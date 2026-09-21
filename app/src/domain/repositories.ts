/**
 * Repository 接口契约（PRD §11 / 本地存储技术方案 §4）
 *
 * 业务层只依赖这些接口，不关心底层是 SQLite WASM、内存 Mock 还是远端 HTTP。
 * 替换数据源时，只需在 infrastructure/ 下提供新的实现类。
 */
import type {
  AnswerLog,
  DailyTaskPack,
  ExamRecord,
  KnowledgeNode,
  PracticeMode,
  Question,
  QuestionSet,
  QuestionSetCategory,
  SubjectId,
  UserKnowledgeState,
  UserQuestionState,
} from './entities'

/* ==================== 题库 ==================== */

export interface QuestionQuery {
  subjectId?: SubjectId
  /** 按知识点过滤（含子节点的题目也会被选出） */
  nodeId?: string
  type?: Question['type']
  /** 难度区间 */
  difficulty?: [number, number]
  /** 仅真题 */
  onlyRealExam?: boolean
  /** 真题年份 */
  examYear?: number
  /** 近 5 年考查 ≥ N 次的高频考点题 */
  minExamFreq?: number
  sourceLevels?: Question['sourceLevel'][]
  ownerTypes?: Question['ownerType'][]
  /** 仅查这些 id 的题（用于按题集组卷：先取题集题目 id，再按 id 拉题） */
  includeIds?: string[]
  /** 排除这些题目（避免重复） */
  excludeIds?: string[]
  limit?: number
  /** 是否打乱（交错练习，PRD §5.1） */
  shuffle?: boolean
}

export interface QuestionRepository {
  getById(id: string): Promise<Question | null>
  query(q: QuestionQuery): Promise<Question[]>
  /** 组卷：按模式智能筛题 */
  buildPaper(params: {
    mode: PracticeMode
    subjectId: SubjectId
    nodeId?: string
    count: number
    /** 真题年份（real_exam 模式） */
    year?: number
    /** 专项：题型（special 模式） */
    type?: Question['type']
    /** 专项：难度 1-5（special 模式） */
    difficulty?: number
    /** 仅练指定归属的题（如「我的题库」= user + ai） */
    ownerTypes?: Question['ownerType'][]
  }): Promise<Question[]>
  save(questions: Question[]): Promise<void>
  count(subjectId?: SubjectId): Promise<number>
  /** 删除题目（按 id），同时清理其学习状态与答题流水 */
  remove(ids: string[]): Promise<void>
  /** 按归属统计题量（内置 / 用户自建 / AI 生成） */
  countByOwner(): Promise<{ official: number; user: number; ai: number }>
}

/* ==================== 题集（题库） ==================== */

export interface QuestionSetRepository {
  /** 列出题集（可按科目 / 类别过滤） */
  list(filter?: { subjectId?: SubjectId; category?: QuestionSetCategory }): Promise<QuestionSet[]>
  get(id: string): Promise<QuestionSet | null>
  /** 保存题集及其题目关联（同 id 则覆盖关联） */
  save(set: QuestionSet, questionIds: string[]): Promise<void>
  /** 删除题集本身（不删除题目） */
  remove(id: string): Promise<void>
  /** 题集内的题目 id 列表（按题集组卷用） */
  itemIds(setId: string): Promise<string[]>
}

/* ==================== 知识树 ==================== */

export interface KnowledgeRepository {
  /** 获取科目下的完整知识树 */
  getTree(subjectId: SubjectId): Promise<KnowledgeNode[]>
  getNode(nodeId: string): Promise<KnowledgeNode | null>
  /** 获取某节点的所有子孙 id（用于按章筛题） */
  getDescendantIds(nodeId: string): Promise<string[]>
}

/* ==================== 学习状态（FSRS） ==================== */

export interface StateRepository {
  get(questionId: string): Promise<UserQuestionState | null>
  getMany(questionIds: string[]): Promise<UserQuestionState[]>
  upsert(state: UserQuestionState): Promise<void>
  /** 今日到期复习队列（PRD M3-F3：可提取性 < 0.9） */
  getDueQueue(subjectId: SubjectId | null, limit: number): Promise<UserQuestionState[]>
  getDueCount(): Promise<number>
  /** 错题池 */
  getWrongPool(subjectId: SubjectId | null): Promise<UserQuestionState[]>
}

/* ==================== 答题流水 ==================== */

export interface AnswerLogRepository {
  append(log: AnswerLog): Promise<void>
  listByQuestion(questionId: string): Promise<AnswerLog[]>
  listBySession(sessionId: string): Promise<AnswerLog[]>
  /** 统计：总答题数、正确数、今日答题数 */
  stats(): Promise<{ total: number; correct: number; today: number }>
  /** 最近 N 天每日答题数（学习热力图用），按日期升序 */
  dailyCounts(days: number): Promise<Array<{ date: string; count: number }>>
  /**
   * 按确信度聚合正确率（元认知校准图用）
   * 只统计用户做过自评的记录（模考的 confidence 为 null，应排除）
   */
  confidenceStats(): Promise<Array<{ confidence: string; total: number; correct: number }>>
}

/* ==================== 掌握度 ==================== */

export interface MasteryRepository {
  get(nodeId: string): Promise<UserKnowledgeState | null>
  listBySubject(subjectId: SubjectId): Promise<UserKnowledgeState[]>
  upsert(state: UserKnowledgeState): Promise<void>
}

/* ==================== 计划 ==================== */

/**
 * 计划仓储：只负责任务包的**存取**。
 * 任务包的**生成规则**（复习优先、超载冻结等）属于业务规则，在 PlanService 中。
 */
export interface PlanRepository {
  getTaskPack(date: string): Promise<DailyTaskPack | null>
  saveTaskPack(pack: DailyTaskPack): Promise<void>
  markPackCompleted(date: string, packId: string): Promise<void>
}

/* ==================== 模考 ==================== */

export interface ExamRepository {
  save(record: ExamRecord): Promise<void>
  list(limit?: number): Promise<ExamRecord[]>
  getLatest(): Promise<ExamRecord | null>
}

/* ==================== 备份 ==================== */

export interface BackupSnapshotInfo {
  id: number
  type: 'auto_daily' | 'auto_weekly' | 'manual' | 'pre_migration'
  createdAt: number
  sizeBytes: number
  /** JSON 字符串，含题量/错题数等摘要，用于「时间机器」展示 */
  stats: string
}

/**
 * 备份仓储：负责数据的**导出/导入**与快照的 CRUD。
 * 快照的创建时机与保留策略属于业务规则，在 BackupService 中。
 */
export interface BackupRepository {
  /** 导出为 JSON（当前阶段用 JSON，后续可换成 SQLite 二进制） */
  export(): Promise<{ manifest: BackupManifest; payload: string }>
  import(payload: string): Promise<BackupManifest>
  createSnapshot(
    type: BackupSnapshotInfo['type'],
    payload: string,
    stats: string,
  ): Promise<number>
  getSnapshot(id: number): Promise<string | null>
  listSnapshots(): Promise<BackupSnapshotInfo[]>
  deleteSnapshot(id: number): Promise<void>
}

export interface BackupManifest {
  formatVersion: string
  appVersion: string
  createdAt: number
  stats: {
    questionsAnswered: number
    wrongCount: number
    examRecords: number
  }
}

/* ==================== 数据源容器 ==================== */

export interface DataSource {
  readonly name: 'mock' | 'sqlite' | 'http'
  init(): Promise<void>
  questions: QuestionRepository
  /** 题集（题库）：用户命名分类，供「我的题库」管理与模考组卷 */
  questionSets: QuestionSetRepository
  knowledge: KnowledgeRepository
  states: StateRepository
  answerLogs: AnswerLogRepository
  mastery: MasteryRepository
  plan: PlanRepository
  exams: ExamRepository
  backup: BackupRepository
  /** 重置全部业务数据（清空学习记录与自建题，保留官方题库），用于重新体验首次流程 */
  reset?(): Promise<void>
}
