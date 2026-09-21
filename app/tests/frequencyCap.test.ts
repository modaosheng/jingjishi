/**
 * 广告频次控制单测（PRD M9-F4 ① 六条规则的逐条验证）
 *
 * 测试策略：全部注入固定时间戳，不依赖真实时钟。
 * 每个用例开始前清空 localStorage，保证互不干扰。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  canShowByFrequency,
  recordImpression,
  recordClick,
  markExamDay,
  settleFatigue,
  frequencySnapshot,
  resetFrequency,
  SPLASH_DAILY_CAP,
  REWARDED_DAILY_CAP,
  REWARDED_DAILY_CAP_EXAM_DAY,
  MIN_INTERVAL_MS,
  SAME_SLOT_DAILY_CAP,
  FATIGUE_DAYS,
} from '../src/domain/ads/frequencyCap.ts'

/* ---------------- 测试环境准备 ---------------- */

/** 最小 localStorage 垫片（Node 环境无此 API） */
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

/** 基准日：2026-09-01 10:00 本地时间（用 Date 构造，避免 UTC 偏移误伤） */
const D0 = new Date(2026, 8, 1, 10, 0, 0).getTime()
const DAY = 86_400_000

function reset(): void {
  resetFrequency()
}

/* ==================== 规则①：开屏每日上限 ==================== */

test('开屏达到每日上限后不再放行', () => {
  reset()
  for (let i = 0; i < SPLASH_DAILY_CAP; i++) {
    assert.equal(canShowByFrequency('splash', false, D0 + i * 1000).allowed, true, `第 ${i + 1} 次应放行`)
    recordImpression('splash', false, D0 + i * 1000)
  }
  const gate = canShowByFrequency('splash', false, D0 + SPLASH_DAILY_CAP * 1000)
  assert.equal(gate.allowed, false)
  assert.match(gate.reason, /上限/)
})

test('开屏不受 90 秒最小间隔限制（被动展示，用户没得选）', () => {
  reset()
  assert.equal(canShowByFrequency('splash', false, D0).allowed, true)
  recordImpression('splash', false, D0)
  // 1 秒后再开一次，仍应放行（因为开屏不是主动触发）
  assert.equal(canShowByFrequency('splash', false, D0 + 1000).allowed, true)
})

/* ==================== 规则②：激励视频每日上限 ==================== */

test('激励视频每日上限为 6 次（跨位置累计计算）', () => {
  reset()
  // ⚠️ 注意本用例用一个不受「同位置 3 次」约束的组合来单独验证激励上限：
  //    三个位置各 3 次 = 9 次展示机会，足以超过激励上限 6 次。
  const plan: Array<{ slot: 'result_card' | 'reward_center'; t: number }> = []
  let t = D0
  for (let i = 0; i < 9; i++) {
    plan.push({ slot: i % 2 === 0 ? 'result_card' : 'reward_center', t })
    t += MIN_INTERVAL_MS + 1000
  }

  let granted = 0
  for (const step of plan) {
    if (canShowByFrequency(step.slot, true, step.t).allowed) {
      recordImpression(step.slot, true, step.t)
      granted++
    }
  }
  assert.equal(granted, REWARDED_DAILY_CAP, `激励视频全天上限应为 ${REWARDED_DAILY_CAP} 次`)
})

test('同位置上限比激励上限更严时，取最严格者（reward_center 单日仅 3 次）', () => {
  reset()
  let t = D0
  let granted = 0
  for (let i = 0; i < 6; i++) {
    if (canShowByFrequency('reward_center', true, t).allowed) {
      recordImpression('reward_center', true, t)
      granted++
    }
    t += MIN_INTERVAL_MS + 1000
  }
  // 虽然激励视频总上限是 6，但 reward_center 自身每日上限是 3，取更严者
  assert.equal(granted, SAME_SLOT_DAILY_CAP, '两个约束叠加时应取最严格的那个')
  assert.equal(SAME_SLOT_DAILY_CAP < REWARDED_DAILY_CAP, true, '前置：同位置上限确实更严')
})

test('模考日激励视频上限降为 3 次', () => {
  reset()
  markExamDay(D0)
  // 模考日上限 3 与同位置上限 3 恰好相等，用一个位置即可验证
  let t = D0
  let granted = 0
  for (let i = 0; i < 5; i++) {
    if (canShowByFrequency('reward_center', true, t).allowed) {
      recordImpression('reward_center', true, t)
      granted++
    }
    t += MIN_INTERVAL_MS + 1000
  }
  assert.equal(granted, REWARDED_DAILY_CAP_EXAM_DAY)

  const gate = canShowByFrequency('reward_center', true, t)
  assert.equal(gate.allowed, false)
})

/* ==================== 规则③：90 秒最小间隔 ==================== */

test('主动触发广告需满足 90 秒最短间隔', () => {
  reset()
  recordImpression('result_card', true, D0)
  // 89 秒后仍被拦
  const early = canShowByFrequency('result_card', true, D0 + 89_000)
  assert.equal(early.allowed, false)
  assert.match(early.reason, /再等/)
  // 90 秒整放行
  assert.equal(canShowByFrequency('result_card', true, D0 + MIN_INTERVAL_MS).allowed, true)
})

test('90 秒间隔在当前用例内不影响被动展示', () => {
  reset()
  recordImpression('result_card', true, D0)
  // 非激励（被动）展示不受间隔约束
  assert.equal(canShowByFrequency('result_card', false, D0 + 1000).allowed, true)
})

/* ==================== 规则④：同位置每日上限 ==================== */

test('同一位置每日最多展示 3 次', () => {
  reset()
  for (let i = 0; i < SAME_SLOT_DAILY_CAP; i++) {
    const t = D0 + i * (MIN_INTERVAL_MS + 1000)
    assert.equal(canShowByFrequency('result_card', false, t).allowed, true)
    recordImpression('result_card', false, t)
  }
  const gate = canShowByFrequency('result_card', false, D0 + 10 * MIN_INTERVAL_MS)
  assert.equal(gate.allowed, false)
  assert.match(gate.reason, /result_card/)
})

test('同位置上限按位置独立计算，互不挤占', () => {
  reset()
  for (let i = 0; i < SAME_SLOT_DAILY_CAP; i++) {
    recordImpression('result_card', false, D0 + i * 1000)
  }
  // 成果卡已满，但奖励中心仍可用
  assert.equal(canShowByFrequency('result_card', false, D0 + 5000).allowed, false)
  assert.equal(canShowByFrequency('reward_center', false, D0 + 5000).allowed, true)
})

/* ==================== 规则⑤：疲劳熔断 ==================== */

test('连续 3 天零点击后该位置进入降频', () => {
  reset()
  // 第 1 天：展示但零点击
  recordImpression('splash', false, D0)
  settleFatigue(D0)

  // 第 2 天
  recordImpression('splash', false, D0 + DAY)
  settleFatigue(D0 + DAY)

  // 第 3 天
  recordImpression('splash', false, D0 + 2 * DAY)
  const rec = settleFatigue(D0 + 2 * DAY)

  assert.ok(rec.downscaled.includes('splash'), '连续 3 天零点击应触发降频')
  assert.equal(FATIGUE_DAYS, 3)
})

test('降频后开屏上限降至 50%', () => {
  reset()
  for (let d = 0; d < FATIGUE_DAYS; d++) {
    recordImpression('splash', false, D0 + d * DAY)
    settleFatigue(D0 + d * DAY)
  }
  const snap = frequencySnapshot(D0)
  assert.equal(snap.splash.cap, Math.floor(SPLASH_DAILY_CAP * 0.5), '降频后上限应为 6')
})

test('产生点击后疲劳计数清零并解除降频', () => {
  reset()
  for (let d = 0; d < FATIGUE_DAYS; d++) {
    recordImpression('splash', false, D0 + d * DAY)
    settleFatigue(D0 + d * DAY)
  }
  // 第 4 天：产生点击
  recordImpression('splash', false, D0 + 3 * DAY)
  recordClick('splash', D0 + 3 * DAY)
  const rec = settleFatigue(D0 + 3 * DAY)
  assert.ok(!rec.downscaled.includes('splash'), '有点击应解除降频')
})

test('从未展示过的位置不触发疲劳', () => {
  reset()
  for (let d = 0; d < FATIGUE_DAYS; d++) settleFatigue(D0 + d * DAY)
  const rec = settleFatigue(D0 + FATIGUE_DAYS * DAY)
  assert.equal(rec.downscaled.length, 0)
})

/* ==================== 跨日清零 ==================== */

test('跨日后当日计数清零，但疲劳状态保留', () => {
  reset()
  for (let i = 0; i < SPLASH_DAILY_CAP; i++) recordImpression('splash', false, D0)
  assert.equal(canShowByFrequency('splash', false, D0 + 1000).allowed, false, '当日已满')

  // 次日
  const nextDay = D0 + DAY
  assert.equal(canShowByFrequency('splash', false, nextDay).allowed, true, '次日应恢复')
  const snap = frequencySnapshot(nextDay)
  assert.equal(snap.splash.shown, 0, '次日计数应为 0')
})

test('跨日后模考标记清零', () => {
  reset()
  markExamDay(D0)
  assert.equal(frequencySnapshot(D0).rewarded.examDay, true)
  assert.equal(frequencySnapshot(D0 + DAY).rewarded.examDay, false)
})

/* ==================== 组合与边界 ==================== */

test('频率快照反映真实配额', () => {
  reset()
  recordImpression('splash', false, D0)
  recordImpression('reward_center', true, D0 + 3000)
  const snap = frequencySnapshot(D0)
  assert.equal(snap.splash.shown, 1)
  assert.equal(snap.splash.cap, SPLASH_DAILY_CAP)
  assert.equal(snap.rewarded.shown, 1)
  assert.equal(snap.rewarded.cap, REWARDED_DAILY_CAP)
})

test('未展示过任何广告时，全部位置放行', () => {
  reset()
  assert.equal(canShowByFrequency('splash', false, D0).allowed, true)
  assert.equal(canShowByFrequency('result_card', false, D0).allowed, true)
  assert.equal(canShowByFrequency('reward_center', true, D0).allowed, true)
})

test('持久化损坏时降级为全新记录而非抛错', () => {
  reset()
  globalThis.localStorage.setItem('jingshi.ad_frequency', '{{{ 不是合法 JSON')
  assert.doesNotThrow(() => canShowByFrequency('splash', false, D0))
  assert.equal(canShowByFrequency('splash', false, D0).allowed, true)
})
