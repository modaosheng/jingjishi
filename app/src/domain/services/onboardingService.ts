/**
 * 引导服务（业务层）
 *
 * 承载 PRD §9.1 的 5 步 onboarding：科目 → 考试日 → 每日时长 → 学习时段 → 摸底测评。
 * 规则（组卷比例、初始掌握度推断、计划初始化）集中在此，页面只收集输入。
 */
import type { Question, SubjectId } from '@/domain/entities'
import type { KnowledgeRepository, MasteryRepository, QuestionRepository } from '@/domain/repositories'
import type { PlanService } from './planService'

export type StudyPeriod = 'morning' | 'commute' | 'noon' | 'night'
export type BaseLevel = 'zero' | 'some' | 'experienced'

export interface OnboardingData {
  subjectIds: SubjectId[]
  examDate: string
  dailyMinutes: number
  studyPeriod: StudyPeriod
  baseLevel: BaseLevel
  targetScore: number
  /** 是否已完成摸底测评 */
  placementDone: boolean
  placementScore?: number
  createdAt: number
}

const LS_KEY = 'jingshi.onboarding'

/** 摸底测评题量（PRD §9.1：30 题分模块） */
const PLACEMENT_COUNT = 30

/** 不同基础的初始掌握度（0-100） */
const INITIAL_MASTERY: Record<BaseLevel, number> = {
  zero: 8,
  some: 30,
  experienced: 55,
}

/** 学习时段 → 默认提醒时间 */
export const PERIOD_HOUR: Record<StudyPeriod, number> = {
  morning: 7,
  commute: 8,
  noon: 12,
  night: 21,
}

export interface OnboardingDeps {
  questions: QuestionRepository
  knowledge: KnowledgeRepository
  mastery: MasteryRepository
  plan: PlanService
}

export class OnboardingService {
  constructor(private readonly deps: OnboardingDeps) {}

  isDone(): boolean {
    return !!localStorage.getItem(LS_KEY)
  }

  load(): OnboardingData | null {
    try {
      const raw = localStorage.getItem(LS_KEY)
      return raw ? (JSON.parse(raw) as OnboardingData) : null
    } catch {
      return null
    }
  }

  /**
   * 摸底测评组卷：按模块分值权重分配题量，保证覆盖而非随机
   */
  async buildPlacementPaper(subjectId: SubjectId): Promise<Question[]> {
    const tree = await this.deps.knowledge.getTree(subjectId)
    const modules = tree.filter((n) => n.level === 1)
    const totalWeight = modules.reduce((s, m) => s + (m.weight || 1), 0) || 1

    const picked: Question[] = []
    for (const mod of modules) {
      const share = Math.max(3, Math.round(((mod.weight || 1) / totalWeight) * PLACEMENT_COUNT))
      const qs = await this.deps.questions.query({
        subjectId,
        nodeId: mod.id,
        limit: share,
        shuffle: true,
      })
      picked.push(...qs)
    }
    return picked.slice(0, PLACEMENT_COUNT)
  }

  /**
   * 完成引导：写入配置 → 初始化掌握度 → 生成首日计划
   */
  async complete(data: Omit<OnboardingData, 'createdAt'>): Promise<void> {
    const payload: OnboardingData = { ...data, createdAt: Date.now() }
    localStorage.setItem(LS_KEY, JSON.stringify(payload))

    // 未做摸底测评时，按申报基础初始化掌握度（保守值）
    if (!data.placementDone) {
      await this.seedMastery(data.subjectIds, data.baseLevel)
    }

    // 生成今日任务包（规则在 PlanService）
    const date = new Date().toISOString().slice(0, 10)
    const pack = await this.deps.plan.generateDailyPack(date, data.dailyMinutes)
    const { getDataSource } = await import('@/infrastructure')
    await getDataSource().plan.saveTaskPack(pack)
  }

  /** 初始化掌握度基线 */
  private async seedMastery(subjectIds: SubjectId[], level: BaseLevel): Promise<void> {
    const base = INITIAL_MASTERY[level]
    for (const subjectId of subjectIds) {
      const tree = await this.deps.knowledge.getTree(subjectId)
      const chapters = tree.filter((n) => n.level === 2)
      for (const ch of chapters) {
        await this.deps.mastery.upsert({
          nodeId: ch.id,
          masteryScore: base,
          level: base < 20 ? 'unlearned' : base < 45 ? 'weak' : 'fair',
          questionCount: 0,
          correctCount: 0,
          lastPracticeAt: null,
          predictForgetAt: null,
        })
      }
    }
  }

  reset(): void {
    localStorage.removeItem(LS_KEY)
  }
}
