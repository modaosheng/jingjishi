/**
 * 广告频次控制（PRD M9-F4 ①）
 *
 * 职责边界（与 releaseEngine 严格分工，勿混）：
 *   - releaseEngine  → 「什么时候开始有广告」（渐进释放，按活跃天数）
 *   - frequencyCap   → 「一天最多看几次、多久才能再看一次」（频次闸门）
 *
 * 两者是**串联**关系：一个广告位必须先通过 releaseEngine.shouldShowAd()，
 * 再通过 frequencyCap 的闸门，才允许真正发起广告请求。
 *
 * ⚠️ 本模块同样是**纯本地逻辑**：不依赖网络、不依赖任何 SDK、不做副作用以外的事。
 *    它的全部意义是：**广告的打扰程度由我们主动控制，而不是由服务端填充率决定。**
 *
 * PRD M9-F4 ① 频次上限表：
 *   | 规则                    | 数值                          |
 *   | 开屏每日上限             | 12 次/日（冷启动才展示，热启动不算）  |
 *   | 每日激励视频总上限         | 6 次/日                       |
 *   | 主动触发广告的单次最短间隔   | 90 秒                         |
 *   | 同一位置每日展示上限        | 3 次（位置①/②/③）              |
 *   | 疲劳熔断                 | 连续 3 天某位置点击率为 0 → 该位置降频 50% |
 *   | 模考日保护               | 当日完成过模考 → 当日激励视频上限降为 3 次 |
 */

import { localDateKey, type AdSlot } from './releaseEngine'

const LS_FREQ = 'jingshi.ad_frequency'

/* ---------------- 常量（全部来自 PRD，修改需同步 PRD） ---------------- */

/** 开屏每日上限：冷启动才展示，热启动不计入 */
export const SPLASH_DAILY_CAP = 12

/** 激励视频每日上限（常规） */
export const REWARDED_DAILY_CAP = 6

/** 激励视频每日上限（模考日降频） */
export const REWARDED_DAILY_CAP_EXAM_DAY = 3

/** 主动触发类广告的单次最短间隔（毫秒） */
export const MIN_INTERVAL_MS = 90_000

/** 同一位置每日展示上限（位置①成果卡 / 位置②奖励中心） */
export const SAME_SLOT_DAILY_CAP = 3

/** 疲劳熔断：连续 N 天点击率为 0 触发 */
export const FATIGUE_DAYS = 3

/** 疲劳熔断触发后的降频比例（降至 50%） */
export const FATIGUE_DOWNSCALE = 0.5

/* ---------------- 数据结构 ---------------- */

/** 单个广告位的当日计数与点击表现 */
interface SlotStat {
  /** 当日已展示次数 */
  shown: number
  /** 当日被点击次数 */
  clicked: number
}

export interface FrequencyRecord {
  /** 统计所属的本地日期键 'YYYY-MM-DD'，跨日自动清零 */
  dateKey: string
  /** 各广告位的当日统计 */
  slots: Partial<Record<AdSlot, SlotStat>>
  /** 今日开屏展示次数（单独计，因为开屏有独立上限） */
  splashShown: number
  /** 今日激励视频次数（单独计，因为跨位置共享一个上限） */
  rewardedShown: number
  /** 今日是否完成过模考（触发激励视频降频） */
  examDay: boolean
  /** 上一次**主动触发类**广告展示的时间戳（用于 90 秒最小间隔） */
  lastActiveAdAt: number
  /** 疲劳熔断记录：某位置的连续零点击天数 */
  fatigueStreak: Partial<Record<AdSlot, number>>
  /** 已经被降频的位置（熔断生效期） */
  downscaled: AdSlot[]
}

function emptyRecord(dateKey: string): FrequencyRecord {
  return {
    dateKey,
    slots: {},
    splashShown: 0,
    rewardedShown: 0,
    examDay: false,
    lastActiveAdAt: 0,
    fatigueStreak: {},
    downscaled: [],
  }
}

/* ---------------- 持久化 ---------------- */

/**
 * 读取频次记录，并在跨日时**自动清零当日计数**。
 * ⚠️ 跨日清零但**保留** `fatigueStreak` 与 `downscaled`（它们是跨天累积的判断依据）。
 */
export function loadFrequency(now: number = Date.now()): FrequencyRecord {
  const today = localDateKey(now)
  let recovered: FrequencyRecord | null = null

  try {
    const raw = localStorage.getItem(LS_FREQ)
    if (raw) {
      const p = JSON.parse(raw) as Partial<FrequencyRecord>
      if (p && typeof p.dateKey === 'string') {
        recovered = {
          dateKey: p.dateKey,
          slots: p.slots ?? {},
          splashShown: typeof p.splashShown === 'number' ? p.splashShown : 0,
          rewardedShown: typeof p.rewardedShown === 'number' ? p.rewardedShown : 0,
          examDay: p.examDay === true,
          lastActiveAdAt: typeof p.lastActiveAdAt === 'number' ? p.lastActiveAdAt : 0,
          fatigueStreak: p.fatigueStreak ?? {},
          downscaled: Array.isArray(p.downscaled) ? p.downscaled : [],
        }
      }
    }
  } catch {
    recovered = null
  }

  if (!recovered) return emptyRecord(today)

  // 跨日：把当日计数清零，但保留跨天累积的熔断状态
  if (recovered.dateKey !== today) {
    return {
      ...emptyRecord(today),
      fatigueStreak: recovered.fatigueStreak,
      downscaled: recovered.downscaled,
    }
  }
  return recovered
}

function persist(record: FrequencyRecord): void {
  try {
    localStorage.setItem(LS_FREQ, JSON.stringify(record))
  } catch {
    /* 配额不足时静默：频次控制失效的代价远小于让广告逻辑抛错 */
  }
}

/* ---------------- 闸门判断 ---------------- */

export interface AdGateResult {
  /** 是否允许展示 */
  allowed: boolean
  /** 不允许的原因（供调试与埋点，**绝不展示给用户**） */
  reason: string
}

const ALLOW: AdGateResult = { allowed: true, reason: '' }

function deny(reason: string): AdGateResult {
  return { allowed: false, reason }
}

/**
 * 判断某广告位此刻是否可以展示。
 *
 * ⚠️ 这是**唯一**的频次闸门入口。UI 层不得自行判断次数——
 *    否则每新增一个广告位都要重新实现一遍全部规则，必然漏掉某条。
 *
 * @param slot        广告位
 * @param isRewarded  该次展示是否为「激励视频」（用户主动点击换取奖励）
 * @param now         当前时间戳（便于单测注入）
 */
export function canShowByFrequency(
  slot: AdSlot,
  isRewarded = false,
  now: number = Date.now(),
): AdGateResult {
  const rec = loadFrequency(now)

  // ① 90 秒最小间隔：仅约束**主动触发类**广告（开屏是被动的，用户没得选，不应被此限制）
  if (isRewarded && rec.lastActiveAdAt > 0 && now - rec.lastActiveAdAt < MIN_INTERVAL_MS) {
    const wait = Math.ceil((MIN_INTERVAL_MS - (now - rec.lastActiveAdAt)) / 1000)
    return deny(`距上次主动触发仅 ${Math.floor((now - rec.lastActiveAdAt) / 1000)}s，需再等 ${wait}s`)
  }

  // ② 开屏：独立日上限，且受疲劳熔断降频
  if (slot === 'splash') {
    const cap = rec.downscaled.includes('splash')
      ? Math.floor(SPLASH_DAILY_CAP * FATIGUE_DOWNSCALE)
      : SPLASH_DAILY_CAP
    if (rec.splashShown >= cap) {
      return deny(`开屏今日已达上限 ${cap} 次${rec.downscaled.includes('splash') ? '（疲劳降频中）' : ''}`)
    }
    return ALLOW
  }

  // ③ 激励视频：跨位置共享一个日上限，模考日降为 3 次
  if (isRewarded) {
    const cap = rec.examDay ? REWARDED_DAILY_CAP_EXAM_DAY : REWARDED_DAILY_CAP
    if (rec.rewardedShown >= cap) {
      return deny(`激励视频今日已达上限 ${cap} 次${rec.examDay ? '（模考日降频）' : ''}`)
    }
  }

  // ④ 同位置日上限（成果卡 / 奖励中心）
  const stat = rec.slots[slot] ?? { shown: 0, clicked: 0 }
  const sameCap = rec.downscaled.includes(slot)
    ? Math.max(1, Math.floor(SAME_SLOT_DAILY_CAP * FATIGUE_DOWNSCALE))
    : SAME_SLOT_DAILY_CAP
  if (stat.shown >= sameCap) {
    return deny(`${slot} 今日已达上限 ${sameCap} 次${rec.downscaled.includes(slot) ? '（疲劳降频中）' : ''}`)
  }

  return ALLOW
}

/* ---------------- 计数上报（由展示层调用） ---------------- */

/**
 * 记录一次**实际发生的展示**。
 * ⚠️ 必须在广告真正展示后调用，而不是在发起请求时——
 *    否则「请求了但没展示成功」也会消耗用户额度，这是对用户不诚实。
 */
export function recordImpression(
  slot: AdSlot,
  isRewarded = false,
  now: number = Date.now(),
): FrequencyRecord {
  const rec = loadFrequency(now)
  const stat = rec.slots[slot] ?? { shown: 0, clicked: 0 }
  stat.shown += 1
  rec.slots[slot] = stat

  if (slot === 'splash') rec.splashShown += 1
  if (isRewarded) {
    rec.rewardedShown += 1
    rec.lastActiveAdAt = now
  }

  persist(rec)
  return rec
}

/** 记录一次点击（用于疲劳熔断判断） */
export function recordClick(slot: AdSlot, now: number = Date.now()): FrequencyRecord {
  const rec = loadFrequency(now)
  const stat = rec.slots[slot] ?? { shown: 0, clicked: 0 }
  stat.clicked += 1
  rec.slots[slot] = stat
  persist(rec)
  return rec
}

/** 标记今日完成过模考 → 当日激励视频上限降为 3 次 */
export function markExamDay(now: number = Date.now()): FrequencyRecord {
  const rec = loadFrequency(now)
  rec.examDay = true
  persist(rec)
  return rec
}

/**
 * 日终结算疲劳状态：连续 3 天某位置点击率为 0 → 加入降频名单。
 *
 * ⚠️ 调用时机：跨日时（由 `loadFrequency` 检测到 dateKey 变化后自行调用亦可）。
 *    这里保留显式函数，是为了让 ESLint 与测试都能清楚看到「跨日结算」这个动作。
 *
 * 设计意图：自动识别「对这个位置不感兴趣」的用户，**主动退让**。
 *          宁可少赚，也不要让用户因为反复看到无效广告而厌烦。
 */
export function settleFatigue(now: number = Date.now()): FrequencyRecord {
  const rec = loadFrequency(now)
  const candidates: AdSlot[] = ['splash', 'result_card', 'reward_center']

  for (const slot of candidates) {
    const stat = rec.slots[slot]
    // 只有真正展示过、且零点击的位置才计入疲劳
    if (stat && stat.shown > 0 && stat.clicked === 0) {
      const streak = (rec.fatigueStreak[slot] ?? 0) + 1
      rec.fatigueStreak[slot] = streak
      if (streak >= FATIGUE_DAYS && !rec.downscaled.includes(slot)) {
        rec.downscaled.push(slot)
      }
    } else if (stat && stat.clicked > 0) {
      // 有点击 → 清零连续计数，并从降频名单移除（用户重新产生兴趣）
      rec.fatigueStreak[slot] = 0
      rec.downscaled = rec.downscaled.filter((s) => s !== slot)
    }
  }

  persist(rec)
  return rec
}

/**
 * 供调试页 / 广告设置页展示的透明化信息。
 * PRD 要求「保证透明度」——用户有权知道我们每天给他看多少广告。
 */
export function frequencySnapshot(now: number = Date.now()): {
  dateKey: string
  splash: { shown: number; cap: number }
  rewarded: { shown: number; cap: number; examDay: boolean }
  slots: Array<{ slot: AdSlot; shown: number; cap: number; downscaled: boolean }>
} {
  const rec = loadFrequency(now)
  const splashCap = rec.downscaled.includes('splash')
    ? Math.floor(SPLASH_DAILY_CAP * FATIGUE_DOWNSCALE)
    : SPLASH_DAILY_CAP

  return {
    dateKey: rec.dateKey,
    splash: { shown: rec.splashShown, cap: splashCap },
    rewarded: {
      shown: rec.rewardedShown,
      cap: rec.examDay ? REWARDED_DAILY_CAP_EXAM_DAY : REWARDED_DAILY_CAP,
      examDay: rec.examDay,
    },
    slots: (['result_card', 'reward_center'] as AdSlot[]).map((slot) => {
      const stat = rec.slots[slot] ?? { shown: 0, clicked: 0 }
      const down = rec.downscaled.includes(slot)
      return {
        slot,
        shown: stat.shown,
        cap: down ? Math.max(1, Math.floor(SAME_SLOT_DAILY_CAP * FATIGUE_DOWNSCALE)) : SAME_SLOT_DAILY_CAP,
        downscaled: down,
      }
    }),
  }
}

/** 仅供测试与调试重置用 */
export function resetFrequency(): void {
  try {
    localStorage.removeItem(LS_FREQ)
  } catch {
    /* noop */
  }
}
