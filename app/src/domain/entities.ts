/**
 * 领域实体定义 —— 严格对齐 PRD §11 数据模型
 * 本层不依赖任何数据源实现（SQLite / Mock / HTTP 均可）
 */

/* ==================== 枚举 ==================== */

/** 科目 */
export type SubjectId = 'econ_base' | 'hr'

/** 题型：单选 / 多选 / 案例分析 */
export type QuestionType = 'single' | 'multi' | 'case'

/** 内容可信度等级（PRD §8.6.1） */
export type SourceLevel = 'S' | 'A' | 'B' | 'C'

/** 归属：官方内置 / 用户自建 / AI 生成 */
export type OwnerType = 'official' | 'user' | 'ai'

/** 布鲁姆认知层次 */
export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze'

/** 确信度自评（元认知校准，PRD M3-F2） */
export type Confidence = 'sure' | 'unsure' | 'noidea'

/** FSRS 四级评分（PRD M3-F3） */
export type FsrsRating = 'again' | 'hard' | 'good' | 'easy'

/** 错误归因（PRD M4-F2） */
export type ErrorReason =
  | 'not_memorized' // 概念没记住
  | 'confused' // 概念混淆
  | 'misread' // 题意没看清
  | 'calc_error' // 计算失误
  | 'no_idea' // 完全没思路

/** 掌握度档位 */
export type MasteryLevel = 'unlearned' | 'weak' | 'fair' | 'good' | 'mastered'

/** 练习模式（PRD M3-F1） */
export type PracticeMode =
  | 'review' // 今日复习
  | 'chapter' // 章节练习
  | 'special' // 专项训练
  | 'real_exam' // 真题演练
  | 'wrong' // 错题重做
  | 'high_freq' // 高频必刷
  | 'ai' // AI 组卷
  | 'exam' // 模考

/* ==================== 核心实体 ==================== */

export interface KnowledgeNode {
  id: string
  subjectId: SubjectId
  parentId: string | null
  level: 1 | 2 | 3 // 模块 / 章 / 知识点
  name: string
  /** 预估分值权重 */
  weight: number
  /** 近 5 年真题考查次数 */
  examFreq: number
  /** 重要度 1-5 */
  stars: number
  order: number
}

export interface QuestionOption {
  key: string // A/B/C/D/E
  content: string
}

export interface QuestionExplanation {
  /** 一句话考点 */
  keyPoint: string
  /** 逐项解析：每个选项独立解释（PRD A2 硬要求，禁止"故选D"） */
  perOption: Array<{ key: string; correct: boolean; text: string }>
  /** 题干陷阱词（PRD A2：审题不清是经济师最高频失分原因） */
  trapWords?: string[]
  /** 来源溯源 */
  sourceRef?: string
  /**
   * 整体解析正文（无法拆成逐项解析时展示，例如用户导入的解析段落）
   * 对应答题页「解析」区块
   */
  analysis?: string
}

export interface AiMetadata {
  model: string
  /** 生成置信度 0-1 */
  confidence: number
  /** 校验状态 */
  verified: boolean
  generatedAt: number
}

export interface Question {
  id: string
  subjectId: SubjectId
  type: QuestionType
  stem: string
  options: QuestionOption[]
  /** 正确答案的 key 数组（单选 1 个，多选 2-4 个） */
  answer: string[]
  /** 难度 1-5 */
  difficulty: number
  bloomLevel?: BloomLevel
  knowledgeNodeIds: string[]
  explanation: QuestionExplanation
  /** 可信度等级 */
  sourceLevel: SourceLevel
  ownerType: OwnerType
  aiMetadata?: AiMetadata
  /** 是否真题 / 年份 */
  examYear?: number
  contentVersion: string
  status: 'active' | 'pending_review' | 'removed'
}

/**
 * 题集类别
 * - custom：自建题目（默认，在「我的题库」里练）
 * - past_exam：往年真题（带年份，可单独用于模考）
 * - mock：模拟题
 * - chapter：按章节整理
 */
export type QuestionSetCategory = 'custom' | 'past_exam' | 'mock' | 'chapter'

/**
 * 题集（题库）：用户命名并分类的题目集合。
 * 用途：①「我的题库」按题集管理 ② 模考时选某个题集单独组卷（如「2024 年真题」）
 */
export interface QuestionSet {
  id: string
  name: string
  category: QuestionSetCategory
  /** 往年真题年份（category='past_exam' 时使用） */
  year?: number
  subjectId: SubjectId
  source: 'upload' | 'ai' | 'manual'
  questionCount: number
  createdAt: number
}

/** 用户-题目记忆状态（FSRS） */
export interface UserQuestionState {
  questionId: string
  /** FSRS 难度 D */
  fsrsDifficulty: number
  /** FSRS 稳定性 S */
  fsrsStability: number
  /** FSRS 可提取性 R */
  fsrsRetrievability: number
  /** 复习到期时间（ms） */
  dueAt: number
  lastReviewAt: number | null
  reviewCount: number
  lapseCount: number
  /** 连续答对次数，用于移出错题本 */
  conquerCount: number
  isWrong: boolean
  isFavorited: boolean
  note?: string
}

export interface AnswerLog {
  id?: number
  questionId: string
  answeredAt: number
  userAnswer: string[]
  isCorrect: boolean
  confidence: Confidence | null
  durationMs: number
  mode: PracticeMode
  sessionId?: string
  errorReason?: ErrorReason
}

export interface UserKnowledgeState {
  nodeId: string
  /** 掌握度 0-100 */
  masteryScore: number
  level: MasteryLevel
  questionCount: number
  correctCount: number
  lastPracticeAt: number | null
  /** 预测遗忘临界日 */
  predictForgetAt: number | null
}

export interface TaskPack {
  id: string
  type: 'review' | 'new' | 'wrong' | 'test' | 'exam'
  title: string
  questionCount: number
  estimatedMinutes: number
  completed: boolean
  /** 关联的知识点 / 题集 */
  targetRef?: string
}

export interface DailyTaskPack {
  date: string // YYYY-MM-DD
  packs: TaskPack[]
  totalMinutes: number
}

export interface StudyPlan {
  id: string
  subjectIds: SubjectId[]
  targetScore: number
  dailyMinutes: number
  startDate: string
  examDate: string
  stage: 'P0' | 'P1' | 'P2' | 'P3' | 'P4'
  createdAt: number
}

export interface ExamRecord {
  id: string
  subjectId: SubjectId
  mode: 'strict' | 'loose'
  startedAt: number
  durationMs: number
  score: number
  passed: boolean
  typeScores: Record<QuestionType, { correct: number; total: number; score: number }>
  moduleScores: Array<{ nodeId: string; name: string; correct: number; total: number }>
  unanswered: number
  marked: number
}

/* ==================== 查询结果结构 ==================== */

/** 首页今日任务聚合数据 */
export interface TodayOverview {
  date: string
  daysToExam: number
  packs: TaskPack[]
  completedCount: number
  totalCount: number
  remainingMinutes: number
  /** 复习超载提示（PRD §6.4） */
  overloadNotice: string | null
  /** 本周掌握度变化 */
  weeklyMasteryDelta: number
}
