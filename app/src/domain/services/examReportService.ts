/**
 * 模考复盘报告服务（PRD M5-F5 六维度）
 *
 *   ① 总分与过线判断（含过线概率）
 *   ② 题型得分分析
 *   ③ 模块得分分析（标出拖后腿模块）
 *   ④ 时间分配分析（平均单题用时 + 最慢 5 题）
 *   ⑤ 遗憾分分析（复用 examService.analyzeRegret）
 *   ⑥ 下一步建议（规则生成，无需 API Key 也能用）
 *
 * 「遗憾分」是全模块最有说服力的部分：考了 78 分的人，最想知道的是
 * 「其中有 11 分本来能拿到」。
 */
import type { AnswerLog, KnowledgeNode, Question, QuestionType, SubjectId } from '@/domain/entities'
import type { KnowledgeRepository } from '@/domain/repositories'
import { PASS_LINE, analyzeRegret, type GradeResult, type RegretReport } from './examService'

const CN_TYPE: Record<QuestionType, string> = {
  single: '单项选择题',
  multi: '多项选择题',
  case: '案例分析题',
}

/** 各题型的目标得分率（PRD §6.5 推荐配置：单选 85% / 多选 58%） */
const TYPE_TARGET: Record<QuestionType, number> = {
  single: 0.85,
  multi: 0.58,
  case: 0.6,
}

/** 建议单题用时（秒）：基础 51 / 实务 54（PRD M5-F5 ④ 的口径） */
const suggestedSecOf = (subjectId: SubjectId) => (subjectId === 'econ_base' ? 51 : 54)

export interface TypeStat {
  type: QuestionType
  label: string
  correct: number
  total: number
  /** 得分率 0-1 */
  rate: number
  score: number
  /** 目标得分率 */
  target: number
  /** 距目标还差多少分 */
  gap: number
}

export interface ModuleStat {
  nodeId: string
  name: string
  correct: number
  total: number
  rate: number
  /** 该模块丢掉的分数 */
  lost: number
}

export interface TimeStat {
  /** 平均单题用时（秒） */
  avgSec: number
  suggestedSec: number
  /** 耗时最长的 5 题 */
  slowest: Array<{ stem: string; sec: number }>
}

export interface Advice {
  title: string
  desc: string
  /** 可跳转的章节（用于一键去练） */
  nodeId?: string
}

export interface ExamReport {
  total: {
    score: number
    passLine: number
    diff: number
    passed: boolean
    /** 过线概率 0-1 */
    probability: number
  }
  byType: TypeStat[]
  byModule: ModuleStat[]
  time: TimeStat
  regret: RegretReport
  advice: Advice[]
}

/**
 * 过线概率估算
 *
 * 用本次得分相对合格线的位置做正态近似（logistic 形式逼近正态 CDF），
 * 取标准差 8 分 —— 模考与真题难度有波动，不宜给出过于自信的数字。
 */
export function estimatePassProbability(score: number): number {
  const SD = 8
  const z = (score - PASS_LINE) / SD
  const p = 1 / (1 + Math.exp(-1.7 * z))
  return Math.round(p * 100) / 100
}

/** 向上找到某节点所属的「章」（level 2） */
function chapterOf(nodeIds: string[], byId: Map<string, KnowledgeNode>): KnowledgeNode | null {
  for (const id of nodeIds) {
    let n: KnowledgeNode | undefined = byId.get(id)
    while (n) {
      if (n.level === 2) return n
      n = n.parentId ? byId.get(n.parentId) : undefined
    }
  }
  return null
}

/** 基于报告的弱项生成建议（规则版：无 API Key 也能给出可执行动作） */
function buildAdvice(
  byModule: ModuleStat[],
  byType: TypeStat[],
  time: TimeStat,
  regret: RegretReport,
): Advice[] {
  const out: Advice[] = []

  // 优先补最薄弱的模块（题量足够才有统计意义）
  byModule
    .filter((m) => m.total >= 3)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 3)
    .forEach((m) => {
      if (m.rate >= 0.75) return
      out.push({
        title: `补「${m.name}」`,
        desc: `得分率 ${Math.round(m.rate * 100)}%，丢了约 ${m.lost} 分。建议先做这个模块的专项训练。`,
        nodeId: m.nodeId,
      })
    })

  // 多选题策略（少选是 84 分线上最大的捡分口子）
  const partial = regret.items.find((i) => i.type === 'partial')
  if (partial && partial.count >= 3) {
    out.push({
      title: '多选策略：宁可少选，不要错选',
      desc: `本次有 ${partial.count} 道题少选，丢了 ${partial.lostScore} 分。没把握的选项不选——错选整题 0 分，少选还能拿一半。`,
    })
  }

  // 粗心失分
  const careless = regret.items.find((i) => i.type === 'careless')
  if (careless && careless.count >= 2) {
    out.push({
      title: '审题要放慢',
      desc: `${careless.count} 道题你自评「很确定」却答错了，共 ${careless.lostScore} 分。注意题干里的「错误的是」「不属于」这类限定词。`,
    })
  }

  // 时间
  if (time.avgSec > time.suggestedSec * 1.3) {
    out.push({
      title: '答题速度偏慢',
      desc: `平均每题 ${time.avgSec} 秒，建议控制在 ${time.suggestedSec} 秒内。平时练习就按这个节奏掐表。`,
    })
  }

  // 题型短板
  const worstType = byType.filter((t) => t.total >= 5).sort((a, b) => a.rate - b.rate)[0]
  if (worstType && worstType.gap > 5) {
    out.push({
      title: `${worstType.label}还差 ${worstType.gap} 分到目标`,
      desc: `得分率 ${Math.round(worstType.rate * 100)}%，目标是 ${Math.round(worstType.target * 100)}%。`,
    })
  }

  return out.slice(0, 4)
}

/**
 * 生成完整复盘报告
 *
 * @param paper   试卷（分段）
 * @param answers 作答
 * @param logs    本次答题流水（含每题用时）
 * @param graded  计分结果
 */
export async function buildExamReport(
  deps: { knowledge: KnowledgeRepository },
  paper: Question[][],
  answers: Record<string, string[]>,
  logs: AnswerLog[],
  subjectId: SubjectId,
  graded: GradeResult,
): Promise<ExamReport> {
  const all = paper.flat()
  const logByQ = new Map(logs.map((l) => [l.questionId, l]))

  // ---------- ① 总分与过线 ----------
  const diff = Math.round((graded.score - PASS_LINE) * 10) / 10
  const total = {
    score: graded.score,
    passLine: PASS_LINE,
    diff,
    passed: graded.passed,
    probability: estimatePassProbability(graded.score),
  }

  // ---------- ② 题型得分 ----------
  const byType: TypeStat[] = (['single', 'multi', 'case'] as QuestionType[])
    .map((type) => {
      const s = graded.typeScores[type]
      if (!s || s.total === 0) return null
      const full = type === 'single' ? 1 : 2
      const rate = s.total > 0 ? s.score / (s.total * full) : 0
      const target = TYPE_TARGET[type]
      return {
        type,
        label: CN_TYPE[type],
        correct: s.correct,
        total: s.total,
        rate: Math.round(rate * 100) / 100,
        score: Math.round(s.score * 10) / 10,
        target,
        gap: Math.round((s.total * full * target - s.score) * 10) / 10,
      }
    })
    .filter((x): x is TypeStat => !!x)

  // ---------- ③ 模块得分（聚合到章） ----------
  const tree = await deps.knowledge.getTree(subjectId)
  const nodeById = new Map(tree.map((n) => [n.id, n]))
  const moduleMap = new Map<string, ModuleStat>()

  all.forEach((q) => {
    const ch = chapterOf(q.knowledgeNodeIds ?? [], nodeById)
    const key = ch?.id ?? '__unknown'
    const name = ch?.name ?? '未归类'
    if (!moduleMap.has(key)) {
      moduleMap.set(key, { nodeId: key, name, correct: 0, total: 0, rate: 0, lost: 0 })
    }
    const m = moduleMap.get(key)!
    const full = q.type === 'single' ? 1 : 2
    const user = answers[q.id] ?? []
    const right = new Set(q.answer)
    const hasWrong = user.some((k) => !right.has(k))
    const got = !user.length
      ? 0
      : hasWrong
        ? 0
        : user.length === right.size
          ? full
          : Math.min(user.length * 0.5, full)

    m.total += 1
    m.lost += full - got
    if (got === full) m.correct += 1
  })

  const byModule = [...moduleMap.values()]
    .map((m) => ({ ...m, rate: m.total ? Math.round((m.correct / m.total) * 100) / 100 : 0, lost: Math.round(m.lost * 10) / 10 }))
    .sort((a, b) => a.rate - b.rate)

  // ---------- ④ 时间分配 ----------
  const suggestedSec = suggestedSecOf(subjectId)
  const timed = all
    .map((q) => ({ stem: q.stem, ms: logByQ.get(q.id)?.durationMs ?? 0 }))
    .filter((x) => x.ms > 0)
  const avgSec = timed.length ? Math.round(timed.reduce((s, x) => s + x.ms, 0) / timed.length / 1000) : 0
  const time: TimeStat = {
    avgSec,
    suggestedSec,
    slowest: [...timed]
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5)
      .map((x) => ({ stem: x.stem.slice(0, 26), sec: Math.round(x.ms / 1000) })),
  }

  // ---------- ⑤ 遗憾分 ----------
  const regret = analyzeRegret(paper, answers, logs)

  // ---------- ⑥ 建议 ----------
  const advice = buildAdvice(byModule, byType, time, regret)

  return { total, byType, byModule, time, regret, advice }
}
