/**
 * SQLite 数据源 —— 真实 SQL 实现，表结构与 PRD §11 / schema.sql 完全一致
 *
 * 迁移价值：将来接入 Capacitor 原生 SQLite 插件（@capacitor-community/sqlite）时，
 * 这里的 SQL 语句可原样复用，只需替换执行器。
 */
import type {
  AnswerLog,
  ExamRecord,
  KnowledgeNode,
  PracticeMode,
  Question,
  QuestionSet,
  SubjectId,
  UserKnowledgeState,
  UserQuestionState,
} from '@/domain/entities'
import type {
  AnswerLogRepository,
  BackupRepository,
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
import { buildAnswerLogs, buildKnowledgeTree, buildMastery, buildQuestions } from '../../mock/mockDataset'
import { sqliteClient as db } from './client'

const now = () => Date.now()

/* ---------- 行 → 实体 映射 ---------- */

type QRow = {
  id: string
  subject_id: string
  type: string
  stem: string
  options: string
  answer: string
  difficulty: number
  bloom_level: string | null
  knowledge_node_ids: string
  explanation: string | null
  source_level: string
  owner_type: string
  ai_metadata: string | null
  exam_year: number | null
  content_version: string | null
  status: string
}

const toQuestion = (r: QRow): Question => ({
  id: r.id,
  subjectId: r.subject_id as SubjectId,
  type: r.type as Question['type'],
  stem: r.stem,
  options: JSON.parse(r.options),
  answer: JSON.parse(r.answer),
  difficulty: r.difficulty,
  bloomLevel: (r.bloom_level ?? undefined) as Question['bloomLevel'],
  knowledgeNodeIds: JSON.parse(r.knowledge_node_ids),
  explanation: r.explanation
    ? JSON.parse(r.explanation)
    : { keyPoint: '暂无解析', perOption: [] },
  sourceLevel: r.source_level as Question['sourceLevel'],
  ownerType: r.owner_type as Question['ownerType'],
  aiMetadata: r.ai_metadata ? JSON.parse(r.ai_metadata) : undefined,
  examYear: r.exam_year ?? undefined,
  contentVersion: r.content_version ?? '2026',
  status: r.status as Question['status'],
})

type SRow = {
  question_id: string
  fsrs_difficulty: number
  fsrs_stability: number
  fsrs_retrievability: number
  due_at: number
  last_review_at: number | null
  review_count: number
  lapse_count: number
  conquer_count: number
  is_wrong: number
  is_favorited: number
  note: string | null
}

const toState = (r: SRow): UserQuestionState => ({
  questionId: r.question_id,
  fsrsDifficulty: r.fsrs_difficulty,
  fsrsStability: r.fsrs_stability,
  fsrsRetrievability: r.fsrs_retrievability,
  dueAt: r.due_at,
  lastReviewAt: r.last_review_at,
  reviewCount: r.review_count,
  lapseCount: r.lapse_count,
  conquerCount: r.conquer_count,
  isWrong: !!r.is_wrong,
  isFavorited: !!r.is_favorited,
  note: r.note ?? undefined,
})

/* ---------- 种子数据导入 ---------- */

async function seedIfEmpty() {
  const row = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM question')
  if (row && row.c > 0) return

  const nodes = buildKnowledgeTree()
  const questions = buildQuestions(nodes, 3)
  const mastery = buildMastery(nodes)
  const states = buildQuestions(nodes, 3).length ? undefined : undefined

  // 知识树
  await db.batch(
    nodes.map((n) => ({
      sql: `INSERT OR IGNORE INTO knowledge_node
            (id, subject_id, parent_id, level, name, weight, exam_freq, stars, sort_order)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      params: [n.id, n.subjectId, n.parentId, n.level, n.name, n.weight, n.examFreq, n.stars, n.order],
    })),
  )

  // 题目（分批，避免单批过大）
  const CHUNK = 200
  for (let i = 0; i < questions.length; i += CHUNK) {
    await db.batch(
      questions.slice(i, i + CHUNK).map((q) => ({
        sql: `INSERT OR IGNORE INTO question
              (id, subject_id, type, stem, options, answer, difficulty, bloom_level,
               knowledge_node_ids, explanation, source_level, owner_type, ai_metadata,
               exam_year, content_version, status, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        params: [
          q.id,
          q.subjectId,
          q.type,
          q.stem,
          JSON.stringify(q.options),
          JSON.stringify(q.answer),
          q.difficulty,
          q.bloomLevel ?? null,
          JSON.stringify(q.knowledgeNodeIds),
          JSON.stringify(q.explanation),
          q.sourceLevel,
          q.ownerType,
          q.aiMetadata ? JSON.stringify(q.aiMetadata) : null,
          q.examYear ?? null,
          q.contentVersion,
          q.status,
          now(),
          now(),
        ],
      })),
    )
  }

  // 掌握度
  await db.batch(
    mastery.map((m) => ({
      sql: `INSERT OR IGNORE INTO user_knowledge_state
            (node_id, mastery_score, level, question_count, correct_count, last_practice_at, predict_forget_at)
            VALUES (?,?,?,?,?,?,?)`,
      params: [
        m.nodeId,
        m.masteryScore,
        m.level,
        m.questionCount,
        m.correctCount,
        m.lastPracticeAt,
        m.predictForgetAt,
      ],
    })),
  )

  void states
}

/* ---------- Repository 实现 ---------- */

const questionRepo: QuestionRepository = {
  async getById(id) {
    const r = await db.get<QRow>('SELECT * FROM question WHERE id = ?', [id])
    return r ? toQuestion(r) : null
  },

  async query(q: QuestionQuery) {
    const where: string[] = ["status = 'active'"]
    const params: unknown[] = []

    if (q.subjectId) {
      where.push('subject_id = ?')
      params.push(q.subjectId)
    }
    if (q.type) {
      where.push('type = ?')
      params.push(q.type)
    }
    if (q.nodeId) {
      const ids = await knowledgeRepo.getDescendantIds(q.nodeId)
      const scope = [q.nodeId, ...ids]
      where.push(`EXISTS (
        SELECT 1 FROM json_each(question.knowledge_node_ids) je
        WHERE je.value IN (${scope.map(() => '?').join(',')})
      )`)
      params.push(...scope)
    }
    if (q.difficulty) {
      where.push('difficulty BETWEEN ? AND ?')
      params.push(q.difficulty[0], q.difficulty[1])
    }
    if (q.onlyRealExam) where.push('exam_year IS NOT NULL')
    if (q.examYear) {
      where.push('exam_year = ?')
      params.push(q.examYear)
    }
    if (q.sourceLevels?.length) {
      where.push(`source_level IN (${q.sourceLevels.map(() => '?').join(',')})`)
      params.push(...q.sourceLevels)
    }
    if (q.ownerTypes?.length) {
      where.push(`owner_type IN (${q.ownerTypes.map(() => '?').join(',')})`)
      params.push(...q.ownerTypes)
    }
    if (q.includeIds?.length) {
      where.push(`id IN (${q.includeIds.map(() => '?').join(',')})`)
      params.push(...q.includeIds)
    }
    if (q.excludeIds?.length) {
      where.push(`id NOT IN (${q.excludeIds.map(() => '?').join(',')})`)
      params.push(...q.excludeIds)
    }

    const order = q.shuffle ? 'ORDER BY RANDOM()' : 'ORDER BY id'
    const limit = q.limit ? `LIMIT ${Number(q.limit)}` : ''
    const rows = await db.all<QRow>(
      `SELECT * FROM question WHERE ${where.join(' AND ')} ${order} ${limit}`,
      params,
    )
    return rows.map(toQuestion)
  },

  async buildPaper({ mode, subjectId, nodeId, count, year, type, difficulty, ownerTypes }) {
    // 我的题库：仅练用户自建 / AI 生成的题
    if (ownerTypes?.length) {
      return questionRepo.query({ subjectId, ownerTypes, limit: count, shuffle: true })
    }
    if (mode === 'review') {
      // FSRS 到期队列 —— 核心索引 idx_uqs_due 在此生效
      const rows = await db.all<QRow>(
        `SELECT q.* FROM user_question_state s
         JOIN question q ON q.id = s.question_id
         WHERE s.due_at > 0 AND s.due_at <= ? AND q.subject_id = ?
         ORDER BY s.due_at LIMIT ?`,
        [now(), subjectId, count],
      )
      if (rows.length) return rows.map(toQuestion)
    }
    if (mode === 'wrong') {
      const rows = await db.all<QRow>(
        `SELECT q.* FROM user_question_state s
         JOIN question q ON q.id = s.question_id
         WHERE s.is_wrong = 1 AND q.subject_id = ? ORDER BY RANDOM() LIMIT ?`,
        [subjectId, count],
      )
      if (rows.length) return rows.map(toQuestion)
    }
    // 真题：按年份 + 章节
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
    // 专项：按题型 + 难度
    // 自适应难度：把「中心难度」展开为 ±1 区间（精确匹配常抽不满）
    const diffRange: [number, number] | undefined = difficulty
      ? [Math.max(1, difficulty - 1), Math.min(5, difficulty + 1)]
      : undefined

    if (mode === 'special') {
      return questionRepo.query({
        subjectId,
        type,
        difficulty: diffRange,
        limit: count,
        shuffle: true,
      })
    }
    // 章节练习：按章节（可选）+ 自适应难度
    return questionRepo.query({ subjectId, nodeId, difficulty: diffRange, limit: count, shuffle: true })
  },

  async save(list) {
    if (!list.length) return
    await db.batch(
      list.map((q) => ({
        sql: `INSERT INTO question
              (id, subject_id, type, stem, options, answer, difficulty, bloom_level,
               knowledge_node_ids, explanation, source_level, owner_type, ai_metadata,
               exam_year, content_version, status, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                stem = excluded.stem, options = excluded.options, answer = excluded.answer,
                explanation = excluded.explanation, updated_at = excluded.updated_at`,
        params: [
          q.id,
          q.subjectId,
          q.type,
          q.stem,
          JSON.stringify(q.options),
          JSON.stringify(q.answer),
          q.difficulty,
          q.bloomLevel ?? null,
          JSON.stringify(q.knowledgeNodeIds),
          JSON.stringify(q.explanation),
          q.sourceLevel,
          q.ownerType,
          q.aiMetadata ? JSON.stringify(q.aiMetadata) : null,
          q.examYear ?? null,
          q.contentVersion,
          q.status,
          now(),
          now(),
        ],
      })),
    )
  },

  async count(subjectId) {
    const r = subjectId
      ? await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM question WHERE subject_id = ?', [subjectId])
      : await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM question')
    return r?.c ?? 0
  },

  async remove(ids) {
    if (!ids.length) return
    const ph = ids.map(() => '?').join(',')
    // 一并清理关联数据，避免留下孤儿记录
    await db.batch([
      { sql: `DELETE FROM question WHERE id IN (${ph})`, params: ids },
      { sql: `DELETE FROM user_question_state WHERE question_id IN (${ph})`, params: ids },
      { sql: `DELETE FROM answer_log WHERE question_id IN (${ph})`, params: ids },
    ])
  },

  async countByOwner() {
    const rows = await db.all<{ owner_type: string; c: number }>(
      'SELECT owner_type, COUNT(*) AS c FROM question GROUP BY owner_type',
    )
    const get = (t: string) => rows.find((r) => r.owner_type === t)?.c ?? 0
    return { official: get('official'), user: get('user'), ai: get('ai') }
  },
}

/* ---------- 题集（题库） ---------- */

type SetRow = {
  id: string
  name: string
  source: string
  category: string | null
  year: number | null
  subject_id: string | null
  question_count: number
  created_at: number
}

const toSet = (r: SetRow): QuestionSet => ({
  id: r.id,
  name: r.name,
  category: (r.category as QuestionSet['category']) ?? 'custom',
  year: r.year ?? undefined,
  subjectId: (r.subject_id ?? 'econ_base') as SubjectId,
  source: r.source as QuestionSet['source'],
  questionCount: r.question_count,
  createdAt: r.created_at,
})

const questionSetRepo: QuestionSetRepository = {
  async list(filter) {
    const where: string[] = []
    const params: unknown[] = []
    if (filter?.subjectId) {
      where.push('subject_id = ?')
      params.push(filter.subjectId)
    }
    if (filter?.category) {
      where.push('category = ?')
      params.push(filter.category)
    }
    const sql =
      'SELECT * FROM question_set' +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY created_at DESC'
    const rows = await db.all<SetRow>(sql, params)
    return rows.map(toSet)
  },

  async get(id) {
    const r = await db.get<SetRow>('SELECT * FROM question_set WHERE id = ?', [id])
    return r ? toSet(r) : null
  },

  async save(set, questionIds) {
    await db.batch([
      {
        sql: `INSERT INTO question_set (id, name, source, category, year, subject_id, question_count, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                source = excluded.source,
                category = excluded.category,
                year = excluded.year,
                subject_id = excluded.subject_id,
                question_count = excluded.question_count`,
        params: [
          set.id,
          set.name,
          set.source,
          set.category,
          set.year ?? null,
          set.subjectId,
          questionIds.length,
          set.createdAt,
        ],
      },
      { sql: 'DELETE FROM question_set_item WHERE set_id = ?', params: [set.id] },
      ...questionIds.map((qid) => ({
        sql: 'INSERT OR IGNORE INTO question_set_item (set_id, question_id) VALUES (?, ?)',
        params: [set.id, qid],
      })),
    ])
  },

  async remove(id) {
    await db.batch([
      { sql: 'DELETE FROM question_set WHERE id = ?', params: [id] },
      { sql: 'DELETE FROM question_set_item WHERE set_id = ?', params: [id] },
    ])
  },

  async itemIds(setId) {
    const rows = await db.all<{ question_id: string }>(
      'SELECT question_id FROM question_set_item WHERE set_id = ?',
      [setId],
    )
    return rows.map((r) => r.question_id)
  },
}

const knowledgeRepo: KnowledgeRepository = {
  async getTree(subjectId) {
    const rows = await db.all<{
      id: string
      subject_id: string
      parent_id: string | null
      level: number
      name: string
      weight: number
      exam_freq: number
      stars: number
      sort_order: number
    }>('SELECT * FROM knowledge_node WHERE subject_id = ? ORDER BY sort_order', [subjectId])
    return rows.map((r) => ({
      id: r.id,
      subjectId: r.subject_id as SubjectId,
      parentId: r.parent_id,
      level: r.level as 1 | 2 | 3,
      name: r.name,
      weight: r.weight,
      examFreq: r.exam_freq,
      stars: r.stars,
      order: r.sort_order,
    }))
  },
  async getNode(nodeId) {
    const all = await knowledgeRepo.getTree((nodeId.startsWith('econ') ? 'econ_base' : 'hr') as SubjectId)
    return all.find((n) => n.id === nodeId) ?? null
  },
  async getDescendantIds(nodeId) {
    const rows = await db.all<{ id: string; parent_id: string | null }>(
      'SELECT id, parent_id FROM knowledge_node',
    )
    const childrenOf = new Map<string, string[]>()
    rows.forEach((r) => {
      if (!r.parent_id) return
      const arr = childrenOf.get(r.parent_id) ?? []
      arr.push(r.id)
      childrenOf.set(r.parent_id, arr)
    })
    const out: string[] = []
    const walk = (id: string) => {
      ;(childrenOf.get(id) ?? []).forEach((c) => {
        out.push(c)
        walk(c)
      })
    }
    walk(nodeId)
    return out
  },
}

const stateRepo: StateRepository = {
  async get(questionId) {
    const r = await db.get<SRow>('SELECT * FROM user_question_state WHERE question_id = ?', [questionId])
    return r ? toState(r) : null
  },
  async getMany(ids) {
    if (!ids.length) return []
    const rows = await db.all<SRow>(
      `SELECT * FROM user_question_state WHERE question_id IN (${ids.map(() => '?').join(',')})`,
      ids,
    )
    return rows.map(toState)
  },
  async upsert(s) {
    await db.run(
      `INSERT INTO user_question_state
       (question_id, fsrs_difficulty, fsrs_stability, fsrs_retrievability, due_at,
        last_review_at, review_count, lapse_count, conquer_count, is_wrong, is_favorited, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(question_id) DO UPDATE SET
         fsrs_difficulty = excluded.fsrs_difficulty,
         fsrs_stability = excluded.fsrs_stability,
         fsrs_retrievability = excluded.fsrs_retrievability,
         due_at = excluded.due_at,
         last_review_at = excluded.last_review_at,
         review_count = excluded.review_count,
         lapse_count = excluded.lapse_count,
         conquer_count = excluded.conquer_count,
         is_wrong = excluded.is_wrong,
         is_favorited = excluded.is_favorited,
         note = excluded.note`,
      [
        s.questionId,
        s.fsrsDifficulty,
        s.fsrsStability,
        s.fsrsRetrievability,
        s.dueAt,
        s.lastReviewAt,
        s.reviewCount,
        s.lapseCount,
        s.conquerCount,
        s.isWrong ? 1 : 0,
        s.isFavorited ? 1 : 0,
        s.note ?? null,
      ],
    )
  },
  async getDueQueue(subjectId, limit) {
    const rows = await db.all<SRow>(
      `SELECT s.* FROM user_question_state s
       JOIN question q ON q.id = s.question_id
       WHERE s.due_at > 0 AND s.due_at <= ? ${subjectId ? 'AND q.subject_id = ?' : ''}
       ORDER BY s.due_at LIMIT ?`,
      subjectId ? [now(), subjectId, limit] : [now(), limit],
    )
    return rows.map(toState)
  },
  async getDueCount() {
    const r = await db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM user_question_state WHERE due_at > 0 AND due_at <= ?',
      [now()],
    )
    return r?.c ?? 0
  },
  async getWrongPool(subjectId) {
    const rows = await db.all<SRow>(
      `SELECT s.* FROM user_question_state s
       JOIN question q ON q.id = s.question_id
       WHERE s.is_wrong = 1 ${subjectId ? 'AND q.subject_id = ?' : ''}`,
      subjectId ? [subjectId] : [],
    )
    return rows.map(toState)
  },
}

const answerLogRepo: AnswerLogRepository = {
  async append(log) {
    await db.run(
      `INSERT INTO answer_log
       (question_id, answered_at, user_answer, is_correct, confidence, duration_ms, mode, session_id, error_reason)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        log.questionId,
        log.answeredAt,
        JSON.stringify(log.userAnswer),
        log.isCorrect ? 1 : 0,
        log.confidence ?? null,
        log.durationMs,
        log.mode,
        log.sessionId ?? null,
        log.errorReason ?? null,
      ],
    )
  },
  async listByQuestion(questionId) {
    const rows = await db.all<Record<string, unknown>>(
      'SELECT * FROM answer_log WHERE question_id = ? ORDER BY answered_at DESC',
      [questionId],
    )
    return rows.map(mapLog)
  },
  async listBySession(sessionId) {
    const rows = await db.all<Record<string, unknown>>(
      'SELECT * FROM answer_log WHERE session_id = ? ORDER BY answered_at',
      [sessionId],
    )
    return rows.map(mapLog)
  },
  async stats() {
    const total = (await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM answer_log'))?.c ?? 0
    const correct =
      (await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM answer_log WHERE is_correct = 1'))?.c ?? 0
    const startOfDay = new Date().setHours(0, 0, 0, 0)
    const today =
      (await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM answer_log WHERE answered_at >= ?', [startOfDay]))
        ?.c ?? 0
    return { total, correct, today }
  },

  async dailyCounts(days) {
    const since = Date.now() - days * 86400000
    const rows = await db.all<{ d: string; c: number }>(
      `SELECT date(answered_at / 1000, 'unixepoch', 'localtime') AS d, COUNT(*) AS c
       FROM answer_log
       WHERE answered_at >= ?
       GROUP BY d
       ORDER BY d`,
      [since],
    )
    return rows.map((r) => ({ date: r.d, count: r.c }))
  },

  async confidenceStats() {
    const rows = await db.all<{ confidence: string; total: number; correct: number }>(
      `SELECT confidence, COUNT(*) AS total,
              SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct
       FROM answer_log
       WHERE confidence IS NOT NULL
       GROUP BY confidence`,
    )
    return rows.map((r) => ({ confidence: r.confidence, total: r.total, correct: r.correct ?? 0 }))
  },
}

function mapLog(r: Record<string, unknown>): AnswerLog {
  return {
    id: r.id as number,
    questionId: r.question_id as string,
    answeredAt: r.answered_at as number,
    userAnswer: JSON.parse((r.user_answer as string) || '[]'),
    isCorrect: !!r.is_correct,
    confidence: (r.confidence as AnswerLog['confidence']) ?? null,
    durationMs: r.duration_ms as number,
    mode: r.mode as PracticeMode,
    sessionId: (r.session_id as string) ?? undefined,
    errorReason: (r.error_reason as AnswerLog['errorReason']) ?? undefined,
  }
}

const masteryRepo: MasteryRepository = {
  async get(nodeId) {
    const r = await db.get<Record<string, unknown>>(
      'SELECT * FROM user_knowledge_state WHERE node_id = ?',
      [nodeId],
    )
    return r ? mapMastery(r) : null
  },
  async listBySubject(subjectId) {
    const rows = await db.all<Record<string, unknown>>(
      `SELECT m.* FROM user_knowledge_state m
       JOIN knowledge_node n ON n.id = m.node_id
       WHERE n.subject_id = ?`,
      [subjectId],
    )
    return rows.map(mapMastery)
  },
  async upsert(s) {
    await db.run(
      `INSERT INTO user_knowledge_state
       (node_id, mastery_score, level, question_count, correct_count, last_practice_at, predict_forget_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(node_id) DO UPDATE SET
         mastery_score = excluded.mastery_score, level = excluded.level,
         question_count = excluded.question_count, correct_count = excluded.correct_count,
         last_practice_at = excluded.last_practice_at, predict_forget_at = excluded.predict_forget_at`,
      [s.nodeId, s.masteryScore, s.level, s.questionCount, s.correctCount, s.lastPracticeAt, s.predictForgetAt],
    )
  },
}

function mapMastery(r: Record<string, unknown>): UserKnowledgeState {
  return {
    nodeId: r.node_id as string,
    masteryScore: r.mastery_score as number,
    level: r.level as UserKnowledgeState['level'],
    questionCount: r.question_count as number,
    correctCount: r.correct_count as number,
    lastPracticeAt: (r.last_practice_at as number) ?? null,
    predictForgetAt: (r.predict_forget_at as number) ?? null,
  }
}

/* ---------- 导出 ---------- */

/** 轻量迁移：为老库补齐新增列（列已存在则忽略） */
async function migrate() {
  const alters = [
    "ALTER TABLE question_set ADD COLUMN category TEXT NOT NULL DEFAULT 'custom'",
    'ALTER TABLE question_set ADD COLUMN year INTEGER',
    'ALTER TABLE question_set ADD COLUMN subject_id TEXT',
  ]
  for (const sql of alters) {
    try {
      await db.run(sql)
    } catch {
      /* 列已存在 → 忽略 */
    }
  }
}

export const sqliteDataSource: DataSource = {
  name: 'sqlite',
  async init() {
    await db.init()
    await migrate()
    await seedIfEmpty()
  },

  /**
   * 重置全部业务数据（保留官方题库与知识树），用于重新体验首次使用流程
   */
  async reset() {
    await db.batch([
      { sql: 'DELETE FROM answer_log' },
      { sql: 'DELETE FROM user_question_state' },
      { sql: 'DELETE FROM user_knowledge_state' },
      { sql: 'DELETE FROM exam_record' },
      { sql: 'DELETE FROM daily_task_pack' },
      { sql: 'DELETE FROM study_plan' },
      { sql: 'DELETE FROM question_set_item' },
      { sql: 'DELETE FROM question_set' },
      { sql: 'DELETE FROM backup_snapshot' },
      { sql: 'DELETE FROM attachment' },
      { sql: 'DELETE FROM ai_response_cache' },
      // 只删自建 / AI 题，官方题库保留
      { sql: "DELETE FROM question WHERE owner_type != 'official'" },
    ])
  },
  questions: questionRepo,
  questionSets: questionSetRepo,
  knowledge: knowledgeRepo,
  states: stateRepo,
  answerLogs: answerLogRepo,
  mastery: masteryRepo,
  // 计划/模考/备份在 v1 阶段复用内存实现，SQL 表已建好，后续可平滑迁移
  plan: {
    // 只做存取；任务包的生成规则在 PlanService
    async getTaskPack(date) {
      const rows = await db.all<{
        pack_id: string
        pack_type: string
        title: string
        question_count: number
        estimated_minutes: number
        completed: number
        target_ref: string | null
      }>('SELECT * FROM daily_task_pack WHERE date = ? ORDER BY rowid', [date])
      if (!rows.length) return null
      return {
        date,
        packs: rows.map((r) => ({
          id: r.pack_id,
          type: r.pack_type as 'review' | 'new' | 'wrong' | 'test' | 'exam',
          title: r.title,
          questionCount: r.question_count,
          estimatedMinutes: r.estimated_minutes,
          completed: !!r.completed,
          targetRef: r.target_ref ?? undefined,
        })),
        totalMinutes: rows.reduce((s, r) => s + r.estimated_minutes, 0),
      }
    },

    async saveTaskPack(pack) {
      if (!pack.packs.length) return
      await db.batch(
        pack.packs.map((p) => ({
          sql: `INSERT INTO daily_task_pack
                (date, pack_id, pack_type, title, question_count, estimated_minutes, completed, target_ref)
                VALUES (?,?,?,?,?,?,?,?)
                ON CONFLICT(date, pack_id) DO UPDATE SET
                  title = excluded.title,
                  question_count = excluded.question_count,
                  estimated_minutes = excluded.estimated_minutes,
                  completed = excluded.completed,
                  target_ref = excluded.target_ref`,
          params: [
            pack.date,
            p.id,
            p.type,
            p.title,
            p.questionCount,
            p.estimatedMinutes,
            p.completed ? 1 : 0,
            p.targetRef ?? null,
          ],
        })),
      )
    },

    async markPackCompleted(date, packId) {
      await db.run('UPDATE daily_task_pack SET completed = 1 WHERE date = ? AND pack_id = ?', [
        date,
        packId,
      ])
    },
  } satisfies PlanRepository,
  exams: {
    async save(r: ExamRecord) {
      await db.run(
        `INSERT OR REPLACE INTO exam_record
         (id, subject_id, mode, started_at, duration_ms, score, passed, type_scores, module_scores, unanswered, marked)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          r.id,
          r.subjectId,
          r.mode,
          r.startedAt,
          r.durationMs,
          r.score,
          r.passed ? 1 : 0,
          JSON.stringify(r.typeScores),
          JSON.stringify(r.moduleScores),
          r.unanswered,
          r.marked,
        ],
      )
    },
    async list(limit = 10) {
      const rows = await db.all<Record<string, unknown>>(
        'SELECT * FROM exam_record ORDER BY started_at DESC LIMIT ?',
        [limit],
      )
      return rows.map(mapExam)
    },
    async getLatest() {
      const r = await db.get<Record<string, unknown>>(
        'SELECT * FROM exam_record ORDER BY started_at DESC LIMIT 1',
      )
      return r ? mapExam(r) : null
    },
  } satisfies ExamRepository,
  backup: {
    async export() {
      const [states, logs, mastery, examRows] = await Promise.all([
        db.all<Record<string, unknown>>('SELECT * FROM user_question_state'),
        db.all<Record<string, unknown>>('SELECT * FROM answer_log ORDER BY answered_at DESC LIMIT 2000'),
        db.all<Record<string, unknown>>('SELECT * FROM user_knowledge_state'),
        db.all<Record<string, unknown>>('SELECT * FROM exam_record'),
      ])
      const payload = JSON.stringify({ states, logs, mastery, exams: examRows })
      return {
        manifest: {
          formatVersion: '1.0',
          appVersion: '0.1.0',
          createdAt: Date.now(),
          stats: {
            questionsAnswered: logs.length,
            wrongCount: states.filter((s) => s.is_wrong).length,
            examRecords: examRows.length,
          },
        },
        payload,
      }
    },

    /**
     * 导入：先建 pre_migration 快照再覆盖，失败可回滚（PRD M10-F4）
     */
    async import(payload) {
      const current = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM user_question_state')
      if (current && current.c > 0) {
        const snapshot = await sqliteDataSource.backup.export()
        await sqliteDataSource.backup.createSnapshot(
          'pre_migration',
          snapshot.payload,
          JSON.stringify(snapshot.manifest.stats),
        )
      }

      const data = JSON.parse(payload) as {
        states?: Record<string, unknown>[]
        logs?: Record<string, unknown>[]
        mastery?: Record<string, unknown>[]
      }

      if (Array.isArray(data.states) && data.states.length) {
        await db.batch(
          data.states.map((s) => ({
            sql: `INSERT INTO user_question_state
                  (question_id, fsrs_difficulty, fsrs_stability, fsrs_retrievability, due_at,
                   last_review_at, review_count, lapse_count, conquer_count, is_wrong, is_favorited, note)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(question_id) DO UPDATE SET
                    fsrs_difficulty = excluded.fsrs_difficulty,
                    fsrs_stability = excluded.fsrs_stability,
                    fsrs_retrievability = excluded.fsrs_retrievability,
                    due_at = excluded.due_at,
                    last_review_at = excluded.last_review_at,
                    review_count = excluded.review_count,
                    lapse_count = excluded.lapse_count,
                    conquer_count = excluded.conquer_count,
                    is_wrong = excluded.is_wrong,
                    is_favorited = excluded.is_favorited`,
            params: [
              s.question_id, s.fsrs_difficulty, s.fsrs_stability, s.fsrs_retrievability, s.due_at,
              s.last_review_at, s.review_count, s.lapse_count, s.conquer_count,
              s.is_wrong, s.is_favorited, s.note ?? null,
            ],
          })),
        )
      }

      if (Array.isArray(data.mastery) && data.mastery.length) {
        await db.batch(
          data.mastery.map((m) => ({
            sql: `INSERT INTO user_knowledge_state
                  (node_id, mastery_score, level, question_count, correct_count, last_practice_at, predict_forget_at)
                  VALUES (?,?,?,?,?,?,?)
                  ON CONFLICT(node_id) DO UPDATE SET mastery_score = excluded.mastery_score`,
            params: [
              m.node_id, m.mastery_score, m.level, m.question_count, m.correct_count,
              m.last_practice_at, m.predict_forget_at,
            ],
          })),
        )
      }

      const stats = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM user_question_state')
      const wrong = await db.get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM user_question_state WHERE is_wrong = 1',
      )
      return {
        formatVersion: '1.0',
        appVersion: '0.1.0',
        createdAt: Date.now(),
        stats: {
          questionsAnswered: stats?.c ?? 0,
          wrongCount: wrong?.c ?? 0,
          examRecords: 0,
        },
      }
    },

    async createSnapshot(type, payload, stats) {
      await db.run(
        'INSERT INTO backup_snapshot (type, created_at, size_bytes, stats, payload) VALUES (?,?,?,?,?)',
        [type, Date.now(), payload.length, stats, payload],
      )
      const row = await db.get<{ id: number }>('SELECT last_insert_rowid() AS id')
      return Number(row?.id ?? 0)
    },

    async getSnapshot(id) {
      const r = await db.get<{ payload: string | null }>(
        'SELECT payload FROM backup_snapshot WHERE id = ?',
        [id],
      )
      return r?.payload ?? null
    },

    async listSnapshots() {
      const rows = await db.all<{
        id: number
        type: string
        created_at: number
        size_bytes: number
        stats: string
      }>(
        'SELECT id, type, created_at, size_bytes, stats FROM backup_snapshot ORDER BY created_at DESC LIMIT 20',
      )
      return rows.map((r) => ({
        id: r.id,
        type: r.type as 'auto_daily' | 'auto_weekly' | 'manual' | 'pre_migration',
        createdAt: r.created_at,
        sizeBytes: r.size_bytes,
        stats: r.stats,
      }))
    },

    async deleteSnapshot(id) {
      await db.run('DELETE FROM backup_snapshot WHERE id = ?', [id])
    },
  } satisfies BackupRepository,
}

function mapExam(r: Record<string, unknown>): ExamRecord {
  return {
    id: r.id as string,
    subjectId: r.subject_id as SubjectId,
    mode: r.mode as ExamRecord['mode'],
    startedAt: r.started_at as number,
    durationMs: r.duration_ms as number,
    score: r.score as number,
    passed: !!r.passed,
    typeScores: JSON.parse((r.type_scores as string) || '{}'),
    moduleScores: JSON.parse((r.module_scores as string) || '[]'),
    unanswered: r.unanswered as number,
    marked: r.marked as number,
  }
}

export type { KnowledgeNode }
