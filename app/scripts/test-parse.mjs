/**
 * 解析规则验证脚本（Node 直接运行）
 * 运行：node scripts/test-parse.mjs
 * ⚠️ 本脚本是 domain/services 解析逻辑的 JS 副本，改动后需同步。
 */

/* ---------- 占位符 → 正则（无 ^，支持全局） ---------- */
const T = { n: '\u0001', c: '\u0002', t: '\u0003', L: '\u0004', a: '\u0005', d: '\u0006', o: '\u0007' }
const CN_NUM = '[一二三四五六七八九十百千零〇两]+'
const TYPE_TAG = '(?:[【\\[][^】\\]]+[】\\]])?'

function buildRegex(pattern) {
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
    .replace(new RegExp(T.L, 'g'), '([A-Ea-e])')
    .replace(new RegExp(T.a, 'g'), '([A-Ea-e]+)')
    .replace(new RegExp(T.d, 'g'), '[.、．,，:：]')
    .replace(new RegExp(T.o, 'g'), '[：:.、．,，\\s]*')
  return new RegExp(src)
}

function buildRegexes(pattern) {
  return String(pattern ?? '')
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(buildRegex)
}

/* ---------- 默认「全能」规则 ---------- */
const RULE = {
  questionPattern: '{n}{d} ; ({n}) ; {n}) ; 第{c}题 ; 第{n}题 ; {t}第{c}题 ; {t}第{n}题',
  optionPattern: '{L}{d} ; ({L}) ; {L})',
  answerPattern: '答案{o}{a} ; 正确答案{o}{a} ; 参考答案{o}{a} ; 【答案】{o}{a}',
  analysisKeywords: '解析,【解析】,详解',
  metaKeywords: '考点,出处,来源',
  startAfter: '',
  endBefore: '',
  denoise: true,
}
const R = {
  questions: buildRegexes(RULE.questionPattern),
  options: buildRegexes(RULE.optionPattern),
  answers: buildRegexes(RULE.answerPattern),
  analysis: RULE.analysisKeywords.split(','),
  meta: RULE.metaKeywords.split(','),
  startAfter: RULE.startAfter,
  endBefore: RULE.endBefore,
}

function buildCombined(regexes) {
  return new RegExp('(' + regexes.map((re) => re.source).join('|') + ')', 'g')
}

/* ---------- 去噪 ---------- */
function denoise(raw) {
  const lines = raw.split(/\r?\n/).map((l) => l.trim())
  const freq = new Map()
  lines.forEach((l) => {
    if (l.length > 0 && l.length <= 25) freq.set(l, (freq.get(l) ?? 0) + 1)
  })
  return lines
    .filter((l) => {
      if (!l) return false
      if (/^\d{1,4}$/.test(l)) return false
      if (/^[-—]\s*\d{1,4}\s*[-—]$/.test(l)) return false
      if (/^第\s*\d{1,4}\s*页?$/.test(l)) return false
      if (/^[一二三四五六七八九十]+[、．]\s*\S{2,12}$/.test(l)) return false
      if (l.length <= 25 && (freq.get(l) ?? 0) >= 3) return false
      return true
    })
    .map((l) => l.replace(/([.。、,，;；])\1{2,}/g, '$1'))
    .join('\n')
}

/* ---------- 段落标记 ---------- */
function classifyMeta(kw) {
  return /考点|考察|知识点|重点|涉及/.test(kw) ? 'point' : 'source'
}
function findSectionMarks(text) {
  const marks = []
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
    .filter((m, i, arr) => (i === 0 ? true : m.index >= arr[i - 1].index + arr[i - 1].kw.length + 2))
}

/* ---------- 切题（标记位置驱动） ---------- */
function parseText(raw) {
  const text = RULE.denoise ? denoise(raw) : raw
  const combined = buildCombined(R.questions)
  const blocks = []
  const matches = [...text.matchAll(combined)]
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const s = (m.index ?? 0) + m[0].length
    const e = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length
    const body = text.slice(s, e).trim()
    if (body) blocks.push(body)
  }

  const out = []
  blocks.forEach((body) => {
    const q = { stem: '', options: [], answer: [] }
    const marks = []

    const optCombined = buildCombined(R.options)
    for (const m of body.matchAll(optCombined)) {
      const key = (m[0].match(/[A-Ea-e]/)?.[0] ?? '').toUpperCase()
      marks.push({ index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind: 'option', key })
    }

    const ansCombined = buildCombined(R.answers)
    const am = [...body.matchAll(ansCombined)][0]
    if (am) {
      const amIndex = am.index ?? 0
      let s = amIndex
      if (s >= 2 && body.slice(s - 2, s) === '参考') s -= 2
      marks.push({ index: s, end: amIndex + am[0].length, kind: 'answer' })
      const letters = am[0].match(/[A-Ea-e]+/)
      if (letters) q.answer = letters[0].toUpperCase().split('')
    }

    for (const sec of findSectionMarks(body)) {
      marks.push({ index: sec.index, end: sec.index + sec.kw.length, kind: 'section', type: sec.type })
    }

    marks.sort((a, b) => a.index - b.index)
    q.stem = marks[0] ? body.slice(0, marks[0].index).trim() : body.trim()

    for (let i = 0; i < marks.length; i++) {
      const m = marks[i]
      if (m.kind !== 'option') continue
      const next = marks[i + 1]
      q.options.push({ key: m.key, content: body.slice(m.end, next ? next.index : body.length).trim() })
    }

    for (let i = 0; i < marks.length; i++) {
      const m = marks[i]
      if (m.kind !== 'section') continue
      const next = marks[i + 1]
      const c = body.slice(m.end, next ? next.index : body.length).replace(/^[：:\s]+/, '').trim()
      if (c) q[m.type] = ((q[m.type] ?? '') + ' ' + c).trim()
    }

    if (q.stem.length >= 4) out.push(q)
  })
  return out
}

/* ---------- 样本：混合题号 + 混合答案格式 + 整行/多行混合 ---------- */
const SAMPLE = `2026年中级经济师《经济基础知识》精选题库

1. 下列关于需求价格弹性的说法，正确的是（）。
A.反映需求量对价格变动的反应程度
B.与需求变动方向一致
C.以上都对
D.以上都不对
参考答案C
解析：本题考查需求价格弹性。

【单选题】第2题 关于财政政策，下列说法正确的是（）。A.降低税率 B.增加政府购买 C.减少政府购买 D.增加补贴 答案：A 解析本题考查财政政策工具。考点财政政策

第三题 关于劳动合同，下列说法正确的是（）。
A.用人单位可随时解除
B.需符合法定情形
C.无需经济补偿
D.仅适用试用期
【答案】B
解析本题考查劳动合同。

(4) 关于通货膨胀，下列说法正确的是（）。A.物价下降 B.物价上涨 C.无关 D.仅衰退期 正确答案D 解析通货膨胀指物价持续上涨。考点通货膨胀
`

const result = parseText(SAMPLE)
let failed = 0
function check(name, actual, expect) {
  const ok = JSON.stringify(actual) === JSON.stringify(expect)
  if (!ok) failed++
  console.log(`${ok ? '✅' : '❌'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (期望 ${JSON.stringify(expect)})`}`)
}

console.log(`解析结果：${result.length} 题\n`)
check('切题数量（混合题号）', result.length, 4)
check('题1答案（参考答案C）', result[0]?.answer, ['C'])
check('题2答案（答案：A）', result[1]?.answer, ['A'])
check('题3答案（【答案】B）', result[2]?.answer, ['B'])
check('题4答案（正确答案D）', result[3]?.answer, ['D'])
check('每题选项数', result.map((q) => q.options.length), [4, 4, 4, 4])
check('选项不含解析', result.every((q) => q.options.every((o) => !o.content.includes('本题'))), true)
check('选项不含答案标记', result.every((q) => q.options.every((o) => !o.content.includes('答案'))), true)
check('解析已提取', result.every((q) => !!q.analysis), true)
check('标题未被识别', result.some((q) => q.stem.includes('精选题库')), false)

result.forEach((q, i) => {
  console.log(`\n第 ${i + 1} 题：${q.stem.slice(0, 36)}`)
  console.log(`  选项：${q.options.map((o) => o.key).join(' ')} | 答案：${q.answer.join('')}`)
  if (q.point) console.log(`  考点：${q.point}`)
  if (q.analysis) console.log(`  解析：${q.analysis.slice(0, 36)}…`)
})

console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项未通过`}`)
process.exit(failed === 0 ? 0 : 1)
