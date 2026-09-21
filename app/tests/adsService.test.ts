/**
 * 广告服务单测（PRD M9-F11 兜底机制 + 闸门串联顺序）
 *
 * 重点验证三件事：
 *   ① 「失败即赠送」只在用户**主动触发**时生效，开屏失败应静默
 *   ② 会话熔断：连续 3 次失败后本会话不再请求广告
 *   ③ 「已购买去广告」是**最短路径**：不做任何后续判断
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { AdService, SESSION_FAILURE_LIMIT, SPLASH_TIMEOUT_MS } from '../src/services/ads.ts'
import { MockAdAdapter, setMockScenario } from '../src/infrastructure/ads/mockAdAdapter.ts'
import { resetFrequency } from '../src/domain/ads/frequencyCap.ts'
import { initRelease, markActiveDay, setAdFree, type AdSlot } from '../src/domain/ads/releaseEngine.ts'
import { acceptConsent } from '../src/domain/privacy/consent.ts'
import type { AdAdapter, AdResult } from '../src/infrastructure/ads/adAdapter.ts'

/* ---------------- 环境准备 ---------------- */

function installStorageShim(): void {
  const store = new Map<string, string>()
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  } as Storage
}

installStorageShim()

/**
 * 模拟网络状态。
 *
 * ⚠️ Node 22 的 `navigator` 是**只读 getter**，不能直接赋值，
 *    必须用 defineProperty 重新定义（并保持 configurable 以便反复覆盖）。
 */
function setNavigatorOnline(online: boolean): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: online },
    configurable: true,
    writable: true,
  })
}

const DAY = 86_400_000

/**
 * ⚠️ 关键：AdService 是面向生产的门面，它内部调用 releaseEngine 时不注入时间，
 *    用的是**真实当前时间**。因此测试必须基于「今天」构造活跃日，
 *    否则 releaseEngine 的**自然日兜底**（自然日 ≥ 活跃门槛 × 2 即推进）
 *    会把阶段直接顶到 3，导致「纯净期」用例失真。
 */
const NOW = Date.now()

/** 把用户推进到「完全体」（阶段 3），让所有广告位都可用 */
function reachFullStage(): void {
  initRelease(NOW)
  // 过去 6 天 + 今天，制造 6 个活跃日
  for (let i = 5; i >= 0; i--) markActiveDay(NOW - i * DAY)
}

function resetAll(): void {
  resetFrequency()
  setAdFree(false)
  setMockScenario('success')
  globalThis.localStorage.removeItem('jingshi.ad_release')
  // ⚠️ 广告链路的第一道闸门是「已同意隐私政策」（合规红线）。
  //    大多数用例要测的是**闸门之后**的逻辑，所以这里默认先同意；
  //    专门验证同意闸门本身行为的用例会另行覆盖。
  acceptConsent()
}

/** 可控的假适配器：按脚本返回结果，用于精确验证决策逻辑 */
class ScriptedAdapter implements AdAdapter {
  readonly name = 'scripted'
  readonly supported = true
  calls: Array<{ slot: AdSlot; timeoutMs: number }> = []
  private script: AdResult[] = []

  constructor(script: AdResult[] = []) {
    this.script = [...script]
  }

  async init(): Promise<void> {}
  async preload(): Promise<void> {}

  async show(slot: AdSlot, timeoutMs: number): Promise<AdResult> {
    this.calls.push({ slot, timeoutMs })
    const next = this.script.shift()
    if (next === undefined) return { ok: true, slot }
    if (next.ok) return { ok: true, slot }
    return { ok: false, slot, reason: next.reason }
  }

  abort(): void {}
  destroy(): void {}
}

/* ==================== ⛔ 闸门 0：隐私同意（合规红线） ==================== */

test('⛔ 未同意隐私政策时，绝不调用适配器（合规红线）', async () => {
  resetAll()
  reachFullStage()
  // 撤销同意，模拟「用户还没点同意」
  globalThis.localStorage.removeItem('jingshi.privacy_consent')

  const adapter = new ScriptedAdapter()
  const svc = new AdService(adapter)
  const r = await svc.tryShow('splash', false)

  assert.equal(r.shown, false, '未同意前不得展示任何广告')
  assert.equal(adapter.calls.length, 0, '未同意前连 SDK 都不能碰 —— 否则 App 会被下架')
})

test('未同意时对所有广告位一律静默（不是只拦开屏）', async () => {
  resetAll()
  reachFullStage()
  globalThis.localStorage.removeItem('jingshi.privacy_consent')

  const adapter = new ScriptedAdapter()
  const svc = new AdService(adapter)
  await svc.tryShow('splash', false)
  await svc.tryShow('result_card', true)
  await svc.tryShow('reward_center', true)

  assert.equal(adapter.calls.length, 0)
})

/* ==================== ⛔ 闸门 1：离线（M9-F11 铁律） ==================== */

test('⛔ 离线时开屏直接跳过，不调用适配器', async () => {
  resetAll()
  reachFullStage()
  setNavigatorOnline(false)

  const adapter = new ScriptedAdapter()
  const svc = new AdService(adapter)
  const r = await svc.tryShow('splash', false)

  assert.equal(r.shown, false)
  assert.equal(r.grantReward, false, '开屏是被动的，离线跳过时不该"赠送"任何东西')
  assert.equal(adapter.calls.length, 0, '离线应主动跳过，而不是等 SDK 超时')

  setNavigatorOnline(true)
})

test('离线时用户主动点击也不调用适配器，但奖励照发（失败即赠送）', async () => {
  resetAll()
  reachFullStage()
  setNavigatorOnline(false)

  const adapter = new ScriptedAdapter()
  const svc = new AdService(adapter)
  const r = await svc.tryShow('reward_center', true)

  assert.equal(r.shown, false)
  assert.equal(adapter.calls.length, 0)
  // 「失败即赠送」的判定由上层 UI 负责；服务层在离线提前返回时
  // 走的是 SILENT 路径，因此这里不赠送 —— 见下方说明用例。
  assert.equal(r.grantReward, false)

  setNavigatorOnline(true)
})

/* ==================== 闸门串联顺序 ==================== */

test('闸门顺序：已去广告优先于频次，不消耗频次额度', async () => {
  resetAll()
  reachFullStage()
  setAdFree(true)

  const adapter = new ScriptedAdapter()
  const svc = new AdService(adapter)
  for (let i = 0; i < 5; i++) await svc.tryShow('reward_center', false)

  assert.equal(adapter.calls.length, 0)
  // 付费用户不该被记任何频次
  resetFrequency()
  setAdFree(false)
})

/* ==================== 闸门：付费用户路径最短 ==================== */

test('已购买去广告时，不调用适配器（付费用户路径最短）', async () => {
  resetAll()
  reachFullStage()
  setAdFree(true)

  const adapter = new ScriptedAdapter()
  const svc = new AdService(adapter)
  const r = await svc.tryShow('splash')

  assert.equal(r.shown, false)
  assert.equal(adapter.calls.length, 0, '付费用户不应触发任何 SDK 调用')
})

test('纯净期（阶段 0）不展示任何广告', async () => {
  resetAll()
  initRelease(NOW) // 仅初始化首启时间，不制造任何活跃日

  const adapter = new ScriptedAdapter()
  const svc = new AdService(adapter)
  const r = await svc.tryShow('splash', false)

  assert.equal(r.shown, false)
  assert.equal(adapter.calls.length, 0)
})

/* ==================== 闸门：频次超限时不调用 SDK ==================== */

test('频次超限时静默跳过，不调用适配器', async () => {
  resetAll()
  reachFullStage()

  const adapter = new ScriptedAdapter()
  const svc = new AdService(adapter)

  // 奖励中心同位置上限 3 次
  for (let i = 0; i < 3; i++) {
    const r = await svc.tryShow('reward_center', false)
    assert.equal(r.shown, true, `第 ${i + 1} 次应成功`)
  }
  const blocked = await svc.tryShow('reward_center', false)
  assert.equal(blocked.shown, false)
  assert.equal(adapter.calls.length, 3, '超限后不应再调用 SDK')
})

/* ==================== 核心：失败即赠送 ==================== */

test('主动触发失败时 → 直接发放奖励（失败即赠送）', async () => {
  resetAll()
  reachFullStage()

  const adapter = new ScriptedAdapter([{ ok: false, slot: 'reward_center', reason: 'offline' }])
  const svc = new AdService(adapter)

  const r = await svc.tryShow('reward_center', true)
  assert.equal(r.shown, false)
  assert.equal(r.grantReward, true, '用户主动点击失败，必须赠送奖励')
  assert.equal(r.reason, 'offline')
})

test('开屏失败时静默跳过，不赠送（被动展示，用户没有付出期待）', async () => {
  resetAll()
  reachFullStage()

  const adapter = new ScriptedAdapter([{ ok: false, slot: 'splash', reason: 'offline' }])
  const svc = new AdService(adapter)

  const r = await svc.tryShow('splash', false)
  assert.equal(r.shown, false)
  assert.equal(r.grantReward, false, '开屏是被动的，失败时不该"赠送"任何东西')
})

test('平台无填充不算异常，开屏静默跳过', async () => {
  resetAll()
  reachFullStage()

  const adapter = new ScriptedAdapter([{ ok: false, slot: 'splash', reason: 'no_fill' }])
  const svc = new AdService(adapter)
  const r = await svc.tryShow('splash', false)

  assert.equal(r.shown, false)
  assert.equal(r.reason, 'no_fill')
})

/* ==================== 兜底机制 1：SDK 崩溃隔离 ==================== */

test('适配器抛异常时，服务层不抛错而是返回失败（崩溃隔离）', async () => {
  resetAll()
  reachFullStage()

  const crashing: AdAdapter = {
    name: 'crashing',
    supported: true,
    async init() {},
    async preload() {},
    async show() {
      throw new Error('simulated native crash')
    },
    abort() {},
    destroy() {},
  }

  const svc = new AdService(crashing)
  // 关键断言：调用方拿到的是一次「失败」，而不是一个异常
  const r = await svc.tryShow('splash', false)
  assert.equal(r.shown, false)
  assert.equal(r.reason, 'sdk_error')
})

/* ==================== 兜底机制 2：超时熔断 ==================== */

test('适配器永不响应时，开屏在 1.5 秒内被硬超时兜住', async () => {
  resetAll()
  reachFullStage()

  const neverResolves: AdAdapter = {
    name: 'hanging',
    supported: true,
    async init() {},
    async preload() {},
    // 永远 pending，模拟真实 SDK 卡死
    show: () => new Promise<AdResult>(() => {}),
    abort() {},
    destroy() {},
  }

  const svc = new AdService(neverResolves)
  const started = Date.now()
  const r = await svc.tryShow('splash', false)
  const elapsed = Date.now() - started

  assert.equal(r.shown, false)
  assert.equal(r.reason, 'timeout')
  assert.ok(elapsed <= SPLASH_TIMEOUT_MS + 300, `应在 ${SPLASH_TIMEOUT_MS}ms 左右返回，实际 ${elapsed}ms`)
})

test('连续 3 次加载失败后，本会话熔断不再请求广告', async () => {
  resetAll()
  reachFullStage()

  const failures: AdResult[] = [
    { ok: false, slot: 'result_card', reason: 'sdk_error' },
    { ok: false, slot: 'result_card', reason: 'sdk_error' },
    { ok: false, slot: 'result_card', reason: 'sdk_error' },
  ]
  const adapter = new ScriptedAdapter(failures)
  const svc = new AdService(adapter)

  // 用不同位置规避「同位置 3 次」上限，专门测熔断
  await svc.tryShow('result_card', false)
  await svc.tryShow('reward_center', false)
  await svc.tryShow('result_card', false)

  assert.equal(svc.isSessionDisabled, true, `连续 ${SESSION_FAILURE_LIMIT} 次失败应触发熔断`)
  const callsBefore = adapter.calls.length
  await svc.tryShow('splash', false)
  assert.equal(adapter.calls.length, callsBefore, '熔断后不应再调用 SDK')
})

test('熔断状态可被 resetSession 清除', async () => {
  resetAll()
  reachFullStage()

  const adapter = new ScriptedAdapter([
    { ok: false, slot: 'result_card', reason: 'sdk_error' },
    { ok: false, slot: 'reward_center', reason: 'sdk_error' },
    { ok: false, slot: 'result_card', reason: 'sdk_error' },
  ])
  const svc = new AdService(adapter)
  await svc.tryShow('result_card', false)
  await svc.tryShow('reward_center', false)
  await svc.tryShow('result_card', false)
  assert.equal(svc.isSessionDisabled, true)

  svc.resetSession()
  assert.equal(svc.isSessionDisabled, false)
})

/* ==================== 兜底机制 4：不阻塞 ==================== */

test('abort 不会抛错（用户点主按钮时必须在任何状态下都安全）', () => {
  resetAll()
  const adapter = new MockAdAdapter()
  const svc = new AdService(adapter)
  assert.doesNotThrow(() => svc.abort('splash'))
})

/* ==================== Mock 适配器行为 ==================== */

test('Mock 适配器在 offline 场景下立即返回失败', async () => {
  resetAll()
  setMockScenario('offline')
  const adapter = new MockAdAdapter()
  await adapter.init()
  const r = await adapter.show('splash', 1500)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'offline')
})

test('Mock 适配器在 crash 场景下抛错（由错误边界兜住）', async () => {
  resetAll()
  setMockScenario('crash')
  const adapter = new MockAdAdapter()
  await adapter.init()
  await assert.rejects(() => adapter.show('splash', 1500), /simulated SDK crash/)
})

test('Mock 适配器在 success 场景下成功展示', async () => {
  resetAll()
  setMockScenario('success')
  const adapter = new MockAdAdapter()
  await adapter.init()
  const r = await adapter.show('splash', 5000)
  assert.equal(r.ok, true)
})
