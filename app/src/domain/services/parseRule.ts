/**
 * 解析规则（业务层）
 *
 * 设计原则：**面向用户，而非面向正则**。用户只描述「长什么样」，不写正则。
 *
 * 占位符：
 *   {n} = 阿拉伯题号（1-4 位）       例：{n}.        →   1.  23.
 *   {c} = 中文题号（一、二…十）      例：第{c}题     →   第一题  第十二题
 *   {t} = 可选题型标记               例：{t}第{c}题  →   【单选题】第一题 / 第一题
 *   {L} = 选项字母（A-E）           例：{L}、       →   A、  B、
 *   {a} = 答案字母串                例：答案：{a}   →   答案：A  答案：AB
 *   {d} = 分隔符（. 、 ， ： : ．）  例：{n}{d}      →   1.  1、  1，
 *   {o} = 可选分隔符（冒号/标点/空白 0~n 个，用于「答案：A」与「答案A」都匹配）
 *
 * 其余字符自动转义，`(` `)` `.` `【` 可直接写。
 * 题号/选项/答案都支持多种写法共存，用分号 `;` 分隔。
 *
 * **默认规则即「全能」**：覆盖绝大多数文档，用户通常无需配置。
 */
export interface ParseRule {
  id: string
  name: string
  /** 题号格式，多种写法用分号分隔 */
  questionPattern: string
  /** 选项格式，多种写法用分号分隔 */
  optionPattern: string
  /** 答案格式，多种写法用分号分隔 */
  answerPattern: string
  /** 解析段落关键词，逗号分隔 */
  analysisKeywords: string
  /** 附加信息关键词（考点 / 出处 / 来源 / 难度 等），逗号分隔，自动归类 */
  metaKeywords: string
  /** 起点：匹配到该文字之前的内容全部忽略。留空 = 从第一个题号开始 */
  startAfter: string
  /** 终点：匹配到该文字之后的内容全部忽略 */
  endBefore: string
  /** 去噪：移除页码与页眉页脚 */
  denoise: boolean
}

const DEFAULT_SECTIONS = {
  analysisKeywords: '解析,【解析】,答案解析,试题解析,详解',
  metaKeywords: '考点,【考点】,考察点,知识点,出处,来源,【出处】,【来源】,难度,题源',
}

/** 默认规则：覆盖绝大多数文档写法，用户通常无需改动 */
export const DEFAULT_RULE: ParseRule = {
  id: 'standard',
  name: '通用（自动识别常见格式）',
  questionPattern: '{n}{d} ; ({n}) ; {n}) ; 第{c}题 ; 第{n}题 ; {t}第{c}题 ; {t}第{n}题',
  optionPattern: '{L}{d} ; ({L}) ; {L})',
  answerPattern: '答案{o}{a} ; 正确答案{o}{a} ; 参考答案{o}{a} ; 【答案】{o}{a}',
  ...DEFAULT_SECTIONS,
  startAfter: '',
  endBefore: '',
  denoise: true,
}

/** 预设模板：特定格式的简化版（默认规则已覆盖大部分，这些用于兜底特殊场景） */
export const RULE_PRESETS: ParseRule[] = [
  DEFAULT_RULE,
  {
    id: 'number',
    name: '纯数字（1. 题目 / A. 选项）',
    questionPattern: '{n}{d}',
    optionPattern: '{L}{d}',
    answerPattern: '答案{o}{a} ; 参考答案{o}{a} ; 【答案】{o}{a}',
    ...DEFAULT_SECTIONS,
    startAfter: '',
    endBefore: '',
    denoise: true,
  },
  {
    id: 'chinese',
    name: '中文题号（第一题 / A、选项）',
    questionPattern: '第{c}题 ; {t}第{c}题',
    optionPattern: '{L}、 ; {L}{d}',
    answerPattern: '答案{o}{a} ; 参考答案{o}{a}',
    ...DEFAULT_SECTIONS,
    startAfter: '',
    endBefore: '',
    denoise: true,
  },
  {
    id: 'bracket',
    name: '括号（(1) 题目 / (A) 选项）',
    questionPattern: '({n}) ; （{n}）',
    optionPattern: '({L}) ; （{L}）',
    answerPattern: '答案{o}{a} ; 【答案】{o}{a}',
    ...DEFAULT_SECTIONS,
    startAfter: '',
    endBefore: '',
    denoise: true,
  },
]

/* ---------- 占位符 → 正则 ---------- */

const T = { n: '\u0001', c: '\u0002', t: '\u0003', L: '\u0004', a: '\u0005', d: '\u0006', o: '\u0007' }

const CN_NUM = '[一二三四五六七八九十百千零〇两]+'
const TYPE_TAG = '(?:[【\\[][^】\\]]+[】\\]])?'

function buildRegex(pattern: string): RegExp {
  let src = String(pattern ?? '').trim()
  if (!src) return /(?:)/

  src = src
    .replace(/\{n\}/g, T.n)
    .replace(/\{c\}/g, T.c)
    .replace(/\{t\}/g, T.t)
    .replace(/\{L\}/g, T.L)
    .replace(/\{a\}/g, T.a)
    .replace(/\{d\}/g, T.d)
    .replace(/\{o\}/g, T.o)

  src = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  src = src
    .replace(new RegExp(T.n, 'g'), '\\d{1,4}')
    .replace(new RegExp(T.c, 'g'), CN_NUM)
    .replace(new RegExp(T.t, 'g'), TYPE_TAG)
    .replace(new RegExp(T.L, 'g'), '([A-Ea-e])') // 捕获组 1：选项字母
    .replace(new RegExp(T.a, 'g'), '([A-Ea-e]+)') // 捕获组 1：答案字母串
    .replace(new RegExp(T.d, 'g'), '[.、．,，:：]')
    .replace(new RegExp(T.o, 'g'), '[：:.、．,，\\s]*')

  try {
    return new RegExp(src)
  } catch {
    return /(?:)/
  }
}

/** 支持多条（分号分隔），任一匹配即可 */
function buildRegexes(pattern: string): RegExp[] {
  const parts = String(pattern ?? '')
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length ? parts.map(buildRegex) : [/(?:)/]
}

export interface CompiledRule {
  questions: RegExp[]
  options: RegExp[]
  answers: RegExp[]
  analysis: string[]
  meta: string[]
  startAfter: string
  endBefore: string
  denoise: boolean
}

const splitKeywords = (s: string) =>
  String(s ?? '')
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean)

export function compileRule(rule: ParseRule): CompiledRule {
  return {
    questions: buildRegexes(rule.questionPattern),
    options: buildRegexes(rule.optionPattern),
    answers: buildRegexes(rule.answerPattern),
    analysis: splitKeywords(rule.analysisKeywords),
    meta: splitKeywords(rule.metaKeywords),
    startAfter: (rule.startAfter ?? '').trim(),
    endBefore: (rule.endBefore ?? '').trim(),
    denoise: rule.denoise,
  }
}

/** 组合多个正则（全局），用于 matchAll 或作为题号分隔符 */
export function buildCombined(regexes: RegExp[]): RegExp {
  const src = regexes.map((re) => re.source).join('|')
  return new RegExp(`(${src})`, 'g')
}

export type SectionType = 'analysis' | 'point' | 'source'

/** 附加信息关键词自动归类：考点类 vs 出处类 */
function classifyMeta(kw: string): 'point' | 'source' {
  return /考点|考察|知识点|重点|涉及/.test(kw) ? 'point' : 'source'
}

export interface SectionMark {
  type: SectionType
  index: number
  kw: string
}

/**
 * 在文本中定位所有段落标记（解析 / 考点 / 出处），按位置排序并去重叠。
 * 用于「整题一行」场景下在同一行内切分解析与考点。
 */
export function findSectionMarks(text: string, R: CompiledRule): SectionMark[] {
  const marks: SectionMark[] = []
  for (const kw of R.analysis) {
    const idx = text.indexOf(kw)
    if (idx >= 0) marks.push({ type: 'analysis', index: idx, kw })
  }
  for (const kw of R.meta) {
    const idx = text.indexOf(kw)
    if (idx >= 0) marks.push({ type: classifyMeta(kw), index: idx, kw })
  }
  return marks
    .sort((a, b) => a.index - b.index)
    .filter((m, i, arr) => {
      if (i === 0) return true
      const prev = arr[i - 1]
      // 紧邻/重叠的标记丢弃后一个（如「考点来源」整体归考点）
      return m.index >= prev.index + prev.kw.length + 2
    })
}

/* ---------- 去噪 ---------- */

export function denoise(raw: string): string {
  const lines = raw.split(/\r?\n/).map((l) => l.trim())

  const freq = new Map<string, number>()
  lines.forEach((l) => {
    if (l.length > 0 && l.length <= 25) freq.set(l, (freq.get(l) ?? 0) + 1)
  })

  return lines
    .filter((l) => {
      if (!l) return false
      if (/^\d{1,4}$/.test(l)) return false
      if (/^[-—]\s*\d{1,4}\s*[-—]$/.test(l)) return false
      if (/^第\s*\d{1,4}\s*页?$/.test(l)) return false
      if (/^第?\s*[一二三四五六七八九十]+\s*页$/.test(l)) return false
      if (/^[一二三四五六七八九十]+[、．]\s*\S{2,12}$/.test(l)) return false
      if (l.length <= 25 && (freq.get(l) ?? 0) >= 3) return false
      return true
    })
    .map((l) => l.replace(/([.。、,，;；])\1{2,}/g, '$1'))
    .join('\n')
}

/* ---------- 模板示例 ---------- */

const SAMPLE_REPLACERS: Array<[RegExp, string]> = [
  [/\{n\}/g, '1'],
  [/\{c\}/g, '一'],
  [/\{t\}/g, '【单选题】'],
  [/\{L\}/g, 'A'],
  [/\{a\}/g, 'A'],
  [/\{d\}/g, '.'],
  [/\{o\}/g, '：'],
]

function fillOne(pattern: string): string {
  let s = String(pattern ?? '').trim()
  SAMPLE_REPLACERS.forEach(([re, v]) => {
    s = s.replace(re, v)
  })
  return s
}

/**
 * 单条规则字段的「可匹配示例」（多条用「或」连接）。
 * 用于在配置框下方实时预览该条规则能匹配什么。
 */
export function buildFieldSample(pattern: string): string {
  const parts = String(pattern ?? '')
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) return '（空）'
  return parts.map(fillOne).join('　或　')
}

/** 生成完整题目模板示例（整体预览用） */
export function buildSample(rule: ParseRule): string {
  const q = fillOne(String(rule.questionPattern).split(/[;；]/)[0] ?? '')
  const opts = ['A', 'B', 'C', 'D'].map((L) => {
    const o = fillOne(String(rule.optionPattern).split(/[;；]/)[0] ?? '').replace('A', L)
    return `${o} 选项内容${L}`
  })
  const ans = fillOne(String(rule.answerPattern).split(/[;；]/)[0] ?? '')
  const analysisKw = splitKeywords(rule.analysisKeywords)[0] ?? '解析'
  const metaKw = splitKeywords(rule.metaKeywords)[0] ?? '考点'

  return [
    `${q} 下列关于……的说法，正确的是（　）。`,
    ...opts,
    ans,
    `${analysisKw}：本题考查……，A 项正确，因为……`,
    `${metaKw}：……`,
  ].join('\n')
}

/* ---------- 样例推导：粘贴一道题 → 自动生成规则 ---------- */

/**
 * 候选题号模式：**从具体到宽松**，取首个命中的。
 * 顺序很关键——带具体标点的（`{n}.`）必须排在标点容错的（`{n}{d}`）之前，
 * 否则会推导出过宽的模式（如把正文里的 "3.14" 也当题号）。
 */
const Q_CANDIDATES = [
  // ① 带「第X题」结构（最明确；{t} 可让规则同时兼容带题型标记的写法）
  '{t}第{n}题',
  '{t}第{c}题',
  '第{n}题',
  '第{c}题',
  // ② 括号包裹
  '({n})',
  '（{n}）',
  // ③ 数字 + 具体标点
  '{n})',
  '{n}）',
  '{n}、',
  '{n}.',
  // ④ 带题型标记的数字题号
  '{t}{n}.',
  '{t}{n}、',
  // ⑤ 标点容错（最宽松，兜底）
  '{n}{d}',
  '{t}{n}{d}',
]

/** 候选选项模式 */
const O_CANDIDATES = ['({L})', '（{L}）', '{L}{d}', '{L}、', '{L}.', '{L})']

/** 候选答案模式（从更具体的写法到最宽松） */
const A_CANDIDATES = ['【答案】{o}{a}', '参考答案{o}{a}', '正确答案{o}{a}', '答案{o}{a}', '答案{d}{a}']

export interface InferenceReport {
  /** 题号：命中的原文与推导出的模式 */
  question: { ok: boolean; sample: string; pattern: string }
  /** 选项：命中的字母序列与推导出的模式 */
  option: { ok: boolean; keys: string[]; pattern: string }
  /** 答案：命中的原文与推导出的模式 */
  answer: { ok: boolean; sample: string; pattern: string }
  /** 样例中是否出现了解析 / 考点标记 */
  analysis: boolean
  point: boolean
}

/** 测试某模式是否在样例「开头」命中（题号必须位于题首） */
function matchAtStart(sample: string, pattern: string): string | null {
  const m = sample.replace(/^\s+/, '').match(buildRegex(pattern))
  return m && m.index === 0 ? m[0] : null
}

/** 统计某选项模式在样例中命中的选项字母序列 */
function matchOptionKeys(sample: string, pattern: string): string[] {
  const re = new RegExp(buildRegex(pattern).source, 'g')
  const keys: string[] = []
  for (const m of sample.matchAll(re)) {
    const k = (m[0].match(/[A-Ea-e]/)?.[0] ?? '').toUpperCase()
    if (k) keys.push(k)
  }
  return keys
}

/**
 * 从一段样例题目自动推导识别规则
 *
 * 思路：用一组「候选模式」逐一测试样例，取首个命中的。
 * 比纯文本解析更可靠——候选集合覆盖了常见写法，命中即确定。
 * 推导失败的项目保留 base（默认规则）中的对应配置作为兜底。
 */
export function inferRule(
  sample: string,
  base: ParseRule = DEFAULT_RULE,
): { rule: ParseRule; report: InferenceReport } {
  const text = String(sample ?? '')
  const rule: ParseRule = { ...base }
  const report: InferenceReport = {
    question: { ok: false, sample: '', pattern: '' },
    option: { ok: false, keys: [], pattern: '' },
    answer: { ok: false, sample: '', pattern: '' },
    analysis: false,
    point: false,
  }

  // ① 题号：取首个在开头命中的候选，并与默认通用题号合并（推导的排最前，优先匹配）
  const inferredQ = Q_CANDIDATES.map((c) => ({ c, hit: matchAtStart(text, c) })).find((x) => x.hit)
  if (inferredQ?.hit) {
    report.question = { ok: true, sample: inferredQ.hit, pattern: inferredQ.c }
    const defaults = String(base.questionPattern)
      .split(/[;；]/)
      .map((s) => s.trim())
      .filter(Boolean)
    rule.questionPattern = [
      inferredQ.c,
      ...defaults.filter((d) => d !== inferredQ.c),
    ]
      .slice(0, 6)
      .join(' ; ')
  }

  // ② 选项：需要命中 ≥2 个且从 A 开始（说明是真正的选项序列）
  const inferredO = O_CANDIDATES.map((c) => ({ c, keys: matchOptionKeys(text, c) })).find(
    (x) => x.keys.length >= 2 && x.keys[0] === 'A',
  )
  if (inferredO) {
    report.option = { ok: true, keys: inferredO.keys, pattern: inferredO.c }
    rule.optionPattern = inferredO.c
  }

  // ③ 答案
  for (const cand of A_CANDIDATES) {
    const m = text.match(buildRegex(cand))
    if (m) {
      report.answer = { ok: true, sample: m[0], pattern: cand }
      rule.answerPattern = cand
      break
    }
  }

  // ④ 解析 / 考点标记（默认关键词已覆盖常见写法，这里只做存在性检测）
  report.analysis = splitKeywords(rule.analysisKeywords).some((k) => text.includes(k))
  report.point = splitKeywords(rule.metaKeywords).some((k) => text.includes(k))

  return { rule, report }
}

/* ---------- 持久化 ---------- */

const LS_RULE = 'jingshi.parse_rule'

export function loadRule(): ParseRule {
  try {
    const raw = localStorage.getItem(LS_RULE)
    if (raw) return { ...DEFAULT_RULE, ...(JSON.parse(raw) as Partial<ParseRule>) }
  } catch {
    /* 忽略损坏数据 */
  }
  return DEFAULT_RULE
}

export function saveRule(rule: ParseRule): void {
  localStorage.setItem(LS_RULE, JSON.stringify(rule))
}
