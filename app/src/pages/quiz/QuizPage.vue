<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getDataSource } from '@/infrastructure'
import { schedule } from '@/domain/services/fsrs'
import { getServices } from '@/services'
import { SUBJECT_META, subjectOfNode, useSubjectStore } from '@/stores/subject'
import { contextLabel, type PracticeContext } from '@/domain/services/practiceContext'
import PracticeConfigSheet from '@/components/practice/PracticeConfigSheet.vue'
import type { Confidence, ErrorReason, FsrsRating, PracticeMode, Question, QuestionType, SubjectId } from '@/domain/entities'
import { loadAdaptiveState, recordResult } from '@/domain/services/adaptiveDifficultyService'
import { decideChapterAction } from '@/domain/services/planEngineService'
import { markActiveDay } from '@/domain/ads/releaseEngine'
import AdErrorBoundary from '@/components/ads/AdErrorBoundary.vue'
import ResultCardAd from '@/components/ads/ResultCardAd.vue'

const route = useRoute()
const router = useRouter()
const ds = () => getDataSource()
const subjectStore = useSubjectStore()

const mode = (route.query.mode as PracticeMode) || 'chapter'
const count = Number(route.query.count) || 10
const packId = (route.query.packId as string) || ''

/** 练习上下文：章节 / 年份 / 题型 / 难度（答题页内可切换） */
const nodeId = ref((route.query.nodeId as string) || '')
const year = ref<number | undefined>(Number(route.query.year) || undefined)
const type = ref<QuestionType | undefined>((route.query.type as QuestionType) || undefined)
const difficulty = ref<number | undefined>(Number(route.query.difficulty) || undefined)
const nodeName = ref('')

/**
 * 科目优先级：URL 指定 > 题目所属（按 nodeId 推断）> 全局 store
 * 这样从章节页进来时不会因 store 是另一科而查不到题
 */
const subjectId = ref<SubjectId>(
  (route.query.subject as SubjectId) || (nodeId.value ? subjectOfNode(nodeId.value) : subjectStore.current),
)

/** 仅练这些归属的题（来自「我的题库」入口，如 ?owner=user,ai） */
const ownerTypes = (route.query.owner as string)
  ? ((route.query.owner as string).split(',') as Question['ownerType'][])
  : undefined

const questions = ref<Question[]>([])
const index = ref(0)
const selected = ref<string[]>([])
const confidence = ref<Confidence | null>(null)
/** 本轮各题的确信度（用于章节跳学判定，PRD §6.6） */
const confHistory = ref<Confidence[]>([])
const submitted = ref(false)
const showFullExp = ref(false)
const finished = ref(false)
const loading = ref(true)
/** 错误归因（PRD M4-F2）：仅答错时需要选择 */
const errorReason = ref<ErrorReason | null>(null)
const answeredAt = ref(0)
const answerDuration = ref(0)

/** 错误归因五类（PRD M4-F2），对应后续训练建议 */
const ERROR_REASONS: Array<{ key: ErrorReason; label: string }> = [
  { key: 'not_memorized', label: '概念没记住' },
  { key: 'confused', label: '概念混淆了' },
  { key: 'misread', label: '题意没看清' },
  { key: 'calc_error', label: '计算失误' },
  { key: 'no_idea', label: '完全没思路' },
]

const startAt = ref(Date.now())
const elapsed = ref(0)
let timer: number | undefined

const current = computed(() => questions.value[index.value])
const isMulti = computed(() => current.value?.type === 'multi' || current.value?.type === 'case')
const isCorrect = computed(() => {
  const q = current.value
  if (!q) return false
  const a = [...selected.value].sort().join('')
  const b = [...q.answer].sort().join('')
  return a === b
})

const correctCount = ref(0)
const wrongCount = ref(0)

const TYPE_LABEL: Record<Question['type'], string> = {
  single: '单选题',
  multi: '多选题',
  case: '案例分析题',
}

const CONF_TEXT: Record<Confidence, string> = {
  sure: '很确定',
  unsure: '有点懵',
  noidea: '没思路',
}

const SOURCE_LABEL: Record<Question['sourceLevel'], { text: string; color: string }> = {
  S: { text: '官方', color: 'var(--src-s)' },
  A: { text: '已审', color: 'var(--src-a)' },
  B: { text: 'AI生成', color: 'var(--src-b)' },
  C: { text: '待验', color: 'var(--src-c)' },
}

const RATING: Array<{ key: FsrsRating; label: string; color: string }> = [
  { key: 'again', label: '重来', color: 'var(--color-danger)' },
  { key: 'hard', label: '困难', color: 'var(--color-warning)' },
  { key: 'good', label: '良好', color: 'var(--color-primary)' },
  { key: 'easy', label: '简单', color: 'var(--color-success)' },
]

async function load() {
  loading.value = true
  /**
   * 自适应难度（PRD M3-F4）：只作用于「练习类」模式（章节 / 专项）。
   * 复习、错题、真题、高频这些模式有各自的选题规则，不应被难度干预。
   * 用户在专项里手动选了难度时，以用户选择为准。
   */
  const adaptiveOn = mode === 'chapter' || mode === 'special'
  const adaptiveLevel = adaptiveOn ? loadAdaptiveState().difficulty : undefined

  questions.value = await ds().questions.buildPaper({
    mode,
    subjectId: subjectId.value,
    nodeId: nodeId.value || undefined,
    count,
    year: year.value,
    type: type.value,
    difficulty: difficulty.value ?? adaptiveLevel,
    ownerTypes,
  })
  // 加载章节名（用于顶部上下文展示）
  if (nodeId.value && !nodeName.value) {
    const node = await ds().knowledge.getNode(nodeId.value)
    nodeName.value = node?.name ?? ''
  }
  loading.value = false
  startAt.value = Date.now()
}

/** 重置答题进度（切换科目/上下文时复用） */
function resetState() {
  index.value = 0
  selected.value = []
  confidence.value = null
  errorReason.value = null
  submitted.value = false
  showFullExp.value = false
  finished.value = false
  correctCount.value = 0
  wrongCount.value = 0
  confHistory.value = []
}

/** 切换科目：重置并按新科目重新组卷 */
async function switchSubject(id: SubjectId) {
  if (id === subjectId.value) return
  subjectStore.setSubject(id)
  subjectId.value = id
  resetState()
  await load()
}

/** 当前上下文（用于顶部展示与选择器回显） */
const ctx = computed<PracticeContext>(() => ({
  mode,
  subjectId: subjectId.value,
  nodeId: nodeId.value || undefined,
  nodeName: nodeName.value || undefined,
  year: year.value,
  type: type.value,
  difficulty: difficulty.value,
}))
const ctxLabel = computed(() => (ownerTypes ? '我的题库练习' : contextLabel(ctx.value)))

/** 仅章节/专项/真题三种模式有上下文可切换 */
const showPicker = ref(false)
function openPicker() {
  if (mode === 'chapter' || mode === 'special' || mode === 'real_exam') {
    showPicker.value = true
  }
}

/** 切换上下文（章节/年份/题型/难度）后重新组卷 */
async function onConfirm(next: PracticeContext) {
  nodeId.value = next.nodeId ?? ''
  nodeName.value = next.nodeName ?? ''
  year.value = next.year
  type.value = next.type
  difficulty.value = next.difficulty
  showPicker.value = false
  resetState()
  await load()
}

onMounted(async () => {
  await load()
  timer = window.setInterval(() => {
    elapsed.value = Math.floor((Date.now() - startAt.value) / 1000)
  }, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

function toggle(key: string) {
  if (submitted.value) return
  if (isMulti.value) {
    const i = selected.value.indexOf(key)
    if (i >= 0) selected.value.splice(i, 1)
    else selected.value.push(key)
  } else {
    selected.value = [key]
  }
}

/** 自适应难度调整提示（难度变化时展示一次） */
const adaptiveNotice = ref('')

async function submit() {
  if (!selected.value.length || !current.value) return
  if (submitted.value) return // 防重复提交：否则难度统计会重复计数
  submitted.value = true
  showFullExp.value = false
  adaptiveNotice.value = '' // 每题只提示一次的难度变化

  if (isCorrect.value) correctCount.value++
  else wrongCount.value++

  // 记录本题确信度（章节跳学判定用）
  if (confidence.value) confHistory.value.push(confidence.value)

  // 仅记录作答时间与用时；流水在 rate() 评分时写入，以便携带错误归因
  answeredAt.value = Date.now()
  answerDuration.value = Date.now() - startAt.value

  // 自适应难度（PRD M3-F4）：与组卷范围保持一致，只统计练习类模式
  if (mode === 'chapter' || mode === 'special') {
    const outcome = recordResult(isCorrect.value)
    if (outcome.reason) adaptiveNotice.value = outcome.reason
  }
}

/* ---------- 免学跳关（PRD §6.6） ---------- */

/**
 * 本轮的主导确信度
 * 跳学判定需要一个"整章"的自评，这里取众数；并列时取更保守的档位
 */
const dominantConfidence = computed<Confidence>(() => {
  const c: Record<Confidence, number> = { sure: 0, unsure: 0, noidea: 0 }
  confHistory.value.forEach((x) => (c[x] += 1))
  const max = Math.max(c.sure, c.unsure, c.noidea)
  if (max === 0) return 'unsure'
  // 并列时取**更保守**的档位：「很确定」必须严格最多才算主导，
  // 否则跳学判定会过于宽松（NR：宁可多练一章，不要漏掉薄弱点）
  if (c.sure === max && c.sure > c.unsure && c.sure > c.noidea) return 'sure'
  if (c.noidea === max && c.noidea > c.unsure) return 'noidea'
  return 'unsure'
})

/** 章节练习的跳学建议：正确率 ≥90% 且自评有把握 → 可跳过本章 */
const chapterAdvice = computed(() => {
  if (mode !== 'chapter' || !questions.value.length) return null
  const acc = correctCount.value / questions.value.length
  return decideChapterAction(acc, dominantConfidence.value)
})

/** 跳过本章，直接进入下一章 */
async function goNextChapter() {
  if (!nodeId.value) {
    router.replace('/study')
    return
  }
  const tree = await ds().knowledge.getTree(subjectId.value)
  const chapters = tree.filter((n) => n.level === 2).sort((a, b) => a.order - b.order)
  const idx = chapters.findIndex((c) => c.id === nodeId.value)
  const next = chapters[idx + 1]
  if (!next) {
    window.alert('已经是最后一章了，去今日任务看看复习安排吧。')
    router.replace('/study')
    return
  }
  router.replace({
    path: '/quiz',
    query: { ...route.query, nodeId: next.id, count: String(count) },
  })
}

async function rate(rating: FsrsRating) {
  const q = current.value
  if (!q) return

  // 写入答题流水（含错误归因，PRD M4-F2）
  await ds().answerLogs.append({
    questionId: q.id,
    answeredAt: answeredAt.value,
    userAnswer: [...selected.value],
    isCorrect: isCorrect.value,
    confidence: confidence.value,
    durationMs: answerDuration.value,
    mode,
    errorReason: isCorrect.value ? undefined : (errorReason.value ?? undefined),
  })

  // 标记今日为「活跃日」→ 驱动广告渐进释放（PRD M9-F4）
  // 定义：当日完成 ≥ 1 个任务包即算活跃。此处是唯一的答题写入点，
  // 因此也是唯一需要的埋点位置。幂等，同一天多次答题只记一次。
  markActiveDay()

  // FSRS 调度 + 错题本维护
  const existing = (await ds().states.get(q.id)) ?? {
    questionId: q.id,
    fsrsDifficulty: 5,
    fsrsStability: 0,
    fsrsRetrievability: 1,
    dueAt: 0,
    lastReviewAt: null,
    reviewCount: 0,
    lapseCount: 0,
    conquerCount: 0,
    isWrong: false,
    isFavorited: false,
  }
  const next = schedule(existing, rating, isCorrect.value)
  await ds().states.upsert(next)

  // 掌握度不逐题重算：交给调度服务按阈值（每 20 题）批量重算，避免每次答题都写库
  getServices().scheduler.onAnswerCommitted()

  if (packId) {
    try {
      await ds().plan.markPackCompleted(new Date().toISOString().slice(0, 10), packId)
    } catch {
      /* 忽略 */
    }
  }

  if (index.value + 1 >= questions.value.length) {
    finished.value = true
    return
  }
  index.value++
  selected.value = []
  confidence.value = null
  errorReason.value = null
  submitted.value = false
  showFullExp.value = false
  startAt.value = Date.now()
}
</script>

<template>
  <div class="page--no-tab quiz">
    <header class="quiz__bar">
      <button class="icon-btn" aria-label="返回" @click="router.back()">‹</button>
      <span class="quiz__progress">{{ index + 1 }}/{{ questions.length }}</span>
      <span class="quiz__timer">⏱ {{ fmt(elapsed) }}</span>
    </header>

    <!-- 科目切换：让用户始终知道在刷哪一科 -->
    <div class="subject-switch">
      <button
        v-for="(meta, id) in SUBJECT_META"
        :key="id"
        class="ss-chip"
        :class="{ 'ss-chip--on': subjectId === id }"
        @click="switchSubject(id as SubjectId)"
      >
        {{ meta.short }}
      </button>
    </div>

    <!-- 练习上下文：当前练什么，可点击切换 -->
    <div class="ctx-bar" @click="openPicker">
      <span class="ctx-bar__label">{{ ctxLabel }}</span>
      <span
        v-if="mode === 'chapter' || mode === 'special' || mode === 'real_exam'"
        class="ctx-bar__swap"
      >
        切换 ⇄
      </span>
    </div>

    <div v-if="loading" class="loading">加载中…</div>

    <div v-else-if="finished" class="result card">
      <div class="result__title">本轮完成</div>
      <div class="result__nums">
        <span class="ok">✓ {{ correctCount }}</span>
        <span class="bad">✗ {{ wrongCount }}</span>
      </div>
      <div class="text-aux">
        正确率 {{ Math.round((correctCount / Math.max(1, questions.length)) * 100) }}%
      </div>

      <!-- 章节推进建议（PRD §6.6）：≥90% 且有把握 → 可跳学；<60% → 建议回看 -->
      <div v-if="chapterAdvice" class="advice" :class="`advice--${chapterAdvice.action}`">
        <div class="advice__title">{{ chapterAdvice.title }}</div>
        <div class="advice__msg">{{ chapterAdvice.message }}</div>
      </div>

      <button
        v-if="chapterAdvice?.action === 'skip'"
        class="primary-btn"
        @click="goNextChapter"
      >
        跳过本章，去下一章
      </button>
      <button
        v-else-if="chapterAdvice?.action === 'block' && nodeId"
        class="primary-btn"
        @click="router.replace(`/study/knowledge/${nodeId}`)"
      >
        回看本章精讲
      </button>
      <button class="btn-ghost" @click="router.replace('/study')">回到今日任务</button>

      <!--
        成果卡广告（PRD M9-F3 位置①）
        ⚠️ 位置纪律（三条，缺一不可）：
           ① 必须挂在**结算视图内**，绝不能插入答题过程中（T1 心流禁投区）
           ② 必须放在**主按钮之后** —— 主行动永远优先（T2 主动触发优先）
           ③ 由 AdSlotView 自行判断释放状态与频次，不满足则整个节点不渲染
      -->
      <AdErrorBoundary>
        <ResultCardAd />
      </AdErrorBoundary>
    </div>

    <template v-else-if="current">
      <div class="tags">
        <span class="tag">{{ TYPE_LABEL[current.type] }}</span>
        <span class="tag tag--src" :style="{ color: SOURCE_LABEL[current.sourceLevel].color }">
          {{ SOURCE_LABEL[current.sourceLevel].text }}
        </span>
        <span class="tag">难度 {{ '★'.repeat(Math.min(5, current.difficulty)) }}</span>
      </div>

      <div class="stem">{{ current.stem }}</div>

      <!-- 选项：整行可点，高度 ≥56px（费茨定律） -->
      <div class="options">
        <div
          v-for="opt in current.options"
          :key="opt.key"
          class="option"
          :class="{
            'option--active': selected.includes(opt.key),
            'option--right': submitted && current.answer.includes(opt.key),
            'option--wrong': submitted && selected.includes(opt.key) && !current.answer.includes(opt.key),
          }"
          role="button"
          :aria-pressed="selected.includes(opt.key)"
          @click="toggle(opt.key)"
        >
          <span class="option__mark">
            <template v-if="submitted">
              <span v-if="current.answer.includes(opt.key)" class="mark-ok">✓</span>
              <span v-else-if="selected.includes(opt.key)" class="mark-bad">✗</span>
              <span v-else>{{ isMulti ? '☐' : '○' }}</span>
            </template>
            <template v-else>{{ selected.includes(opt.key) ? (isMulti ? '☑' : '◉') : isMulti ? '☐' : '○' }}</template>
          </span>
          <span class="option__key">{{ opt.key }}.</span>
          <span class="option__text">{{ opt.content }}</span>
        </div>
      </div>

      <!-- 确信度自评（元认知校准，PRD M3-F2） -->
      <div v-if="!submitted" class="confidence">
        <div class="confidence__label">你有多大把握？</div>
        <div class="confidence__opts">
          <button
            v-for="(text, key) in CONF_TEXT"
            :key="key"
            class="chip"
            :class="{ 'chip--on': confidence === key }"
            @click="confidence = key as Confidence"
          >
            {{ text }}
          </button>
        </div>
        <button class="primary-btn" :disabled="!selected.length" @click="submit">提交</button>
      </div>

      <!-- 解析：渐进披露 -->
      <div v-else class="explanation card">
        <div class="exp__head" :class="isCorrect ? 'exp__head--ok' : 'exp__head--bad'">
          {{ isCorrect ? '回答正确' : '回答错误' }}
        </div>

        <!-- 自适应难度提示（PRD M3-F4）：仅在难度发生变化时出现 -->
        <div v-if="adaptiveNotice" class="adaptive">
          <span class="adaptive__icon">🎚️</span>
          <span>{{ adaptiveNotice }}</span>
        </div>

        <div class="exp__keypoint">{{ current.explanation.keyPoint }}</div>

        <!-- 整体解析（用户导入题自带解析时展示） -->
        <div v-if="current.explanation.analysis" class="exp__analysis">
          <span class="exp__tag">解析</span>
          {{ current.explanation.analysis }}
        </div>

        <button class="exp__toggle" @click="showFullExp = !showFullExp">
          {{ showFullExp ? '收起完整解析' : '查看逐项解析' }}
        </button>

        <div v-if="showFullExp" class="exp__list">
          <div
            v-for="o in current.explanation.perOption"
            :key="o.key"
            class="exp__item"
            :class="o.correct ? 'exp__item--ok' : 'exp__item--bad'"
          >
            <strong>{{ o.key }}. {{ o.correct ? '正确' : '错误' }}</strong> {{ o.text }}
          </div>
          <div v-if="current.explanation.trapWords?.length" class="exp__traps">
            ⚠️ 题干关键词：{{ current.explanation.trapWords.join(' / ') }}
          </div>
          <div v-if="current.explanation.sourceRef" class="exp__ref">
            来源：{{ current.explanation.sourceRef }}
          </div>
        </div>

        <!-- 错误归因（PRD M4-F2）：仅答错时引导，帮系统定位薄弱点 -->
        <div v-if="!isCorrect" class="reason">
          <div class="reason__label">这道题为什么错？（选一个）</div>
          <div class="reason__opts">
            <button
              v-for="r in ERROR_REASONS"
              :key="r.key"
              class="chip"
              :class="{ 'chip--on': errorReason === r.key }"
              @click="errorReason = errorReason === r.key ? null : r.key"
            >
              {{ r.label }}
            </button>
          </div>
        </div>

        <!-- FSRS 四级评分（PRD M3-F3） -->
        <div class="rating">
          <div class="rating__label">这道题的掌握程度？</div>
          <div class="rating__opts">
            <button
              v-for="r in RATING"
              :key="r.key"
              class="rating__btn"
              :style="{ borderColor: r.color, color: r.color }"
              @click="rate(r.key)"
            >
              {{ r.label }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- 上下文选择器（章节/专项/年份） -->
    <PracticeConfigSheet
      :model-value="showPicker"
      :mode="mode === 'special' ? 'special' : mode === 'real_exam' ? 'real_exam' : 'chapter'"
      :subject-id="subjectId"
      :current="ctx"
      @update:model-value="showPicker = false"
      @confirm="onConfirm"
    />
  </div>
</template>

<style scoped>
.quiz {
  min-height: 100%;
  background: var(--bg-primary);
  padding: calc(var(--safe-top) + var(--sp-2)) var(--sp-4)
    calc(var(--safe-bottom) + var(--sp-6));
}
.quiz__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-2) 0;
  margin-bottom: var(--sp-2);
}
.icon-btn {
  background: none;
  border: none;
  font-size: 28px;
  line-height: 1;
  color: var(--text-primary);
  width: var(--tap-min);
  height: var(--tap-min);
}
.quiz__progress {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
}
.subject-switch {
  display: flex;
  gap: var(--sp-2);
  margin-bottom: var(--sp-3);
}
.ss-chip {
  flex: 1;
  min-height: 40px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-aux);
}
.ss-chip--on {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
  font-weight: 500;
}
.ctx-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-secondary);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  padding: var(--sp-2) var(--sp-3);
  margin-bottom: var(--sp-3);
}
.ctx-bar__label {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
}
.ctx-bar__swap {
  font-size: var(--fs-caption);
  color: var(--color-primary);
}
.quiz__timer {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.tags {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
  margin-bottom: var(--sp-3);
}
.tag {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  background: var(--bg-secondary);
  padding: 2px 8px;
  border-radius: 6px;
}
.tag--src {
  background: transparent;
  border: 1px solid currentColor;
}
/* PRD §10.1：题目 17-18px，行高 1.7 */
.stem {
  font-size: var(--fs-title);
  line-height: 1.7;
  margin-bottom: var(--sp-4);
  color: var(--text-primary);
}
.options {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.option {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: var(--option-h);
  padding: var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  transition: background 0.15s, border-color 0.15s;
}
.option--active {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}
.option--right {
  border-color: var(--color-success);
  background: rgba(22, 163, 74, 0.1);
}
.option--wrong {
  border-color: var(--color-danger);
  background: rgba(220, 38, 38, 0.08);
}
.option__mark {
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}
.mark-ok {
  color: var(--color-success);
}
.mark-bad {
  color: var(--color-danger);
}
.option__text {
  font-size: var(--fs-body);
  line-height: 1.5;
}
.confidence {
  margin-top: var(--sp-5);
}
.confidence__label {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.confidence__opts {
  display: flex;
  gap: var(--sp-2);
  margin-bottom: var(--sp-4);
}
.chip {
  flex: 1;
  min-height: var(--tap-min);
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-aux);
}
.chip--on {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
}
.primary-btn {
  width: 100%;
  height: var(--btn-h);
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--fs-body);
}
.primary-btn:disabled {
  background: var(--text-tertiary);
}
.explanation {
  margin-top: var(--sp-4);
}
.exp__head {
  font-size: var(--fs-title);
  font-weight: 600;
  margin-bottom: var(--sp-2);
}
.exp__head--ok {
  color: var(--color-success);
}
.exp__head--bad {
  color: var(--color-danger);
}
.exp__keypoint {
  font-size: var(--fs-body);
  line-height: var(--lh-read);
  color: var(--text-primary);
}
.exp__analysis {
  margin-top: var(--sp-2);
  font-size: var(--fs-aux);
  line-height: 1.7;
  color: var(--text-secondary);
}
.exp__tag {
  display: inline-block;
  font-size: 11px;
  background: var(--bg-secondary);
  color: var(--text-tertiary);
  padding: 1px 6px;
  border-radius: 4px;
  margin-right: var(--sp-2);
}
.exp__toggle {
  margin-top: var(--sp-3);
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: var(--fs-aux);
  padding: var(--sp-2) 0;
}
.exp__list {
  margin-top: var(--sp-2);
  border-top: 1px solid var(--border-color);
  padding-top: var(--sp-3);
}
.exp__item {
  font-size: var(--fs-aux);
  line-height: 1.7;
  margin-bottom: var(--sp-2);
}
.exp__item--ok strong {
  color: var(--color-success);
}
.exp__item--bad strong {
  color: var(--color-danger);
}
.exp__traps {
  margin-top: var(--sp-2);
  font-size: var(--fs-caption);
  color: var(--color-warning);
}
.exp__ref {
  margin-top: var(--sp-1);
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
}
.reason {
  margin-top: var(--sp-3);
  padding-top: var(--sp-3);
  border-top: 1px dashed var(--border-color);
}
.reason__label {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.reason__opts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.rating {
  margin-top: var(--sp-4);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--border-color);
}
.rating__label {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.rating__opts {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--sp-2);
}
.rating__btn {
  min-height: var(--tap-min);
  border: 1.5px solid;
  background: var(--bg-primary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-aux);
}
.result {
  margin-top: var(--sp-8);
  text-align: center;
}
.result__title {
  font-size: var(--fs-title);
  font-weight: 600;
  margin-bottom: var(--sp-3);
}
.result__nums {
  display: flex;
  justify-content: center;
  gap: var(--sp-5);
  font-size: 20px;
  margin-bottom: var(--sp-2);
}
.ok {
  color: var(--color-success);
}
.bad {
  color: var(--color-danger);
}
.loading {
  padding: var(--sp-8);
  text-align: center;
  color: var(--text-secondary);
}
/* 自适应难度提示（PRD M3-F4） */
.adaptive {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  margin: var(--sp-2) 0 var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  background: rgba(59, 130, 246, 0.08);
  border-radius: var(--radius-sm);
  font-size: var(--fs-caption);
  line-height: 1.7;
  color: var(--color-primary);
}
.adaptive__icon {
  flex-shrink: 0;
}
/* 章节推进建议（PRD §6.6） */
.advice {
  margin: var(--sp-3) 0;
  padding: var(--sp-3);
  border-radius: var(--radius-sm);
  text-align: left;
}
.advice--skip {
  background: rgba(16, 185, 129, 0.1);
}
.advice--skip .advice__title {
  color: var(--color-success);
}
.advice--block {
  background: rgba(245, 158, 11, 0.1);
}
.advice--block .advice__title {
  color: var(--color-warning);
}
.advice--proceed {
  background: var(--bg-secondary);
}
.advice__title {
  font-size: var(--fs-aux);
  font-weight: 600;
  margin-bottom: 4px;
}
.advice__msg {
  font-size: var(--fs-caption);
  line-height: 1.7;
  color: var(--text-secondary);
}
.btn-ghost {
  width: 100%;
  height: 40px;
  margin-top: var(--sp-2);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-aux);
  font-family: inherit;
}
</style>
