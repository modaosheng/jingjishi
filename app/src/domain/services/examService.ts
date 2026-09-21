/**
 * 模考服务（业务层）
 *
 * 承接原先写在页面里的计分逻辑，包含 PRD 的两处核心规则：
 *   R1 评分：单选 1 分；多选/案例全对 2 分，少选且无错项每项 0.5 分，错选 0 分
 *   M5-F5 ⑤ 遗憾分分析：「本来能拿到却丢掉的分」——比任何鼓励都更能驱动学习
 */
import type { AnswerLog, Question, QuestionType, SubjectId } from '@/domain/entities'
import type { KnowledgeRepository, QuestionRepository } from '@/domain/repositories'

export interface SectionSpec {
  type: QuestionType
  label: string
  count: number
  /** 每题分值 */
  score: number
}

/** 题型分段：与真实考试一致（PRD §1.1） */
export function sectionsOf(subjectId: SubjectId): SectionSpec[] {
  return subjectId === 'econ_base'
    ? [
        { type: 'single', label: '一、单项选择题', count: 70, score: 1 },
        { type: 'multi', label: '二、多项选择题', count: 35, score: 2 },
      ]
    : [
        { type: 'single', label: '一、单项选择题', count: 60, score: 1 },
        { type: 'multi', label: '二、多项选择题', count: 20, score: 2 },
        { type: 'case', label: '三、案例分析题', count: 20, score: 2 },
      ]
}

export const PASS_LINE = 84

/* ==================== 组卷 ==================== */

export interface PaperDeps {
  questions: QuestionRepository
  knowledge: KnowledgeRepository
}

/**
 * 按考点权重组卷 —— 让考点分布贴近真实考试
 *
 * 为什么需要：真实考试各章分值占比不同，若只按题型随机抽题，考点分布会失真
 * （可能整卷都压在某一章）。这里按「章」级节点的 weight 分配每段的题目配额，
 * 某章题量不足时用同题型其他题补齐，保证题量达标。
 */
export async function buildBalancedPaper(
  deps: PaperDeps,
  subjectId: SubjectId,
  sections: SectionSpec[],
): Promise<Question[][]> {
  const tree = await deps.knowledge.getTree(subjectId)
  const chapters = tree.filter((n) => n.subjectId === subjectId && n.level === 2)
  const totalWeight = chapters.reduce((s, c) => s + (c.weight || 1), 0)

  const paper: Question[][] = []
  for (const sec of sections) {
    const picked: Question[] = []
    const seen = new Set<string>()

    // ① 按章节权重分配配额
    if (totalWeight > 0) {
      for (const ch of chapters) {
        const quota = Math.round((sec.count * (ch.weight || 1)) / totalWeight)
        if (quota <= 0) continue
        const qs = await deps.questions.query({
          nodeId: ch.id,
          type: sec.type,
          limit: quota,
          shuffle: true,
        })
        qs.forEach((q) => {
          if (!seen.has(q.id)) {
            seen.add(q.id)
            picked.push(q)
          }
        })
      }
    }

    // ② 配额未抽满（章节题量不足）→ 用同题型补齐，保证题量
    if (picked.length < sec.count) {
      const extra = await deps.questions.query({
        subjectId,
        type: sec.type,
        limit: sec.count - picked.length,
        excludeIds: [...seen],
        shuffle: true,
      })
      extra.forEach((q) => {
        if (!seen.has(q.id)) {
          seen.add(q.id)
          picked.push(q)
        }
      })
    }

    paper.push(picked.slice(0, sec.count))
  }
  return paper
}

export interface GradeResult {
  score: number
  passed: boolean
  correctCount: number
  answeredCount: number
  typeScores: Record<QuestionType, { correct: number; total: number; score: number }>
}

/** 单题得分（PRD R1） */
export function scoreOf(q: Question, userAnswer: string[]): number {
  const per = q.type === 'single' ? 1 : 2
  if (!userAnswer.length) return 0

  const right = new Set(q.answer)
  const user = new Set(userAnswer)
  const hasWrong = [...user].some((k) => !right.has(k))
  if (hasWrong) return 0 // 错选整题 0 分

  if (q.type === 'single') return user.size === 1 && right.has(userAnswer[0]) ? 1 : 0

  // 多选/案例：全对满分；少选且无错项每项 0.5
  if (user.size === right.size) return per
  return Math.min(user.size * 0.5, per)
}

/** 批量计分 */
export function gradePaper(
  paper: Question[][],
  sections: SectionSpec[],
  answers: Record<string, string[]>,
): GradeResult {
  let score = 0
  let correctCount = 0
  let answeredCount = 0
  const typeScores: GradeResult['typeScores'] = {
    single: { correct: 0, total: 0, score: 0 },
    multi: { correct: 0, total: 0, score: 0 },
    case: { correct: 0, total: 0, score: 0 },
  }

  paper.forEach((sec, si) => {
    const spec = sections[si]
    const per = spec?.score ?? (sec[0]?.type === 'single' ? 1 : 2)
    sec.forEach((q) => {
      const user = answers[q.id] ?? []
      const got = scoreOf(q, user)
      score += got
      typeScores[q.type].total += 1
      typeScores[q.type].score += got
      if (user.length) answeredCount += 1
      if (got === per) {
        correctCount += 1
        typeScores[q.type].correct += 1
      }
    })
  })

  return {
    score: Math.round(score * 10) / 10,
    passed: score >= PASS_LINE,
    correctCount,
    answeredCount,
    typeScores,
  }
}

/* ==================== 遗憾分分析（PRD M5-F5 ⑤） ==================== */

export interface RegretItem {
  type: 'careless' | 'partial' | 'unanswered' | 'slow'
  label: string
  count: number
  lostScore: number
  desc: string
}

export interface RegretReport {
  total: number
  items: RegretItem[]
}

/**
 * 计算遗憾分
 * @param paper 试卷
 * @param answers 作答
 * @param logs 本次作答流水（含确信度与用时）
 */
export function analyzeRegret(
  paper: Question[][],
  answers: Record<string, string[]>,
  logs: AnswerLog[],
): RegretReport {
  const logByQ = new Map(logs.map((l) => [l.questionId, l]))
  const all = paper.flat()
  const items: RegretItem[] = []

  // ① 粗心失分：自信（sure）却答错
  const careless = all.filter((q) => {
    const l = logByQ.get(q.id)
    const got = scoreOf(q, answers[q.id] ?? [])
    const per = q.type === 'single' ? 1 : 2
    return l?.confidence === 'sure' && got < per
  })
  if (careless.length) {
    items.push({
      type: 'careless',
      label: '粗心丢分',
      count: careless.length,
      lostScore: careless.reduce((s, q) => s + (q.type === 'single' ? 1 : 2), 0),
      desc: '这些题你选了「很确定」却答错了，属于会但没拿住的分',
    })
  }

  // ② 少选损失：多选/案例漏选正确项，每项少拿 0.5 分
  const partial = all.filter((q) => {
    if (q.type === 'single') return false
    const user = new Set(answers[q.id] ?? [])
    if (!user.size) return false
    const right = new Set(q.answer)
    const hasWrong = [...user].some((k) => !right.has(k))
    return !hasWrong && user.size < right.size
  })
  if (partial.length) {
    items.push({
      type: 'partial',
      label: '少选漏分',
      count: partial.length,
      lostScore: partial.reduce((s, q) => s + (q.answer.length - (answers[q.id]?.length ?? 0)) * 0.5, 0),
      desc: '多选/案例少选不给满分，每项仅 0.5 分——宁缺毋滥也要敢选',
    })
  }

  // ③ 未作答损失：按单选 25% 蒙对率保守估算可得期望分
  const unanswered = all.filter((q) => !(answers[q.id] ?? []).length)
  if (unanswered.length) {
    items.push({
      type: 'unanswered',
      label: '未作答',
      count: unanswered.length,
      lostScore: Math.round(unanswered.length * 0.25 * 10) / 10,
      desc: '没做完的题，即便蒙也有期望分——宁可先选一个也别留空',
    })
  }

  // ④ 超时失分：单题用时超过均值 2 倍（基础 51s / 实务 54s）
  const avgSec = all.length ? 52 : 0
  const slow = all.filter((q) => (logByQ.get(q.id)?.durationMs ?? 0) > avgSec * 2 * 1000)
  if (slow.length >= 3) {
    items.push({
      type: 'slow',
      label: '耗时过长',
      count: slow.length,
      lostScore: 0,
      desc: `${slow.length} 道题耗时超过平均题速 2 倍，挤占了后面的答题时间`,
    })
  }

  return {
    total: Math.round(items.reduce((s, i) => s + i.lostScore, 0) * 10) / 10,
    items,
  }
}
