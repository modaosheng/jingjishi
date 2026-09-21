/**
 * 模考复盘报告验证（Node 直接运行）
 * 运行：node scripts/test-report.mjs
 * ⚠️ 本脚本是 examReportService 的 JS 副本，改动后需同步。
 */

const PASS_LINE = 84

/** 过线概率：logistic 近似正态 CDF，标准差 8 分 */
function estimatePassProbability(score) {
  const SD = 8
  const z = (score - PASS_LINE) / SD
  const p = 1 / (1 + Math.exp(-1.7 * z))
  return Math.round(p * 100) / 100
}

/** 向上找到所属「章」（level 2） */
function chapterOf(nodeIds, byId) {
  for (const id of nodeIds) {
    let n = byId.get(id)
    while (n) {
      if (n.level === 2) return n
      n = n.parentId ? byId.get(n.parentId) : undefined
    }
  }
  return null
}

/** 单题得分（与 examService.scoreOf 保持一致） */
function scoreOf(q, user) {
  const full = q.type === 'single' ? 1 : 2
  if (!user.length) return 0
  const right = new Set(q.answer)
  if (user.some((k) => !right.has(k))) return 0
  if (q.type === 'single') return user.length === 1 && right.has(user[0]) ? 1 : 0
  if (user.length === right.size) return full
  return Math.min(user.length * 0.5, full)
}

/** 模块聚合 */
function aggregateModules(all, answers, tree) {
  const byId = new Map(tree.map((n) => [n.id, n]))
  const map = new Map()
  all.forEach((q) => {
    const ch = chapterOf(q.knowledgeNodeIds ?? [], byId)
    const key = ch?.id ?? '__unknown'
    const name = ch?.name ?? '未归类'
    if (!map.has(key)) map.set(key, { nodeId: key, name, correct: 0, total: 0, rate: 0, lost: 0 })
    const m = map.get(key)
    const full = q.type === 'single' ? 1 : 2
    const got = scoreOf(q, answers[q.id] ?? [])
    m.total += 1
    m.lost += full - got
    if (got === full) m.correct += 1
  })
  return [...map.values()]
    .map((m) => ({
      ...m,
      rate: m.total ? Math.round((m.correct / m.total) * 100) / 100 : 0,
      lost: Math.round(m.lost * 10) / 10,
    }))
    .sort((a, b) => a.rate - b.rate)
}

/* ---------- 断言 ---------- */
let failed = 0
const check = (name, actual, expect) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expect)
  if (!ok) failed++
  console.log(`${ok ? '✅' : '❌'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (期望 ${JSON.stringify(expect)})`}`)
}

/* ① 过线概率 */
check('① 恰好合格线（84 分）→ 50%', estimatePassProbability(84), 0.5)
check('① 100 分 → 高概率', estimatePassProbability(100) > 0.95, true)
check('① 60 分 → 低概率', estimatePassProbability(60) < 0.05, true)
check('① 68 分 → 低于 15%', estimatePassProbability(68) < 0.15, true)
check('① 单调递增', estimatePassProbability(95) > estimatePassProbability(85), true)

/* ② 模块聚合（按章归类 + 薄弱排前） */
const tree = [
  { id: 'ch1', parentId: null, level: 1, name: '第一部分' },
  { id: 'ch2', parentId: 'ch1', level: 2, name: '经济学基础' },
  { id: 'k1', parentId: 'ch2', level: 3, name: '需求理论' },
  { id: 'ch3', parentId: 'ch1', level: 2, name: '财政' },
]
const all = [
  { id: 'q1', knowledgeNodeIds: ['k1'], type: 'single', answer: ['A'] },
  { id: 'q2', knowledgeNodeIds: ['ch3'], type: 'single', answer: ['B'] },
  { id: 'q3', knowledgeNodeIds: ['ch3'], type: 'single', answer: ['C'] },
  { id: 'q4', knowledgeNodeIds: [], type: 'single', answer: ['D'] },
]
const answers = { q1: ['A'], q2: ['A'], q3: ['A'], q4: ['D'] } // q2/q3 均答错
const mods = aggregateModules(all, answers, tree)

check('② 模块数（含未归类）', mods.length, 3)
check('② 薄弱模块排最前', mods[0].name, '财政')
check('② 财政得分率', mods[0].rate, 0)
check('② 财政丢分', mods[0].lost, 2)
check('② 知识点归到所属章', mods.find((m) => m.name === '经济学基础')?.rate, 1)
check('② 无知识点归入未归类', mods.find((m) => m.name === '未归类')?.total, 1)

/* ③ 多选少选计分（影响 lost 计算） */
const multiAll = [{ id: 'm1', knowledgeNodeIds: ['ch3'], type: 'multi', answer: ['A', 'B'] }]
const multiGot = aggregateModules(multiAll, { m1: ['A'] }, tree)
check('③ 多选少选：得 0.5 分', multiGot[0].lost, 1.5)
check('③ 多选少选：不算正确', multiGot[0].correct, 0)

const multiWrong = aggregateModules(multiAll, { m1: ['A', 'C'] }, tree)
check('③ 多选错选：整题 0 分', multiWrong[0].lost, 2)

const multiFull = aggregateModules(multiAll, { m1: ['A', 'B'] }, tree)
check('③ 多选全对：不丢分', multiFull[0].lost, 0)
check('③ 多选全对：正确数 1', multiFull[0].correct, 1)

console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项未通过`}`)
process.exit(failed === 0 ? 0 : 1)
