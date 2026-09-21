/**
 * 题库导入解析服务（业务层）
 *
 * 承载 PRD M7-F2「解析流水线」中的文本切题与置信度评估：
 *   题号切分 → 选项抽取 → 答案识别 → 置信度评估
 * 规则集中在此，页面只负责输入与预览交互。
 *
 * 注意：PDF / 图片需要 OCR，属于基础设施（infrastructure），本服务只处理纯文本。
 */
import type { KnowledgeNode, SubjectId } from '@/domain/entities'
import {
  buildCombined,
  compileRule,
  DEFAULT_RULE,
  denoise,
  findSectionMarks,
  type CompiledRule,
  type ParseRule,
  type SectionType,
} from './parseRule'

export interface ParsedOption {
  key: string
  content: string
}

export interface ParsedQuestion {
  /** 临时 id（预览阶段） */
  key: string
  stem: string
  options: ParsedOption[]
  /** 识别到的答案（可能为空） */
  answer: string[]
  /** 0-1，用于分级提示（PRD M7-F3：绿/黄/红） */
  confidence: number
  /** 需要用户注意的提示 */
  warnings: string[]
  /** 用户预设科目（导入页所选） */
  subjectId: SubjectId
  /** 归类的科目（classify 后填充，可能与预设不同） */
  classifiedSubjectId?: SubjectId
  /** 归类的知识点 / 章节 */
  classifiedNodeId?: string
  classifiedNodeName?: string
  /** 归类置信度 0-1 */
  classifyConfidence?: number
  /** 归类方式 */
  classifyMatchedBy?: 'knowledge_point' | 'chapter' | 'none'
  /** 解析正文（对应答题页「解析」） */
  analysis?: string
  /** 考点（对应答题页「考点 / 本地考察」） */
  point?: string
  /** 出处来源 */
  source?: string
  /** 是否与「我的题库」已有题目重复（导入前标记） */
  duplicated?: boolean
}

export interface ClassifyResult {
  subjectId: SubjectId | null
  nodeId: string | null
  nodeName: string | null
  /** 0-1 */
  confidence: number
  matchedBy: 'knowledge_point' | 'chapter' | 'none'
}

/**
 * 题目归类（业务层，纯本地、确定性、零成本）
 *
 * 决策依据（PRD M7 导入后的归集）：
 *   ① 科目   —— 用户预设为主；本函数跨两科匹配，命中另一科时给出「建议科目」
 *   ② 章节   —— 题干/选项含知识点名 → 高置信；含章节名 → 中置信；无命中 → 未归类（让用户手动选）
 *   ③ 题型   —— 由选项/答案数推断，见 ImportPage.toQuestion
 *
 * 为什么用关键词匹配而非 AI：考试题干几乎必然出现考点术语（如「需求价格弹性」），
 * 本地字符串命中率极高、零成本、可离线，符合本地优先架构；AI 作为后续可选增强。
 */
export function classifyQuestion(
  stem: string,
  options: string[],
  tree: KnowledgeNode[],
): ClassifyResult {
  const text = `${stem} ${options.join(' ')}`
  const points = tree.filter((n) => n.level === 3)
  const chapters = tree.filter((n) => n.level === 2)

  // ① 知识点名精确命中（权重 = 名称长度，越长越具体）
  let bestPoint: KnowledgeNode | null = null
  let bestScore = 0
  for (const p of points) {
    if (text.includes(p.name)) {
      const score = p.name.length
      if (score > bestScore) {
        bestScore = score
        bestPoint = p
      }
    }
  }
  if (bestPoint) {
    return {
      subjectId: bestPoint.subjectId,
      nodeId: bestPoint.id,
      nodeName: bestPoint.name,
      confidence: 0.9,
      matchedBy: 'knowledge_point',
    }
  }

  // ② 章节名命中（去掉「1. 」这类序号前缀）
  let bestChapter: KnowledgeNode | null = null
  bestScore = 0
  for (const c of chapters) {
    const name = c.name.replace(/^\d+\.\s*/, '')
    if (name && name.length >= 4 && text.includes(name)) {
      const score = name.length
      if (score > bestScore) {
        bestScore = score
        bestChapter = c
      }
    }
  }
  if (bestChapter) {
    return {
      subjectId: bestChapter.subjectId,
      nodeId: bestChapter.id,
      nodeName: bestChapter.name,
      confidence: 0.6,
      matchedBy: 'chapter',
    }
  }

  return { subjectId: null, nodeId: null, nodeName: null, confidence: 0, matchedBy: 'none' }
}

/** 置信度分级（PRD M7-F3） */
export type ConfidenceLevel = 'high' | 'medium' | 'low'

export function confidenceLevel(c: number): ConfidenceLevel {
  if (c >= 0.9) return 'high'
  if (c >= 0.7) return 'medium'
  return 'low'
}

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, { text: string; color: string }> = {
  high: { text: '识别良好', color: 'var(--color-success)' },
  medium: { text: '请核对', color: 'var(--color-warning)' },
  low: { text: '建议检查', color: 'var(--color-danger)' },
}

/* ---------- 题号与选项的正则 ---------- */

// 题号：1. / 1、 / 1． / 1) / 1） / (1) / （1） / 1题 / 第1题 / 第 1 题
const QUESTION_NO = /^(?:第\s*)?[（(]?\s*(\d{1,4})\s*(?:[）).、．]\s*|\s*题\s*)/
// 选项：A. / A、 / (A) / A．（A 前允许空白）
const OPTION = /^([A-Ea-e])\s*[\.、．\)）]\s*(.*)$/
// 答案：答案：A / 【答案】A / 正确答案：AB / 参考答案 AC（冒号可选）
const ANSWER = /^(?:【?答案】?|【?正确答案】?|参考答案|正确答案)\s*[：:]?\s*([A-Ea-e]+)/i
// 解析 / 考点：忽略
const SKIP_PREFIX = /^(?:【?解析】?|【?考点】?|【?点拨】?|【?提示】?)\s*[：:]/i

function newParsed(subjectId: SubjectId, index: number): ParsedQuestion {
  return {
    key: `p_${index}`,
    stem: '',
    options: [],
    answer: [],
    confidence: 0,
    warnings: [],
    subjectId,
  }
}

/**
 * 从纯文本解析题目
 *
 * 两种文档结构都支持：
 *   1. 每题多行：题号一行、选项每行一个（传统格式）
 *   2. 整题一行：题干、选项、答案、解析、考点挤在同一行，用空格分隔（部分 PDF/OCR 导出）
 *
 * 核心思路：先按题号把文本切成「题目块」，再在每块内按标记切出题干/选项/答案/解析/考点。
 */
export function parseText(raw: string, subjectId: SubjectId, rule?: ParseRule): ParsedQuestion[] {
  const R = compileRule(rule ?? DEFAULT_RULE)
  let text = R.denoise ? denoise(raw) : raw

  // ① 起点/终点裁剪：去掉标题、考试说明、答案速查等
  text = applyBounds(text, R)
  if (!text.trim()) return []

  // ② 按题号切成题目块
  const combined = buildCombined(R.questions)
  const blocks = splitByQuestion(text, combined)
  if (!blocks.length) return []

  // ③ 逐块解析结构
  const out: ParsedQuestion[] = []
  blocks.forEach((body, i) => {
    const q = parseBlock(body, R, subjectId, i)
    if (q && q.stem.trim().length >= 4) out.push(q)
  })

  out.forEach((q) => assess(q))
  return out
}

/** 应用起点/终点，裁掉文档前后无关内容 */
function applyBounds(text: string, R: CompiledRule): string {
  let t = text
  if (R.startAfter) {
    const idx = t.indexOf(R.startAfter)
    if (idx >= 0) t = t.slice(idx + R.startAfter.length)
    else return '' // 找不到起点，说明文档不含题目
  }
  if (R.endBefore) {
    const idx = t.indexOf(R.endBefore)
    if (idx >= 0) t = t.slice(0, idx)
  }
  return t
}

/** 按题号切块：两个题号之间的内容即题目正文（题号可跨行出现） */
function splitByQuestion(text: string, combined: RegExp): string[] {
  const blocks: string[] = []
  const matches = [...text.matchAll(combined)]
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const start = (m.index ?? 0) + m[0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length
    const body = text.slice(start, end).trim()
    if (body) blocks.push(body)
  }
  return blocks
}

/**
 * 块内解析（标记位置驱动，各字段独立定位、互不依赖）
 *
 * 优势：即使某一种标记（如答案）没识别到，题干/选项/解析仍能正确切分，
 * 不会出现「解析内容拼进最后一个选项」的连锁错误。
 */
function parseBlock(
  body: string,
  R: CompiledRule,
  subjectId: SubjectId,
  index: number,
): ParsedQuestion {
  const q = newParsed(subjectId, index)

  interface Mark {
    index: number
    end: number
    kind: 'option' | 'answer' | 'section'
    key?: string
    type?: SectionType
  }
  const marks: Mark[] = []

  // ① 选项标记（A. / A、 / (A) 等，全部定位）
  const optCombined = buildCombined(R.options)
  for (const m of body.matchAll(optCombined)) {
    const key = (m[0].match(/[A-Ea-e]/)?.[0] ?? '').toUpperCase()
    marks.push({ index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind: 'option', key })
  }

  // ② 答案标记（参考答案 / 答案 / 【答案】 等）
  const ansCombined = buildCombined(R.answers)
  // 注意：必须用 matchAll 取第一个匹配（带 index）；body.match(全局正则) 返回字符串数组，无 index
  const am = [...body.matchAll(ansCombined)][0]
  if (am) {
    const amIndex = am.index ?? 0
    let ansStart = amIndex
    // 「参考答案」的"参考"在"答案"前，一并算入标记，避免混进选项
    if (ansStart >= 2 && body.slice(ansStart - 2, ansStart) === '参考') ansStart -= 2
    marks.push({ index: ansStart, end: amIndex + am[0].length, kind: 'answer' })
    const letters = am[0].match(/[A-Ea-e]+/)
    if (letters) q.answer = letters[0].toUpperCase().split('')
  }

  // ③ 解析 / 考点 / 出处标记
  for (const s of findSectionMarks(body, R)) {
    marks.push({ index: s.index, end: s.index + s.kw.length, kind: 'section', type: s.type })
  }

  marks.sort((a, b) => a.index - b.index)

  // ④ 题干：第一个标记之前
  const first = marks[0]
  q.stem = first ? body.slice(0, first.index).trim() : body.trim()

  // ⑤ 选项：选项标记到「下一个标记」之间（不会把解析/答案拼进选项）
  const options: Array<{ key: string; content: string }> = []
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]
    if (m.kind !== 'option' || !m.key) continue
    const next = marks[i + 1]
    const end = next ? next.index : body.length
    options.push({ key: m.key, content: body.slice(m.end, end).trim() })
  }
  if (options.length >= 2) q.options = options

  // ⑥ 解析 / 考点 / 出处：段落标记到下一个标记之间
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]
    if (m.kind !== 'section' || !m.type) continue
    const next = marks[i + 1]
    const end = next ? next.index : body.length
    appendField(q, m.type, body.slice(m.end, end))
  }

  return q
}

/** 追加解析/考点/出处字段（剥离冒号与空白） */
function appendField(q: ParsedQuestion, type: SectionType, content: string) {
  const c = content.replace(/^[：:\s]+/, '').trim()
  if (!c) return
  if (type === 'analysis') q.analysis = `${q.analysis ?? ''} ${c}`.trim()
  else if (type === 'point') q.point = `${q.point ?? ''} ${c}`.trim()
  else q.source = `${q.source ?? ''} ${c}`.trim()
}

/* ---------- Excel 表头模板：结构化导入（完全绕开 OCR 与切题） ---------- */

/** 表头 → 字段的别名映射（宽松匹配，用户表头不必完全一致） */
const COLUMN_ALIASES: Array<{ field: string; keys: string[] }> = [
  { field: 'stem', keys: ['题干', '题目', '试题', '问题'] },
  { field: 'a', keys: ['选项a', 'a选项', 'a'] },
  { field: 'b', keys: ['选项b', 'b选项', 'b'] },
  { field: 'c', keys: ['选项c', 'c选项', 'c'] },
  { field: 'd', keys: ['选项d', 'd选项', 'd'] },
  { field: 'e', keys: ['选项e', 'e选项', 'e'] },
  // 「所有选项挤在一列」的常见写法（如 A.甲 B.乙 C.丙 D.丁）
  { field: 'options', keys: ['选项', '选项内容', '备选项'] },
  { field: 'answer', keys: ['答案', '正确答案', '参考答案'] },
  { field: 'analysis', keys: ['解析', '答案解析', '试题解析', '详解'] },
  { field: 'point', keys: ['考点', '考查点', '知识点'] },
]

/** 归一化表头：去空白、去括号、转小写 */
function normHeader(h: string): string {
  return String(h ?? '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[（）()]/g, '')
    .toLowerCase()
}

/** 表头 → 列索引 */
function mapColumns(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {}
  headers.forEach((h, i) => {
    const n = normHeader(h)
    if (!n) return
    for (const { field, keys } of COLUMN_ALIASES) {
      if (map[field] != null) continue
      if (keys.some((k) => n === normHeader(k))) {
        map[field] = i
        return
      }
    }
  })
  return map
}

/** 从「A.甲 B.乙 C.丙」这类合并字符串中拆出选项 */
function splitOptions(blob: string): Array<{ key: string; content: string }> {
  const re = /([A-Ea-e])\s*[.、．,，:：)）]\s*/g
  const marks = [...blob.matchAll(re)]
  if (marks.length < 2) return []
  return marks
    .map((m, i) => ({
      key: (m[1] ?? '').toUpperCase(),
      content: blob
        .slice(
          (m.index ?? 0) + m[0].length,
          i + 1 < marks.length ? (marks[i + 1].index ?? blob.length) : blob.length,
        )
        .trim(),
    }))
    .filter((o) => o.key && o.content)
}

/** 单行校验问题 */
export interface TableIssue {
  /** 原表行号（含表头，从 1 起，便于对照 Excel） */
  row: number
  /** 具体问题，如「缺少答案」 */
  issues: string[]
  /** 题干预览，便于定位该行 */
  stem: string
}

export interface TableParseResult {
  questions: ParsedQuestion[]
  /** 逐行问题清单 */
  issues: TableIssue[]
  /** 表头识别结果（字段 → 原列名），用于诊断「为什么没识别」 */
  mapped: Record<string, string>
  /** 未被识别的表头（该列会被忽略） */
  unmapped: string[]
}

/**
 * 从 Excel 表格解析题目（表头模板）+ 逐行校验
 *
 * 完全绕开 OCR 与切题规则，零识别误差，最适合批量建题。
 * 兼容两种选项写法：① 选项A/B/C/D 分列  ② 所有选项挤在一个「选项」列。
 * `questions` 为空表示不是模板表，调用方应回退到文本切题。
 */
export function parseTable(
  table: { headers: string[]; rows: string[][] },
  subjectId: SubjectId,
): TableParseResult {
  const col = mapColumns(table.headers)
  const mapped: Record<string, string> = {}
  Object.entries(col).forEach(([f, i]) => {
    mapped[f] = table.headers[i] ?? ''
  })
  const usedIdx = new Set(Object.values(col))
  const unmapped = table.headers.filter((h, i) => h && !usedIdx.has(i))

  const result: TableParseResult = { questions: [], issues: [], mapped, unmapped }
  if (col.stem == null) return result // 没有题干列 → 不是模板表

  const hasSeparateOptions = (['a', 'b', 'c', 'd', 'e'] as const).some((k) => col[k] != null)

  table.rows.forEach((row, i) => {
    const rowNo = i + 2 // 表头占第 1 行
    const stem = (row[col.stem] ?? '').trim()

    if (!stem) {
      result.issues.push({ row: rowNo, issues: ['题干为空，该行已跳过'], stem: '（空行）' })
      return
    }

    // 选项：优先分列；否则从合并列拆分
    let options: Array<{ key: string; content: string }> = []
    if (hasSeparateOptions) {
      options = (['a', 'b', 'c', 'd', 'e'] as const)
        .filter((k) => col[k] != null)
        .map((k) => ({ key: k.toUpperCase(), content: (row[col[k]] ?? '').trim() }))
        .filter((o) => o.content)
    } else if (col.options != null) {
      options = splitOptions(row[col.options] ?? '')
    }

    // 答案
    const answerRaw = col.answer != null ? (row[col.answer] ?? '') : ''
    const answer = (answerRaw.match(/[A-Ea-e]/g) ?? []).map((x) => x.toUpperCase())

    // ---- 逐行校验 ----
    const issues: string[] = []
    if (stem.length < 4) issues.push('题干过短，可能不是完整题目')
    if (!options.length) issues.push('没有识别到选项，请检查表头或选项内容')
    else if (options.length < 4) issues.push(`只有 ${options.length} 个选项（选择题通常 4 个）`)
    if (!answer.length) issues.push('缺少答案')
    if (answer.length && options.length) {
      const keys = new Set(options.map((o) => o.key))
      const bad = answer.filter((a) => !keys.has(a))
      if (bad.length) issues.push(`答案 ${bad.join('、')} 不在选项中`)
    }
    if (issues.length) {
      result.issues.push({ row: rowNo, issues, stem: stem.slice(0, 30) })
    }

    if (stem.length < 4) return // 题干不成立 → 不入库

    const analysis = col.analysis != null ? (row[col.analysis] ?? '').trim() : ''
    const point = col.point != null ? (row[col.point] ?? '').trim() : ''

    result.questions.push({
      key: `t_${i}`,
      stem,
      options,
      answer,
      confidence: issues.length ? 0.7 : 0.99,
      warnings: issues,
      subjectId,
      analysis: analysis || undefined,
      point: point || undefined,
    })
  })

  return result
}

/** 置信度评估：选项完整性 + 是否识别到答案 */
function assess(q: ParsedQuestion): void {
  const warnings: string[] = []
  let confidence = 0.95

  if (q.options.length < 2) {
    confidence = 0.3
    warnings.push('选项过少，可能不是选择题')
  } else if (q.options.length < 4) {
    confidence -= 0.3
    warnings.push(`选项不足 4 个（识别到 ${q.options.length} 个）`)
  }

  if (!q.answer.length) {
    confidence -= 0.35
    warnings.push('未识别到答案')
  } else {
    // 答案是否都在选项里
    const optionKeys = new Set(q.options.map((o) => o.key))
    const invalid = q.answer.filter((a) => !optionKeys.has(a))
    if (invalid.length) {
      confidence -= 0.2
      warnings.push(`答案 ${invalid.join('')} 不在选项中`)
    }
  }

  q.confidence = Math.max(0.1, Math.round(confidence * 100) / 100)
  q.warnings = warnings
}

/** 预览阶段的整体统计 */
export function summarize(list: ParsedQuestion[]) {
  const byLevel = { high: 0, medium: 0, low: 0 }
  list.forEach((q) => {
    byLevel[confidenceLevel(q.confidence)]++
  })
  return { total: list.length, ...byLevel }
}
