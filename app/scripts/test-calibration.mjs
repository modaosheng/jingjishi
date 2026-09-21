/**
 * 元认知校准验证（Node 直接运行）
 * 运行：node scripts/test-calibration.mjs
 * ⚠️ 本脚本是 metacognitionService 的 JS 副本，改动后需同步。
 */

const NOMINAL = { sure: 0.9, unsure: 0.55, noidea: 0.25 }
const LABEL = { sure: '很确定', unsure: '有点懵', noidea: '没思路' }
const DEVIATION_TARGET = 0.15
const MIN_SAMPLE = 5

function buildInsight(buckets, deviation, overconfidentWrong) {
  const sure = buckets.find((b) => b.confidence === 'sure')
  const noidea = buckets.find((b) => b.confidence === 'noidea')

  if (sure && sure.bias <= -0.15) {
    return `过度自信：${Math.round(sure.actual * 100)}%，${overconfidentWrong} 道自信却答错`
  }
  if (sure && sure.actual >= 0.9 && deviation < DEVIATION_TARGET) {
    return '判断很准'
  }
  if (noidea && noidea.actual >= 0.45) {
    return '别把运气当实力'
  }
  return `校准偏差 ${Math.round(deviation * 100)}%`
}

function analyzeCalibration(raw) {
  const byConf = new Map(raw.map((r) => [r.confidence, r]))
  const buckets = ['sure', 'unsure', 'noidea']
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
    .filter(Boolean)

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
  const sure = buckets.find((b) => b.confidence === 'sure')
  const overconfidentWrong = sure ? sure.count - sure.correct : 0

  return {
    buckets,
    deviation,
    ok: deviation < DEVIATION_TARGET,
    total: totalN,
    insight: buildInsight(buckets, deviation, overconfidentWrong),
    overconfidentWrong,
  }
}

/* ---------- 断言 ---------- */
let failed = 0
const check = (name, actual, expect) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expect)
  if (!ok) failed++
  console.log(`${ok ? '✅' : '❌'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (期望 ${JSON.stringify(expect)})`}`)
}

/* ① 过度自信场景：说「很确定」却只对 60% */
const r1 = analyzeCalibration([
  { confidence: 'sure', total: 20, correct: 12 },
  { confidence: 'unsure', total: 10, correct: 5 },
  { confidence: 'noidea', total: 10, correct: 3 },
])
check('① 三档都纳入统计', r1.buckets.length, 3)
check('① 很确定档实际正确率', r1.buckets[0].actual, 0.6)
check('① 很确定档偏差（负=过度自信）', r1.buckets[0].bias, -0.3)
check('① 自信却答错题数', r1.overconfidentWrong, 8)
check('① 总体偏差（加权）', r1.deviation, 0.18)
check('① 超标（>15%）', r1.ok, false)
check('① 结论指向过度自信', r1.insight.includes('过度自信'), true)

/* ② 判断精准场景 */
const r2 = analyzeCalibration([
  { confidence: 'sure', total: 20, correct: 19 },
  { confidence: 'unsure', total: 10, correct: 5 },
  { confidence: 'noidea', total: 10, correct: 2 },
])
// 偏差 = (0.05*20 + 0.05*10 + 0.05*10)/40 = 0.05
check('② 偏差很小', r2.deviation, 0.05)
check('② 达标（<15%）', r2.ok, true)
check('② 给出正反馈', r2.insight.includes('判断很准'), true)

/* ③ 蒙对率高 → 提醒 */
const r3 = analyzeCalibration([
  { confidence: 'unsure', total: 10, correct: 5 },
  { confidence: 'noidea', total: 10, correct: 6 },
])
check('③ 没思路档蒙对率', r3.buckets.find((b) => b.confidence === 'noidea').actual, 0.6)
check('③ 提醒别依赖运气', r3.insight.includes('运气'), true)

/* ④ 样本不足的档被剔除 */
const r4 = analyzeCalibration([
  { confidence: 'sure', total: 20, correct: 18 },
  { confidence: 'noidea', total: 3, correct: 1 },
])
check('④ 只保留样本够的档', r4.buckets.length, 1)
check('④ 保留的是很确定档', r4.buckets[0].confidence, 'sure')

/* ⑤ 完全没数据 */
const r5 = analyzeCalibration([])
check('⑤ 空数据不报错', r5.buckets.length, 0)
check('⑤ 空数据偏差为 0', r5.deviation, 0)
check('⑤ 空数据给出引导文案', r5.insight.includes('攒够数据'), true)

/* ⑥ 总量统计口径 */
const r6 = analyzeCalibration([{ confidence: 'sure', total: 20, correct: 18 }])
check('⑥ total 只计纳入统计的样本', r6.total, 20)

console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项未通过`}`)
process.exit(failed === 0 ? 0 : 1)
