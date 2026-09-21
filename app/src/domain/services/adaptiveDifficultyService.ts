/**
 * 自适应难度引擎（PRD M3-F4）
 *
 * 目标：把练习正确率锚定在 **85%**（最近发展区最优 —— 太简单无收益，太难易挫败）。
 *
 * 调节规则（PRD）：
 *   · 正确率 > 92% 连续 2 个窗口 → 难度 +1
 *   · 正确率 < 70% 连续 2 个窗口 → 难度 -1，并插入同类基础题
 *   · 情绪保护：连续答错 3 题 → 立即降难度并插入一道已掌握的简单题
 *
 * 状态持久化在 localStorage（与计划容量系数同一策略）。
 */

const KEY = 'jingshi.adaptive_difficulty'

/** 目标正确率（PRD §5.1：最近发展区最优为 85%） */
export const TARGET_ACCURACY = 0.85
/** 高于此值算「太简单」 */
const HIGH = 0.92
/** 低于此值算「太难」 */
const LOW = 0.7
/** 滚动窗口题数（PRD：最近 20 题） */
const WINDOW = 20
/** 样本不足时不评判，避免开局几题就上下调整 */
const MIN_SAMPLE = 12
/** 难度范围 1-5 */
const MIN_D = 1
const MAX_D = 5
/** 连续答错多少题触发情绪保护 */
const WRONG_GUARD = 3

export interface AdaptiveState {
  /** 当前难度 1-5 */
  difficulty: number
  /** 滚动窗口内每题对错（保留最近 WINDOW 条） */
  recent: boolean[]
  /** 连续「正确率 > 92%」的窗口数 */
  highStreak: number
  /** 连续「正确率 < 70%」的窗口数 */
  lowStreak: number
  /** 当前连续答错计数 */
  wrongStreak: number
}

export interface AdjustOutcome {
  /** 难度变化：-1 降 / 0 不变 / +1 升 */
  changed: -1 | 0 | 1
  difficulty: number
  /** 是否需要插入一道简单题（情绪保护） */
  insertEasy: boolean
  /** 说明（可展示给用户） */
  reason: string
}

const initialState = (): AdaptiveState => ({
  difficulty: 3, // 默认中等
  recent: [],
  highStreak: 0,
  lowStreak: 0,
  wrongStreak: 0,
})

export function loadAdaptiveState(): AdaptiveState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return initialState()
    const s = JSON.parse(raw) as Partial<AdaptiveState>
    const d = Number(s.difficulty)
    return {
      difficulty: Number.isFinite(d) ? Math.min(Math.max(d, MIN_D), MAX_D) : 3,
      recent: Array.isArray(s.recent) ? s.recent.slice(-WINDOW) : [],
      highStreak: Number(s.highStreak) || 0,
      lowStreak: Number(s.lowStreak) || 0,
      wrongStreak: Number(s.wrongStreak) || 0,
    }
  } catch {
    return initialState()
  }
}

export function saveAdaptiveState(s: AdaptiveState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* 配额不足时静默跳过 */
  }
}

/**
 * 当前难度对应的题目难度区间
 * 上下各放宽 1 档：难度是粗略标签，区间太窄会抽不到题
 */
export function difficultyRange(level: number): [number, number] {
  const d = Math.min(Math.max(Math.round(level), MIN_D), MAX_D)
  return [Math.max(MIN_D, d - 1), Math.min(MAX_D, d + 1)]
}

/** 当前窗口的正确率（样本不足返回 null） */
export function windowAccuracy(s: AdaptiveState): number | null {
  if (s.recent.length < MIN_SAMPLE) return null
  const correct = s.recent.filter(Boolean).length
  return correct / s.recent.length
}

/**
 * 记录一道题的结果，返回调整结论
 *
 * 注意：**连续答错的情绪保护优先级最高** —— 先接住情绪，再谈难度优化。
 */
export function recordResult(isCorrect: boolean, prev?: AdaptiveState): AdjustOutcome {
  const s = prev ? { ...prev, recent: [...prev.recent] } : loadAdaptiveState()

  // ① 更新滚动窗口
  s.recent.push(isCorrect)
  if (s.recent.length > WINDOW) s.recent = s.recent.slice(-WINDOW)

  // ② 连续答错计数
  s.wrongStreak = isCorrect ? 0 : s.wrongStreak + 1

  // ③ 情绪保护：连续答错 3 题 → 立刻降难度
  //    注意：**已在最低难度时也要插入简单题** —— 情绪保护的目的不是改难度，是接住挫败感
  if (s.wrongStreak >= WRONG_GUARD) {
    const canDrop = s.difficulty > MIN_D
    if (canDrop) s.difficulty -= 1
    s.wrongStreak = 0
    s.lowStreak = 0
    s.highStreak = 0
    saveAdaptiveState(s)
    return {
      changed: canDrop ? -1 : 0,
      difficulty: s.difficulty,
      insertEasy: true,
      reason: canDrop
        ? '连续答错几题了，先把难度降下来，做几道有把握的找回手感。'
        : '连错几题了，换几道轻松的把状态找回来。',
    }
  }

  // ④ 窗口评估（每满 WINDOW 题且样本足够时）
  const acc = windowAccuracy(s)
  let changed: -1 | 0 | 1 = 0
  let reason = ''
  let insertEasy = false

  if (acc !== null && s.recent.length >= WINDOW) {
    if (acc > HIGH) {
      s.highStreak += 1
      s.lowStreak = 0
      if (s.highStreak >= 2 && s.difficulty < MAX_D) {
        s.difficulty += 1
        changed = 1
        reason = `最近正确率 ${Math.round(acc * 100)}%，已经超出目标区（85%）。难度已上调，继续保持。`
      }
    } else if (acc < LOW) {
      s.lowStreak += 1
      s.highStreak = 0
      if (s.lowStreak >= 2 && s.difficulty > MIN_D) {
        s.difficulty -= 1
        changed = -1
        insertEasy = true
        reason = `最近正确率 ${Math.round(acc * 100)}%，偏难了。难度已下调，并补几道基础题打底。`
      }
    } else {
      // 落在目标区（70%~92%）→ 保持，重置连续计数
      s.highStreak = 0
      s.lowStreak = 0
    }
    // 评估后**无条件清空窗口**，形成「独立批次」语义。
    // 若只在调整时清空，滑动窗口会让连续计数在几题内就累加满，
    // 与 PRD「连续 2 个窗口」的含义不符。
    s.recent = []
  }

  saveAdaptiveState(s)
  return { changed, difficulty: s.difficulty, insertEasy, reason }
}

/** 重置（如切换科目、清空数据时） */
export function resetAdaptiveState(): void {
  saveAdaptiveState(initialState())
}
