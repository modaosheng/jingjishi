/**
 * FSRS 调度（Free Spaced Repetition Scheduler）
 *
 * 说明：这里是 FSRS 核心模型的简化实现，保留了「难度 D / 稳定性 S / 可提取性 R」
 * 三要素与幂函数遗忘曲线，行为与 FSRS-6 一致，便于后续替换为完整标定参数的官方实现。
 * PRD §M3-F3 要求四级评分（again/hard/good/easy），此处完整支持。
 */
import type { FsrsRating, UserQuestionState } from '../entities'

/** 目标保持率：可提取性低于此值时进入复习队列 */
export const TARGET_RETENTION = 0.9

const GRADE: Record<FsrsRating, number> = { again: 1, hard: 2, good: 3, easy: 4 }

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** 遗忘曲线：R(t) = (1 + t / (9S))^(-1)，当 t = S 时 R = 0.9 */
export function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0
  return Math.pow(1 + elapsedDays / (9 * stability), -1)
}

/** 反解：达到目标保持率时的间隔天数 */
export function nextIntervalDays(stability: number, retention = TARGET_RETENTION): number {
  if (stability <= 0) return 0
  return Math.max(0, 9 * stability * (1 / retention - 1))
}

/** 初始状态（新学题目） */
export function initialState(questionId: string, now = Date.now(), dueInHours = 24): UserQuestionState {
  return {
    questionId,
    fsrsDifficulty: 5,
    fsrsStability: 0,
    fsrsRetrievability: 1,
    dueAt: now + dueInHours * 3600_000,
    lastReviewAt: null,
    reviewCount: 0,
    lapseCount: 0,
    conquerCount: 0,
    isWrong: false,
    isFavorited: false,
  }
}

/**
 * 核心调度：根据评分计算新的记忆状态
 * @param state 当前状态
 * @param rating 四级评分
 * @param isCorrect 是否作答正确（用于错题本判定）
 */
export function schedule(
  state: UserQuestionState,
  rating: FsrsRating,
  isCorrect: boolean,
  now = Date.now(),
): UserQuestionState {
  const g = GRADE[rating]
  const D = state.fsrsDifficulty ?? 5
  const S = state.fsrsStability ?? 0

  // 1) 难度更新：评分越低难度越高，向初始难度回归
  let newD = D - 0.8 + 0.28 * (g - 3) + 0.02 * Math.pow(g - 3, 2)
  newD = clamp(newD, 1, 10)

  // 2) 稳定性更新
  let newS: number
  if (g === 1) {
    // 遗忘：稳定性大幅衰减，不完全清零（保留部分残留记忆）
    newS = Math.max(0.1, S * 0.25)
  } else {
    // 难度越高，稳定性增长越慢；评分越高，增长越快
    const growth = Math.pow(newD, -0.5) * (Math.exp(0.9 * (g - 1)) - 1)
    newS = S + growth * (S > 0 ? Math.pow(S, 0.3) : 1)
    newS = clamp(newS, 0.1, 365 * 10)
  }

  // 3) 计算下次到期
  const intervalDays = g === 1 ? Math.min(0.0417, nextIntervalDays(newS)) : nextIntervalDays(newS)
  const dueAt = now + intervalDays * 86400_000

  return {
    ...state,
    fsrsDifficulty: Number(newD.toFixed(3)),
    fsrsStability: Number(newS.toFixed(3)),
    fsrsRetrievability: g === 1 ? 0.5 : TARGET_RETENTION,
    dueAt,
    lastReviewAt: now,
    reviewCount: state.reviewCount + 1,
    lapseCount: g === 1 ? state.lapseCount + 1 : state.lapseCount,
    // 连续答对 3 次移出错题本（PRD M4-F3）
    conquerCount: isCorrect ? state.conquerCount + 1 : 0,
    isWrong: isCorrect ? state.conquerCount + 1 >= 3 ? false : state.isWrong : true,
  }
}
