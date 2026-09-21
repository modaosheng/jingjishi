<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getDataSource } from '@/infrastructure'
import { gradePaper, sectionsOf } from '@/services'
import { buildBalancedPaper } from '@/domain/services/examService'
import { buildExamReport, type ExamReport } from '@/domain/services/examReportService'
import ExamCalculator from '@/components/exam/ExamCalculator.vue'
import type { AnswerLog, Question, SubjectId } from '@/domain/entities'

const route = useRoute()
const router = useRouter()
const ds = () => getDataSource()

const subjectId = (route.query.subject as SubjectId) || 'econ_base'
const strict = (route.query.mode as string) !== 'loose'
/** 试卷来源：指定题集 id 时从该题集组卷（往年真题 / 自建题库） */
const setId = (route.query.set as string) || ''
/**
 * 两科连考模式（PRD R3）：同一批次内两科连续作答，中场休息 40 分钟。
 * 第一科交卷后引导进入休息页，而不是直接跳走 —— 让用户先看到本科成绩。
 */
const series = !!route.query.series
const isSecondStage = route.query.stage === '2'
const TOTAL_SECONDS = 90 * 60

/* ---------- 机考工具（PRD R5） ---------- */

/** 文字缩放档位 */
const FONT_STEPS = [0.85, 1, 1.15, 1.3, 1.5]
const fontIdx = ref(1)
const fontScale = computed(() => FONT_STEPS[fontIdx.value] ?? 1)
function zoom(delta: number) {
  fontIdx.value = Math.min(Math.max(fontIdx.value + delta, 0), FONT_STEPS.length - 1)
}

/** 案例题分栏：none | lr（左右） | tb（上下） */
const splitMode = ref<'none' | 'lr' | 'tb'>('none')
const splitLabel = computed(() =>
  splitMode.value === 'none' ? '分栏' : splitMode.value === 'lr' ? '左右分栏' : '上下分栏',
)
function cycleSplit() {
  splitMode.value = splitMode.value === 'none' ? 'lr' : splitMode.value === 'lr' ? 'tb' : 'none'
}

/**
 * 强调显示：选中题干文字后标黄。
 * PRD R5 明确「切换试题后标记取消」——靠题目区的 :key 强制重渲染实现。
 */
const stemRef = ref<HTMLElement | null>(null)
function applyHighlight() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    alert('请先选中要强调的文字，再点「强调显示」')
    return
  }
  const range = sel.getRangeAt(0)
  const root = stemRef.value
  if (!root || !root.contains(range.commonAncestorContainer)) {
    alert('只能强调题干中的文字')
    return
  }
  const mark = document.createElement('mark')
  mark.className = 'hl'
  try {
    range.surroundContents(mark)
  } catch {
    // 跨节点选区 → surroundContents 会抛错，降级处理
    try {
      mark.appendChild(range.extractContents())
      range.insertNode(mark)
    } catch {
      return
    }
  }
  sel.removeAllRanges()
}

/** 科学计算器开关 */
const showCalc = ref(false)

/* ---------- 单题用时统计（供复盘报告 ④ 时间分析用） ---------- */

/** 每题累计用时（毫秒）。同一题可能被多次进入，因此是累加而非覆盖 */
const timeSpent = ref<Record<string, number>>({})
let qEnterAt = Date.now()

/** 离开当前题时，把在本题停留的时间累加进去 */
function flushTime() {
  const q = current.value
  if (q) {
    timeSpent.value[q.id] = (timeSpent.value[q.id] ?? 0) + (Date.now() - qEnterAt)
  }
  qEnterAt = Date.now()
}

/** 题型分段：与真实考试一致（PRD §1.1）。规则统一由 examService 提供，页面不重复定义 */
const SECTIONS = sectionsOf(subjectId)

const paper = ref<Question[][]>([])
const sectionIdx = ref(0)
/** 已进入过的最大段；严格模式下小于该值的段不可再进入 */
const lockedBefore = ref(0)
const qIdx = ref(0)
const answers = ref<Record<string, string[]>>({})
const marked = ref<Set<string>>(new Set())
const remaining = ref(TOTAL_SECONDS)
const loading = ref(true)
/** 组卷提示（如题集题量不足） */
const paperNotice = ref('')
const showConfirm = ref(false)
const showSubmit = ref(false)
const result = ref<{
  score: number
  passed: boolean
  /** 复盘报告（PRD M5-F5 六维度） */
  report: ExamReport | null
} | null>(null)
let timer: number | undefined

const currentSection = computed(() => SECTIONS[sectionIdx.value])
const current = computed(() => paper.value[sectionIdx.value]?.[qIdx.value] ?? null)

/** 全局题号（用于题号栏编号连续） */
const globalNo = computed(() => {
  let base = 0
  for (let i = 0; i < sectionIdx.value; i++) base += paper.value[i]?.length ?? 0
  return base + qIdx.value + 1
})
const totalCount = computed(() => paper.value.reduce((s, p) => s + p.length, 0))

const answeredCount = computed(() => Object.values(answers.value).filter((a) => a.length).length)

onMounted(async () => {
  const built: Question[][] = []

  if (setId) {
    // 按题集组卷：先取题集内题目 id，再按题型分段抽题（考试院式"抽卷"）
    const ids = await ds().questionSets.itemIds(setId)
    for (const sec of SECTIONS) {
      const qs = await ds().questions.query({
        includeIds: ids,
        type: sec.type,
        limit: sec.count,
        shuffle: true,
      })
      built.push(qs)
    }
    const got = built.reduce((s, p) => s + p.length, 0)
    const need = SECTIONS.reduce((s, x) => s + x.count, 0)
    if (got < need) paperNotice.value = `该题库题量不足（共 ${got} 题），已按实际题量组卷`
  } else {
    // 官方题库：按考点（章节）权重组卷，让考点分布贴近真实考试
    const balanced = await buildBalancedPaper(
      { questions: ds().questions, knowledge: ds().knowledge },
      subjectId,
      SECTIONS,
    )
    built.push(...balanced)
  }

  paper.value = built
  loading.value = false
  timer = window.setInterval(() => {
    remaining.value--
    if (remaining.value <= 0) {
      clearInterval(timer)
      submitExam()
    }
  }, 1000)
})

onUnmounted(() => clearInterval(timer))

const fmtClock = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

function cellState(qid: string) {
  if (answers.value[qid]?.length) return 'answered'
  return 'unanswered'
}

function jump(si: number, qi: number) {
  if (strict && si < lockedBefore.value) return
  flushTime() // 先结算「离开的题」的用时
  sectionIdx.value = si
  qIdx.value = qi
}

function toggle(key: string) {
  const q = current.value
  if (!q) return
  const cur = answers.value[q.id] ? [...answers.value[q.id]] : []
  if (q.type === 'single') {
    answers.value[q.id] = [key]
  } else {
    const i = cur.indexOf(key)
    if (i >= 0) cur.splice(i, 1)
    else cur.push(key)
    answers.value[q.id] = cur
  }
}

function toggleMark() {
  const q = current.value
  if (!q) return
  const s = new Set(marked.value)
  s.has(q.id) ? s.delete(q.id) : s.add(q.id)
  marked.value = s
}

/** 下一题：跨段时（严格模式）弹强确认 */
function next() {
  const sec = paper.value[sectionIdx.value]
  if (qIdx.value + 1 < sec.length) {
    flushTime()
    qIdx.value++
    return
  }
  if (sectionIdx.value + 1 < paper.value.length) {
    if (strict) {
      showConfirm.value = true
      return
    }
    enterNextSection()
  }
}

function enterNextSection() {
  flushTime()
  lockedBefore.value = sectionIdx.value + 1
  sectionIdx.value += 1
  qIdx.value = 0
  showConfirm.value = false
}

function prev() {
  if (qIdx.value > 0) {
    flushTime()
    qIdx.value--
  }
}

/** 从复盘建议一键去练对应模块 */
function practiceModule(nodeId: string) {
  router.replace({ path: '/quiz', query: { mode: 'chapter', nodeId, count: '10' } })
}

async function submitExam() {
  const sessionId = `exam_${Date.now()}`
  flushTime() // 结算最后一题的用时

  // ① 落作答流水（含每题用时，供复盘 ④ 时间分析 与 ⑤ 遗憾分使用）
  const logs: AnswerLog[] = []
  paper.value.flat().forEach((q) => {
    const user = answers.value[q.id] ?? []
    const spent = timeSpent.value[q.id] ?? 0
    // 完全没作答、也没停留过的题不必入库
    if (!user.length && spent < 5000) return
    logs.push({
      questionId: q.id,
      answeredAt: Date.now(),
      userAnswer: user,
      isCorrect: user.length > 0 && [...user].sort().join('') === [...q.answer].sort().join(''),
      confidence: null,
      durationMs: spent,
      mode: 'exam',
      sessionId,
    })
  })
  await Promise.all(logs.map((l) => ds().answerLogs.append(l)))

  // ② 计分：规则在 examService，页面不实现第二份
  const graded = gradePaper(paper.value, SECTIONS, answers.value)

  // ③ 复盘报告（PRD M5-F5 六维度）
  const report = await buildExamReport(
    { knowledge: ds().knowledge },
    paper.value,
    answers.value,
    logs,
    subjectId,
    graded,
  )

  result.value = { score: graded.score, passed: graded.passed, report }
  showSubmit.value = false
  if (timer) clearInterval(timer)

  await ds().exams.save({
    id: sessionId,
    subjectId,
    mode: strict ? 'strict' : 'loose',
    startedAt: Date.now() - (TOTAL_SECONDS - remaining.value) * 1000,
    durationMs: (TOTAL_SECONDS - remaining.value) * 1000,
    score: graded.score,
    passed: graded.passed,
    typeScores: graded.typeScores,
    moduleScores: [],
    unanswered: totalCount.value - answeredCount.value,
    marked: marked.value.size,
  })
}
</script>

<template>
  <div class="room">
    <!-- 标题栏：还原官方机考布局 -->
    <header class="title-bar">
      <div class="title-bar__left">
        <span class="who">张明</span>
        <span class="sep">|</span>
        <span>{{ subjectId === 'econ_base' ? '经济基础知识' : '人力资源管理' }}</span>
        <span class="seat">机位 A-12</span>
      </div>
      <div class="title-bar__right">
        <span class="clock" :class="{ 'clock--warn': remaining < 300 }">剩余 {{ fmtClock(remaining) }}</span>
        <button class="submit-btn" @click="showSubmit = true">交卷</button>
      </div>
    </header>

    <div v-if="loading" class="loading">组卷中…</div>
    <div v-else-if="paperNotice" class="paper-notice">{{ paperNotice }}</div>

    <div v-else-if="result" class="report card">
      <!-- ① 总分与过线判断 -->
      <div class="report__title">{{ result.passed ? '过线' : '未过线' }}</div>
      <div class="report__score">{{ result.score }} <span class="unit">/ 140</span></div>
      <div class="text-aux">
        合格线 {{ result.report?.total.passLine ?? 84 }} 分 ·
        {{ result.passed ? '超出' : '还差' }}
        {{ Math.abs(result.report?.total.diff ?? 0) }} 分<template v-if="result.report">
          · 过线概率 {{ Math.round(result.report.total.probability * 100) }}%</template
        >
      </div>

      <template v-if="result.report">
        <!-- ⑤ 遗憾分：比任何鼓励都更能驱动继续学，放最显眼位置 -->
        <div v-if="result.report.regret.total > 0" class="regret">
          <div class="regret__head">💡 本可多得 {{ result.report.regret.total }} 分</div>
          <div v-for="item in result.report.regret.items" :key="item.type" class="regret__item">
            <div class="regret__line">
              <strong>{{ item.label }}</strong>
              <span>{{ item.count }} 题</span>
              <span v-if="item.lostScore > 0" class="regret__lost">损失 {{ item.lostScore }} 分</span>
            </div>
            <div class="text-caption">{{ item.desc }}</div>
          </div>
        </div>

        <!-- ② 题型得分 -->
        <section class="blk">
          <div class="blk__title">② 题型得分</div>
          <div v-for="t in result.report.byType" :key="t.type" class="row">
            <span class="row__name">{{ t.label }}</span>
            <div class="row__bar">
              <div class="row__fill" :style="{ width: `${Math.round(t.rate * 100)}%` }" />
            </div>
            <span class="row__val">{{ Math.round(t.rate * 100) }}%</span>
          </div>
          <div class="text-caption blk__note">目标：单选 85% · 多选 58%</div>
        </section>

        <!-- ③ 模块得分（得分率低的排前面） -->
        <section v-if="result.report.byModule.length" class="blk">
          <div class="blk__title">③ 模块得分</div>
          <div v-for="m in result.report.byModule.slice(0, 6)" :key="m.nodeId" class="row">
            <span class="row__name">{{ m.name }}</span>
            <div class="row__bar">
              <div class="row__fill row__fill--warn" :style="{ width: `${Math.round(m.rate * 100)}%` }" />
            </div>
            <span class="row__val">{{ Math.round(m.rate * 100) }}%</span>
          </div>
        </section>

        <!-- ④ 时间分配 -->
        <section v-if="result.report.time.avgSec" class="blk">
          <div class="blk__title">④ 时间分配</div>
          <div class="text-aux">
            平均每题 {{ result.report.time.avgSec }} 秒 · 建议
            {{ result.report.time.suggestedSec }} 秒
          </div>
          <div v-if="result.report.time.slowest.length" class="slow">
            <div class="text-caption">耗时最长的题：</div>
            <div v-for="(s, i) in result.report.time.slowest" :key="i" class="slow__item">
              <span class="slow__stem">{{ s.stem }}…</span>
              <span class="slow__sec">{{ s.sec }}s</span>
            </div>
          </div>
        </section>

        <!-- ⑥ 下一步建议 -->
        <section v-if="result.report.advice.length" class="blk">
          <div class="blk__title">⑥ 下一步建议</div>
          <div v-for="(a, i) in result.report.advice" :key="i" class="advice">
            <div class="advice__title">{{ a.title }}</div>
            <div class="text-caption">{{ a.desc }}</div>
            <button v-if="a.nodeId" class="advice__go" @click="practiceModule(a.nodeId)">
              去练这个模块 ›
            </button>
          </div>
        </section>
      </template>

      <!-- 连考：第一科交卷后进入中场休息（PRD R3） -->
      <button
        v-if="series && !isSecondStage"
        class="primary-btn"
        @click="router.replace({ path: '/exam/break', query: { next: 'hr' } })"
      >
        进入中场休息（40 分钟）
      </button>
      <button v-else class="primary-btn" @click="router.replace('/exam')">
        {{ series ? '连考完成，返回模考' : '返回模考' }}
      </button>
    </div>

    <div v-else class="body">
      <!-- 题号栏（PRD R5：白未答 / 蓝已答 / 橙当前 / 三角标记） -->
      <aside class="no-col">
        <div v-for="(sec, si) in paper" :key="si" class="no-group">
          <div class="no-group__label">{{ si + 1 }}</div>
          <div class="no-grid">
            <button
              v-for="(q, qi) in sec"
              :key="q.id"
              class="no-cell"
              :class="[
                `no-cell--${cellState(q.id)}`,
                { 'no-cell--current': si === sectionIdx && qi === qIdx },
                { 'no-cell--locked': strict && si < lockedBefore },
                { 'no-cell--mark': marked.has(q.id) },
              ]"
              @click="jump(si, qi)"
            >
              {{ sec.slice(0, qi).length + 1 + paper.slice(0, si).reduce((s, p) => s + p.length, 0) }}
              <span v-if="marked.has(q.id)" class="mark">▲</span>
            </button>
          </div>
        </div>
      </aside>

      <!-- 试题栏 -->
      <section class="q-col">
        <div class="sec-label">
          {{ currentSection.label }}（共 {{ currentSection.count }} 题）
          <span v-if="current?.type === 'case'" class="sec-label__case">案例题</span>
        </div>

        <!-- 题目区：:key 保证切题时重建，从而清除「强调显示」的标黄（PRD R5） -->
        <div class="q-body" :class="splitMode !== 'none' ? `q-body--${splitMode}` : ''">
          <div class="q-pane">
            <div
              :key="current?.id"
              ref="stemRef"
              class="stem"
              :style="{ fontSize: `${16 * fontScale}px` }"
            >
              {{ current?.stem }}
            </div>
          </div>
          <div class="q-pane">
            <div class="options">
              <div
                v-for="opt in current?.options ?? []"
                :key="opt.key"
                class="option"
                :class="{ 'option--on': (answers[current?.id ?? ''] ?? []).includes(opt.key) }"
                :style="{ fontSize: `${15 * fontScale}px` }"
                @click="toggle(opt.key)"
              >
                <span class="option__box">{{ current?.type === 'single' ? '○' : '☐' }}</span>
                <span>{{ opt.key }}. {{ opt.content }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部作答栏（PRD R5：强调显示 / 标记 / 计算器 / 缩放 / 分栏 + 上下题） -->
        <footer class="actions">
          <div class="actions__tools">
            <button class="act" @click="applyHighlight">强调显示</button>
            <button
              class="act"
              :class="{ 'act--on': marked.has(current?.id ?? '') }"
              @click="toggleMark"
            >
              标记{{ marked.has(current?.id ?? '') ? ' ✓' : '' }}
            </button>
            <button class="act" @click="showCalc = true">计算器</button>
            <button class="act" :disabled="fontIdx === 0" @click="zoom(-1)">A−</button>
            <button class="act" :disabled="fontIdx === FONT_STEPS.length - 1" @click="zoom(1)">A+</button>
            <button
              class="act"
              :class="{ 'act--on': splitMode !== 'none' }"
              :disabled="current?.type !== 'case'"
              @click="cycleSplit"
            >
              {{ splitLabel }}
            </button>
          </div>
          <div class="actions__nav">
            <button class="act" @click="prev">上一题</button>
            <button class="act act--primary" @click="next">下一题</button>
          </div>
        </footer>
      </section>
    </div>

    <!-- 科学计算器（PRD R5） -->
    <div v-if="showCalc" class="mask" @click.self="showCalc = false">
      <ExamCalculator @close="showCalc = false" />
    </div>

    <!-- 分段锁定强确认（PRD M5-F2） -->
    <div v-if="showConfirm" class="mask">
      <div class="dialog">
        <div class="dialog__title">即将进入{{ paper[sectionIdx + 1] ? SECTIONS[sectionIdx + 1].label : '' }}</div>
        <div class="dialog__body">
          <p>进入后将无法返回修改{{ currentSection.label.replace(/^[一二三]、/, '') }}的答案。</p>
          <p class="dialog__stat">
            当前：已答 {{ answeredCount }} / {{ totalCount }} 题，标记 {{ marked.size }} 题
          </p>
        </div>
        <div class="dialog__btns">
          <button class="btn" @click="showConfirm = false">返回检查</button>
          <button class="btn btn--primary" @click="enterNextSection">确认进入</button>
        </div>
      </div>
    </div>

    <!-- 交卷确认 -->
    <div v-if="showSubmit" class="mask">
      <div class="dialog">
        <div class="dialog__title">确认交卷？</div>
        <div class="dialog__body">
          <p>未作答 {{ totalCount - answeredCount }} 题 · 已标记 {{ marked.size }} 题</p>
          <p class="text-caption">交卷后将不可修改答案（与真实考试一致）</p>
        </div>
        <div class="dialog__btns">
          <button class="btn" @click="showSubmit = false">继续答题</button>
          <button class="btn btn--primary" @click="submitExam">确认交卷</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.room {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}
.title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-2) var(--sp-3);
  background: #2f3542;
  color: #fff;
  font-size: 12px;
  padding-top: calc(var(--safe-top) + var(--sp-2));
}
.title-bar__left,
.title-bar__right {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.sep {
  opacity: 0.4;
}
.seat {
  opacity: 0.7;
}
.clock {
  font-variant-numeric: tabular-nums;
}
.clock--warn {
  color: #ff7875;
}
.submit-btn {
  background: #1890ff;
  border: none;
  color: #fff;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
}
.body {
  flex: 1;
  display: flex;
  overflow: hidden;
}
.no-col {
  width: 96px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color);
  overflow-y: auto;
  padding: var(--sp-2);
}
.no-group {
  margin-bottom: var(--sp-3);
}
.no-group__label {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}
.no-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.no-cell {
  height: 30px;
  border: 1px solid var(--border-color);
  background: #fff;
  color: var(--text-primary);
  font-size: 11px;
  border-radius: 3px;
  position: relative;
  padding: 0;
}
.no-cell--answered {
  background: #1890ff;
  color: #fff;
  border-color: #1890ff;
}
.no-cell--current {
  background: #fa8c16;
  color: #fff;
  border-color: #fa8c16;
}
.no-cell--locked {
  opacity: 0.35;
}
.mark {
  position: absolute;
  top: -1px;
  right: 0;
  font-size: 7px;
  color: #f5222d;
}
.q-col {
  flex: 1;
  padding: var(--sp-3);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.sec-label {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.stem {
  font-size: var(--fs-title);
  line-height: 1.7;
  margin-bottom: var(--sp-4);
}
.options {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.option {
  display: flex;
  gap: var(--sp-2);
  min-height: var(--option-h);
  align-items: center;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: var(--fs-body);
}
.option--on {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}
.actions {
  margin-top: auto;
  display: flex;
  gap: var(--sp-2);
  padding-top: var(--sp-4);
}
.act {
  flex: 1;
  height: var(--tap-min);
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-aux);
}
.act--primary {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
  padding: var(--sp-5);
}
.dialog {
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  padding: var(--sp-5);
  width: 100%;
  max-width: 340px;
}
.dialog__title {
  font-size: var(--fs-title);
  font-weight: 600;
  margin-bottom: var(--sp-2);
}
.dialog__body {
  font-size: var(--fs-aux);
  line-height: 1.7;
  color: var(--text-secondary);
}
.dialog__stat {
  margin-top: var(--sp-2);
  color: var(--text-primary);
}
.dialog__btns {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-4);
}
.btn {
  flex: 1;
  height: var(--tap-min);
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
}
.btn--primary {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
.report {
  margin: var(--sp-8) var(--sp-4);
  text-align: center;
}
.report__title {
  font-size: var(--fs-title);
  font-weight: 600;
}
.report__score {
  font-size: 40px;
  font-weight: 600;
  color: var(--color-primary);
  margin: var(--sp-2) 0;
}
.unit {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
}
.regret {
  margin-top: var(--sp-4);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--border-color);
  text-align: left;
}
.regret__head {
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--color-warning);
  margin-bottom: var(--sp-2);
}
.regret__item {
  margin-bottom: var(--sp-3);
}
.regret__line {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-aux);
  margin-bottom: 2px;
}
.regret__lost {
  margin-left: auto;
  color: var(--color-danger);
}
.primary-btn {
  width: 100%;
  height: var(--btn-h);
  margin-top: var(--sp-5);
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
}
.loading {
  padding: var(--sp-8);
  text-align: center;
  color: var(--text-secondary);
}
.paper-notice {
  padding: 6px var(--sp-3);
  background: rgba(245, 158, 11, 0.12);
  color: var(--color-warning);
  font-size: var(--fs-caption);
  text-align: center;
}
/* ---------- 机考四件套（PRD R5） ---------- */
.actions {
  margin-top: auto;
  padding-top: var(--sp-3);
  border-top: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.actions__tools {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.actions__nav {
  display: flex;
  gap: var(--sp-2);
}
.actions__nav .act {
  flex: 1;
}
.act {
  flex: 0 0 auto;
  min-height: 34px;
  padding: 0 10px;
  font-size: var(--fs-caption);
}
.act:disabled {
  opacity: 0.4;
}
.act--on {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(59, 130, 246, 0.1);
}
.act--primary {
  min-height: var(--tap-min);
  font-size: var(--fs-aux);
}
/* 题干「强调显示」：mark 由 JS 运行时插入，需 :deep 穿透 scoped 样式 */
.stem :deep(mark.hl) {
  background: #fde68a;
  color: #1f2937;
  border-radius: 2px;
  padding: 0 2px;
}
/* 案例题分栏：左右 / 上下 */
.q-body--lr {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
  align-items: start;
}
.q-body--tb {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.q-body--lr .q-pane,
.q-body--tb .q-pane {
  min-width: 0;
  overflow-y: auto;
  max-height: 52vh;
}
.sec-label__case {
  margin-left: var(--sp-2);
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(59, 130, 246, 0.12);
  color: var(--color-primary);
  font-weight: 400;
}
/* ---------- 复盘报告六维度（PRD M5-F5） ---------- */
.blk {
  margin-top: var(--sp-4);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--border-color);
  text-align: left;
}
.blk__title {
  font-size: var(--fs-aux);
  font-weight: 600;
  margin-bottom: var(--sp-2);
}
.blk__note {
  margin-top: 6px;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: 6px;
}
.row__name {
  width: 78px;
  flex-shrink: 0;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--bg-secondary);
  overflow: hidden;
}
.row__fill {
  height: 100%;
  background: var(--color-primary);
}
.row__fill--warn {
  background: var(--color-warning);
}
.row__val {
  width: 38px;
  text-align: right;
  font-size: var(--fs-caption);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.slow {
  margin-top: var(--sp-2);
}
.slow__item {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-2);
  font-size: var(--fs-caption);
  line-height: 1.9;
}
.slow__stem {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}
.slow__sec {
  color: var(--color-warning);
  flex-shrink: 0;
}
.advice {
  padding: var(--sp-2) 0;
  border-bottom: 1px dashed var(--border-color);
}
.advice:last-child {
  border-bottom: none;
}
.advice__title {
  font-size: var(--fs-aux);
  font-weight: 500;
  margin-bottom: 2px;
}
.advice__go {
  margin-top: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--color-primary);
  background: transparent;
  color: var(--color-primary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-caption);
  font-family: inherit;
}
</style>
