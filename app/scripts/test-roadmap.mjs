/**
 * 计划引擎验证（Node 直接运行）
 * 运行：node scripts/test-roadmap.mjs
 * ⚠️ 本脚本是 planEngineService 的 JS 副本，改动后需同步。
 */

const DAY_MS = 86400000
const EXAM_DATE = '2026-11-07'
const EXAM_TS = new Date(`${EXAM_DATE}T00:00:00`).getTime()

const STAGE_META = {
  P0: { name: '诊断期' },
  P1: { name: '基础构建' },
  P2: { name: '强化突破' },
  P3: { name: '冲刺模考' },
  P4: { name: '考前稳定' },
}

function pickTemplate(daysLeft) {
  if (daysLeft >= 150) return 'full'
  if (daysLeft >= 90) return 'standard'
  if (daysLeft >= 45) return 'sprint'
  return 'extreme'
}

function scaleStages(totalDays) {
  const FIXED = 3 + 8
  const BASE_FLEX = 74 + 55 + 40
  const flexible = Math.max(totalDays - FIXED, 3)
  const k = flexible / BASE_FLEX
  const stages = [
    { id: 'P0', days: 3 },
    { id: 'P1', days: Math.max(1, Math.round(74 * k)) },
    { id: 'P2', days: Math.max(1, Math.round(55 * k)) },
    { id: 'P3', days: Math.max(1, Math.round(40 * k)) },
    { id: 'P4', days: 8 },
  ]
  const sum = stages.reduce((s, x) => s + x.days, 0)
  stages[1].days = Math.max(1, stages[1].days + (totalDays - sum))
  return stages
}

const fmtDate = (ts) => {
  const d = new Date(ts)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function buildRoadmap(today, startDate) {
  const todayTs = today.getTime()
  const startTs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : todayTs

  const daysLeft = Math.max(Math.ceil((EXAM_TS - todayTs) / DAY_MS), 0)
  const totalDays = Math.max(Math.ceil((EXAM_TS - startTs) / DAY_MS), 16)
  const elapsedDays = Math.min(Math.max(Math.floor((todayTs - startTs) / DAY_MS), 0), totalDays)

  const template = pickTemplate(daysLeft)
  const scaled = scaleStages(totalDays)

  let cursor = EXAM_TS
  const stages = []
  for (let i = scaled.length - 1; i >= 0; i--) {
    const s = scaled[i]
    const startTs2 = cursor - s.days * DAY_MS
    stages.unshift({
      id: s.id,
      ...STAGE_META[s.id],
      days: s.days,
      startDate: fmtDate(startTs2),
      endDate: fmtDate(cursor - DAY_MS),
      status: 'future',
    })
    cursor = startTs2
  }

  stages.forEach((s) => {
    const start = new Date(`${s.startDate}T00:00:00`).getTime()
    const end = new Date(`${s.endDate}T23:59:59`).getTime()
    s.status = todayTs > end ? 'past' : todayTs < start ? 'future' : 'current'
  })

  const currentStageId = stages.find((s) => s.status === 'current')?.id ?? stages[0].id
  return { daysLeft, template, totalDays, elapsedDays, currentStageId, stages }
}

function evaluateAdjustment(s) {
  if (s.daysLeft < 15) return { action: 'stabilize' }
  if (s.daysSinceLogin >= 7) return { action: 'welcome_back' }
  if (s.missStreak >= 3) return { action: 'downgrade', capacityFactor: 0.8 }
  const scores = s.examScores.slice(0, 2)
  if (scores.length === 2 && scores[0] < scores[1]) return { action: 'reforge' }
  if (s.overStreak >= 7) return { action: 'upgrade', capacityFactor: 1.2 }
  return null
}

function decideChapterAction(accuracy, confidence) {
  if (accuracy < 0.6) return { action: 'block' }
  if (accuracy >= 0.9 && confidence === 'sure') return { action: 'skip' }
  return { action: 'proceed' }
}

/** 构造「距今 daysAgo 天」的日期 */
const daysAgo = (n) => new Date(EXAM_TS - n * DAY_MS)

/* ---------- 断言 ---------- */
let failed = 0
const check = (name, actual, expect) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expect)
  if (!ok) failed++
  console.log(`${ok ? '✅' : '❌'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (期望 ${JSON.stringify(expect)})`}`)
}

// ① 分档策略（PRD §6.2 边界）
check('① T=180 → 完整版', pickTemplate(180), 'full')
check('① T=150 → 完整版（边界）', pickTemplate(150), 'full')
check('① T=149 → 标准版', pickTemplate(149), 'standard')
check('① T=90 → 标准版（边界）', pickTemplate(90), 'standard')
check('① T=89 → 冲刺版', pickTemplate(89), 'sprint')
check('① T=45 → 冲刺版（边界）', pickTemplate(45), 'sprint')
check('① T=44 → 极限版', pickTemplate(44), 'extreme')

// ② 基准 180 天：阶段天数须与 PRD §6.2 完全一致
const base = scaleStages(180)
check('② 180 天各阶段天数', base.map((s) => s.days), [3, 74, 55, 40, 8])
check('② 180 天合计', base.reduce((s, x) => s + x.days, 0), 180)

// ③ 缩放后总和必须精确等于总天数（误差修正）
;[365, 200, 180, 120, 90, 60, 30].forEach((t) => {
  const sum = scaleStages(t).reduce((s, x) => s + x.days, 0)
  const ok = sum === t
  if (!ok) failed++
  console.log(`${ok ? '✅' : '❌'} ③ T=${t} 阶段合计 = ${sum}（须精确等于 T）`)
})

// ④ 日期结构：首尾相接，末阶段结束于考试前一天
const rm180 = buildRoadmap(daysAgo(180), fmtDate(EXAM_TS - 180 * DAY_MS))
check('④ 阶段数', rm180.stages.length, 5)
check('④ 末阶段结束于考试前一天', rm180.stages[4].endDate, '2026-11-06')
check('④ P4 固定 8 天', rm180.stages[4].days, 8)
const chained = rm180.stages.every((s, i) => {
  if (i === 0) return true
  const prevEnd = new Date(`${rm180.stages[i - 1].endDate}T00:00:00`).getTime()
  return new Date(`${s.startDate}T00:00:00`).getTime() - prevEnd === DAY_MS
})
check('④ 各阶段首尾相接无缝隙', chained, true)

// ⑤ 计划推进：今天才开始 → P0；已进行 100 天 → P2
const fresh = buildRoadmap(daysAgo(180)) // 未传 startDate → 今天开始
check('⑤ 今天才开始 → 第 1 天在 P0', [fresh.currentStageId, fresh.elapsedDays], ['P0', 0])

const day100 = buildRoadmap(daysAgo(80), fmtDate(EXAM_TS - 180 * DAY_MS))
check('⑤ 已进行 100 天 → P2', day100.currentStageId, 'P2')
check('⑤ 已进行 100 天：天数统计', [day100.totalDays, day100.elapsedDays, day100.daysLeft], [180, 100, 80])

const day6 = buildRoadmap(daysAgo(174), fmtDate(EXAM_TS - 180 * DAY_MS))
check('⑤ 已进行 6 天 → P1（P0 占前 3 天）', day6.currentStageId, 'P1')

const day166 = buildRoadmap(daysAgo(14), fmtDate(EXAM_TS - 180 * DAY_MS))
check('⑤ 已进行 166 天 → P3', day166.currentStageId, 'P3')

const day178 = buildRoadmap(daysAgo(2), fmtDate(EXAM_TS - 180 * DAY_MS))
check('⑤ 已进行 178 天 → P4', day178.currentStageId, 'P4')

// ⑥ 时间线回溯一致性：早期阶段全部 past
check('⑥ 已进行 100 天时 P0/P1 已完成', day100.stages.slice(0, 2).map((s) => s.status), ['past', 'past'])
check('⑥ 已进行 100 天时 P3/P4 未开始', day100.stages.slice(3).map((s) => s.status), ['future', 'future'])

// ⑦ 动态调整规则优先级（PRD §6.6）
const snap = { daysLeft: 100, daysSinceLogin: 0, missStreak: 0, overStreak: 0, examScores: [] }
check('⑦ 无异常 → 不调整', evaluateAdjustment(snap), null)
check('⑦ 考前 10 天 → 稳定期（优先级最高）', evaluateAdjustment({ ...snap, daysLeft: 10, missStreak: 5 }).action, 'stabilize')
check('⑦ 7 天未登录 → 欢迎回归', evaluateAdjustment({ ...snap, daysSinceLogin: 8, missStreak: 5 }).action, 'welcome_back')
check('⑦ 连续 3 天未完成 → 降档 20%', evaluateAdjustment({ ...snap, missStreak: 3 }).capacityFactor, 0.8)
check('⑦ 模考连续下滑 → 回炉', evaluateAdjustment({ ...snap, examScores: [88, 95] }).action, 'reforge')
check('⑦ 模考上升 → 不回炉', evaluateAdjustment({ ...snap, examScores: [95, 88] }), null)
check('⑦ 连续 7 天超额 → 加档 20%', evaluateAdjustment({ ...snap, overStreak: 7 }).capacityFactor, 1.2)

// ⑧ 章节推进决策（PRD §6.6）
check('⑧ 正确率 50% → 阻断', decideChapterAction(0.5, 'sure').action, 'block')
check('⑧ 正确率 92% + 有把握 → 跳学', decideChapterAction(0.92, 'sure').action, 'skip')
check('⑧ 正确率 92% 但没把握 → 正常推进', decideChapterAction(0.92, 'unsure').action, 'proceed')
check('⑧ 正确率 75% → 正常推进', decideChapterAction(0.75, 'sure').action, 'proceed')

/* ---------- ⑨ 进度汇总（summarizeProgress） ---------- */

const DEFAULT_DAILY_GOAL = 15
const MISS_RATIO = 0.6
const OVER_RATIO = 1.2

const fmtD = (d) => {
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function summarizeProgress(daily, examScores, daysLeft, today) {
  const todayStr = fmtD(today)
  const todayTs = today.getTime()
  const past = daily.filter((d) => d.date < todayStr).sort((a, b) => (a.date < b.date ? 1 : -1))
  const goalOf = (d) => (d.planned > 0 ? d.planned : DEFAULT_DAILY_GOAL)

  let missStreak = 0
  for (const d of past) {
    if (d.answered >= goalOf(d) * MISS_RATIO) break
    missStreak += 1
  }
  let overStreak = 0
  for (const d of past) {
    if (d.answered < goalOf(d) * OVER_RATIO) break
    overStreak += 1
  }

  const lastActive = [...daily]
    .filter((d) => d.answered > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0]
  const daysSinceLogin = lastActive
    ? Math.max(0, Math.floor((todayTs - new Date(`${lastActive.date}T00:00:00`).getTime()) / DAY_MS))
    : 999

  return { daysLeft, daysSinceLogin, missStreak, overStreak, examScores }
}

const TODAY = new Date('2026-09-18T10:00:00')

// 连续 3 天未完成（17/16/15），14 号达标应中断
check(
  '⑨ 连续未完成天数统计（遇达标中断）',
  summarizeProgress(
    [
      { date: '2026-09-17', answered: 2, planned: 20 },
      { date: '2026-09-16', answered: 0, planned: 20 },
      { date: '2026-09-15', answered: 5, planned: 20 },
      { date: '2026-09-14', answered: 18, planned: 20 },
    ],
    [],
    50,
    TODAY,
  ).missStreak,
  3,
)

// 今天还没过完，不能计入连续统计
check(
  '⑨ 今天不计入连续统计',
  summarizeProgress(
    [
      { date: '2026-09-18', answered: 0, planned: 20 },
      { date: '2026-09-17', answered: 20, planned: 20 },
    ],
    [],
    50,
    TODAY,
  ).missStreak,
  0,
)

// 连续超额（≥120%）
check(
  '⑨ 连续超额天数统计',
  summarizeProgress(
    [
      { date: '2026-09-17', answered: 30, planned: 20 },
      { date: '2026-09-16', answered: 25, planned: 20 },
      { date: '2026-09-15', answered: 10, planned: 20 },
    ],
    [],
    50,
    TODAY,
  ).overStreak,
  2,
)

// 无任务包记录 → 用默认目标（15 题 × 60% = 9）
check(
  '⑨ 无任务包时用默认目标判定',
  summarizeProgress([{ date: '2026-09-17', answered: 8, planned: 0 }], [], 50, TODAY).missStreak,
  1,
)
check(
  '⑨ 无任务包时达标即中断',
  summarizeProgress([{ date: '2026-09-17', answered: 10, planned: 0 }], [], 50, TODAY).missStreak,
  0,
)

// 距上次活跃天数
check(
  '⑨ 距上次登录 7 天',
  summarizeProgress([{ date: '2026-09-11', answered: 10, planned: 20 }], [], 50, TODAY)
    .daysSinceLogin,
  7,
)
check('⑨ 从未答题 → 大值', summarizeProgress([], [], 50, TODAY).daysSinceLogin, 999)

// 汇总结果可直接喂给 evaluateAdjustment（端到端）
const e2e = summarizeProgress(
  [
    { date: '2026-09-17', answered: 1, planned: 20 },
    { date: '2026-09-16', answered: 0, planned: 20 },
    { date: '2026-09-15', answered: 3, planned: 20 },
  ],
  [],
  50,
  TODAY,
)
check('⑨ 端到端：连续落后触发降档', evaluateAdjustment(e2e)?.action, 'downgrade')

/* ---------- ⑩ 章节跳学判定（主导确信度 + 推进建议） ---------- */

/** 本轮主导确信度：取众数；并列时取更保守的档位 */
function dominantConfidence(list) {
  const c = { sure: 0, unsure: 0, noidea: 0 }
  list.forEach((x) => (c[x] += 1))
  const max = Math.max(c.sure, c.unsure, c.noidea)
  if (max === 0) return 'unsure'
  if (c.sure === max && c.sure > c.unsure && c.sure > c.noidea) return 'sure'
  if (c.noidea === max && c.noidea > c.unsure) return 'noidea'
  return 'unsure'
}

check('⑩ 多数「很确定」→ sure', dominantConfidence(['sure', 'sure', 'unsure']), 'sure')
check('⑩ 并列时取保守档', dominantConfidence(['sure', 'unsure']), 'unsure')
check('⑩ 多数「没思路」→ noidea', dominantConfidence(['noidea', 'noidea', 'sure']), 'noidea')
check('⑩ 空数组兜底为 unsure', dominantConfidence([]), 'unsure')
check('⑩ 全部很确定 → sure', dominantConfidence(['sure', 'sure', 'sure']), 'sure')

check('⑩ 90% + 有把握 → 允许跳学', decideChapterAction(0.9, 'sure').action, 'skip')
check('⑩ 90% 但没把握 → 不跳学', decideChapterAction(0.9, 'unsure').action, 'proceed')
check('⑩ 55% → 阻断回看', decideChapterAction(0.55, 'sure').action, 'block')

console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项未通过`}`)
process.exit(failed === 0 ? 0 : 1)
