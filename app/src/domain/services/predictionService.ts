/**
 * 过线概率预测服务（业务层，纯本地计算，PRD §8.8 要求离线可用）
 *
 * 输入：模考成绩序列 + 加权掌握度 + 剩余天数
 * 输出：过线概率 / 预测分数区间 / 提升杠杆
 *
 * ⚠️ 必须附免责声明：预测基于模型估算，不构成对考试结果的承诺（PRD M8-F2）
 */
import type { ExamRecord, SubjectId } from '@/domain/entities'
import type { ExamRepository, KnowledgeRepository, MasteryRepository } from '@/domain/repositories'
import { PASS_LINE } from './examService'

/** 考场折损系数：平时掌握度 → 真实得分的折扣（紧张、时间压力、机考陌生） */
const EXAM_DISCOUNT = 0.85

export interface PredictionResult {
  /** 过线概率 0-1 */
  probability: number
  /** 预测分数区间 */
  range: [number, number]
  /** 点估计 */
  expected: number
  /** 剩余天数 */
  daysToExam: number
  /** 提升杠杆：优先补哪个模块 */
  levers: Array<{ moduleId: string; name: string; weight: number; mastery: number; gainPerTen: number }>
  disclaimer: string
}

export interface PredictionDeps {
  exams: ExamRepository
  mastery: MasteryRepository
  knowledge: KnowledgeRepository
}

/** 标准正态分布 CDF（Abramowitz-Stegun 近似） */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - p : p
}

export class PredictionService {
  constructor(private readonly deps: PredictionDeps) {}

  async predict(subjectId: SubjectId, examDate: string): Promise<PredictionResult> {
    const daysToExam = Math.max(0, Math.ceil((new Date(examDate).getTime() - Date.now()) / 86400000))

    // ① 掌握度预测分
    const mastery = await this.weightedMastery(subjectId)
    const byMastery = (mastery / 100) * 140 * EXAM_DISCOUNT

    // ② 模考预测分（近期权重更高）
    const records = (await this.deps.exams.list(10)).filter((r) => r.subjectId === subjectId)
    const byExam = this.weightedExamScore(records)

    // ③ 融合：有模考数据时以模考为主（更贴近真实），否则靠掌握度推算
    const expected =
      records.length === 0
        ? byMastery
        : records.length === 1
          ? byMastery * 0.5 + byExam * 0.5
          : byMastery * 0.35 + byExam * 0.65

    // ④ 标准差：有模考样本用样本标准差，否则随剩余天数收敛
    const sigma = this.estimateSigma(records, daysToExam)

    const probability = normalCdf((expected - PASS_LINE) / sigma)
    const range: [number, number] = [
      Math.max(0, Math.round(expected - 1.28 * sigma)),
      Math.min(140, Math.round(expected + 1.28 * sigma)),
    ]

    return {
      probability: Math.max(0, Math.min(1, probability)),
      range,
      expected: Math.round(expected),
      daysToExam,
      levers: await this.computeLevers(subjectId),
      disclaimer: '预测基于你的练习与模考数据建模估算，不构成对考试结果的承诺',
    }
  }

  private weightedExamScore(records: ExamRecord[]): number {
    if (!records.length) return 0
    let sum = 0
    let w = 0
    records.forEach((r, i) => {
      const weight = Math.pow(0.7, i) // 越近权重越高
      sum += r.score * weight
      w += weight
    })
    return w ? sum / w : 0
  }

  private estimateSigma(records: ExamRecord[], daysToExam: number): number {
    if (records.length >= 2) {
      const scores = records.map((r) => r.score)
      const mean = scores.reduce((s, x) => s + x, 0) / scores.length
      const variance = scores.reduce((s, x) => s + (x - mean) ** 2, 0) / (scores.length - 1)
      return Math.max(4, Math.sqrt(variance))
    }
    // 无模考样本：剩余天数越少，不确定性越低
    return Math.max(6, 18 - daysToExam * 0.12)
  }

  private async weightedMastery(subjectId: SubjectId): Promise<number> {
    const tree = await this.deps.knowledge.getTree(subjectId)
    const list = await this.deps.mastery.listBySubject(subjectId)
    if (!list.length) return 0
    const modules = tree.filter((n) => n.level === 1)
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

  /**
   * 提升杠杆：分值权重高且掌握度低的模块，提分性价比最高
   * gainPerTen = 该模块掌握度每提升 10% 带来的总分提升
   */
  private async computeLevers(subjectId: SubjectId) {
    const tree = await this.deps.knowledge.getTree(subjectId)
    const list = await this.deps.mastery.listBySubject(subjectId)
    const modules = tree.filter((n) => n.level === 1)

    return modules
      .map((mod) => {
        const chapterIds = tree.filter((n) => n.parentId === mod.id).map((n) => n.id)
        const scores = list.filter((m) => chapterIds.includes(m.nodeId))
        const mastery = scores.length
          ? scores.reduce((s, m) => s + m.masteryScore, 0) / scores.length
          : 0
        // 该模块占 140 分的权重比 × 提升 10% 的得分
        const weightRatio = (mod.weight || 0) / 140
        const gainPerTen = Math.round(weightRatio * 140 * 0.1 * EXAM_DISCOUNT * 10) / 10
        return { moduleId: mod.id, name: mod.name, weight: mod.weight, mastery: Math.round(mastery), gainPerTen }
      })
      .filter((l) => l.mastery < 85)
      .sort((a, b) => b.gainPerTen / Math.max(1, b.mastery) - a.gainPerTen / Math.max(1, a.mastery))
      .slice(0, 3)
  }
}
