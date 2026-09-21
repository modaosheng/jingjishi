/**
 * 渐进释放状态机单测（PRD §15 明确要求「逻辑简单但需严格单测」）
 *
 * 运行：node --experimental-strip-types --test tests/releaseEngine.test.ts
 *
 * 测试策略：状态机是**纯逻辑**（只依赖传入的 now 与 localStorage），
 * 因此不需要 mock 网络或数据库，只需一个最小 localStorage 垫片。
 */

// ---------- 最小 localStorage 垫片（Node 环境无此 API） ----------
const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
} as Storage

import { strict as assert } from 'node:assert'
import { test, beforeEach } from 'node:test'

import {
  computeStage,
  initRelease,
  markActiveDay,
  advance,
  isSlotReleased,
  releasedSlots,
  shouldShowAd,
  setAdFree,
  isAdFree,
  stageProgress,
  naturalDaysBetween,
  localDateKey,
  STAGE_THRESHOLDS,
  NATURAL_DAY_FALLBACK_FACTOR,
  NATURAL_FALLBACK_MAX_GAP_DAYS,
  daysSinceLastActive,
  SLOTS_BY_STAGE,
  type ActivityRecord,
  type ReleaseStage,
} from '../src/domain/ads/releaseEngine.ts'

/** 造一个「首启于 firstLaunchMs，已有 n 个活跃日」的记录 */
function rec(activeCount: number, firstLaunchMs: number): ActivityRecord {
  return {
    firstLaunchAt: firstLaunchMs,
    activeDays: Array.from({ length: activeCount }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`),
    stage: 0,
    history: [],
  }
}

/**
 * 造一个「最近活跃」的记录：活跃日连续排到 now 附近。
 * ⚠️ v1.5 新增兜底前置条件后，测试兜底必须用这个构造函数 ——
 *    因为「距上次活跃 ≤ 3 天」是兜底生效的必要条件。
 */
function recRecentlyActive(activeCount: number, now: number): ActivityRecord {
  const days: string[] = []
  for (let i = activeCount - 1; i >= 0; i--) {
    const d = new Date(now - i * DAY)
    days.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
  }
  days.sort()
  return { firstLaunchAt: now - 400 * DAY, activeDays: days, stage: 0, history: [] }
}

const DAY = 86_400_000
// 用固定时间点，避免测试受运行时刻影响
const D0 = new Date('2026-01-01T10:00:00').getTime()

beforeEach(() => {
  store.clear()
})

/* ==================== 阶段阈值 ==================== */

test('阶段阈值符合 PRD：D0 / D1 / D3 / D6', () => {
  assert.equal(STAGE_THRESHOLDS[0], 0)
  assert.equal(STAGE_THRESHOLDS[1], 1)
  assert.equal(STAGE_THRESHOLDS[2], 3)
  assert.equal(STAGE_THRESHOLDS[3], 6)
})

test('广告位释放表：阶段 0 无任何广告位（纯净首日不可妥协）', () => {
  assert.deepEqual(SLOTS_BY_STAGE[0], [])
})

test('广告位释放表：一次只引入一个新位置', () => {
  const s1 = new Set(SLOTS_BY_STAGE[1])
  const s2 = new Set(SLOTS_BY_STAGE[2])
  const s3 = new Set(SLOTS_BY_STAGE[3])
  const newIn2 = [...s2].filter((x) => !s1.has(x))
  const newIn3 = [...s3].filter((x) => !s2.has(x))
  assert.equal(newIn2.length, 2, '阶段 2 引入成果卡 + 奖励中心（后者零打扰，可同批）')
  // v1.5：广告位由 4 个减为 3 个，阶段 3 不再引入新位置（原位置③ AI 额度已删除）
  assert.equal(newIn3.length, 0, 'v1.5 阶段 3 不新增广告位，仅为「完全体」语义标记')
  assert.equal(SLOTS_BY_STAGE[3].length, 3, '完全体共 3 个广告位')
})

/* ==================== 阶段推进：活跃天数主路径 ==================== */

test('活跃 0 天 → 阶段 0', () => {
  assert.equal(computeStage(rec(0, D0), D0).stage, 0)
})

test('活跃 1 天 → 阶段 1（只开开屏）', () => {
  const { stage } = computeStage(rec(1, D0), D0)
  assert.equal(stage, 1)
  assert.deepEqual(SLOTS_BY_STAGE[stage], ['splash'])
})

test('活跃 3 天 → 阶段 2', () => {
  assert.equal(computeStage(rec(3, D0), D0).stage, 2)
})

test('活跃 6 天 → 阶段 3', () => {
  assert.equal(computeStage(rec(6, D0), D0).stage, 3)
})

test('活跃 100 天 → 仍是阶段 3（不会越界）', () => {
  assert.equal(computeStage(rec(100, D0), D0).stage, 3)
})

/* ==================== 自然日兜底 ==================== */

test('兜底倍数应为 2（PRD Q20 决策）', () => {
  assert.equal(NATURAL_DAY_FALLBACK_FACTOR, 2)
})

test('兜底有效期为 3 天（v1.5 修正）', () => {
  assert.equal(NATURAL_FALLBACK_MAX_GAP_DAYS, 3)
})

test('最近活跃 + 自然日达 6 天 → 兜底推进（低频用户不能被长期锁死在低广告）', () => {
  const now = D0 + 6 * DAY
  const record = recRecentlyActive(1, now)
  const { stage, reason } = computeStage(record, now)
  // 首启 400 天前 → 自然日远超阶段 3 的兜底阈值 12 天，兜底直接推到完全体
  assert.equal(stage, 3)
  assert.match(reason, /兜底/)
})

test('最近活跃但自然日不足 → 不被兜底推进', () => {
  const now = D0 + DAY // 自然日 1 天，不足任何兜底阈值
  const record: ActivityRecord = {
    firstLaunchAt: now, // 今天首启
    activeDays: [localDateKey(now)],
    stage: 0,
    history: [],
  }
  const { stage } = computeStage(record, now)
  assert.equal(stage, 1, '活跃 1 天 → 阶段 1（走活跃路径，非兜底）')
})

/* ---- v1.5 修正：长期放置后回归，兜底必须失效 ---- */

test('⛔ 放置 19 天后回归 → 兜底失效，不得直接跳到完全体', () => {
  // 模拟真实场景：2026-01-01 首启、只用了 1 天（1/1）就放置，
  // 2026-01-20 再打开。旧实现会因自然日 19 ≥ 12 直接跳到阶段 3。
  const firstLaunch = D0
  const back = D0 + 19 * DAY
  const record: ActivityRecord = {
    firstLaunchAt: firstLaunch,
    activeDays: ['2026-01-01'], // 只有第一天活跃过
    stage: 0,
    history: [],
  }
  const { stage, reason } = computeStage(record, back)
  assert.equal(stage, 1, '只应有 1 个活跃日 → 阶段 1，而不是被兜底顶到阶段 3')
  assert.match(reason, /活跃 1 天/)
  assert.doesNotMatch(reason, /兜底/, '此处不应引用兜底路径')
})

test('⛔ 从未活跃过（活跃 0 天）→ 永远停在阶段 0，兜底也不生效', () => {
  // 与 PRD「D0 纯净首日不可妥协」一致：一次都没学过，凭什么推广告阶段
  const now = D0 + 60 * DAY
  const record = rec(0, D0)
  const { stage } = computeStage(record, now)
  assert.equal(stage, 0)
})

test('距上次活跃恰好 3 天 → 兜底仍有效（边界含端点）', () => {
  const now = D0 + 30 * DAY
  const lastActive = new Date(now - 3 * DAY)
  const key = `${lastActive.getFullYear()}-${String(lastActive.getMonth() + 1).padStart(2, '0')}-${String(lastActive.getDate()).padStart(2, '0')}`
  const record: ActivityRecord = {
    firstLaunchAt: now - 400 * DAY,
    activeDays: [key],
    stage: 0,
    history: [],
  }
  const { stage } = computeStage(record, now)
  assert.ok(stage >= 1, '3 天整仍在兜底有效期内')
})

test('距上次活跃 4 天 → 兜底失效', () => {
  const now = D0 + 30 * DAY
  const lastActive = new Date(now - 4 * DAY)
  const key = `${lastActive.getFullYear()}-${String(lastActive.getMonth() + 1).padStart(2, '0')}-${String(lastActive.getDate()).padStart(2, '0')}`
  const record: ActivityRecord = {
    firstLaunchAt: now - 400 * DAY,
    activeDays: [key],
    stage: 0,
    history: [],
  }
  const { stage } = computeStage(record, now)
  assert.equal(stage, 1, '超过有效期后兜底不生效，但活跃 1 天仍达阶段 1')
})

test('daysSinceLastActive 在从未活跃时返回 Infinity', () => {
  assert.equal(daysSinceLastActive(rec(0, D0), D0), Infinity)
})

test('活跃天数与自然日都未达标 → 不推进', () => {
  const now = D0 + 2 * DAY
  const { stage } = computeStage(rec(0, D0), now)
  assert.equal(stage, 0, '从未活跃 → 阶段 0')
})

test('取先到者：活跃 3 天但自然日仅 3 天 → 按活跃推进到阶段 2', () => {
  const now = D0 + 3 * DAY
  const { stage, reason } = computeStage(rec(3, D0), now)
  assert.equal(stage, 2)
  assert.match(reason, /活跃/)
})

/* ==================== 不可回退（核心纪律） ==================== */

test('不可回退：已到阶段 3 后，活跃数据被清空也不会降级', () => {
  let r = rec(6, D0)
  r = advance(r, D0 + 6 * DAY)
  assert.equal(r.stage, 3)

  // 模拟异常：活跃日被清空（理论不该发生，但要防御）
  r.activeDays = []
  r = advance(r, D0 + 6 * DAY)
  assert.equal(r.stage, 3, '阶段只增不减')
})

test('不可回退：时间倒流（用户改系统时间）不降级', () => {
  let r = rec(6, D0)
  r = advance(r, D0 + 6 * DAY)
  r = advance(r, D0) // 时间被调回原点
  assert.equal(r.stage, 3)
})

test('推进有历史记录，可追溯原因', () => {
  let r = rec(1, D0)
  r = advance(r, D0 + DAY)
  assert.equal(r.history.length, 1)
  assert.equal(r.history[0]!.stage, 1)
  assert.ok(r.history[0]!.reason.length > 0)
})

/* ==================== markActiveDay 幂等 ==================== */

test('markActiveDay 同日多次调用只记一次', () => {
  initRelease(D0)
  const a = markActiveDay(D0)
  const b = markActiveDay(D0 + 3600_000) // 同一天，晚一小时
  assert.equal(a.activeDays.length, b.activeDays.length)
})

test('markActiveDay 跨日累加', () => {
  initRelease(D0)
  markActiveDay(D0)
  markActiveDay(D0 + DAY)
  const r = markActiveDay(D0 + 2 * DAY)
  assert.equal(r.activeDays.length, 3)
  assert.equal(r.stage, 2, '活跃 3 天 → 阶段 2')
})

/* ==================== 初始化幂等 ==================== */

test('initRelease 幂等：不会重置首启时间', () => {
  const first = initRelease(D0)
  const second = initRelease(D0 + 10 * DAY)
  assert.equal(first.firstLaunchAt, second.firstLaunchAt)
})

/* ==================== 去广告买断 ==================== */

test('购买去广告后，所有广告位立即失效（与阶段无关）', () => {
  initRelease(D0)
  markActiveDay(D0)
  markActiveDay(D0 + DAY)
  markActiveDay(D0 + 2 * DAY)
  markActiveDay(D0 + 3 * DAY)
  markActiveDay(D0 + 4 * DAY)
  const r = markActiveDay(D0 + 5 * DAY)
  assert.equal(r.stage, 3, '前置条件：已到完全体')
  assert.ok(isSlotReleased('splash', D0 + 5 * DAY))

  setAdFree(true)
  assert.equal(isAdFree(), true)
  assert.equal(shouldShowAd('splash', D0 + 5 * DAY), false)
  assert.equal(shouldShowAd('result_card', D0 + 5 * DAY), false)
  assert.equal(shouldShowAd('reward_center', D0 + 5 * DAY), false)

  setAdFree(false)
  assert.equal(shouldShowAd('splash', D0 + 5 * DAY), true, '取消后恢复')
})

test('shouldShowAd 在纯净期对任何广告位都返回 false', () => {
  initRelease(D0)
  assert.equal(shouldShowAd('splash', D0), false)
  assert.equal(shouldShowAd('result_card', D0), false)
  assert.equal(releasedSlots(D0).length, 0)
})

/* ==================== 进度展示 ==================== */

test('stageProgress 给出下一阶段所需天数', () => {
  const p = stageProgress(D0)
  assert.equal(p.stage, 0)
  assert.equal(p.label, '纯净期')
  assert.equal(p.nextStage, 1)
  assert.equal(p.daysToNext, 1)
})

test('stageProgress 在完全体时无下一阶段', () => {
  initRelease(D0)
  for (let i = 0; i < 6; i++) markActiveDay(D0 + i * DAY)
  const p = stageProgress(D0 + 6 * DAY)
  assert.equal(p.stage, 3)
  assert.equal(p.nextStage, null)
  assert.equal(p.daysToNext, 0)
})

/* ==================== 日期工具 ==================== */

test('localDateKey 用本地时区（东八区晚 8 点不算到第二天）', () => {
  // 2026-01-01 20:00 本地时间
  const ts = new Date('2026-01-01T20:00:00').getTime()
  assert.equal(localDateKey(ts), '2026-01-01')
})

test('naturalDaysBetween 计算正确', () => {
  assert.equal(naturalDaysBetween('2026-01-01', '2026-01-01'), 0)
  assert.equal(naturalDaysBetween('2026-01-01', '2026-01-04'), 3)
  assert.equal(naturalDaysBetween('2026-01-04', '2026-01-01'), 0, '倒序返回 0 而非负数')
})

/* ==================== 边界：阶段单调性（穷举） ==================== */

test('穷举：任意活跃天数与自然天数组合下，阶段均单调不减', () => {
  const stages: ReleaseStage[] = []
  for (let natural = 0; natural <= 14; natural++) {
    const r = rec(3, D0) // 固定活跃 3 天
    stages.push(computeStage(r, D0 + natural * DAY).stage)
  }
  for (let i = 1; i < stages.length; i++) {
    assert.ok(
      stages[i]! >= stages[i - 1]!,
      `自然日 ${i} 时阶段 ${stages[i]} 低于前一天的 ${stages[i - 1]}`,
    )
  }
})
