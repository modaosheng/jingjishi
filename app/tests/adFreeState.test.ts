/**
 * 去广告状态单测（买断 + 限期体验，v1.5 新增）
 *
 * 覆盖三件事：
 *   ① 限期体验到期后自动失效（按本地日期，含端点）
 *   ② 叠加规则：多次兑换**不吞掉**已有天数
 *   ③ PRD 铁律：「免广告」必须是名副其实的全量去广告 —— 含开屏
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isAdFree,
  loadAdFree,
  setAdFree,
  grantAdFreeDays,
  adFreeDaysLeft,
  shouldShowAd,
  initRelease,
  markActiveDay,
} from '../src/domain/ads/releaseEngine.ts'

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

const DAY = 86_400_000
const NOW = new Date(2026, 8, 1, 10, 0, 0).getTime()

function reset(): void {
  globalThis.localStorage.clear()
}

/** 把用户推到完全体（所有广告位可用），便于验证「去广告压过一切」 */
function reachFullStage(): void {
  initRelease(NOW)
  for (let i = 5; i >= 0; i--) markActiveDay(NOW - i * DAY)
}

/* ==================== 买断 ==================== */

test('未购买时不是免广告状态', () => {
  reset()
  assert.equal(isAdFree(NOW), false)
  assert.equal(loadAdFree().purchased, false)
})

test('买断后永久有效', () => {
  reset()
  setAdFree(true)
  assert.equal(isAdFree(NOW), true)
  // 十年后仍然有效
  assert.equal(isAdFree(NOW + 3650 * DAY), true, '买断必须永久')
  assert.equal(adFreeDaysLeft(NOW), -1, '-1 表示永久')
})

test('买断可被撤销（退款场景）', () => {
  reset()
  setAdFree(true)
  setAdFree(false)
  assert.equal(isAdFree(NOW), false)
})

/* ==================== 限期体验 ==================== */

test('发放 1 天免广告体验后立即生效', () => {
  reset()
  grantAdFreeDays(1, NOW)
  assert.equal(isAdFree(NOW), true)
  assert.equal(adFreeDaysLeft(NOW), 1)
})

test('限期体验到期后自动失效', () => {
  reset()
  grantAdFreeDays(1, NOW)
  assert.equal(isAdFree(NOW), true, '当天有效')
  assert.equal(isAdFree(NOW + DAY), false, '次日应失效')
})

test('到期日当天仍有效（含端点）', () => {
  reset()
  grantAdFreeDays(3, NOW)
  // 第 3 天仍是有效期内
  assert.equal(isAdFree(NOW + 2 * DAY), true)
  assert.equal(adFreeDaysLeft(NOW + 2 * DAY), 1)
  // 第 4 天失效
  assert.equal(isAdFree(NOW + 3 * DAY), false)
})

test('发放 30 天体验 → 剩余 30 天', () => {
  reset()
  grantAdFreeDays(30, NOW)
  assert.equal(adFreeDaysLeft(NOW), 30)
})

test('多次兑换叠加，不吞掉已有天数（对用户诚实）', () => {
  reset()
  grantAdFreeDays(1, NOW)
  grantAdFreeDays(7, NOW) // 从原到期日继续累加
  assert.equal(adFreeDaysLeft(NOW), 8, '1 天 + 7 天 = 8 天')
})

test('体验已过期后再兑换，从今天重新计算', () => {
  reset()
  grantAdFreeDays(1, NOW)
  // 10 天后再兑换
  grantAdFreeDays(1, NOW + 10 * DAY)
  assert.equal(adFreeDaysLeft(NOW + 10 * DAY), 1, '过期后应从今天重新起算，而非累积负天数')
})

/* ==================== 与渐进释放的关系 ==================== */

test('⛔ 免广告期间，全部广告位（含开屏）一律不展示', () => {
  reset()
  reachFullStage()
  // 前置：完全体下开屏本来是可见的
  assert.equal(shouldShowAd('splash', NOW), true)

  grantAdFreeDays(1, NOW)
  // PRD 铁律：「免广告」必须是名副其实的全量去广告，不能有例外
  assert.equal(shouldShowAd('splash', NOW), false, '开屏也必须一并移除')
  assert.equal(shouldShowAd('result_card', NOW), false)
  assert.equal(shouldShowAd('reward_center', NOW), false)
})

test('免广告到期后，广告按原阶段恢复（不得被重置）', () => {
  reset()
  reachFullStage()
  grantAdFreeDays(1, NOW)
  // 次日体验到期，完全体状态应完好保留
  assert.equal(shouldShowAd('splash', NOW + DAY), true, '到期后应恢复原本的释放状态')
  assert.equal(shouldShowAd('result_card', NOW + DAY), true)
})

/* ==================== 向后兼容 ==================== */

test('旧格式（布尔值 1）能被正确读取', () => {
  reset()
  globalThis.localStorage.setItem('jingshi.remove_ads', '1')
  assert.equal(isAdFree(NOW), true, 'v1.5 之前的购买记录不能丢')
  assert.equal(loadAdFree().purchased, true)
})

test('存储内容损坏时降级为「未去广告」而非抛错', () => {
  reset()
  globalThis.localStorage.setItem('jingshi.remove_ads', '{{{ 坏数据')
  assert.doesNotThrow(() => isAdFree(NOW))
  assert.equal(isAdFree(NOW), false)
})
