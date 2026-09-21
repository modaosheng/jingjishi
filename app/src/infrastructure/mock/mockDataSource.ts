/**
 * Mock 数据源 —— 实现 PRD §11 全部 Repository 接口
 *
 * 数据全部在内存，用户态数据（答题状态/答题流水）持久化到 localStorage，
 * 保证刷新后学习进度不丢。切换为 SQLite / HTTP 时只需替换本文件，业务代码零改动。
 */
import type {
  AnswerLog,
  DailyTaskPack,
  ExamRecord,
  KnowledgeNode,
  PracticeMode,
  Question,
  QuestionSet,
  SubjectId,
  TaskPack,
  TodayOverview,
  UserKnowledgeState,
  UserQuestionState,
} from '@/domain/entities'
import type {
  AnswerLogRepository,
  BackupManifest,
  BackupRepository,
  BackupSnapshotInfo,
  DataSource,
  ExamRepository,
  KnowledgeRepository,
  MasteryRepository,
  PlanRepository,
  QuestionQuery,
  QuestionRepository,
  QuestionSetRepository,
  StateRepository,
} from '@/domain/repositories'
import { buildAnswerLogs, buildKnowledgeTree, buildMastery, buildQuestions, buildUserStates } from './mockDataset'

const LS_STATES = 'jingshi.user_states'
const LS_LOGS = 'jingshi.answer_logs'
/** 用户自建题（导入 / AI 生成）—— 种子题库不入 localStorage，只持久化用户新增的题 */
const LS_USER_Q = 'jingshi.user_questions'

function readUserQuestions(): Question[] {
  try {
    const raw = localStorage.getItem(LS_USER_Q)
    return raw ? (JSON.parse(raw) as Question[]) : []
  } catch {
    return []
  }
}

function writeUserQuestions(list: Question[]) {
  try {
    localStorage.setItem(LS_USER_Q, JSON.stringify(list.filter((q) => q.ownerType !== 'official')))
  } catch {
    /* 容量超限时静默失败，不影响内存中的使用 */
  }
}

/* ==================== 数据集（懒初始化） ==================== */

let nodes: KnowledgeNode[] | null = null
let questions: Question[] | null = null
let logs: AnswerLog[] | null = null
let mastery: UserKnowledgeState[] | null = null
let states: Map<string, UserQuestionState> | null = null
const exams: ExamRecord[] = []

function getNodes() {
  if (!nodes) nodes = buildKnowledgeTree()
  return nodes
}
function getQuestions() {
  if (!questions) {
    // 种子题库 + 本地持久化的用户自建题
    questions = [...buildQuestions(getNodes(), 3), ...readUserQuestions()]
  }
  return questions
}
function getMastery() {
  if (!mastery) mastery = buildMastery(getNodes())
  return mastery
}

function getStates(): Map<string, UserQuestionState> {
  if (states) return states
  const built = buildUserStates(getNodes(), getQuestions())
  states = new Map(built.map((s) => [s.questionId, s]))
  // 合并本地持久化
  try {
    const raw = localStorage.getItem(LS_STATES)
    if (raw) {
      const arr = JSON.parse(raw) as UserQuestionState[]
      arr.forEach((s) => states!.set(s.questionId, s))
    }
  } catch {
    /* 忽略损坏的本地数据 */
  }
  return states
}

function getLogs(): AnswerLog[] {
  if (logs) return logs
  logs = buildAnswerLogs(getQuestions(), 800)
  try {
    const raw = localStorage.getItem(LS_LOGS)
    if (raw) {
      const local = JSON.parse(raw) as AnswerLog[]
      logs = [...local, ...logs]
    }
  } catch {
    /* 忽略 */
  }
  return logs
}

function persist() {
  try {
    if (states) localStorage.setItem(LS_STATES, JSON.stringify([...states.values()]))
    if (logs) localStorage.setItem(LS_LOGS, JSON.stringify(logs.slice(0, 500)))
  } catch {
    /* 配额不足时静默失败 */
  }
}

const shuffle = <T>(arr: T[]): T[] => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const today = () => new Date().toISOString().slice(0, 10)

/* ==================== Repository 实现 ==================== */

const questionRepo: QuestionRepository = {
  async getById(id) {
    return getQuestions().find((q) => q.id === id) ?? null
  },

  async query(q: QuestionQuery) {
    let list = getQuestions().filter((x) => x.status === 'active')

    if (q.subjectId) list = list.filter((x) => x.subjectId === q.subjectId)
    if (q.type) list = list.filter((x) => x.type === q.type)
    if (q.nodeId) {
      // 含子孙节点
      const ids = await knowledgeRepo.getDescendantIds(q.nodeId)
      const scope = new Set([q.nodeId, ...ids])
      list = list.filter((x) => x.knowledgeNodeIds.some((k) => scope.has(k)))
    }
    // 注意：先把 range 取出，避免回调参数遮蔽导致的类型收窄失败
    const range = q.difficulty
    if (range) {
      const [lo, hi] = range
      list = list.filter((x) => x.difficulty >= lo && x.difficulty <= hi)
    }
    if (q.onlyRealExam) list = list.filter((x) => !!x.examYear)
    if (q.examYear) list = list.filter((x) => x.examYear === q.examYear)
    if (q.sourceLevels?.length) list = list.filter((x) => q.sourceLevels!.includes(x.sourceLevel))
    if (q.ownerTypes?.length) list = list.filter((x) => q.ownerTypes!.includes(x.ownerType))
    if (q.includeIds?.length) {
      const keep = new Set(q.includeIds)
      list = list.filter((x) => keep.has(x.id))
    }
    if (q.excludeIds?.length) list = list.filter((x) => !q.excludeIds!.includes(x.id))
    if (q.shuffle) list = shuffle(list)
    return q.limit ? list.slice(0, q.limit) : list
  },

  async buildPaper({ mode, subjectId, nodeId, count, year, type, difficulty, ownerTypes }) {
    const now = Date.now()
    const st = getStates()

    // 我的题库：仅练用户自建 / AI 生成的题
    if (ownerTypes?.length) {
      return questionRepo.query({ subjectId, ownerTypes, limit: count, shuffle: true })
    }

    // 今日复习：FSRS 到期队列（PRD M3-F3 硬约束）
    if (mode === 'review') {
      const due = [...st.values()]
        .filter((s) => s.dueAt > 0 && s.dueAt <= now)
        .sort((a, b) => a.dueAt - b.dueAt)
        .slice(0, count)
      const qs: Question[] = []
      for (const s of due) {
        const q = getQuestions().find((x) => x.id === s.questionId)
        if (q) qs.push(q)
      }
      return qs.length ? qs : questionRepo.query({ subjectId, limit: count, shuffle: true })
    }

    if (mode === 'wrong') {
      const wrong = [...st.values()].filter((s) => s.isWrong).slice(0, count)
      const qs: Question[] = []
      for (const s of wrong) {
        const q = getQuestions().find((x) => x.id === s.questionId)
        if (q) qs.push(q)
      }
      return qs.length ? qs : questionRepo.query({ subjectId, limit: count, shuffle: true })
    }

    if (mode === 'high_freq') {
      return questionRepo.query({ subjectId, onlyRealExam: true, limit: count, shuffle: true })
    }

    // 真题：按年份（可选）+ 章节（可选）
    if (mode === 'real_exam') {
      return questionRepo.query({
        subjectId,
        onlyRealExam: true,
        examYear: year,
        nodeId,
        limit: count,
        shuffle: true,
      })
    }

    // 自适应难度的落地点：把「中心难度」展开为 ±1 的区间。
    // 用区间而非精确匹配 —— 难度是粗略标签，精确匹配常抽不满。
    const diffRange: [number, number] | undefined = difficulty
      ? [Math.max(1, difficulty - 1), Math.min(5, difficulty + 1)]
      : undefined

    // 专项：按题型 + 难度筛选
    if (mode === 'special') {
      return questionRepo.query({
        subjectId,
        type,
        difficulty: diffRange,
        limit: count,
        shuffle: true,
      })
    }

    // 章节练习：按章节（可选）+ 自适应难度，默认打乱（交错练习）
    return questionRepo.query({
      subjectId,
      nodeId,
      difficulty: diffRange,
      limit: count,
      shuffle: true,
    })
  },

  async save(list) {
    const all = getQuestions()
    list.forEach((q) => {
      const idx = all.findIndex((x) => x.id === q.id)
      if (idx >= 0) all[idx] = q
      else all.push(q)
    })
    writeUserQuestions(all)
  },

  async count(subjectId) {
    const list = getQuestions()
    return subjectId ? list.filter((x) => x.subjectId === subjectId).length : list.length
  },

  async remove(ids) {
    if (!ids.length) return
    const set = new Set(ids)
    const all = getQuestions()
    for (let i = all.length - 1; i >= 0; i--) {
      if (set.has(all[i].id)) all.splice(i, 1)
    }
    writeUserQuestions(all)
    // 同步清理学习状态，避免留下孤儿数据
    const st = getStates()
    ids.forEach((id) => st.delete(id))
    persist()
  },

  async countByOwner() {
    const all = getQuestions()
    return {
      official: all.filter((q) => q.ownerType === 'official').length,
      user: all.filter((q) => q.ownerType === 'user').length,
      ai: all.filter((q) => q.ownerType === 'ai').length,
    }
  },
}

/* ---------- 题集（题库） ---------- */

const LS_SETS = 'jingshi.question_sets'
const LS_SET_ITEMS = 'jingshi.question_set_items'

function readSets(): QuestionSet[] {
  try {
    const raw = localStorage.getItem(LS_SETS)
    return raw ? (JSON.parse(raw) as QuestionSet[]) : []
  } catch {
    return []
  }
}
function writeSets(list: QuestionSet[]) {
  try {
    localStorage.setItem(LS_SETS, JSON.stringify(list))
  } catch {
    /* 忽略配额错误 */
  }
}
function readSetItems(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(LS_SET_ITEMS)
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}
function writeSetItems(map: Record<string, string[]>) {
  try {
    localStorage.setItem(LS_SET_ITEMS, JSON.stringify(map))
  } catch {
    /* 忽略配额错误 */
  }
}

const questionSetRepo: QuestionSetRepository = {
  async list(filter) {
    return readSets()
      .filter(
        (s) =>
          (!filter?.subjectId || s.subjectId === filter.subjectId) &&
          (!filter?.category || s.category === filter.category),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
  },
  async get(id) {
    return readSets().find((s) => s.id === id) ?? null
  },
  async save(set, questionIds) {
    const list = readSets().filter((s) => s.id !== set.id)
    list.push({ ...set, questionCount: questionIds.length })
    writeSets(list)
    const items = readSetItems()
    items[set.id] = [...questionIds]
    writeSetItems(items)
  },
  async remove(id) {
    writeSets(readSets().filter((s) => s.id !== id))
    const items = readSetItems()
    delete items[id]
    writeSetItems(items)
  },
  async itemIds(setId) {
    return readSetItems()[setId] ?? []
  },
}

const knowledgeRepo: KnowledgeRepository = {
  async getTree(subjectId) {
    return getNodes().filter((n) => n.subjectId === subjectId)
  },
  async getNode(nodeId) {
    return getNodes().find((n) => n.id === nodeId) ?? null
  },
  async getDescendantIds(nodeId) {
    const all = getNodes()
    const result: string[] = []
    const walk = (id: string) => {
      all
        .filter((n) => n.parentId === id)
        .forEach((n) => {
          result.push(n.id)
          walk(n.id)
        })
    }
    walk(nodeId)
    return result
  },
}

const stateRepo: StateRepository = {
  async get(questionId) {
    return getStates().get(questionId) ?? null
  },
  async getMany(ids) {
    const st = getStates()
    return ids.map((id) => st.get(id)).filter((x): x is UserQuestionState => !!x)
  },
  async upsert(state) {
    getStates().set(state.questionId, state)
    persist()
  },
  async getDueQueue(subjectId, limit) {
    const now = Date.now()
    const list = [...getStates().values()]
      .filter((s) => s.dueAt > 0 && s.dueAt <= now)
      .sort((a, b) => a.dueAt - b.dueAt)
    if (!subjectId) return list.slice(0, limit)
    const qIds = new Set(getQuestions().filter((q) => q.subjectId === subjectId).map((q) => q.id))
    return list.filter((s) => qIds.has(s.questionId)).slice(0, limit)
  },
  async getDueCount() {
    const now = Date.now()
    return [...getStates().values()].filter((s) => s.dueAt > 0 && s.dueAt <= now).length
  },
  async getWrongPool(subjectId) {
    const list = [...getStates().values()].filter((s) => s.isWrong)
    if (!subjectId) return list
    const qIds = new Set(getQuestions().filter((q) => q.subjectId === subjectId).map((q) => q.id))
    return list.filter((s) => qIds.has(s.questionId))
  },
}

const answerLogRepo: AnswerLogRepository = {
  async append(log) {
    getLogs().unshift(log)
    persist()
  },
  async listByQuestion(questionId) {
    return getLogs().filter((l) => l.questionId === questionId)
  },
  async listBySession(sessionId) {
    return getLogs().filter((l) => l.sessionId === sessionId)
  },
  async stats() {
    const all = getLogs()
    const startOfDay = new Date().setHours(0, 0, 0, 0)
    return {
      total: all.length,
      correct: all.filter((l) => l.isCorrect).length,
      today: all.filter((l) => l.answeredAt >= startOfDay).length,
    }
  },

  async dailyCounts(days) {
    const since = Date.now() - days * 86400000
    const map = new Map<string, number>()
    for (const l of getLogs()) {
      if (l.answeredAt < since) continue
      const d = new Date(l.answeredAt).toISOString().slice(0, 10)
      map.set(d, (map.get(d) ?? 0) + 1)
    }
    return [...map.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
  },

  async confidenceStats() {
    const map = new Map<string, { total: number; correct: number }>()
    for (const l of getLogs()) {
      // 只统计做过自评的记录（模考的 confidence 为 null，应排除）
      if (!l.confidence) continue
      const cur = map.get(l.confidence) ?? { total: 0, correct: 0 }
      cur.total += 1
      if (l.isCorrect) cur.correct += 1
      map.set(l.confidence, cur)
    }
    return [...map.entries()].map(([confidence, v]) => ({ confidence, ...v }))
  },
}

const masteryRepo: MasteryRepository = {
  async get(nodeId) {
    return getMastery().find((m) => m.nodeId === nodeId) ?? null
  },
  async listBySubject(subjectId) {
    const ids = new Set(getNodes().filter((n) => n.subjectId === subjectId).map((n) => n.id))
    return getMastery().filter((m) => ids.has(m.nodeId))
  },
  async upsert(state) {
    const list = getMastery()
    const idx = list.findIndex((m) => m.nodeId === state.nodeId)
    if (idx >= 0) list[idx] = state
    else list.push(state)
  },
}

/* ==================== 每日任务包（PRD §6.4 算法） ==================== */

const EXAM_DATE = '2026-11-07'

/**
 * 任务包生成规则（复习优先、超载冻结新学、下一个知识点排序）
 * 已统一迁移到 domain/services/planService.ts。
 * 仓储层只负责存取，不再包含任何业务规则。
 */
const planRepo: PlanRepository = {
  async getTaskPack(date) {
    const raw = localStorage.getItem(`jingshi.pack.${date}`)
    return raw ? (JSON.parse(raw) as DailyTaskPack) : null
  },

  async saveTaskPack(pack) {
    localStorage.setItem(`jingshi.pack.${pack.date}`, JSON.stringify(pack))
  },

  async markPackCompleted(date, packId) {
    const pack = await planRepo.getTaskPack(date)
    const target = pack?.packs.find((p) => p.id === packId)
    if (target) target.completed = true
    if (pack) await planRepo.saveTaskPack(pack)
  },
}

const examRepo: ExamRepository = {
  async save(record) {
    exams.unshift(record)
    localStorage.setItem('jingshi.exams', JSON.stringify(exams.slice(0, 20)))
  },
  async list(limit = 10) {
    return exams.slice(0, limit)
  },
  async getLatest() {
    return exams[0] ?? null
  },
}

const backupRepo: BackupRepository = {
  async export() {
    const payload = JSON.stringify({
      states: [...getStates().values()],
      logs: getLogs().slice(0, 2000),
      mastery: getMastery(),
    })
    return {
      manifest: {
        formatVersion: '1.0',
        appVersion: '0.1.0',
        createdAt: Date.now(),
        stats: {
          questionsAnswered: getLogs().length,
          wrongCount: [...getStates().values()].filter((s) => s.isWrong).length,
          examRecords: exams.length,
        },
      },
      payload,
    }
  },
  async import(payload): Promise<BackupManifest> {
    const data = JSON.parse(payload)
    if (Array.isArray(data.states)) {
      const st = getStates()
      data.states.forEach((s: UserQuestionState) => st.set(s.questionId, s))
    }
    if (Array.isArray(data.logs)) logs = data.logs
    persist()
    return {
      formatVersion: '1.0',
      appVersion: '0.1.0',
      createdAt: Date.now(),
      stats: {
        questionsAnswered: getLogs().length,
        wrongCount: [...getStates().values()].filter((s) => s.isWrong).length,
        examRecords: exams.length,
      },
    }
  },
  async listSnapshots(): Promise<BackupSnapshotInfo[]> {
    return readSnapshots()
  },

  async createSnapshot(type, payload, stats) {
    const list = readSnapshots()
    const id = Date.now()
    const next: BackupSnapshotInfo = { id, type, createdAt: id, sizeBytes: payload.length, stats }
    try {
      localStorage.setItem(`jingshi.snapshot.${id}`, payload)
      localStorage.setItem('jingshi.snapshots', JSON.stringify([next, ...list].slice(0, 20)))
    } catch {
      // localStorage 配额不足：丢弃最旧的快照数据后重试一次
      const oldest = list[list.length - 1]
      if (oldest) localStorage.removeItem(`jingshi.snapshot.${oldest.id}`)
      localStorage.setItem(
        'jingshi.snapshots',
        JSON.stringify([next, ...list.slice(0, 9)]),
      )
    }
    return id
  },

  async getSnapshot(id) {
    return localStorage.getItem(`jingshi.snapshot.${id}`)
  },

  async deleteSnapshot(id) {
    localStorage.removeItem(`jingshi.snapshot.${id}`)
    localStorage.setItem(
      'jingshi.snapshots',
      JSON.stringify(readSnapshots().filter((s) => s.id !== id)),
    )
  },
}

/** 读取快照索引（快照正文按 id 分开存储，避免单个 key 过大） */
function readSnapshots(): BackupSnapshotInfo[] {
  try {
    return JSON.parse(localStorage.getItem('jingshi.snapshots') || '[]') as BackupSnapshotInfo[]
  } catch {
    return []
  }
}

/* ==================== 导出 ==================== */

export const mockDataSource: DataSource = {
  name: 'mock',
  async init() {
    // 预热数据集
    getNodes()
    getQuestions()
    getStates()
    getLogs()
  },

  /** 重置全部业务数据（内存 + localStorage），用于重新体验首次使用流程 */
  async reset() {
    questions = null
    states = null
    logs = null
    mastery = null
    exams.length = 0
    localStorage.clear()
  },
  questions: questionRepo,
  questionSets: questionSetRepo,
  knowledge: knowledgeRepo,
  states: stateRepo,
  answerLogs: answerLogRepo,
  mastery: masteryRepo,
  plan: planRepo,
  exams: examRepo,
  backup: backupRepo,
}

export { EXAM_DATE }
