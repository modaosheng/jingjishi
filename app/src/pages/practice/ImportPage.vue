<script setup lang="ts">
/**
 * 题库导入
 *
 * 三个入口（粘贴文本 / 上传文件 / AI 生成）各自独立页面，但共用：
 *   - 同一套识别规则（localStorage 持久化）
 *   - 同一套预览确认流程（PRD M7-F3：绝不静默入库）
 *   - 同一套归类逻辑（关键词匹配）
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getDataSource } from '@/infrastructure'
import { detectKind, extractFileText, SUPPORTED_HINT } from '@/infrastructure/fileParse'
import { readSheetTable, downloadTemplate } from '@/infrastructure/fileParse/xlsx'
import { SUBJECT_META, useSubjectStore } from '@/stores/subject'
import { getServices } from '@/services'
import RuleConfigPanel from '@/components/practice/RuleConfigPanel.vue'
import {
  classifyQuestion,
  CONFIDENCE_LABEL,
  confidenceLevel,
  parseTable,
  parseText,
  summarize,
  type ParsedQuestion,
  type TableParseResult,
} from '@/domain/services/importService'
import { buildSample, loadRule, saveRule, type ParseRule } from '@/domain/services/parseRule'
import type { Question, QuestionSet, QuestionSetCategory, SubjectId } from '@/domain/entities'

const route = useRoute()
const router = useRouter()
const subjectStore = useSubjectStore()

/** 入口模式：undefined = 首屏三选一 */
const mode = computed(() => route.params.mode as 'text' | 'file' | 'ai' | undefined)

/** 共用的识别规则 */
const rule = ref<ParseRule>(loadRule())
const showRule = ref(false)

type Stage = 'input' | 'preview' | 'done'
const stage = ref<Stage>('input')
const parsed = ref<ParsedQuestion[]>([])
const filter = ref<'all' | 'medium' | 'low'>('all')
const importedCount = ref(0)
/** 因重复被跳过的题数 */
const skippedCount = ref(0)

// 文本模式
const rawText = ref('')
// 文件模式
const fileInput = ref<HTMLInputElement>()
const parsing = ref(false)
const parseProgress = ref<{ status: string; progress: number } | null>(null)
/** 上传的原始文件名（预览阶段展示来源） */
const sourceFile = ref('')

/* ---------- 题集信息（导入时填写，决定题目归属与能否用于模考） ---------- */

const setName = ref('')
const setCategory = ref<QuestionSetCategory>('custom')
/** 往年真题年份 */
const setYear = ref(String(new Date().getFullYear() - 1))

const CATEGORIES: Array<{ key: QuestionSetCategory; label: string; hint: string }> = [
  { key: 'custom', label: '自建题目', hint: '默认。在「我的题库」里练习' },
  { key: 'past_exam', label: '往年真题', hint: '带年份，可在模考中单独组卷' },
  { key: 'mock', label: '模拟题', hint: '模拟试卷，可在模考中组卷' },
  { key: 'chapter', label: '章节整理', hint: '按章节整理的题目' },
]

const categoryHint = computed(
  () => CATEGORIES.find((c) => c.key === setCategory.value)?.hint ?? '',
)
/** 文件提取出的原始文本（供「AI 智能解析」兜底） */
const extractedText = ref('')
/** Excel 表头模板的解析报告（表头映射 + 逐行问题） */
const tableReport = ref<TableParseResult | null>(null)
/** 校验报告展开状态 */
const showReport = ref(false)

/** 字段 → 中文名（报告里展示"某列被当成什么"） */
const FIELD_LABEL: Record<string, string> = {
  stem: '题干',
  a: '选项A',
  b: '选项B',
  c: '选项C',
  d: '选项D',
  e: '选项E',
  options: '选项（合并列）',
  answer: '答案',
  analysis: '解析',
  point: '考点',
}

/** 导出问题清单为 CSV（带 BOM，Excel 打开不乱码），便于对照原始表格修正 */
function exportIssues() {
  const r = tableReport.value
  if (!r?.issues.length) return
  const rows = [
    ['行号', '问题', '题干预览'],
    ...r.issues.map((i) => [String(i.row), i.issues.join('；'), i.stem]),
  ]
  const csv = rows
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '导入问题清单.csv'
  a.click()
  URL.revokeObjectURL(url)
}
// AI 模式
const aiTopic = ref('')

const EXAMPLE = `1. 下列关于需求价格弹性的说法，正确的是（　）。
A. 反映需求量对价格变动的反应程度
B. 与需求量的变动方向一致
C. 以上都对
D. 以上都不对
答案：A
解析：本题考查需求价格弹性。A 项正确，弹性反映需求量对价格变动的敏感程度。
考点：需求价格弹性

2. 下列属于紧缩性财政政策的是（　）。
A. 降低税率
B. 增加政府购买
C. 减少政府购买
D. 增加财政补贴
答案：C
解析：减少政府购买会抑制总需求，属于紧缩性财政政策。
考点：财政政策工具`

/** 模板示例：功能页只读展示，避免与首屏重复配置规则 */
const sample = computed(() => buildSample(rule.value))

const summary = computed(() => summarize(parsed.value))
/** 与「我的题库」重复的题数（导入时会自动跳过） */
const dupCount = computed(() => parsed.value.filter((p) => p.duplicated).length)
const list = computed(() => {
  if (filter.value === 'all') return parsed.value
  return parsed.value.filter((q) => confidenceLevel(q.confidence) === filter.value)
})

function go(m: string) {
  router.push(`/practice/import/${m}`)
}

/**
 * 返回：子流程页 → 导入首屏；首屏 → 题库页
 * 不用 router.back()，避免依赖历史栈导致在导入页与 AI 页之间来回跳
 */
function goBack() {
  if (mode.value) router.push('/practice/import')
  else router.push('/practice')
}

function pickFile() {
  fileInput.value?.click()
}

function fillExample() {
  rawText.value = EXAMPLE
}

/* ---------- 三个入口各自的解析 ---------- */

async function analyzeText() {
  const result = parseText(rawText.value, subjectStore.current, rule.value)
  if (!result.length) {
    alert('没有识别出题目。请展开「识别规则」，确认题号格式与你的文档一致。')
    return
  }
  await classifyAll(result)
  parsed.value = result
  stage.value = 'preview'
  filter.value = 'all'
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  parsing.value = true
  sourceFile.value = file.name
  parseProgress.value = { status: '解析中…', progress: 0 }
  try {
    // ① Excel / CSV：优先尝试「表头模板」结构化导入（零识别误差）
    if (detectKind(file) === 'xlsx') {
      try {
        const table = await readSheetTable(file)
        const res = table ? parseTable(table, subjectStore.current) : null
        if (res?.questions.length) {
          await classifyAll(res.questions)
          parsed.value = res.questions
          tableReport.value = res
          stage.value = 'preview'
          filter.value = 'all'
          return
        }
      } catch {
        /* 不是模板表 → 继续走文本切题 */
      }
    }

    // ② 其余：提取文本 → 规则切题
    const { text, usedOcr } = await extractFileText(file, (p) => (parseProgress.value = p))
    if (!text.trim()) throw new Error('未能提取到文字内容')
    extractedText.value = text

    const result = parseText(text, subjectStore.current, rule.value)
    if (!result.length) {
      const preview = text
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .slice(0, 3)
        .join('｜')
      const hasAi = getServices().ai.available
      alert(
        `已提取 ${text.length} 字${usedOcr ? '（已完成图文识别）' : ''}，但规则没能切出题目。\n\n` +
          (hasAi
            ? '建议点下方「AI 智能解析」，由 AI 按语义切题。'
            : '两个办法：\n· 用「AI 智能解析」（需先在 AI 私教页配置 Key）\n· 或在「识别规则」里调整题号格式') +
          `\n\n文档开头预览：${preview.slice(0, 80) || '（空）'}`,
      )
      return
    }
    await classifyAll(result)
    parsed.value = result
    stage.value = 'preview'
    filter.value = 'all'
  } catch (err) {
    alert(err instanceof Error ? err.message : '文件解析失败')
  } finally {
    parsing.value = false
    parseProgress.value = null
  }
}

/**
 * AI 智能解析：把整段文本交给 AI 按语义切题
 * 规则解析靠模式匹配，遇到格式混乱的 OCR 结果会失效；AI 靠语义理解，能兜住这些情况。
 */
async function smartParse() {
  const src = mode.value === 'text' ? rawText.value : extractedText.value
  if (!src.trim()) {
    alert('请先粘贴题目文本，或上传文件完成文字提取')
    return
  }
  const ai = getServices().ai
  if (!ai.available) {
    alert(
      'AI 智能解析需要 API Key（BYOK，仅存本机、不上传）。\n\n' +
        '请到「AI 私教」页 → 右上「设置」→ 填入你的 Key，再回来重试。',
    )
    return
  }

  parsing.value = true
  parseProgress.value = { status: 'AI 正在按语义解析题目…', progress: 0.6 }
  try {
    const questions = await ai.parseQuestions(src, subjectStore.current)
    const result: ParsedQuestion[] = questions.map((q) => ({
      key: q.id,
      stem: q.stem,
      options: q.options,
      answer: q.answer,
      confidence: 0.9,
      warnings: ['AI 解析，建议核对'],
      subjectId: q.subjectId,
      analysis: q.explanation?.analysis,
      point: q.explanation?.keyPoint,
    }))
    await classifyAll(result)
    parsed.value = result
    stage.value = 'preview'
    filter.value = 'all'
  } catch (err) {
    alert(err instanceof Error ? err.message : 'AI 解析失败')
  } finally {
    parsing.value = false
    parseProgress.value = null
  }
}

async function generateByAI() {
  if (!aiTopic.value.trim()) {
    alert('请输入要练习的考点或资料内容')
    return
  }
  parsing.value = true
  parseProgress.value = { status: 'AI 生成中…', progress: 0 }
  try {
    const questions = await getServices().ai.generateQuestions({
      subjectId: subjectStore.current,
      material: aiTopic.value,
      count: 10,
      types: ['single'],
    })
    if (!questions.length) throw new Error('AI 未生成题目，请调整描述后重试')

    // 转成预览结构，复用同一套确认流程
    const result: ParsedQuestion[] = questions.map((q, i) => ({
      key: `ai_${Date.now()}_${i}`,
      stem: q.stem,
      options: q.options,
      answer: q.answer,
      confidence: q.aiMetadata?.confidence ?? 0.85,
      warnings: q.aiMetadata?.verified ? [] : ['AI 生成，建议人工核对'],
      subjectId: q.subjectId,
      classifiedSubjectId: q.subjectId,
      point: q.explanation?.keyPoint,
      analysis: q.explanation?.analysis,
    }))
    await classifyAll(result)
    parsed.value = result
    stage.value = 'preview'
    filter.value = 'all'
  } catch (err) {
    alert(err instanceof Error ? err.message : 'AI 生成失败')
  } finally {
    parsing.value = false
    parseProgress.value = null
  }
}

/** 试解析：用当前规则验证（不入库） */
function tryParse() {
  if (!rawText.value.trim()) {
    alert('请先粘贴一段样本题目再试解析')
    return
  }
  const result = parseText(rawText.value, subjectStore.current, rule.value)
  saveRule(rule.value)
  alert(
    result.length
      ? `试解析成功：识别到 ${result.length} 题。点「开始识别」查看完整预览。`
      : '未识别出题目，请调整「题号长什么样」，例如改成 ({n}) 或 第{n}题',
  )
}

/* ---------- 共用：归类 / 入库 ---------- */

/** 题干归一化：去掉空白与常见标点，用于判重 */
function normalizeStem(s: string): string {
  return s
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：？！（）()【】[\]．.·,;:?!'"“”‘’]+/g, '')
    .toLowerCase()
}

async function classifyAll(list: ParsedQuestion[]) {
  const ds = getDataSource()
  const tree = [
    ...(await ds.knowledge.getTree('econ_base')),
    ...(await ds.knowledge.getTree('hr')),
  ]
  list.forEach((q) => {
    const r = classifyQuestion(q.stem, q.options.map((o) => o.content), tree)
    q.classifiedSubjectId = r.subjectId ?? undefined
    q.classifiedNodeId = r.nodeId ?? undefined
    q.classifiedNodeName = r.nodeName ?? undefined
    q.classifyConfidence = r.confidence
    q.classifyMatchedBy = r.matchedBy
  })

  // 判重：与「我的题库」已有题目比对题干，重复的在预览中标记出来
  const existing = await ds.questions.query({ ownerTypes: ['user', 'ai'] })
  const set = new Set(existing.map((q) => normalizeStem(q.stem)))
  list.forEach((p) => {
    p.duplicated = set.has(normalizeStem(p.stem))
  })
}

function remove(key: string) {
  parsed.value = parsed.value.filter((q) => q.key !== key)
  if (!parsed.value.length) stage.value = 'input'
}

function toggleAnswer(q: ParsedQuestion, key: string) {
  const i = q.answer.indexOf(key)
  if (i >= 0) q.answer.splice(i, 1)
  else q.answer.push(key)
}

function toQuestion(p: ParsedQuestion, i: number, batchTs = Date.now()): Question {
  const subjectId = p.classifiedSubjectId ?? subjectStore.current
  return {
    id: `user_${batchTs}_${i}`,
    subjectId,
    type: p.answer.length > 1 ? 'multi' : 'single',
    stem: p.stem,
    options: p.options,
    answer: p.answer,
    difficulty: 3,
    bloomLevel: 'remember',
    knowledgeNodeIds: p.classifiedNodeId ? [p.classifiedNodeId] : [],
    explanation: {
      keyPoint: p.point || '用户自建题，暂无考点',
      perOption: [],
      trapWords: [],
      sourceRef: p.source,
      analysis: p.analysis,
    },
    sourceLevel: 'C',
    ownerType: 'user',
    contentVersion: '2026',
    status: 'active',
  }
}

async function confirmImport() {
  if (!parsed.value.length) return
  const ds = getDataSource()

  // 幂等：自动跳过与「我的题库」重复的题，避免重复入库
  const list = parsed.value.filter((p) => !p.duplicated)
  skippedCount.value = parsed.value.length - list.length

  if (!list.length) {
    alert(`这 ${parsed.value.length} 道题都已存在于「我的题库」，无需重复导入。`)
    importedCount.value = 0
    stage.value = 'done'
    return
  }

  const batchTs = Date.now() // 同一批共用一个批次号
  const questions = list.map((p, i) => toQuestion(p, i, batchTs))

  // 往年真题：给题目打上年份标记，这样「真题演练」也能筛到
  const year = setCategory.value === 'past_exam' ? Number(setYear.value) || undefined : undefined
  if (year) questions.forEach((q) => { q.examYear = year })

  // 创建题集（题库）：让这批题可命名、可分类，并在模考中单独组卷
  const set: QuestionSet = {
    id: `set_${batchTs}`,
    name: setName.value.trim() || `导入的题目 ${new Date().toLocaleDateString()}`,
    category: setCategory.value,
    year,
    subjectId: subjectStore.current,
    source: mode.value === 'ai' ? 'ai' : 'upload',
    questionCount: questions.length,
    createdAt: batchTs,
  }

  await ds.questions.save(questions)
  await ds.questionSets.save(set, questions.map((q) => q.id))

  importedCount.value = questions.length
  stage.value = 'done'
}
</script>

<template>
  <div :class="mode ? 'page--no-tab imp' : 'page imp'">
    <header class="head">
      <button class="back" @click="goBack">‹</button>
      <h1 class="h1">
        {{
          mode === 'text'
            ? '粘贴文本'
            : mode === 'file'
              ? '上传文件'
              : mode === 'ai'
                ? 'AI 生成'
                : '导入题库'
        }}
      </h1>
      <span class="subj">{{ subjectStore.shortName() }}</span>
    </header>

    <!-- 首屏：三个入口各自独立 -->
    <template v-if="!mode">
      <p class="text-caption tip">选择一种导入方式。三种方式共用同一套识别规则与确认流程。</p>

      <div class="entry" @click="go('text')">
        <span class="entry__icon">📝</span>
        <div class="entry__body">
          <div class="entry__title">粘贴文本</div>
          <div class="entry__desc">复制题目文字直接粘贴，识别最准确</div>
        </div>
        <span class="entry__go">›</span>
      </div>

      <div class="entry" @click="go('file')">
        <span class="entry__icon">📄</span>
        <div class="entry__body">
          <div class="entry__title">上传文件</div>
          <div class="entry__desc">{{ SUPPORTED_HINT }}</div>
        </div>
        <span class="entry__go">›</span>
      </div>

      <div class="entry" @click="go('ai')">
        <span class="entry__icon">✨</span>
        <div class="entry__body">
          <div class="entry__title">AI 生成</div>
          <div class="entry__desc">输入考点让 AI 出题（需先配置 API Key）</div>
        </div>
        <span class="entry__go">›</span>
      </div>

      <RuleConfigPanel :rule="rule" :open="showRule" @toggle="showRule = !showRule" />
    </template>

    <!-- 输入阶段：按模式独立渲染 -->
    <template v-else-if="stage === 'input'">
      <!-- 粘贴文本 -->
      <template v-if="mode === 'text'">
        <textarea v-model="rawText" class="area" placeholder="在此粘贴题目文本…" rows="12" />
        <div class="row">
          <button class="btn" @click="fillExample">填充示例</button>
          <button class="btn btn--primary" :disabled="!rawText.trim()" @click="analyzeText">
            开始识别
          </button>
        </div>
        <button
          class="btn btn--ai"
          :disabled="!rawText.trim() || parsing"
          @click="smartParse"
        >
          ✨ AI 智能解析（规则识别不准时用）
        </button>
      </template>

      <!-- 上传文件 -->
      <template v-else-if="mode === 'file'">
        <input
          ref="fileInput"
          type="file"
          hidden
          accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,image/*"
          @change="onFileChange"
        />
        <div class="drop" @click="pickFile">
          <div class="drop__icon">📤</div>
          <div class="drop__title">点击选择文件</div>
          <div class="drop__desc">{{ SUPPORTED_HINT }}</div>
        </div>
        <div v-if="parsing" class="card parsing">
          <div class="parsing__status">{{ parseProgress?.status ?? '解析中…' }}</div>
          <div class="bar">
            <div
              class="bar__fill"
              :style="{ width: `${Math.round((parseProgress?.progress ?? 0) * 100)}%` }"
            />
          </div>
          <div v-if="sourceFile" class="text-caption">{{ sourceFile }}</div>
        </div>
        <button
          v-if="extractedText && !parsing"
          class="btn btn--ai"
          @click="smartParse"
        >
          ✨ AI 智能解析（规则没切出来时用）
        </button>
        <!-- 分场景提示：给可执行的动作，而不是泛泛的说明 -->
        <div class="guide">
          <div class="guide__item">
            <span class="guide__icon">📊</span>
            <div class="guide__body">
              <div class="guide__title">有现成表格？用模板最准</div>
              <div class="text-caption">
                列名：题干 / 选项A~E / 答案 / 解析 / 考点。结构化导入，零识别误差。
              </div>
              <button class="guide__btn" @click="downloadTemplate">下载模板</button>
            </div>
          </div>
          <div class="guide__item">
            <span class="guide__icon">📄</span>
            <div class="guide__body">
              <div class="guide__title">扫描件 / PDF / 图片</div>
              <div class="text-caption">
                识别效果取决于原件清晰度。建议用单栏排版、含题号与答案的文件；识别不准时可一键转 AI 解析。
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- AI 生成 -->
      <template v-else>
        <p class="text-caption tip">
          描述你要练习的考点，或粘贴一段资料，AI 会据此出题。生成后同样需要逐题确认才会入库。
        </p>
        <textarea
          v-model="aiTopic"
          class="area"
          placeholder="例如：请围绕「财政政策工具」出 10 道单选题…"
          rows="8"
        />
        <div v-if="parsing" class="card parsing">
          <div class="parsing__status">{{ parseProgress?.status ?? '生成中…' }}</div>
        </div>
        <button class="btn btn--primary" :disabled="!aiTopic.trim() || parsing" @click="generateByAI">
          开始生成
        </button>
      </template>

      <!-- 功能页不重复配置规则，只读展示模板供参考 -->
      <div v-if="mode !== 'ai'" class="card mt refcard">
        <div class="refcard__head">
          <span class="refcard__title">当前规则可匹配的题目模板</span>
          <button class="refcard__edit" @click="router.push('/practice/import')">修改规则</button>
        </div>
        <pre class="refcard__body">{{ sample }}</pre>
      </div>
    </template>

    <!-- 预览确认（三个入口共用） -->
    <template v-else-if="stage === 'preview'">
      <!-- 题集信息：决定题目归属，以及能否在模考中单独组卷 -->
      <div class="card setbox">
        <div class="field">
          <label class="field__label">题库名称</label>
          <input v-model="setName" class="mini" placeholder="如：2024 年经济基础真题" />
        </div>
        <div class="field">
          <label class="field__label">类别</label>
          <div class="chips">
            <button
              v-for="c in CATEGORIES"
              :key="c.key"
              class="chip"
              :class="{ 'chip--on': setCategory === c.key }"
              @click="setCategory = c.key"
            >
              {{ c.label }}
            </button>
          </div>
          <div class="text-caption chip-hint">{{ categoryHint }}</div>
        </div>
        <div v-if="setCategory === 'past_exam'" class="field">
          <label class="field__label">真题年份</label>
          <input v-model="setYear" class="mini" type="number" placeholder="2024" />
        </div>
      </div>

      <!-- Excel 校验报告：告诉用户哪些行有问题、为什么 -->
      <div v-if="tableReport" class="card report">
        <div class="report__head" @click="showReport = !showReport">
          <span class="report__ok">✅ 表头识别 {{ Object.keys(tableReport.mapped).length }} 列</span>
          <span class="report__toggle" :class="{ 'report__toggle--warn': tableReport.issues.length }">
            {{ tableReport.issues.length ? `⚠️ ${tableReport.issues.length} 行需修正` : '无问题' }}
            {{ showReport ? '▲' : '▼' }}
          </span>
        </div>

        <div v-if="showReport" class="report__body">
          <div class="report__section">
            <div class="report__label">已识别的列</div>
            <div class="report__tags">
              <span v-for="(col, field) in tableReport.mapped" :key="field" class="tag">
                {{ col }} → {{ FIELD_LABEL[String(field)] ?? field }}
              </span>
            </div>
          </div>

          <div v-if="tableReport.unmapped.length" class="report__section">
            <div class="report__label">未识别的列（可忽略）</div>
            <div class="report__tags">
              <span v-for="c in tableReport.unmapped" :key="c" class="tag tag--dim">{{ c }}</span>
            </div>
          </div>

          <div v-if="tableReport.issues.length" class="report__section">
            <div class="report__label">问题行（已导入，但建议回表修正）</div>
            <div v-for="it in tableReport.issues" :key="it.row" class="issue">
              <span class="issue__row">第 {{ it.row }} 行</span>
              <span class="issue__msg">{{ it.issues.join('；') }}</span>
              <div class="issue__stem">{{ it.stem }}</div>
            </div>
            <button class="report__btn" @click="exportIssues">导出问题清单</button>
          </div>
        </div>
      </div>

      <div class="card sum">
        <span>识别 {{ summary.total }} 题</span>
        <span class="ok">🟢 {{ summary.high }}</span>
        <span class="mid">🟡 {{ summary.medium }}</span>
        <span class="low">🔴 {{ summary.low }}</span>
        <span v-if="dupCount" class="dup">重复 {{ dupCount }}</span>
      </div>

      <!-- 归属说明：让用户清楚这些题会出现在哪 -->
      <p class="text-caption note">
        导入后进入「<b>我的题库</b>」，标记为「自建 · 待验」。
        已归类的题可在「<b>章节练习</b>」对应章节中练到；
        <span v-if="dupCount">重复的 {{ dupCount }} 题会自动跳过。</span>
      </p>

      <div class="filter">
        <button :class="{ on: filter === 'all' }" @click="filter = 'all'">全部</button>
        <button :class="{ on: filter === 'medium' }" @click="filter = 'medium'">请核对</button>
        <button :class="{ on: filter === 'low' }" @click="filter = 'low'">建议检查</button>
      </div>

      <div v-if="!list.length" class="text-caption empty">该分级下没有题目</div>

      <div v-for="(q, i) in list" :key="q.key" class="q card">
        <div class="q__head">
          <span class="q__no">#{{ i + 1 }}</span>
          <span
            class="conf"
            :style="{ color: CONFIDENCE_LABEL[confidenceLevel(q.confidence)].color }"
          >
            {{ CONFIDENCE_LABEL[confidenceLevel(q.confidence)].text }}
            {{ Math.round(q.confidence * 100) }}%
          </span>
          <button class="q__del" @click="remove(q.key)">删除</button>
        </div>

        <div class="q__cls">
          <span
            v-if="q.classifiedNodeName"
            class="cls"
            :class="q.classifyMatchedBy === 'knowledge_point' ? 'cls--pt' : 'cls--ch'"
          >
            📁 {{ q.classifiedNodeName }}
          </span>
          <span v-else class="cls cls--none">📁 未归类</span>
          <span
            v-if="q.classifiedSubjectId && q.classifiedSubjectId !== subjectStore.current"
            class="cls-warn"
          >
            建议科目：{{ SUBJECT_META[q.classifiedSubjectId as SubjectId].short }}
          </span>
          <span v-if="q.duplicated" class="cls cls--dup">⚠️ 已存在，将跳过</span>
        </div>

        <div class="q__stem">{{ q.stem }}</div>

        <div
          v-for="o in q.options"
          :key="o.key"
          class="q__opt"
          :class="{ 'q__opt--ans': q.answer.includes(o.key) }"
          @click="toggleAnswer(q, o.key)"
        >
          {{ o.key }}. {{ o.content }}
        </div>

        <!-- 解析 / 考点 / 出处：入库后对应答题页的展示 -->
        <div v-if="q.point || q.analysis || q.source" class="q__extra">
          <div v-if="q.point" class="extra">
            <span class="extra__tag">考点</span>
            <span class="extra__text">{{ q.point }}</span>
          </div>
          <div v-if="q.analysis" class="extra">
            <span class="extra__tag">解析</span>
            <span class="extra__text">{{ q.analysis }}</span>
          </div>
          <div v-if="q.source" class="extra">
            <span class="extra__tag">出处</span>
            <span class="extra__text">{{ q.source }}</span>
          </div>
        </div>

        <div v-if="q.warnings.length" class="q__warn">⚠️ {{ q.warnings.join('；') }}</div>
        <div class="q__hint text-caption">点击选项可勾选/取消答案</div>
      </div>

      <div class="row foot">
        <button class="btn" @click="stage = 'input'">返回修改</button>
        <button class="btn btn--primary" :disabled="!parsed.length" @click="confirmImport">
          确认导入 {{ parsed.length }} 题
        </button>
      </div>
    </template>

    <!-- 完成 -->
    <template v-else>
      <div class="done">
        <div class="done__icon">✅</div>
        <div class="done__title">已导入 {{ importedCount }} 道题</div>
        <div class="text-aux">
          已保存到「我的题库」，标记为「自建 · 待验」<template v-if="skippedCount">
            （重复的 {{ skippedCount }} 题已自动跳过）</template
          >
          <br />已归类的题可在「章节练习」对应章节中练到，考点与解析会展示在答题页
        </div>
        <button
          class="btn btn--primary"
          @click="router.push({ path: '/quiz', query: { mode: 'chapter', count: 10 } })"
        >
          立即练习
        </button>
        <button class="btn" @click="router.push('/practice/sets')">去「我的题库」管理</button>
        <button class="btn btn--ghost" @click="stage = 'input'; parsed = []">继续导入</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.imp {
  padding: calc(var(--safe-top) + var(--sp-2)) var(--sp-4) calc(var(--safe-bottom) + var(--sp-5));
  min-height: 100%;
}
/* 首屏（无 mode）显示底部导航，需为其留出空间；子流程页隐藏导航，用上面的默认值 */
.page.imp {
  padding-bottom: calc(var(--tabbar-h) + var(--safe-bottom) + var(--sp-5));
}
.head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-3);
}
.back {
  background: none;
  border: none;
  font-size: 28px;
  line-height: 1;
  width: var(--tap-min);
  height: var(--tap-min);
  color: var(--text-primary);
}
.h1 {
  font-size: 20px;
  font-weight: 600;
}
.subj {
  margin-left: auto;
  font-size: var(--fs-caption);
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
  border-radius: 10px;
  padding: 2px 8px;
}
.tip {
  margin-bottom: var(--sp-3);
  line-height: 1.6;
}
.entry {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  background: var(--bg-primary);
  border-radius: var(--radius-md);
  padding: var(--sp-4);
  margin-bottom: var(--sp-3);
  cursor: pointer;
}
.entry__icon {
  font-size: 26px;
}
.entry__body {
  flex: 1;
}
.entry__title {
  font-size: var(--fs-body);
  font-weight: 500;
  margin-bottom: 2px;
}
.entry__desc {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.5;
}
.entry__go {
  color: var(--text-tertiary);
  font-size: 20px;
}
.area {
  width: 100%;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  padding: var(--sp-3);
  font-size: var(--fs-body);
  line-height: 1.6;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: inherit;
}
.drop {
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius-md);
  padding: var(--sp-8) var(--sp-4);
  text-align: center;
  background: var(--bg-secondary);
  cursor: pointer;
}
.drop__icon {
  font-size: 36px;
  margin-bottom: var(--sp-2);
}
.drop__title {
  font-size: var(--fs-body);
  font-weight: 500;
  margin-bottom: var(--sp-1);
}
.drop__desc {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.row {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.btn {
  flex: 1;
  height: var(--btn-h);
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: var(--radius-md);
  font-size: var(--fs-body);
}
.btn--primary {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
.btn:disabled {
  background: var(--text-tertiary);
  border-color: var(--text-tertiary);
  color: #fff;
}
.btn--sm {
  height: 40px;
  font-size: var(--fs-aux);
  margin-top: var(--sp-3);
}
.btn--ai {
  width: 100%;
  height: var(--btn-h);
  margin-top: var(--sp-2);
  border: 1px solid var(--color-primary);
  background: rgba(59, 130, 246, 0.08);
  color: var(--color-primary);
  border-radius: var(--radius-md);
  font-size: var(--fs-aux);
}
.btn--ai:disabled {
  opacity: 0.5;
}
.file-tip {
  margin-top: var(--sp-3);
  line-height: 1.6;
}
/* ---------- 分场景导入提示 ---------- */
.guide {
  margin-top: var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.guide__item {
  display: flex;
  gap: var(--sp-2);
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  padding: var(--sp-3);
}
.guide__icon {
  font-size: 18px;
  flex-shrink: 0;
}
.guide__body {
  flex: 1;
  min-width: 0;
}
.guide__title {
  font-size: var(--fs-aux);
  font-weight: 500;
  margin-bottom: 4px;
}
.guide__btn {
  margin-top: var(--sp-2);
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--color-primary);
  background: transparent;
  color: var(--color-primary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-caption);
}
.mt {
  margin-top: var(--sp-4);
}
/* ---------- 题集信息表单 ---------- */
.setbox {
  margin-bottom: var(--sp-3);
}
.field {
  margin-bottom: var(--sp-3);
}
.field:last-child {
  margin-bottom: 0;
}
.field__label {
  display: block;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.mini {
  width: 100%;
  height: 38px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  padding: 0 var(--sp-2);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--fs-aux);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.chip {
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-secondary);
  border-radius: 14px;
  padding: 4px 12px;
  font-size: var(--fs-caption);
  min-height: 30px;
}
.chip--on {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(59, 130, 246, 0.1);
}
.chip-hint {
  margin-top: 6px;
  line-height: 1.5;
}
/* ---------- Excel 校验报告 ---------- */
.report {
  margin-bottom: var(--sp-3);
}
.report__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--fs-aux);
}
.report__ok {
  color: var(--color-success);
}
.report__toggle {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
}
.report__toggle--warn {
  color: var(--color-warning);
}
.report__body {
  margin-top: var(--sp-3);
  border-top: 1px solid var(--border-color);
  padding-top: var(--sp-3);
}
.report__section {
  margin-bottom: var(--sp-3);
}
.report__label {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.report__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
}
.tag--dim {
  color: var(--text-tertiary);
}
.issue {
  padding: var(--sp-2) 0;
  border-bottom: 1px solid var(--border-color);
}
.issue:last-of-type {
  border-bottom: none;
}
.issue__row {
  font-size: var(--fs-caption);
  color: var(--color-warning);
  font-weight: 500;
  margin-right: var(--sp-2);
}
.issue__msg {
  font-size: var(--fs-caption);
  color: var(--text-primary);
}
.issue__stem {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
  line-height: 1.5;
}
.report__btn {
  margin-top: var(--sp-2);
  width: 100%;
  height: 34px;
  border: 1px solid var(--color-primary);
  background: transparent;
  color: var(--color-primary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-caption);
}
.refcard {
  padding: var(--sp-3);
}
.refcard__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-2);
}
.refcard__title {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.refcard__edit {
  background: none;
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
  border-radius: 12px;
  padding: 2px 10px;
  font-size: var(--fs-caption);
  min-height: 26px;
}
.refcard__body {
  margin: 0;
  font-size: 11px;
  line-height: 1.9;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  padding: var(--sp-2);
}
.parsing {
  margin-top: var(--sp-3);
}
.parsing__status {
  font-size: var(--fs-aux);
  margin-bottom: var(--sp-2);
}
.bar {
  height: 6px;
  background: var(--bg-tertiary);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: var(--sp-1);
}
.bar__fill {
  height: 100%;
  background: var(--color-primary);
  transition: width 0.2s;
}
.sum {
  display: flex;
  gap: var(--sp-3);
  margin-bottom: var(--sp-3);
  font-size: var(--fs-aux);
}
.ok {
  color: var(--color-success);
}
.mid {
  color: var(--color-warning);
}
.low {
  color: var(--color-danger);
}
.dup {
  color: var(--color-warning);
}
.note {
  margin-bottom: var(--sp-3);
  line-height: 1.7;
}
.note b {
  color: var(--color-primary);
}
.btn--ghost {
  border-color: transparent;
  color: var(--text-secondary);
}
.filter {
  display: flex;
  gap: var(--sp-2);
  margin-bottom: var(--sp-3);
}
.filter button {
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-secondary);
  border-radius: 14px;
  padding: 4px 12px;
  font-size: var(--fs-caption);
  min-height: 30px;
}
.filter .on {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
}
.q {
  margin-bottom: var(--sp-2);
}
.q__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-2);
}
.q__no {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
}
.conf {
  font-size: var(--fs-caption);
  margin-left: auto;
}
.q__del {
  background: none;
  border: none;
  color: var(--color-danger);
  font-size: var(--fs-caption);
  padding: 4px;
}
.q__cls {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
  margin-bottom: var(--sp-2);
}
.cls {
  font-size: var(--fs-caption);
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--color-primary-light);
  color: var(--color-primary);
}
.cls--ch {
  background: rgba(22, 163, 74, 0.1);
  color: var(--color-success);
}
.cls--none {
  background: var(--bg-secondary);
  color: var(--text-tertiary);
}
.cls--dup {
  background: rgba(245, 158, 11, 0.12);
  color: var(--color-warning);
}
.cls-warn {
  font-size: var(--fs-caption);
  color: var(--color-warning);
}
.q__stem {
  font-size: var(--fs-body);
  line-height: 1.6;
  margin-bottom: var(--sp-2);
}
.q__opt {
  font-size: var(--fs-aux);
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  margin-bottom: 4px;
  border: 1px solid transparent;
}
.q__opt--ans {
  border-color: var(--color-success);
  background: rgba(22, 163, 74, 0.08);
}
.q__extra {
  margin-top: var(--sp-2);
  padding-top: var(--sp-2);
  border-top: 1px dashed var(--border-color);
}
.extra {
  display: flex;
  gap: var(--sp-2);
  margin-bottom: var(--sp-1);
}
.extra__tag {
  flex-shrink: 0;
  font-size: 11px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  padding: 1px 6px;
  border-radius: 4px;
  height: fit-content;
}
.extra__text {
  font-size: var(--fs-caption);
  line-height: 1.7;
  color: var(--text-secondary);
}
.q__warn {
  font-size: var(--fs-caption);
  color: var(--color-warning);
  margin-top: var(--sp-2);
}
.q__hint {
  margin-top: var(--sp-1);
}
.empty {
  padding: var(--sp-6);
  text-align: center;
}
.foot {
  position: sticky;
  bottom: calc(var(--safe-bottom) + var(--sp-3));
}
.done {
  text-align: center;
  padding-top: var(--sp-8);
}
.done__icon {
  font-size: 48px;
  margin-bottom: var(--sp-3);
}
.done__title {
  font-size: var(--fs-title);
  font-weight: 600;
  margin-bottom: var(--sp-2);
}
.done .btn {
  margin-top: var(--sp-3);
}
</style>
