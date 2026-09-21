/**
 * Excel 表头模板解析验证（Node 直接运行）
 * 运行：node scripts/test-table.mjs
 * ⚠️ 本脚本是 importService.parseTable 的 JS 副本，改动后需同步。
 */

const COLUMN_ALIASES = [
  { field: 'stem', keys: ['题干', '题目', '试题', '问题'] },
  { field: 'a', keys: ['选项a', 'a选项', 'a'] },
  { field: 'b', keys: ['选项b', 'b选项', 'b'] },
  { field: 'c', keys: ['选项c', 'c选项', 'c'] },
  { field: 'd', keys: ['选项d', 'd选项', 'd'] },
  { field: 'e', keys: ['选项e', 'e选项', 'e'] },
  { field: 'options', keys: ['选项', '选项内容', '备选项'] },
  { field: 'answer', keys: ['答案', '正确答案', '参考答案'] },
  { field: 'analysis', keys: ['解析', '答案解析', '试题解析', '详解'] },
  { field: 'point', keys: ['考点', '考查点', '知识点'] },
]

const normHeader = (h) =>
  String(h ?? '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[（）()]/g, '')
    .toLowerCase()

function mapColumns(headers) {
  const map = {}
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

function splitOptions(blob) {
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

function parseTable(table) {
  const col = mapColumns(table.headers)
  const mapped = {}
  Object.entries(col).forEach(([f, i]) => {
    mapped[f] = table.headers[i] ?? ''
  })
  const usedIdx = new Set(Object.values(col))
  const unmapped = table.headers.filter((h, i) => h && !usedIdx.has(i))

  const result = { questions: [], issues: [], mapped, unmapped }
  if (col.stem == null) return result

  const hasSeparateOptions = ['a', 'b', 'c', 'd', 'e'].some((k) => col[k] != null)

  table.rows.forEach((row, i) => {
    const rowNo = i + 2
    const stem = (row[col.stem] ?? '').trim()

    if (!stem) {
      result.issues.push({ row: rowNo, issues: ['题干为空，该行已跳过'], stem: '（空行）' })
      return
    }

    let options = []
    if (hasSeparateOptions) {
      options = ['a', 'b', 'c', 'd', 'e']
        .filter((k) => col[k] != null)
        .map((k) => ({ key: k.toUpperCase(), content: (row[col[k]] ?? '').trim() }))
        .filter((o) => o.content)
    } else if (col.options != null) {
      options = splitOptions(row[col.options] ?? '')
    }

    const answerRaw = col.answer != null ? (row[col.answer] ?? '') : ''
    const answer = (answerRaw.match(/[A-Ea-e]/g) ?? []).map((x) => x.toUpperCase())

    const issues = []
    if (stem.length < 4) issues.push('题干过短，可能不是完整题目')
    if (!options.length) issues.push('没有识别到选项，请检查表头或选项内容')
    else if (options.length < 4) issues.push(`只有 ${options.length} 个选项（选择题通常 4 个）`)
    if (!answer.length) issues.push('缺少答案')
    if (answer.length && options.length) {
      const keys = new Set(options.map((o) => o.key))
      const bad = answer.filter((a) => !keys.has(a))
      if (bad.length) issues.push(`答案 ${bad.join('、')} 不在选项中`)
    }
    if (issues.length) result.issues.push({ row: rowNo, issues, stem: stem.slice(0, 30) })

    if (stem.length < 4) return

    const analysis = col.analysis != null ? (row[col.analysis] ?? '').trim() : ''
    const point = col.point != null ? (row[col.point] ?? '').trim() : ''

    result.questions.push({
      stem,
      options,
      answer,
      analysis: analysis || undefined,
      point: point || undefined,
      confidence: issues.length ? 0.7 : 0.99,
    })
  })

  return result
}

/* ---------- 用例 ---------- */

// ① 标准表头（分列选项）
const t1 = {
  headers: ['题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析', '考点'],
  rows: [
    ['在资源配置中起决定性作用的是？', '国家计划', '财政政策', '市场机制', '行政指令', 'C', '市场决定资源配置', '资源配置方式'],
    ['属于紧缩性财政政策的是？', '降低税率', '增加政府购买', '减少政府购买', '增加补贴', 'C', '', '财政政策'],
  ],
}

// ② 别名表头
const t2 = {
  headers: ['题目', 'A', 'B', 'C', 'D', '正确答案', '答案解析', '知识点'],
  rows: [['需求价格弹性反映什么？', '反应程度', '方向一致', '以上都对', '以上都不对', 'A', '弹性反映敏感程度', '需求价格弹性']],
}

// ③ 非模板表 → questions 为空（交回文本切题）
const t3 = {
  headers: ['序号', '备注', '分值'],
  rows: [['1', '第一章', '2']],
}

// ④ 多选题 AB
const t4 = {
  headers: ['题干', '选项A', '选项B', '选项C', '选项D', '答案'],
  rows: [['下列属于扩张性财政政策的有？', '降税', '增购', '减购', '减补贴', 'AB']],
}

// ⑤ 选项挤在一列（常见 Excel 写法）
const t5 = {
  headers: ['题干', '选项', '答案', '解析'],
  rows: [
    ['关于通货膨胀，下列说法正确的是？', 'A.物价下降 B.物价上涨 C.无关 D.仅衰退期', 'B', '通胀指物价持续上涨'],
  ],
}

// ⑥ 校验报告：缺答案 / 选项不足 / 答案越界 / 空题干
const t6 = {
  headers: ['题干', '选项A', '选项B', '选项C', '选项D', '答案', '备注列'],
  rows: [
    ['正常的一道题？', '甲', '乙', '丙', '丁', 'A', 'x'],
    ['答案越界的题？', '甲', '乙', '丙', '丁', 'E', 'x'],
    ['缺少答案的题？', '甲', '乙', '丙', '丁', '', 'x'],
    ['选项不足的题？', '甲', '乙', '', '', 'A', 'x'],
    ['', '甲', '乙', '丙', '丁', 'A', 'x'],
  ],
}

/* ---------- 断言 ---------- */
let failed = 0
const check = (name, actual, expect) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expect)
  if (!ok) failed++
  console.log(`${ok ? '✅' : '❌'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (期望 ${JSON.stringify(expect)})`}`)
}

const r1 = parseTable(t1)
check('① 标准表头：题数', r1.questions.length, 2)
check('① 选项数', r1.questions[0].options.length, 4)
check('① 答案', r1.questions[0].answer, ['C'])
check('① 解析带入', r1.questions[0].analysis, '市场决定资源配置')
check('① 考点带入', r1.questions[0].point, '资源配置方式')
check('① 置信度（无问题）', r1.questions[0].confidence, 0.99)
check('① 无问题行', r1.issues.length, 0)

const r2 = parseTable(t2)
check('② 别名表头：题数', r2.questions.length, 1)
check('② 答案（正确答案列）', r2.questions[0].answer, ['A'])
check('② 考点（知识点列）', r2.questions[0].point, '需求价格弹性')

const r3 = parseTable(t3)
check('③ 非模板表：题数为 0', r3.questions.length, 0)

const r4 = parseTable(t4)
check('④ 多选 AB', r4.questions[0].answer, ['A', 'B'])

const r5 = parseTable(t5)
check('⑤ 合并选项列：题数', r5.questions.length, 1)
check('⑤ 合并选项列：拆出 4 个选项', r5.questions[0].options.length, 4)
check('⑤ 选项内容正确', r5.questions[0].options[1].content, '物价上涨')
check('⑤ 选项键正确', r5.questions[0].options.map((o) => o.key), ['A', 'B', 'C', 'D'])
check('⑤ 无问题行', r5.issues.length, 0)

const r6 = parseTable(t6)
check('⑥ 校验：正常行入库（4 行有题干）', r6.questions.length, 4)
check('⑥ 校验：问题行数（越界/缺答案/选项不足/空题干）', r6.issues.length, 4)
check(
  '⑥ 校验：问题描述',
  r6.issues.map((i) => i.issues[0]),
  ['答案 E 不在选项中', '缺少答案', '只有 2 个选项（选择题通常 4 个）', '题干为空，该行已跳过'],
)
check('⑥ 校验：行号正确（含表头偏移）', r6.issues.map((i) => i.row), [3, 4, 5, 6])
check('⑥ 表头映射', r6.mapped.stem, '题干')
check('⑥ 未识别列被列出', r6.unmapped, ['备注列'])

console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项未通过`}`)
process.exit(failed === 0 ? 0 : 1)
