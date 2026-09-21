/**
 * 计划引擎服务（业务层）
 *
 * 实现 PRD §6「上岸计划引擎」中尚未落地的部分：
 *   ① 四阶段模型 + 分档策略（§6.2）—— 按剩余天数自动匹配模板并划分阶段
 *   ② 动态调整规则（§6.6）—— 落后降档 / 超额加档 / 回炉 / 阻断 / 跳关 / 稳定期
 *
 * 每日任务包算法（§6.4）已在 planService 中实现，本文件不重复。
 * 本层不依赖 UI，仅依赖实体类型，可独立测试。
 */
import { EXAM_DATE } from './planService'

const DAY_MS = 86400000

/* ==================== 四阶段模型（PRD §6.2） ==================== */

export type PlanStageId = 'P0' | 'P1' | 'P2' | 'P3' | 'P4'

/** 计划模板档位（§6.2 分档策略） */
export type PlanTemplate = 'full' | 'standard' | 'sprint' | 'extreme'

export interface PlanStage {
  id: PlanStageId
  name: string
  goal: string
  actions: string
  /** 时间分配比例 */
  ratio: string
  days: number
  startDate: string
  endDate: string
  status: 'past' | 'current' | 'future'
}

export interface Roadmap {
  daysLeft: number
  template: PlanTemplate
  templateLabel: string
  templateNote: string
  totalDays: number
  elapsedDays: number
  /** 0-1 */
  progress: number
  currentStageId: PlanStageId
  stages: PlanStage[]
}

/** 各阶段文案（PRD §6.2 表） */
const STAGE_META: Record<
  PlanStageId,
  { name: string; goal: string; actions: string; ratio: string }
> = {
  P0: {
    name: '诊断期',
    goal: '建立掌握度基线',
    actions: '30 题分模块摸底测评 + 学习目标设定 + 可用时间申报',
    ratio: '测评 100%',
  },
  P1: {
    name: '基础构建',
    goal: '全覆盖，建立知识框架',
    actions: '按权重顺序学模块 → 每节即时测 → 每章章节测 → 复习队列',
    ratio: '新学 60% / 复习 30% / 测试 10%',
  },
  P2: {
    name: '强化突破',
    goal: '消灭薄弱点，真题精研',
    actions: '专项训练 + 近 5 年真题（按知识点刷，非按年份）+ 错题歼灭',
    ratio: '复习 30% / 专项 40% / 真题 30%',
  },
  P3: {
    name: '冲刺模考',
    goal: '全真演练，适应机考',
    actions: '每周 1 套全真模考（含连考）+ 复盘 + 高频考点回炉',
    ratio: '模考 35% / 回炉 45% / 复习 20%',
  },
  P4: {
    name: '考前稳定',
    goal: '轻负载，稳状态',
    actions: '每日轻量复习 + 1 套最终模考 + 机考操作演练 + 作息调整',
    ratio: '复习 70% / 轻量测 30%',
  },
}

/** 基准（T=180，PRD §6.2）各阶段天数 */
const BASE_STAGES: Array<{ id: PlanStageId; days: number }> = [
  { id: 'P0', days: 3 },
  { id: 'P1', days: 74 },
  { id: 'P2', days: 55 },
  { id: 'P3', days: 40 },
  { id: 'P4', days: 8 },
]

/** 按剩余天数判定模板档位（§6.2 分档策略） */
export function pickTemplate(daysLeft: number): PlanTemplate {
  if (daysLeft >= 150) return 'full'
  if (daysLeft >= 90) return 'standard'
  if (daysLeft >= 45) return 'sprint'
  return 'extreme'
}

export const TEMPLATE_META: Record<PlanTemplate, { label: string; note: string }> = {
  full: { label: '完整版', note: '全覆盖 + 深度，按权重顺序逐模块推进' },
  standard: { label: '标准版', note: '压缩基础期，模块仍全覆盖，但深度降级（跳过低频考点）' },
  sprint: { label: '冲刺版', note: '砍掉低频低权重考点，只覆盖「拿 84 分所需的 65% 高频考点」' },
  extreme: { label: '极限版', note: '只做「高频考点 + 真题 + 模考」，取舍已在下方说明' },
}

/**
 * 按总天数缩放各阶段
 * P0（诊断 3 天）与 P4（稳定 8 天）固定不缩放，中间三段等比伸缩。
 * 最后把四舍五入的误差补进基础期，**保证总和精确等于总天数**——
 * 否则倒推出的首阶段起点会晚于「计划开始日」，导致当前阶段判定落空。
 */
function scaleStages(totalDays: number): Array<{ id: PlanStageId; days: number }> {
  const FIXED = 3 + 8
  const BASE_FLEX = 74 + 55 + 40
  const flexible = Math.max(totalDays - FIXED, 3)
  const k = flexible / BASE_FLEX
  const stages: Array<{ id: PlanStageId; days: number }> = [
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

function fmtDate(ts: number): string {
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function daysUntilExam(today = new Date()): number {
  const exam = new Date(`${EXAM_DATE}T00:00:00`).getTime()
  return Math.max(0, Math.ceil((exam - today.getTime()) / DAY_MS))
}

/**
 * 生成「上岸作战地图」
 *
 * 以**考试日**为锚点倒推阶段区间（P4 结束于考试前一天），
 * 并用「计划开始日」推算总天数与已进行天数。
 *
 * ⚠️ 注意区分两个概念：`daysLeft`（距考试天数）用于**选模板档位**；
 *    而阶段推进要看 **elapsedDays**（计划已进行天数）。二者只有在
 *    「用户今天才开始用」时才相等。
 *
 * @param today      今天（便于测试注入）
 * @param startDate  计划开始日 YYYY-MM-DD；不传则视为今天开始
 */
export function buildRoadmap(today = new Date(), startDate?: string): Roadmap {
  const examTs = new Date(`${EXAM_DATE}T00:00:00`).getTime()
  const todayTs = today.getTime()
  const startTs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : todayTs

  const daysLeft = Math.max(Math.ceil((examTs - todayTs) / DAY_MS), 0)
  const totalDays = Math.max(Math.ceil((examTs - startTs) / DAY_MS), 16)
  const elapsedDays = Math.min(Math.max(Math.floor((todayTs - startTs) / DAY_MS), 0), totalDays)

  const template = pickTemplate(daysLeft)
  const scaled = scaleStages(totalDays)

  // 从考试日前一天倒推
  let cursor = examTs
  const stages: PlanStage[] = []
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

  // 按日期标记状态（比按天数累计更贴近用户真实感知）
  stages.forEach((s) => {
    const start = new Date(`${s.startDate}T00:00:00`).getTime()
    const end = new Date(`${s.endDate}T23:59:59`).getTime()
    s.status = todayTs > end ? 'past' : todayTs < start ? 'future' : 'current'
  })

  const currentStageId = stages.find((s) => s.status === 'current')?.id ?? stages[0].id

  return {
    daysLeft,
    template,
    templateLabel: TEMPLATE_META[template].label,
    templateNote: TEMPLATE_META[template].note,
    totalDays,
    elapsedDays,
    progress: totalDays > 0 ? Math.min(1, elapsedDays / totalDays) : 0,
    currentStageId,
    stages,
  }
}

/* ==================== 动态调整规则（PRD §6.6） ==================== */

export type AdjustAction =
  | 'downgrade'
  | 'upgrade'
  | 'reforge'
  | 'block'
  | 'skip'
  | 'proceed'
  | 'stabilize'
  | 'welcome_back'

export interface AdjustSignal {
  action: AdjustAction
  title: string
  message: string
  /** 建议的每日容量系数（1 = 不变，0.8 = 下调 20%） */
  capacityFactor?: number
}

/** 近期学习情况快照（由调用方汇总） */
export interface ProgressSnapshot {
  /** 距考试天数 */
  daysLeft: number
  /** 距上次登录天数 */
  daysSinceLogin: number
  /** 连续未完成计划天数 */
  missStreak: number
  /** 连续超额完成天数（≥120%） */
  overStreak: number
  /** 模考成绩，**时间倒序**（最近在前） */
  examScores: number[]
}

/**
 * 评估是否应调整计划。
 * 只返回**优先级最高**的一条信号——一次弹多条会让用户无所适从。
 *
 * 优先级：稳定期 > 长期未登录 > 落后降档 > 模考回炉 > 超额加档
 */
export function evaluateAdjustment(s: ProgressSnapshot): AdjustSignal | null {
  if (s.daysLeft < 15) {
    return {
      action: 'stabilize',
      title: '进入考前稳定期',
      message: '距考试不足 15 天，已停止新学，只保留复习与模考。这时候稳住比多学更重要。',
    }
  }

  if (s.daysSinceLogin >= 7) {
    return {
      action: 'welcome_back',
      title: '我们重新算一下，还来得及',
      message: '有一阵没来了。已按剩余天数重新压缩计划——先保住复习不断档，再谈进度。',
    }
  }

  if (s.missStreak >= 3) {
    return {
      action: 'downgrade',
      title: '最近很忙？我把计划调松了',
      message: '连续几天没完成，已把每日容量下调 20%。进度可以慢，节奏不能断。',
      capacityFactor: 0.8,
    }
  }

  const scores = s.examScores.slice(0, 2)
  if (scores.length === 2 && scores[0] < scores[1]) {
    return {
      action: 'reforge',
      title: '启动回炉',
      message: '模考成绩出现下滑，已把相关模块标记为薄弱，并插入专项训练。',
    }
  }

  if (s.overStreak >= 7) {
    return {
      action: 'upgrade',
      title: '状态很好，可以加档',
      message: '连续一周超额完成，可以提前推进下一阶段。保持这个节奏。',
      capacityFactor: 1.2,
    }
  }

  return null
}

/** 章节测后的推进决策（§6.6） */
export function decideChapterAction(
  accuracy: number,
  confidence: 'sure' | 'unsure' | 'noidea',
): AdjustSignal {
  if (accuracy < 0.6) {
    return {
      action: 'block',
      title: '先别急着往下走',
      message: `本章正确率 ${Math.round(accuracy * 100)}%，建议回看精讲并重做错题，再进入下一章。`,
    }
  }
  if (accuracy >= 0.9 && confidence === 'sure') {
    return {
      action: 'skip',
      title: '这一章可以跳过',
      message: `正确率 ${Math.round(accuracy * 100)}% 且自评有把握，可直接标记完成，把时间留给薄弱章节。`,
    }
  }
  return {
    action: 'proceed',
    title: '继续推进',
    message: `正确率 ${Math.round(accuracy * 100)}%，掌握情况良好，进入下一章。`,
  }
}

/* ==================== 进度汇总（把原始记录算成调整指标） ==================== */

/** 单日学习记录 */
export interface DailyStat {
  date: string
  /** 实际答题数 */
  answered: number
  /** 当日计划题数（无任务包记录时为 0） */
  planned: number
}

/** 没有任务包记录时的默认每日目标题数 */
const DEFAULT_DAILY_GOAL = 15
/** 完成率低于此比例视为「未完成」 */
const MISS_RATIO = 0.6
/** 完成率高于此比例视为「超额完成」 */
const OVER_RATIO = 1.2

/**
 * 汇总最近学习情况，产出动态调整所需的指标
 *
 * ⚠️ 只统计**已经结束的日子**（今天还没过完，计入连续统计会误判）。
 *
 * @param daily      每日记录（由 answerLogs.dailyCounts 与任务包合并而来）
 * @param examScores 模考成绩，**时间倒序**（最近在前）
 * @param daysLeft   距考试天数
 */
export function summarizeProgress(
  daily: DailyStat[],
  examScores: number[],
  daysLeft: number,
  today = new Date(),
): ProgressSnapshot {
  const todayStr = fmtDate(today.getTime())
  const todayTs = today.getTime()

  // 最近的在前
  const past = daily.filter((d) => d.date < todayStr).sort((a, b) => (a.date < b.date ? 1 : -1))
  const goalOf = (d: DailyStat) => (d.planned > 0 ? d.planned : DEFAULT_DAILY_GOAL)

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

  // 距上次活跃：最后一次有答题记录的日子（从未答题则给一个大值）
  const lastActive = [...daily]
    .filter((d) => d.answered > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0]
  const daysSinceLogin = lastActive
    ? Math.max(0, Math.floor((todayTs - new Date(`${lastActive.date}T00:00:00`).getTime()) / DAY_MS))
    : 999

  return { daysLeft, daysSinceLogin, missStreak, overStreak, examScores }
}

/* ==================== 容量系数（降档/加档的落地） ==================== */

const CAPACITY_KEY = 'jingshi.plan_capacity_factor'

/** 读取当前的每日容量系数（1 = 不调整） */
export function getCapacityFactor(): number {
  const v = Number(localStorage.getItem(CAPACITY_KEY) ?? '1')
  return Number.isFinite(v) && v > 0.3 && v <= 2 ? v : 1
}

/** 应用建议的容量系数（由 evaluateAdjustment 给出） */
export function applyCapacityFactor(factor: number): void {
  const clamped = Math.min(Math.max(factor, 0.5), 1.5)
  localStorage.setItem(CAPACITY_KEY, String(clamped))
}
