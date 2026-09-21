/**
 * 计划引擎服务（业务层）
 *
 * 实现 PRD §6.4「每日任务包算法」：
 *   每日容量 C = 可用时长 × 效率系数
 *   ① 复习到期量 R（硬约束）→ ② 新学 N → ③ 错题 W → ④ 模考 M
 *   复习耗时超 C×50% 触发「复习超载」：冻结新学，宁可不学新的也不欠复习债
 *
 * 本层不依赖 HTTP / UI，仅依赖 Repository 接口，可独立测试。
 */
import type {
  DailyTaskPack,
  KnowledgeNode,
  PracticeMode,
  SubjectId,
  TaskPack,
  TodayOverview,
} from '@/domain/entities'
import type { KnowledgeRepository, MasteryRepository, PlanRepository, StateRepository } from '@/domain/repositories'

/** 单位耗时（秒），PRD §6.4 */
const SEC_PER_CARD = 20
const SEC_PER_QUESTION = 35
const SEC_PER_WRONG = 40

/** 效率系数：0.85 为默认，可按用户历史完成率校准 */
const DEFAULT_EFFICIENCY = 0.85

/** 单日新学上限（Miller 7±2） */
const MAX_NEW_POINTS = 7

export interface PlanServiceDeps {
  states: StateRepository
  mastery: MasteryRepository
  knowledge: KnowledgeRepository
  plan: PlanRepository
  /**
   * 每日容量系数（动态调整用，PRD §6.6）
   * 落后 → 0.8（降档保节奏）；超额 → 1.2（提前推进）；不传则按 1
   */
  capacityFactor?: () => number
}

export class PlanService {
  constructor(private readonly deps: PlanServiceDeps) {}

  /**
   * 生成每日任务包
   * @param date YYYY-MM-DD
   * @param dailyMinutes 用户申报的每日可用分钟数
   * @param efficiency 效率系数
   */
  async generateDailyPack(
    date: string,
    dailyMinutes: number,
    efficiency = DEFAULT_EFFICIENCY,
  ): Promise<DailyTaskPack> {
    // 动态调整系数（PRD §6.6）：落后降档 / 超额加档，直接作用于每日容量
    const factor = this.deps.capacityFactor?.() ?? 1
    const capacityMin = dailyMinutes * efficiency * factor
    const packs: TaskPack[] = []
    let usedMin = 0

    // ① 复习到期量（硬约束，最高优先级）
    const due = await this.deps.states.getDueQueue(null, 200)
    if (due.length) {
      // 排序：可提取性低（更临近遗忘）优先
      const sorted = [...due].sort((a, b) => a.fsrsRetrievability - b.fsrsRetrievability)
      const reviewMin = Math.ceil((sorted.length * SEC_PER_QUESTION) / 60)
      packs.push({
        id: 'pack_review',
        type: 'review',
        title: `复习 ${sorted.length} 题`,
        questionCount: sorted.length,
        estimatedMinutes: reviewMin,
        completed: false,
      })
      usedMin += reviewMin
    }

    const reviewMin = packs.filter((p) => p.type === 'review').reduce((s, p) => s + p.estimatedMinutes, 0)

    // 复习超载：冻结新学与错题，只保留复习（PRD §6.4）
    if (reviewMin > capacityMin * 0.5) {
      return { date, packs, totalMinutes: reviewMin }
    }

    // ② 新学任务
    const nextPoint = await this.pickNextKnowledgePoint()
    if (nextPoint) {
      const remain = capacityMin - usedMin
      const newMin = Math.min(remain * 0.6, 15)
      if (newMin >= 5) {
        const qCount = Math.floor((newMin * 60) / SEC_PER_QUESTION)
        packs.push({
          id: 'pack_new',
          type: 'new',
          title: `新学：${nextPoint.name}`,
          questionCount: Math.min(qCount, MAX_NEW_POINTS * 2),
          estimatedMinutes: Math.ceil(newMin),
          completed: false,
          targetRef: nextPoint.id,
        })
        usedMin += newMin
      }
    }

    // ③ 错题歼灭
    const wrong = await this.deps.states.getWrongPool(null)
    const wrongDue = wrong.filter((s) => s.conquerCount < 3).slice(0, 10)
    if (wrongDue.length) {
      const remain = capacityMin - usedMin
      const wMin = Math.min(remain * 0.4, (wrongDue.length * SEC_PER_WRONG) / 60)
      if (wMin >= 3) {
        packs.push({
          id: 'pack_wrong',
          type: 'wrong',
          title: `错题重做 ${wrongDue.length} 题`,
          questionCount: wrongDue.length,
          estimatedMinutes: Math.ceil(wMin),
          completed: false,
        })
        usedMin += wMin
      }
    }

    // ④ 章节测（当日新学内容的即时测，测试效应）
    const newPack = packs.find((p) => p.type === 'new')
    if (newPack?.targetRef) {
      packs.push({
        id: 'pack_test',
        type: 'test',
        title: '章节测（学后即时测）',
        questionCount: 10,
        estimatedMinutes: 6,
        completed: false,
        targetRef: newPack.targetRef,
      })
      usedMin += 6
    }

    return { date, packs, totalMinutes: Math.ceil(usedMin) }
  }

  /** 选择下一个该学的知识点：分值权重高 + 掌握度低 + 顺序靠前 */
  private async pickNextKnowledgePoint(): Promise<KnowledgeNode | null> {
    for (const subject of ['econ_base', 'hr'] as SubjectId[]) {
      const tree = await this.deps.knowledge.getTree(subject)
      const points = tree.filter((n) => n.level === 3)
      if (!points.length) continue

      const masteryList = await this.deps.mastery.listBySubject(subject)
      const scoreOf = (nodeId: string) => {
        const chapter = tree.find((t) => t.id === points.find((p) => p.id === nodeId)?.parentId)
        if (!chapter) return 0
        const m = masteryList.find((x) => x.nodeId === chapter.id)
        return m?.masteryScore ?? 0
      }

      // 优先级 = 权重 × (100 - 掌握度)
      const ranked = points
        .map((p) => ({ p, priority: (p.weight || 1) * (100 - scoreOf(p.id)) }))
        .sort((a, b) => b.priority - a.priority)

      if (ranked[0]) return ranked[0].p
    }
    return null
  }

  /** 首页聚合数据 */
  async getTodayOverview(dailyMinutes = 60): Promise<TodayOverview> {
    const date = new Date().toISOString().slice(0, 10)
    let pack = await this.deps.plan.getTaskPack(date)
    if (!pack) {
      pack = await this.generateDailyPack(date, dailyMinutes)
    }

    const completed = pack.packs.filter((p) => p.completed).length
    const reviewMin = pack.packs
      .filter((p) => p.type === 'review')
      .reduce((s, p) => s + p.estimatedMinutes, 0)

    const daysToExam = Math.max(
      0,
      Math.ceil((new Date(EXAM_DATE).getTime() - Date.now()) / 86400000),
    )

    return {
      date,
      daysToExam,
      packs: pack.packs,
      completedCount: completed,
      totalCount: pack.packs.length,
      remainingMinutes: pack.packs.filter((p) => !p.completed).reduce((s, p) => s + p.estimatedMinutes, 0),
      overloadNotice:
        reviewMin > dailyMinutes * 0.5
          ? '今天复习量偏大，已为你暂停新学。复习债不还，学了也白学。'
          : null,
      weeklyMasteryDelta: await this.computeWeeklyMasteryDelta(),
    }
  }

  /** 本周掌握度变化（对比 7 天前） */
  private async computeWeeklyMasteryDelta(): Promise<number> {
    // 简化实现：取当前平均掌握度与上次记录的差值，真实实现需存储历史快照
    const cached = Number(localStorage.getItem('jingshi.mastery_snapshot') || '0')
    const list = [
      ...(await this.deps.mastery.listBySubject('econ_base')),
      ...(await this.deps.mastery.listBySubject('hr')),
    ]
    if (!list.length) return 0
    const avg = list.reduce((s, m) => s + m.masteryScore, 0) / list.length
    const delta = Math.round(avg - cached)
    localStorage.setItem('jingshi.mastery_snapshot', String(Math.round(avg)))
    return delta > 0 ? delta : 0
  }

  /** 任务包对应的练习模式 */
  static modeOf(pack: TaskPack): PracticeMode {
    switch (pack.type) {
      case 'review':
        return 'review'
      case 'wrong':
        return 'wrong'
      case 'exam':
        return 'exam'
      default:
        return 'chapter'
    }
  }
}

/** 考试日期：2026-11-07（PRD §1.1） */
export const EXAM_DATE = '2026-11-07'
