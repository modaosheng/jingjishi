<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getDataSource } from '@/infrastructure'
import { EXAM_DATE, getServices } from '@/services'
import type { SubjectId } from '@/domain/entities'
import type { PredictionResult } from '@/domain/services/predictionService'
import type { TreeNodeView } from '@/domain/services/knowledgeService'
import { analyzeCalibration, type CalibrationReport } from '@/domain/services/metacognitionService'

const subject = ref<SubjectId>('econ_base')
const stats = ref({ total: 0, correct: 0, today: 0 })
const dueCount = ref(0)
const modules = ref<TreeNodeView[]>([])
const prediction = ref<PredictionResult | null>(null)
const streak = ref(0)
const heatmap = ref<Array<{ date: string; count: number }>>([])
/** 元认知校准（PRD M8-F1 特色） */
const calibration = ref<CalibrationReport | null>(null)
/** 模考成绩趋势（时间升序：左旧右新） */
const examTrend = ref<Array<{ score: number; at: number }>>([])
const loading = ref(true)

const accuracy = computed(() =>
  stats.value.total ? Math.round((stats.value.correct / stats.value.total) * 100) : 0,
)

/** 热力图展示最近 12 周（84 天） */
const HEAT_DAYS = 84

async function load() {
  loading.value = true
  const ds = getDataSource()
  const svc = getServices()
  stats.value = await ds.answerLogs.stats()
  dueCount.value = await ds.states.getDueCount()
  modules.value = (await svc.knowledge.getTreeWithMastery(subject.value)).filter((n) => n.level === 1)
  prediction.value = await svc.prediction.predict(subject.value, EXAM_DATE)
  streak.value = Number(localStorage.getItem('jingshi.streak') || '0')
  heatmap.value = await ds.answerLogs.dailyCounts(HEAT_DAYS)
  calibration.value = analyzeCalibration(await ds.answerLogs.confidenceStats())
  // 模考趋势：list 返回时间倒序，反转成升序便于从左到右绘制
  const exams = await ds.exams.list(10)
  examTrend.value = [...exams].reverse().map((e) => ({ score: e.score, at: e.startedAt }))
  loading.value = false
}

onMounted(load)

const barColor = (m: number) =>
  m < 45 ? 'var(--color-danger)' : m < 65 ? 'var(--color-warning)' : 'var(--color-success)'

/* ---------- 学习热力图 ---------- */

/** 补齐首行空白，使第一列对齐周日，形成规整的周网格 */
const cells = computed<Array<{ date: string; count: number } | null>>(() => {
  const first = heatmap.value[0]
  const pad = first ? new Date(`${first.date}T00:00:00`).getDay() : 0
  return [...Array<null>(pad).fill(null), ...heatmap.value]
})

const heatLevel = (count: number) =>
  count === 0 ? 0 : count <= 5 ? 1 : count <= 15 ? 2 : count <= 30 ? 3 : 4

const HEAT_COLOR = [
  'var(--bg-tertiary)',
  'rgba(43, 92, 230, 0.25)',
  'rgba(43, 92, 230, 0.5)',
  'rgba(43, 92, 230, 0.75)',
  'var(--color-primary)',
]

const activeDays = computed(() => heatmap.value.length)

/* ---------- 模考成绩趋势（含 84 分参考线，PRD M8-F1） ---------- */

/** SVG 坐标系 */
const CHART_W = 300
const CHART_H = 118
const PAD = { top: 10, right: 8, bottom: 18, left: 26 }
/** 纵轴按满分 140 固定，保证 84 分参考线位置稳定可比 */
const MAX_SCORE = 140
const PASS = 84

const innerW = CHART_W - PAD.left - PAD.right
const innerH = CHART_H - PAD.top - PAD.bottom

const chartPoints = computed(() => {
  const n = examTrend.value.length
  if (!n) return []
  return examTrend.value.map((e, i) => ({
    x: PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW),
    y: PAD.top + innerH * (1 - e.score / MAX_SCORE),
    score: e.score,
  }))
})

const chartLine = computed(() => chartPoints.value.map((p) => `${p.x},${p.y}`).join(' '))

/** 84 分参考线的 y 坐标 */
const passY = computed(() => PAD.top + innerH * (1 - PASS / MAX_SCORE))

/** 与上一次模考的分差 */
const trendDelta = computed(() => {
  const t = examTrend.value
  if (t.length < 2) return 0
  return Math.round((t[t.length - 1].score - t[t.length - 2].score) * 10) / 10
})
</script>

<template>
  <div class="page dash">
    <header class="head">
      <h1 class="h1">数据看板</h1>
      <div class="tabs">
        <button :class="{ on: subject === 'econ_base' }" @click="(subject = 'econ_base'), load()">基础</button>
        <button :class="{ on: subject === 'hr' }" @click="(subject = 'hr'), load()">人力</button>
      </div>
    </header>

    <div v-if="loading" class="loading">加载中…</div>

    <template v-else>
      <section class="stats">
        <div class="stat card">
          <div class="stat__num">{{ stats.total }}</div>
          <div class="stat__label">累计答题</div>
        </div>
        <div class="stat card">
          <div class="stat__num">{{ accuracy }}%</div>
          <div class="stat__label">总正确率</div>
        </div>
        <div class="stat card">
          <div class="stat__num">{{ dueCount }}</div>
          <div class="stat__label">待复习</div>
        </div>
        <div class="stat card">
          <div class="stat__num">{{ streak }}</div>
          <div class="stat__label">连续天数</div>
        </div>
      </section>

      <!-- 过线预测（PRD M8-F2） -->
      <section v-if="prediction" class="card pred">
        <div class="pred__title">过线预测</div>
        <div class="pred__main">
          <div class="pred__prob" :class="prediction.probability >= 0.6 ? 'ok' : 'warn'">
            {{ Math.round(prediction.probability * 100) }}%
          </div>
          <div class="pred__side">
            <div>预计 {{ prediction.range[0] }} - {{ prediction.range[1] }} 分</div>
            <div class="text-caption">合格线 84 分 · 距考试 {{ prediction.daysToExam }} 天</div>
          </div>
        </div>
        <div v-if="prediction.levers.length" class="levers">
          <div class="levers__title">提分杠杆（优先补这些）</div>
          <div v-for="l in prediction.levers" :key="l.moduleId" class="lever">
            <span class="lever__name">{{ l.name }}</span>
            <span class="text-caption">{{ l.weight }} 分 · 当前 {{ l.mastery }}%</span>
            <span class="lever__gain">+{{ l.gainPerTen }} 分/10%</span>
          </div>
        </div>
        <p class="disclaimer text-caption">{{ prediction.disclaimer }}</p>
      </section>

      <!-- 模块掌握度 -->
      <section class="card block">
        <div class="block__title">模块掌握度</div>
        <div v-for="m in modules" :key="m.id" class="mod">
          <div class="mod__name">
            {{ m.name }}
            <span class="text-caption">{{ m.weight }} 分</span>
          </div>
          <div class="bar">
            <div class="bar__fill" :style="{ width: `${m.mastery}%`, background: barColor(m.mastery) }" />
          </div>
          <span class="mod__num">{{ m.mastery }}%</span>
        </div>
      </section>

      <!-- 学习热力图：最近 12 周 -->
      <section class="card block">
        <div class="block__title heat__head">
          <span>学习热力图</span>
          <span class="text-caption">近 12 周 · 活跃 {{ activeDays }} 天</span>
        </div>
        <div v-if="!cells.length" class="text-caption empty">还没有学习记录</div>
        <template v-else>
          <div class="heat">
            <div
              v-for="(c, i) in cells"
              :key="i"
              class="heat__cell"
              :style="{ background: c ? HEAT_COLOR[heatLevel(c.count)] : 'transparent' }"
              :title="c ? `${c.date} · ${c.count} 题` : ''"
            />
          </div>
          <div class="heat__legend">
            <span class="text-caption">少</span>
            <span
              v-for="lvl in 5"
              :key="lvl"
              class="heat__cell heat__cell--sm"
              :style="{ background: HEAT_COLOR[lvl - 1] }"
            />
            <span class="text-caption">多</span>
          </div>
        </template>
      </section>

      <!-- 模考成绩趋势（含 84 分参考线，PRD M8-F1） -->
      <section v-if="examTrend.length" class="card block">
        <div class="block__title heat__head">
          <span>模考成绩趋势</span>
          <span
            v-if="examTrend.length >= 2"
            class="trend__delta"
            :class="trendDelta >= 0 ? 'trend__delta--up' : 'trend__delta--down'"
          >
            较上次 {{ trendDelta >= 0 ? '+' : '' }}{{ trendDelta }} 分
          </span>
        </div>

        <svg
          class="trend"
          :viewBox="`0 0 ${CHART_W} ${CHART_H}`"
          role="img"
          aria-label="模考成绩趋势"
        >
          <line
            :x1="PAD.left"
            :x2="CHART_W - PAD.right"
            :y1="passY"
            :y2="passY"
            stroke="var(--color-warning)"
            stroke-width="1"
            stroke-dasharray="4 3"
          />
          <text :x="2" :y="passY + 3" class="trend__axis">84</text>
          <text :x="2" :y="PAD.top + 8" class="trend__axis">140</text>

          <polyline
            :points="chartLine"
            fill="none"
            stroke="var(--color-primary)"
            stroke-width="2"
          />
          <circle
            v-for="(p, i) in chartPoints"
            :key="i"
            :cx="p.x"
            :cy="p.y"
            r="3"
            :fill="p.score >= PASS ? 'var(--color-success)' : 'var(--color-danger)'"
          />
        </svg>

        <div class="text-caption trend__note">
          共 {{ examTrend.length }} 次模考 · 虚线为 84 分合格线
        </div>
      </section>

      <!-- 元认知校准图（PRD M8-F1 特色）：你以为的 vs 实际的 -->
      <section class="card block">
        <div class="block__title heat__head">
          <span>元认知校准</span>
          <span
            v-if="calibration?.buckets.length"
            class="calib__badge"
            :class="calibration?.ok ? 'calib__badge--ok' : 'calib__badge--warn'"
          >
            偏差 {{ Math.round((calibration?.deviation ?? 0) * 100) }}%
          </span>
        </div>

        <p class="text-caption calib__desc">
          横轴是你说「有多大把握」，纵轴是实际正确率。两者越接近，说明你越清楚自己会什么。
        </p>

        <div v-if="!calibration?.buckets.length" class="text-caption empty">
          {{ calibration?.insight }}
        </div>

        <template v-else>
          <div class="calib__chart">
            <div v-for="b in calibration.buckets" :key="b.confidence" class="calib__col">
              <div class="calib__bars">
                <div
                  class="calib__bar calib__bar--actual"
                  :style="{ height: `${Math.max(Math.round(b.actual * 100), 4)}%` }"
                  :title="`实际 ${Math.round(b.actual * 100)}%`"
                />
                <div
                  class="calib__bar calib__bar--nominal"
                  :style="{ height: `${Math.max(Math.round(b.nominal * 100), 4)}%` }"
                  :title="`你的预期 ${Math.round(b.nominal * 100)}%`"
                />
              </div>
              <div class="calib__x">
                {{ b.label }}
                <span class="calib__cnt">{{ b.count }}</span>
              </div>
            </div>
          </div>

          <div class="calib__legend">
            <span><i class="dot dot--actual" />实际正确率</span>
            <span><i class="dot dot--nominal" />你的预期</span>
          </div>

          <div class="calib__insight">{{ calibration.insight }}</div>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.dash {
  padding: calc(var(--safe-top) + var(--sp-4)) var(--sp-4)
    calc(var(--tabbar-h) + var(--safe-bottom) + var(--sp-4));
  min-height: 100%;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-4);
}
.h1 {
  font-size: 22px;
  font-weight: 600;
}
.tabs {
  display: flex;
  gap: 4px;
}
.tabs button {
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-secondary);
  border-radius: 14px;
  padding: 4px 12px;
  font-size: var(--fs-caption);
  min-height: 30px;
}
.tabs .on {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--sp-2);
  margin-bottom: var(--sp-3);
}
.stat {
  text-align: center;
  padding: var(--sp-3) var(--sp-1);
}
.stat__num {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-primary);
}
.stat__label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.pred {
  margin-bottom: var(--sp-3);
}
.pred__title {
  font-weight: 500;
  margin-bottom: var(--sp-3);
}
.pred__main {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
}
.pred__prob {
  font-size: 32px;
  font-weight: 600;
}
.ok {
  color: var(--color-success);
}
.warn {
  color: var(--color-danger);
}
.pred__side {
  flex: 1;
  font-size: var(--fs-body);
}
.levers {
  margin-top: var(--sp-3);
  border-top: 1px solid var(--border-color);
  padding-top: var(--sp-2);
}
.levers__title {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.lever {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 6px 0;
  font-size: var(--fs-aux);
}
.lever__name {
  min-width: 76px;
}
.lever__gain {
  margin-left: auto;
  color: var(--color-success);
  font-weight: 500;
}
.disclaimer {
  margin-top: var(--sp-3);
  line-height: 1.6;
}
.block__title {
  font-weight: 500;
  margin-bottom: var(--sp-3);
}
.mod {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-2);
}
.mod__name {
  min-width: 84px;
  font-size: var(--fs-aux);
}
.bar {
  flex: 1;
  height: 8px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
}
.bar__fill {
  height: 100%;
}
.mod__num {
  min-width: 36px;
  text-align: right;
  font-size: var(--fs-caption);
}
.heat__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.heat {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 3px;
}
.heat__cell {
  aspect-ratio: 1;
  border-radius: 3px;
  background: var(--bg-tertiary);
}
.heat__cell--sm {
  width: 12px;
  height: 12px;
  aspect-ratio: auto;
}
.heat__legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-top: var(--sp-3);
}
.empty {
  padding: var(--sp-3) 0;
}
.loading {
  text-align: center;
  padding: var(--sp-8);
  color: var(--text-secondary);
}
/* ---------- 元认知校准图（PRD M8-F1 特色） ---------- */
.calib__badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
}
.calib__badge--ok {
  background: rgba(16, 185, 129, 0.14);
  color: var(--color-success);
}
.calib__badge--warn {
  background: rgba(245, 158, 11, 0.14);
  color: var(--color-warning);
}
.calib__desc {
  line-height: 1.7;
  margin-bottom: var(--sp-3);
}
.calib__chart {
  display: flex;
  justify-content: space-around;
  align-items: flex-end;
  gap: var(--sp-3);
  height: 132px;
  padding: 0 var(--sp-2);
}
.calib__col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}
.calib__bars {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 5px;
}
.calib__bar {
  width: 18px;
  border-radius: 3px 3px 0 0;
  min-height: 4px;
  transition: height 0.3s;
}
.calib__bar--actual {
  background: var(--color-primary);
}
.calib__bar--nominal {
  background: var(--bg-tertiary);
  border: 1px dashed var(--border-strong);
}
.calib__x {
  margin-top: 6px;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  text-align: center;
}
.calib__cnt {
  display: block;
  font-size: 10px;
  color: var(--text-tertiary);
}
.calib__legend {
  display: flex;
  gap: var(--sp-4);
  justify-content: center;
  margin-top: var(--sp-3);
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.calib__legend span {
  display: flex;
  align-items: center;
  gap: 4px;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  display: inline-block;
}
.dot--actual {
  background: var(--color-primary);
}
.dot--nominal {
  background: var(--bg-tertiary);
  border: 1px dashed var(--border-strong);
}
.calib__insight {
  margin-top: var(--sp-3);
  padding: var(--sp-3);
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-caption);
  line-height: 1.8;
  color: var(--text-secondary);
}
/* ---------- 模考成绩趋势 ---------- */
.trend {
  width: 100%;
  height: auto;
  display: block;
}
.trend__axis {
  font-size: 9px;
  fill: var(--text-tertiary);
}
.trend__delta {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
}
.trend__delta--up {
  background: rgba(16, 185, 129, 0.14);
  color: var(--color-success);
}
.trend__delta--down {
  background: rgba(239, 68, 68, 0.14);
  color: var(--color-danger);
}
.trend__note {
  margin-top: var(--sp-2);
}
</style>
