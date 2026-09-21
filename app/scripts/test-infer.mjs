/**
 * 样例推导验证脚本（Node 直接运行）
 * 运行：node scripts/test-infer.mjs
 *
 * ⚠️ 本脚本是 parseRule.inferRule 的 JS 副本，改动后需同步。
 */

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

const Q_CANDIDATES = [
  '{t}第{n}题', '{t}第{c}题', '第{n}题', '第{c}题',
  '({n})', '（{n}）',
  '{n})', '{n}）', '{n}、', '{n}.',
  '{t}{n}.', '{t}{n}、',
  '{n}{d}', '{t}{n}{d}',
]
const O_CANDIDATES = ['({L})', '（{L}）', '{L}{d}', '{L}、', '{L}.', '{L})']
const A_CANDIDATES = ['【答案】{o}{a}', '参考答案{o}{a}', '正确答案{o}{a}', '答案{o}{a}', '答案{d}{a}']

function matchAtStart(sample, pattern) {
  const m = sample.replace(/^\s+/, '').match(buildRegex(pattern))
  return m && m.index === 0 ? m[0] : null
}

function matchOptionKeys(sample, pattern) {
  const re = new RegExp(buildRegex(pattern).source, 'g')
  const keys = []
  for (const m of sample.matchAll(re)) {
    const k = (m[0].match(/[A-Ea-e]/)?.[0] ?? '').toUpperCase()
    if (k) keys.push(k)
  }
  return keys
}

function inferRule(sample) {
  const text = String(sample ?? '')
  const report = {
    question: { ok: false, sample: '', pattern: '' },
    option: { ok: false, keys: [], pattern: '' },
    answer: { ok: false, sample: '', pattern: '' },
  }

  const q = Q_CANDIDATES.map((c) => ({ c, hit: matchAtStart(text, c) })).find((x) => x.hit)
  if (q?.hit) report.question = { ok: true, sample: q.hit, pattern: q.c }

  const o = O_CANDIDATES.map((c) => ({ c, keys: matchOptionKeys(text, c) })).find(
    (x) => x.keys.length >= 2 && x.keys[0] === 'A',
  )
  if (o) report.option = { ok: true, keys: o.keys, pattern: o.c }

  for (const cand of A_CANDIDATES) {
    const m = text.match(buildRegex(cand))
    if (m) {
      report.answer = { ok: true, sample: m[0], pattern: cand }
      break
    }
  }
  return report
}

/* ---------- 用例 ---------- */
const CASES = [
  {
    name: '带题型标记 + 阿拉伯题号（用户实际文档）',
    text: '【单选题】第1题 在我国的资源配置中发挥决定性作用的是（）。A.国家计划 B.财政政策 C.市场机制 D.行政指令 参考答案C 解析社会主义市场经济…',
    expect: { q: '{t}第{n}题', o: '{L}{d}', a: '参考答案{o}{a}' },
  },
  {
    name: '纯数字点号 + 答案冒号',
    text: '1. 下列关于需求价格弹性的说法，正确的是（　）。\nA.反映反应程度\nB.方向一致\nC.以上都对\nD.以上都不对\n答案：A',
    expect: { q: '{n}.', o: '{L}{d}', a: '答案{o}{a}' },
  },
  {
    name: '全角括号题号 + 顿号选项 + 括号答案',
    text: '（1）关于劳动合同解除，下列说法正确的是（　）。A、可随时解除 B、需符合法定情形 C、无需补偿 D、仅试用期 【答案】B',
    expect: { q: '（{n}）', o: '{L}{d}', a: '【答案】{o}{a}' },
  },
  {
    name: '中文题号「第X题」',
    text: '第一题 关于通货膨胀，下列说法正确的是（　）。A.物价下降 B.物价上涨 C.无关 D.仅衰退期 答案 B',
    // {t} 是「可选题型标记」：推导出带 {t} 的写法可同时兼容「第一题」与「【单选题】第一题」，更通用
    expect: { q: '{t}第{c}题', o: '{L}{d}', a: '答案{o}{a}' },
  },
  {
    name: '数字+顿号题号',
    text: '1、关于财政政策，下列说法正确的是（　）。A.降税 B.增购 C.减购 D.补贴 答案：C',
    expect: { q: '{n}、', o: '{L}{d}', a: '答案{o}{a}' },
  },
  {
    name: '半角括号题号',
    text: '(1) 关于资源配置，下列说法正确的是（　）。A.计划 B.市场 C.财政 D.行政 答案：B',
    expect: { q: '({n})', o: '{L}{d}', a: '答案{o}{a}' },
  },
]

let failed = 0
CASES.forEach((c) => {
  const r = inferRule(c.text)
  const ok = r.question.pattern === c.expect.q && r.option.pattern === c.expect.o && r.answer.pattern === c.expect.a
  if (!ok) failed++
  console.log(`${ok ? '✅' : '❌'} ${c.name}`)
  console.log(
    `   题号 ${r.question.pattern || '未识别'}${r.question.pattern === c.expect.q ? '' : `（期望 ${c.expect.q}）`}`,
  )
  console.log(
    `   选项 ${r.option.pattern || '未识别'}${r.option.pattern === c.expect.o ? '' : `（期望 ${c.expect.o}）`}  命中 ${r.option.keys.join('')}`,
  )
  console.log(
    `   答案 ${r.answer.pattern || '未识别'}${r.answer.pattern === c.expect.a ? '' : `（期望 ${c.expect.a}）`}  命中 "${r.answer.sample}"`,
  )
})

console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项未通过`}`)
process.exit(failed === 0 ? 0 : 1)
