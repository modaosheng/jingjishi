/**
 * 掌握度服务（业务层）
 *
 * PRD 要求：不要每次答题都重算掌握度（会卡顿），改为批量异步重算。
 * 掌握度 = 0.6 × 时间加权正确率 + 0.4 × 记忆可提取性
 */
import type { MasteryLevel, SubjectId, UserKnowledgeState, UserQuestionState } from '@/domain/entities'
import type {
  AnswerLogRepository,
  KnowledgeRepository,
  MasteryRepository,
  QuestionRepository,
  StateRepository,
} from '@/domain/repositories'

/** 时间衰减半衰期（天）：越近的答题权重越高 */
const HALF_LIFE_DAYS = 14

export interface MasteryServiceDeps {
  mastery: MasteryRepository
  states: StateRepository
  questions: QuestionRepository
  knowledge: KnowledgeRepository
  answerLogs: AnswerLogRepository
}

function levelOf(score: number): MasteryLevel {
  if (score < 20) return 'unlearned'
  if (score < 45) return 'weak'
  if (score < 65) return 'fair'
  if (score < 82) return 'good'
  return 'mastered'
}

/** 预测遗忘临界日：可提取性降至 0.7 的时刻（PRD M10 遗忘预警用） */
export function predictForgetAt(state: UserQuestionState, now = Date.now()): number | null {
  const S = state.fsrsStability
  if (!S || S <= 0) return null
  // R(t) = (1 + t/(9S))^-1 = 0.7  →  t = 9S × (1/0.7 - 1)
  const days = 9 * S * (1 / 0.7 - 1)
  return now + days * 86400000
}

export class MasteryService {
  constructor(private readonly deps: MasteryServiceDeps) {}

  /** 重算单个章节（知识点聚合到章）的掌握度 */
  async recomputeChapter(nodeId: string): Promise<UserKnowledgeState | null> {
    const tree = await this.deps.knowledge.getTree(nodeId.startsWith('econ') ? 'econ_base' : 'hr')
    const chapter = tree.find((n) => n.id === nodeId)
    if (!chapter) return null

    const pointIds = tree.filter((n) => n.parentId === nodeId).map((n) => n.id)
    const scope = pointIds.length ? pointIds : [nodeId]

    const questions = await this.deps.questions.query({ nodeId, limit: 500 })
    if (!questions.length) return null

    const states = await this.deps.states.getMany(questions.map((q) => q.id))
    const stateMap = new Map(states.map((s) => [s.questionId, s]))

    const now = Date.now()
    let weightedRight = 0
    let weightedTotal = 0
    let retrievabilitySum = 0
    let retrievabilityCount = 0

    for (const q of questions) {
      const logs = await this.deps.answerLogs.listByQuestion(q.id)
      for (const log of logs) {
        const ageDays = (now - log.answeredAt) / 86400000
        const w = Math.pow(0.5, ageDays / HALF_LIFE_DAYS)
        weightedTotal += w
        if (log.isCorrect) weightedRight += w
      }
      const st = stateMap.get(q.id)
      if (st && st.fsrsStability > 0) {
        const elapsedDays = st.lastReviewAt ? (now - st.lastReviewAt) / 86400000 : 0
        retrievabilitySum += Math.pow(1 + elapsedDays / (9 * st.fsrsStability), -1)
        retrievabilityCount += 1
      }
    }

    const accuracy = weightedTotal ? weightedRight / weightedTotal : 0
    const avgR = retrievabilityCount ? retrievabilitySum / retrievabilityCount : 0
    const masteryScore = Math.round(Math.min(100, (0.6 * accuracy + 0.4 * avgR) * 100))

    const result: UserKnowledgeState = {
      nodeId,
      masteryScore,
      level: levelOf(masteryScore),
      questionCount: questions.length,
      correctCount: Math.round(accuracy * questions.length),
      lastPracticeAt: now,
      predictForgetAt: null,
    }
    await this.deps.mastery.upsert(result)
    void scope
    return result
  }

  /** 批量重算整科（后台任务，会话结束或每 20 题触发一次） */
  async recomputeSubject(subjectId: SubjectId): Promise<number> {
    const tree = await this.deps.knowledge.getTree(subjectId)
    const chapters = tree.filter((n) => n.level === 2)
    for (const ch of chapters) {
      await this.recomputeChapter(ch.id)
    }
    return chapters.length
  }

  /** 全科加权平均掌握度（按分值权重） */
  async weightedMastery(subjectId: SubjectId): Promise<number> {
    const tree = await this.deps.knowledge.getTree(subjectId)
    const modules = tree.filter((n) => n.level === 1)
    const list = await this.deps.mastery.listBySubject(subjectId)
    if (!list.length) return 0

    let sum = 0
    let weight = 0
    for (const mod of modules) {
      const chapterIds = tree.filter((n) => n.parentId === mod.id).map((n) => n.id)
      const scores = list.filter((m) => chapterIds.includes(m.nodeId))
      if (!scores.length) continue
      const avg = scores.reduce((s, m) => s + m.masteryScore, 0) / scores.length
      sum += avg * (mod.weight || 1)
      weight += mod.weight || 1
    }
    return weight ? sum / weight : 0
  }
}
