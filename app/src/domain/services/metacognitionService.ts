/**
 * 元认知校准服务（PRD M8-F1 第 3 点）
 *
 * 回答一个问题：你「以为自己会不会」的判断，准不准？
 *
 *   横轴 = 确信度（很确定 / 有点懵 / 完全没思路）
 *   纵轴 = 实际正确率
 *
 * 为什么值得单独看：「很确定」却答错的题是最危险的失分——
 * 因为你不会去复习它（你压根没意识到自己不会）。
 * 反过来，「很不确定」却答对，说明知识点其实是模糊的，靠的是运气。
 */
import type { Confidence } from '@/domain/entities'

/** 各档确信度对应的「隐含把握率」（用户自评时心里的预期） */
const NOMINAL: Record<Confidence, number> = {
  sure: 0.9, // 「很确定」≈ 心里觉得九成会对
  unsure: 0.55, // 「有点懵」≈ 一半一半
  noidea: 0.25, // 「完全没思路」≈ 四选一随机
}

const LABEL: Record<Confidence, string> = {
  sure: '很确定',
  unsure: '有点懵',
  noidea: '没思路',
}

/** PRD §13.2：元认知校准偏差目标 < 15% */
export const DEVIATION_TARGET = 0.15

/** 每档至少这么多题才纳入统计（避免小样本结论失真） */
const MIN_SAMPLE = 5

export interface CalibrationBucket {
  confidence: Confidence
  label: string
  count: number
  correct: number
  /** 实际正确率 */
  actual: number
  /** 隐含把握率 */
  nominal: number
  /** 偏差 = 实际 − 隐含；负值表示过度自信 */
  bias: number
}

export interface CalibrationReport {
  buckets: CalibrationBucket[]
  /** 总体校准偏差（按题量加权平均 |实际 − 隐含|），目标 < 0.15 */
  deviation: number
  ok: boolean
  total: number
  insight: string
  /** 「很确定却答错」的题数 —— 最值得警惕的数字 */
  overconfidentWrong: number
}

/** 生成一句话结论（按优先级取最该说的那条） */
function buildInsight(
  buckets: CalibrationBucket[],
  deviation: number,
  overconfidentWrong: number,
): string {
  const sure = buckets.find((b) => b.confidence === 'sure')
  const noidea = buckets.find((b) => b.confidence === 'noidea')

  // ① 过度自信：最危险，优先说
  if (sure && sure.bias <= -0.15) {
    return `你在「很确定」的题上实际只对了 ${Math.round(sure.actual * 100)}%（自我预期约 90%），有 ${overconfidentWrong} 道自信却答错。这类题最容易被忽略——因为你不会想到去复习它们。`
  }

  // ② 判断精准：给正反馈
  if (sure && sure.actual >= 0.9 && deviation < DEVIATION_TARGET) {
    return `你的自我判断很准：说「很确定」时正确率 ${Math.round(sure.actual * 100)}%，校准偏差仅 ${Math.round(deviation * 100)}%。你清楚自己会什么、不会什么，这是很高效的学习状态。`
  }

  // ③ 蒙对率高：提醒别依赖运气
  if (noidea && noidea.actual >= 0.45) {
    return `「完全没思路」的题你有 ${Math.round(noidea.actual * 100)}% 答对了，别把运气当实力——建议回看这些题涉及的考点。`
  }

  return `校准偏差 ${Math.round(deviation * 100)}%${
    deviation < DEVIATION_TARGET ? '，在健康范围内。' : '，建议多留意「自信却答错」的题。'
  }`
}

/**
 * 分析元认知校准
 * @param raw 仓储层的按确信度聚合结果（已排除无自评的记录）
 */
export function analyzeCalibration(
  raw: Array<{ confidence: string; total: number; correct: number }>,
): CalibrationReport {
  const byConf = new Map(raw.map((r) => [r.confidence, r]))

  const buckets: CalibrationBucket[] = (['sure', 'unsure', 'noidea'] as Confidence[])
    .map((c) => {
      const r = byConf.get(c)
      if (!r || r.total < MIN_SAMPLE) return null
      const actual = r.correct / r.total
      const nominal = NOMINAL[c]
      return {
        confidence: c,
        label: LABEL[c],
        count: r.total,
        correct: r.correct,
        actual: Math.round(actual * 100) / 100,
        nominal,
        bias: Math.round((actual - nominal) * 100) / 100,
      }
    })
    .filter((x): x is CalibrationBucket => !!x)

  const sampleTotal = raw.reduce((s, r) => s + r.total, 0)

  if (!buckets.length) {
    return {
      buckets: [],
      deviation: 0,
      ok: true,
      total: sampleTotal,
      insight: '练习时选一下「你有多大把握」，攒够数据（每档至少 5 题）就能看出你的自我判断准不准。',
      overconfidentWrong: 0,
    }
  }

  const totalN = buckets.reduce((s, b) => s + b.count, 0)
  const deviation =
    Math.round((buckets.reduce((s, b) => s + Math.abs(b.bias) * b.count, 0) / totalN) * 100) / 100

  const sureBucket = buckets.find((b) => b.confidence === 'sure')
  const overconfidentWrong = sureBucket ? sureBucket.count - sureBucket.correct : 0

  return {
    buckets,
    deviation,
    ok: deviation < DEVIATION_TARGET,
    total: totalN,
    insight: buildInsight(buckets, deviation, overconfidentWrong),
    overconfidentWrong,
  }
}
