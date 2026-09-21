/**
 * 广告渐进释放状态机（PRD M9-F4 ②）
 *
 * 核心设计意图：让用户对「这个 App 有哪些广告」形成**稳定、完整、可预期**的认知过程。
 *   - 不是「先没有，后突然有」（会造成被欺骗感）
 *   - 而是「从一开始就有，由少到多慢慢来」（全程无预期落差）
 *
 * ⚠️ 三条不可违反的纪律（PRD M9-F4 关键设计约束）：
 *   1. **阶段推进不可回退**（禁止出现「昨天有今天没有」）
 *   2. **不可加速**（禁止因为数据不好看就压缩时间表）
 *   3. **按活跃天数为主 + 自然日 2 倍兜底**（取先到者）
 *
 * 本模块是**纯函数式状态机**：不做任何副作用，不直接读 Date.now() 以外的东西，
 * 便于单测覆盖每个边界（PRD §15 明确要求「逻辑简单但需严格单测」）。
 */

const LS_RELEASE = 'jingshi.ad_release'

/** 用户有实际学习行为的判定：当日完成 ≥ 1 个任务包 */
export interface ActivityRecord {
  /** 首次启动时间戳（D0 的锚点） */
  firstLaunchAt: number
  /** 有学习行为的自然日集合（本地日期字符串 'YYYY-MM-DD'），按插入顺序 */
  activeDays: string[]
  /** 已经推进到的阶段（单调不减，这是「不可回退」的技术保证） */
  stage: ReleaseStage
  /** 阶段推进时的历史记录，便于排查「为什么现在是这样」 */
  history: Array<{ stage: ReleaseStage; at: number; reason: string }>
}

export type ReleaseStage = 0 | 1 | 2 | 3

/** 各阶段的开屏门槛：达到该活跃天数即进入该阶段 */
export const STAGE_THRESHOLDS: Record<ReleaseStage, number> = {
  0: 0, // D0：纯净期
  1: 1, // D1：单点引入（只开开屏）
  2: 3, // D3：成果位开放
  3: 6, // D6：完全体
}

/** 自然日兜底倍数：自然天数达到活跃门槛的 N 倍时，即使活跃不足也推进 */
export const NATURAL_DAY_FALLBACK_FACTOR = 2

/**
 * 广告位标识（v1.5：由 4 个减为 3 个）
 *
 * ⚠️ `ai_quota`（原位置③「看视频换 AI 额度」）已在 v1.3 删除、v1.5 最终确认。
 *    v1.5 撤销 AI 中转后，本产品**彻底无 AI 额度体系**，该广告位在业务上不存在。
 *    **禁止重新引入**。
 */
export type AdSlot = 'splash' | 'result_card' | 'reward_center'

/** 各阶段开放的广告位（PRD M9-F4 释放时间表） */
export const SLOTS_BY_STAGE: Record<ReleaseStage, AdSlot[]> = {
  0: [],
  1: ['splash'],
  2: ['splash', 'result_card', 'reward_center'],
  3: ['splash', 'result_card', 'reward_center'],
}

/** 阶段的中文名（用于调试页与日志） */
export const STAGE_LABEL: Record<ReleaseStage, string> = {
  0: '纯净期',
  1: '单点引入',
  2: '成果位开放',
  3: '完全体',
}

/* ---------------- 本地日期工具 ---------------- */

/**
 * 取本地日期字符串（YYYY-MM-DD）。
 * ⚠️ 必须用**本地时区**而非 UTC：用户的「今天」是按他所在时区算的，
 *    用 toISOString() 会让东八区用户在晚上 8 点后就被算成第二天。
 */
export function localDateKey(ts: number = Date.now()): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 两个日期键相差的自然天数 */
export function naturalDaysBetween(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T00:00:00`).getTime()
  const to = new Date(`${toKey}T00:00:00`).getTime()
  return Math.max(0, Math.round((to - from) / 86_400_000))
}

/* ---------------- 持久化 ---------------- */

function emptyRecord(now: number): ActivityRecord {
  return { firstLaunchAt: now, activeDays: [], stage: 0, history: [] }
}

export function loadRecord(): ActivityRecord | null {
  try {
    const raw = localStorage.getItem(LS_RELEASE)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<ActivityRecord>
    if (typeof p.firstLaunchAt !== 'number') return null
    const stage = (typeof p.stage === 'number' && p.stage >= 0 && p.stage <= 3 ? p.stage : 0) as ReleaseStage
    return {
      firstLaunchAt: p.firstLaunchAt,
      activeDays: Array.isArray(p.activeDays) ? p.activeDays.filter((x) => typeof x === 'string') : [],
      stage,
      history: Array.isArray(p.history) ? p.history : [],
    }
  } catch {
    return null
  }
}

function persist(record: ActivityRecord): void {
  try {
    localStorage.setItem(LS_RELEASE, JSON.stringify(record))
  } catch {
    /* 配额不足时静默，下次启动重新初始化 */
  }
}

/* ---------------- 状态机核心 ---------------- */

/**
 * 自然日兜底的有效期：距上次活跃超过这个天数，兜底**不再生效**。
 *
 * ⚠️ 这条约束是修正一个真实漏洞而加的（v1.5 修订）：
 *
 *   反例：用户 9/1 下载、只用了 1 天就放置，9/20 再打开。
 *        活跃天数 = 1（本该停在阶段 1），
 *        但自然日 = 19 天 ≥ 6×2 = 12 天 → **直接跳到阶段 3「完全体」**。
 *
 *   这与 PRD M9-F4 的核心意图直接冲突：
 *     「如果一个用户下载后放置了 30 天才开始用，他应该从阶段 0 开始，
 *       而不是一上来就面对完全体广告。」
 *
 *   兜底机制的本意是补偿「间歇性活跃」用户（如只周末学习的在职考生），
 *   让他们不会因为活跃天数攒得慢而永远停在低级阶段。
 *   但它**不应该**服务于「长期流失后回归」的用户 —— 后者恰恰最需要
 *   重新走一遍完整的、教科书式的渐进过程。
 *
 * 判定方式：兜底要求「距上次活跃 ≤ 3 天」，从而区分这两类用户：
 *   - 周末学习者：一直在活跃 → 兜底正常生效 ✅
 *   - 放置 19 天回来的用户：距上次活跃 19 天 > 3 天 → 兜底不生效 ✅
 */
export const NATURAL_FALLBACK_MAX_GAP_DAYS = 3

/** 距上次活跃的天数（从未活跃过则返回 Infinity，即兜底不生效） */
export function daysSinceLastActive(record: ActivityRecord, now: number = Date.now()): number {
  if (record.activeDays.length === 0) return Infinity
  // activeDays 按插入顺序追加，最后一个是最近活跃日
  const last = record.activeDays[record.activeDays.length - 1]
  return naturalDaysBetween(last, localDateKey(now))
}

/**
 * 根据活跃天数与自然天数计算**应该**处于的阶段。
 * 取「活跃达标」与「自然日兜底」的**先到者**（PRD Q20 决策）。
 *
 * ⚠️ 自然日兜底带前置条件：**必须处于「最近活跃」状态**（见上方常量说明）。
 *    这是为了防止「长期放置后回归」的用户被兜底机制直接顶到完全体。
 */
export function computeStage(record: ActivityRecord, now: number = Date.now()): {
  stage: ReleaseStage
  reason: string
} {
  const activeCount = record.activeDays.length
  const naturalDays = naturalDaysBetween(localDateKey(record.firstLaunchAt), localDateKey(now))
  const sinceActive = daysSinceLastActive(record, now)
  const fallbackUsable = sinceActive <= NATURAL_FALLBACK_MAX_GAP_DAYS

  let stage: ReleaseStage = 0
  let reason = 'D0 纯净期（尚未产生学习行为）'

  // 从高到低判断，命中即停（保证取到已满足的最高阶段）
  for (const candidate of [3, 2, 1] as ReleaseStage[]) {
    const needActive = STAGE_THRESHOLDS[candidate]
    const needNatural = needActive * NATURAL_DAY_FALLBACK_FACTOR
    if (activeCount >= needActive) {
      stage = candidate
      reason = `活跃 ${activeCount} 天 ≥ ${needActive} 天`
      break
    }
    if (fallbackUsable && naturalDays >= needNatural) {
      stage = candidate
      reason = `自然日 ${naturalDays} 天 ≥ ${needNatural} 天（兜底 · 距上次活跃 ${sinceActive} 天）`
      break
    }
  }

  return { stage, reason }
}

/**
 * 初始化 / 读取释放记录。
 * 幂等：重复调用不会重置 firstLaunchAt。
 */
export function initRelease(now: number = Date.now()): ActivityRecord {
  const existing = loadRecord()
  if (existing) return existing
  const fresh = emptyRecord(now)
  persist(fresh)
  return fresh
}

/**
 * 记录一次学习行为（当日完成 ≥ 1 个任务包时调用）。
 * 幂等：同一天多次调用只记一次。
 * @returns 推进后的记录
 */
export function markActiveDay(now: number = Date.now()): ActivityRecord {
  const record = initRelease(now)
  const key = localDateKey(now)
  if (!record.activeDays.includes(key)) {
    record.activeDays.push(key)
  }
  return advance(record, now)
}

/**
 * 推进阶段。
 * ⚠️ **只增不减**（不可回退），这是 PRD 硬约束在代码层的落实。
 */
export function advance(record: ActivityRecord, now: number = Date.now()): ActivityRecord {
  const { stage: target, reason } = computeStage(record, now)
  if (target > record.stage) {
    record.stage = target
    record.history.push({ stage: target, at: now, reason })
  }
  persist(record)
  return record
}

/** 仅供一次性进入时调用，确保阶段与当前活跃度对齐 */
export function refreshRelease(now: number = Date.now()): ActivityRecord {
  return advance(initRelease(now), now)
}

/* ---------------- 对外查询接口 ---------------- */

/** 当前处于哪个阶段 */
export function currentStage(now: number = Date.now()): ReleaseStage {
  return refreshRelease(now).stage
}

/** 指定广告位当前是否已释放 */
export function isSlotReleased(slot: AdSlot, now: number = Date.now()): boolean {
  return SLOTS_BY_STAGE[currentStage(now)].includes(slot)
}

/** 当前已释放的全部广告位（供广告模块统一查询） */
export function releasedSlots(now: number = Date.now()): AdSlot[] {
  return [...SLOTS_BY_STAGE[currentStage(now)]]
}

/** 阶段进度信息（供「我的 → 广告设置」展示，保证透明度） */
export function stageProgress(now: number = Date.now()): {
  stage: ReleaseStage
  label: string
  activeDays: number
  nextStage: ReleaseStage | null
  daysToNext: number
} {
  const record = refreshRelease(now)
  const next = (record.stage < 3 ? (record.stage + 1) as ReleaseStage : null)
  const needActive = next ? STAGE_THRESHOLDS[next] : 0
  return {
    stage: record.stage,
    label: STAGE_LABEL[record.stage],
    activeDays: record.activeDays.length,
    nextStage: next,
    daysToNext: next ? Math.max(0, needActive - record.activeDays.length) : 0,
  }
}

/* ---------------- 去广告状态（买断 + 限期体验） ---------------- */

const LS_REMOVE_ADS = 'jingshi.remove_ads'

/**
 * 去广告的来源。
 *   - `purchase` —— ¥68 / ¥128 买断（永久有效）
 *   - `trial`    —— 奖励中心兑换的「免广告体验」（有到期日）
 *
 * 两种来源**在效果上完全等价**：都意味着「全量去广告」。
 * PRD 明确要求：「『免广告』必须是名副其实的全量去广告，不能有例外 —— 这是信任问题。」
 * 因此这里刻意**不做任何按来源区分**的处理，开屏也一并移除。
 */
export type AdFreeSource = 'purchase' | 'trial'

export interface AdFreeState {
  /** 买断（永久） */
  purchased: boolean
  /** 限期免广告的到期日（本地日期键 'YYYY-MM-DD'），null 表示无 */
  trialUntil: string | null
}

function emptyAdFree(): AdFreeState {
  return { purchased: false, trialUntil: null }
}

/** 读取去广告状态（兼容 v1.5 之前的布尔值格式） */
export function loadAdFree(): AdFreeState {
  try {
    const raw = localStorage.getItem(LS_REMOVE_ADS)
    if (!raw) return emptyAdFree()
    // 向后兼容：旧格式是 '1'
    if (raw === '1') return { purchased: true, trialUntil: null }
    const p = JSON.parse(raw) as Partial<AdFreeState>
    return {
      purchased: p.purchased === true,
      trialUntil: typeof p.trialUntil === 'string' ? p.trialUntil : null,
    }
  } catch {
    return emptyAdFree()
  }
}

function persistAdFree(state: AdFreeState): void {
  try {
    localStorage.setItem(LS_REMOVE_ADS, JSON.stringify(state))
  } catch {
    /* 配额不足时静默 */
  }
}

/**
 * 当前是否处于「无广告」状态。
 *
 * ⚠️ 这是**唯一**的去广告判定入口。UI 层不得直接读 localStorage。
 *    限期体验到期后自动失效（按本地日期比较，跨日即过期）。
 */
export function isAdFree(now: number = Date.now()): boolean {
  const s = loadAdFree()
  if (s.purchased) return true
  if (s.trialUntil) {
    // 到期日当天仍有效（含端点），次日零点起失效
    return localDateKey(now) <= s.trialUntil
  }
  return false
}

/**
 * 设置买断状态。
 * ⚠️ 只用于「购买成功 / 退款」两类真实状态变更，
 *    不得用于任何临时开关（限期体验请用 grantAdFreeDays）。
 */
export function setAdFree(value: boolean): void {
  const s = loadAdFree()
  s.purchased = value
  persistAdFree(s)
}

/**
 * 发放「免广告体验天数」（奖励中心兑换用）。
 *
 * 语义约定（重要，避免差一错误）：
 *   `trialUntil` 存的是**最后一个有效日的日期键**，而不是「失效时刻」。
 *   因此 `grantAdFreeDays(1)` → `trialUntil = 今天`（今天全天有效，次日失效）。
 *
 * 叠加规则：若已有未到期的体验，则从**原到期日**继续累加（不吞掉已有时长）。
 * 这是对用户的诚实 —— 他攒下的天数不该因为再次兑换而重置。
 */
export function grantAdFreeDays(days: number, now: number = Date.now()): AdFreeState {
  if (days <= 0) return loadAdFree()
  const s = loadAdFree()
  const today = localDateKey(now)

  // 起点：
  //   未过期 → 从「原到期日的次日」续期（不能从到期日当天重算，否则会吞掉已有一天）
  //   已过期或从未发放 → 从今天起算
  let startMs = new Date(`${today}T00:00:00`).getTime()
  if (s.trialUntil && s.trialUntil >= today) {
    startMs = new Date(`${s.trialUntil}T00:00:00`).getTime() + 86_400_000
  }

  // 发 N 天 = 覆盖 start 当天在内的 N 天 → 最后一天是 start + (N-1) 天
  const last = new Date(startMs + (days - 1) * 86_400_000)
  s.trialUntil = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
  persistAdFree(s)
  return s
}

/**
 * 剩余免广告天数。
 *   -1 → 已买断（永久）
 *    0 → 无免广告
 *   n → 含今天在内的剩余天数
 */
export function adFreeDaysLeft(now: number = Date.now()): number {
  const s = loadAdFree()
  if (s.purchased) return -1
  if (!s.trialUntil) return 0
  const today = localDateKey(now)
  if (s.trialUntil < today) return 0
  // 含端点：今天到期 → 剩 1 天
  return naturalDaysBetween(today, s.trialUntil) + 1
}

/**
 * 是否应当展示某个广告位 —— 广告 SDK 调用前的**唯一入口**。
 * 组合了两个条件：① 阶段已释放；② 未处于任何形式的去广告状态。
 */
export function shouldShowAd(slot: AdSlot, now: number = Date.now()): boolean {
  if (isAdFree(now)) return false
  return isSlotReleased(slot, now)
}
