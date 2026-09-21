/**
 * 后台任务调度服务（业务层）
 *
 * PRD 要求：不在交互路径中执行长任务（掌握度重算、快照、队列预热）。
 * 本服务在应用启动与答题结束时按需触发，全部异步、不阻塞 UI。
 *
 * 触发时机：
 *   - 应用启动：生成今日任务包、自动快照、逾期复习队列预热
 *   - 每答满 20 题：批量重算掌握度（PRD 明确要求，避免每题重算）
 *   - 每周：周快照 + 掌握度全量重算
 */
import type { DailyTaskPack } from '@/domain/entities'
import type { PlanRepository, StateRepository } from '@/domain/repositories'
import type { BackupService } from './backupService'
import type { MasteryService } from './masteryService'
import type { PlanService } from './planService'

/** 触发批量重算掌握度的答题数阈值 */
const RECOMPUTE_EVERY = 20

export interface SchedulerDeps {
  plan: PlanService
  mastery: MasteryService
  backup: BackupService
  states: StateRepository
  planRepo: PlanRepository
}

export class SchedulerService {
  private answerCounter = 0
  private started = false

  constructor(private readonly deps: SchedulerDeps) {}

  /**
   * 应用启动调度：串行执行，任何一步失败都不影响后续
   */
  async onAppStart(dailyMinutes = 60): Promise<DailyTaskPack | null> {
    if (this.started) return null
    this.started = true

    let pack: DailyTaskPack | null = null
    try {
      // ① 确保今日任务包存在（生成规则在 PlanService）
      const date = new Date().toISOString().slice(0, 10)
      pack = await this.deps.planRepo.getTaskPack(date)
      if (!pack) {
        pack = await this.deps.plan.generateDailyPack(date, dailyMinutes)
        await this.deps.planRepo.saveTaskPack(pack)
      }
    } catch (err) {
      console.warn('[Scheduler] 生成任务包失败', err)
    }

    // ② 自动快照（每日/每周），内部已做去重
    void this.deps.backup.ensureAutoSnapshot().catch((e) => console.warn('[Scheduler] 快照失败', e))

    // ③ 复习队列预热：仅统计到期数量，供首页快速渲染
    void this.deps.states.getDueCount().catch(() => 0)

    return pack
  }

  /**
   * 每答一题调用；达到阈值时触发批量重算
   */
  onAnswerCommitted(): void {
    this.answerCounter++
    if (this.answerCounter % RECOMPUTE_EVERY !== 0) return
    // 异步重算两科，不阻塞答题
    void (async () => {
      try {
        await this.deps.mastery.recomputeSubject('econ_base')
        await this.deps.mastery.recomputeSubject('hr')
      } catch (err) {
        console.warn('[Scheduler] 掌握度批量重算失败', err)
      }
    })()
  }

  /**
   * 应用进入后台 / 会话结束时调用：兜底重算 + 快照
   */
  async onSessionEnd(): Promise<void> {
    try {
      await this.deps.mastery.recomputeSubject('econ_base')
      await this.deps.mastery.recomputeSubject('hr')
      await this.deps.backup.createSnapshot('auto_daily')
    } catch (err) {
      console.warn('[Scheduler] 会话结束任务失败', err)
    }
  }

  /** 供测试与调试：重置计数器 */
  reset(): void {
    this.answerCounter = 0
    this.started = false
  }
}
