<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getDataSource } from '@/infrastructure'
import { getServices } from '@/services'
import { useSubjectStore } from '@/stores/subject'
import {
  applyCapacityFactor,
  daysUntilExam,
  evaluateAdjustment,
  summarizeProgress,
  type AdjustSignal,
  type DailyStat,
} from '@/domain/services/planEngineService'
import type { TodayOverview, TaskPack } from '@/domain/entities'

const router = useRouter()
const subjectStore = useSubjectStore()
const overview = ref<TodayOverview | null>(null)
const loading = ref(true)
/** 计划调整建议（PRD §6.6） */
const adjustment = ref<AdjustSignal | null>(null)

const todayStr = () => {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const TYPE_META: Record<TaskPack['type'], { icon: string; label: string; color: string }> = {
  review: { icon: '🔴', label: '复习', color: 'var(--color-danger)' },
  new: { icon: '📘', label: '新学', color: 'var(--color-primary)' },
  wrong: { icon: '❌', label: '错题', color: 'var(--color-warning)' },
  test: { icon: '📝', label: '测试', color: 'var(--color-success)' },
  exam: { icon: '🎯', label: '模考', color: 'var(--color-info)' },
}

async function load() {
  loading.value = true
  // 任务包生成与首页聚合是业务规则，统一走 PlanService
  overview.value = await getServices().plan.getTodayOverview()
  loading.value = false
  // 计划调整评估不阻塞首屏，后台算即可
  loadAdjustment().catch(() => {})
}

/* ---------- 动态调整（PRD §6.6） ---------- */

/**
 * 汇总最近 14 天的学习情况，评估是否需要调整计划
 * 同一天内用户处理过就不再重复打扰
 */
async function loadAdjustment() {
  if (localStorage.getItem('jingshi.adjust_dismissed') === todayStr()) return

  const ds = getDataSource()
  const counts = await ds.answerLogs.dailyCounts(14)

  // 每日计划量 = 当天任务包中各 pack 的题数之和（无任务包则记 0，由汇总逻辑兜底）
  const daily: DailyStat[] = []
  for (const c of counts) {
    const pack = await ds.plan.getTaskPack(c.date)
    const planned = pack ? pack.packs.reduce((s, p) => s + p.questionCount, 0) : 0
    daily.push({ date: c.date, answered: c.count, planned })
  }

  // 模考成绩（list 返回时间倒序）
  const exams = await ds.exams.list(5)
  const scores = exams.map((e) => e.score)

  adjustment.value = evaluateAdjustment(summarizeProgress(daily, scores, daysUntilExam()))
}

/** 接受调整：把容量系数落地（明天生效，不打断今天的任务） */
function acceptAdjustment() {
  const f = adjustment.value?.capacityFactor
  if (f) {
    applyCapacityFactor(f)
    window.alert(
      f < 1
        ? '已把每日容量下调，明天起生效。\n\n进度可以慢，节奏不能断。'
        : '已提高每日容量，明天起生效。\n\n保持这个节奏。',
    )
  }
  dismissAdjustment()
}

function dismissAdjustment() {
  localStorage.setItem('jingshi.adjust_dismissed', todayStr())
  adjustment.value = null
}

onMounted(load)

const percent = computed(() => {
  if (!overview.value || overview.value.totalCount === 0) return 0
  return Math.round((overview.value.completedCount / overview.value.totalCount) * 100)
})

// 环形进度（PRD §10.2：直径 88px，环宽 8px）
const R = 40
const CIRCUMFERENCE = 2 * Math.PI * R
const dashOffset = computed(() => CIRCUMFERENCE * (1 - percent.value / 100))

async function startPack(pack: TaskPack) {
  if (pack.type === 'exam') {
    router.push('/exam')
    return
  }
  const mode =
    pack.type === 'review' ? 'review' : pack.type === 'wrong' ? 'wrong' : pack.type === 'test' ? 'chapter' : 'chapter'
  router.push({ path: '/quiz', query: { mode, count: String(pack.questionCount), packId: pack.id } })
}
</script>

<template>
  <div class="page today">
    <header class="today__header">
      <div>
        <div class="title">今日任务</div>
        <div class="text-aux">
          {{ overview?.date }} · 剩余 {{ overview?.remainingMinutes ?? 0 }} 分钟
        </div>
        <button class="subj-chip" @click="subjectStore.toggle()">
          {{ subjectStore.shortName() }} ⇄
        </button>
      </div>
      <button class="countdown" @click="router.push('/study/roadmap')">
        <span class="countdown__row">
          <span class="countdown__num">{{ overview?.daysToExam ?? 0 }}</span>
          <span class="countdown__label">天</span>
        </span>
        <span class="countdown__go">作战地图 ›</span>
      </button>
    </header>

    <div v-if="loading" class="loading">加载中…</div>

    <template v-else-if="overview">
      <!-- 进度环（蔡格尼克效应：未完成时有视觉张力） -->
      <section class="ring-card card">
        <svg class="ring" width="88" height="88" viewBox="0 0 88 88" role="img" aria-label="今日任务完成度">
          <circle cx="44" cy="44" :r="R" fill="none" stroke="var(--bg-tertiary)" stroke-width="8" />
          <circle
            cx="44"
            cy="44"
            :r="R"
            fill="none"
            stroke="var(--color-primary)"
            stroke-width="8"
            stroke-linecap="round"
            :stroke-dasharray="CIRCUMFERENCE"
            :stroke-dashoffset="dashOffset"
            transform="rotate(-90 44 44)"
          />
          <text x="44" y="44" text-anchor="middle" dominant-baseline="central" class="ring__text">
            {{ overview.completedCount }}/{{ overview.totalCount }}
          </text>
        </svg>
        <div class="ring-info">
          <div class="ring-title">今日进度</div>
          <div class="text-aux">完成全部任务即可保持连续学习</div>
          <div v-if="overview.weeklyMasteryDelta" class="delta">
            本周掌握度 +{{ overview.weeklyMasteryDelta }}%
          </div>
        </div>
      </section>

      <!-- 复习超载提示（PRD §6.4：宁可不学新的，也不能欠复习的债） -->
      <div v-if="overview.overloadNotice" class="notice">
        <span class="notice__icon">⚠️</span>
        <span>{{ overview.overloadNotice }}</span>
      </div>

      <!-- 计划调整建议（PRD §6.6：不指责，主动调整） -->
      <div v-if="adjustment" class="adjust">
        <div class="adjust__head">
          <span class="adjust__icon">🧭</span>
          <span class="adjust__title">{{ adjustment.title }}</span>
        </div>
        <p class="adjust__msg">{{ adjustment.message }}</p>
        <div class="adjust__ops">
          <button
            v-if="adjustment.capacityFactor"
            class="adjust__btn adjust__btn--primary"
            @click="acceptAdjustment"
          >
            好的，就这样
          </button>
          <button class="adjust__btn" @click="dismissAdjustment">先保持不变</button>
        </div>
      </div>

      <!-- 任务包列表：复习置顶，视觉权重最高 -->
      <section class="packs">
        <div
          v-for="pack in overview.packs"
          :key="pack.id"
          class="pack"
          :class="{ 'pack--done': pack.completed, 'pack--review': pack.type === 'review' }"
          role="button"
          tabindex="0"
          @click="startPack(pack)"
        >
          <div class="pack__icon">{{ TYPE_META[pack.type].icon }}</div>
          <div class="pack__body">
            <div class="pack__title">{{ pack.title }}</div>
            <div class="text-caption">
              {{ pack.questionCount }} 题 · 约 {{ pack.estimatedMinutes }} 分钟
            </div>
          </div>
          <div class="pack__action">
            <span v-if="pack.completed" class="pack__done">已完成</span>
            <span v-else class="pack__go">开始</span>
          </div>
        </div>
      </section>

      <!-- 上岸作战地图入口（PRD §6.2） -->
      <button class="roadmap-entry" @click="router.push('/study/roadmap')">
        <span class="roadmap-entry__icon">🗺️</span>
        <span class="roadmap-entry__body">
          <span class="roadmap-entry__title">上岸作战地图</span>
          <span class="text-caption">四个阶段怎么走、你现在在哪、还剩多远</span>
        </span>
        <span class="roadmap-entry__go">›</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.today {
  padding: calc(var(--safe-top) + var(--sp-4)) var(--sp-4) calc(var(--tabbar-h) + var(--safe-bottom) + var(--sp-4));
  background: var(--bg-secondary);
  min-height: 100%;
}
.today__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-4);
}
.title {
  font-size: 22px;
  font-weight: 600;
}
.subj-chip {
  margin-top: var(--sp-1);
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
  border-radius: 12px;
  padding: 2px 10px;
  font-size: 11px;
  min-height: 24px;
}
.countdown {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  background: none;
  border: none;
  padding: 0;
}
.countdown__row {
  display: flex;
  align-items: baseline;
  gap: 2px;
  color: var(--color-danger);
}
.countdown__num {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.1;
}
.countdown__label {
  font-size: var(--fs-aux);
}
.countdown__go {
  font-size: 10px;
  color: var(--color-primary);
}
/* 作战地图入口（PRD §6.2） */
.roadmap-entry {
  width: 100%;
  margin-top: var(--sp-3);
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--sp-3) var(--sp-4);
  text-align: left;
}
.roadmap-entry__icon {
  font-size: 20px;
  flex-shrink: 0;
}
.roadmap-entry__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.roadmap-entry__title {
  font-size: var(--fs-body);
  font-weight: 500;
  color: var(--text-primary);
}
.roadmap-entry__go {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.ring-card {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  margin-bottom: var(--sp-3);
}
.ring__text {
  font-size: 16px;
  font-weight: 600;
  fill: var(--text-primary);
}
.ring-info {
  flex: 1;
}
.ring-title {
  font-size: var(--fs-title);
  font-weight: 500;
  margin-bottom: 2px;
}
.delta {
  margin-top: var(--sp-2);
  display: inline-block;
  font-size: var(--fs-caption);
  color: var(--color-success);
  background: rgba(22, 163, 74, 0.1);
  padding: 2px 8px;
  border-radius: 10px;
}
.notice {
  display: flex;
  gap: var(--sp-2);
  align-items: flex-start;
  background: rgba(245, 158, 11, 0.12);
  border-left: 3px solid var(--color-warning);
  padding: var(--sp-3);
  border-radius: var(--radius-sm);
  font-size: var(--fs-aux);
  color: var(--text-primary);
  margin-bottom: var(--sp-3);
}
.packs {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.pack {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  background: var(--bg-primary);
  border-radius: var(--radius-md);
  padding: var(--sp-4);
  min-height: 68px;
  transition: opacity 0.15s;
}
.pack--review {
  border-left: 3px solid var(--color-danger);
}
.pack--done {
  opacity: 0.5;
}
.pack__icon {
  font-size: 20px;
  width: 24px;
  text-align: center;
}
.pack__body {
  flex: 1;
}
.pack__title {
  font-size: var(--fs-body);
  font-weight: 500;
  margin-bottom: 2px;
}
.pack__go {
  color: var(--color-primary);
  font-size: var(--fs-aux);
}
.pack__done {
  color: var(--text-tertiary);
  font-size: var(--fs-aux);
}
.loading {
  padding: var(--sp-8);
  text-align: center;
  color: var(--text-secondary);
}
/* 计划调整建议卡片（PRD §6.6：落后降档 / 超额加档，语气不指责） */
.adjust {
  margin-top: var(--sp-3);
  background: var(--bg-primary);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-md);
  padding: var(--sp-3) var(--sp-4);
}
.adjust__head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.adjust__icon {
  font-size: 16px;
}
.adjust__title {
  font-size: var(--fs-body);
  font-weight: 500;
  color: var(--color-primary);
}
.adjust__msg {
  font-size: var(--fs-caption);
  line-height: 1.7;
  color: var(--text-secondary);
  margin-bottom: var(--sp-3);
}
.adjust__ops {
  display: flex;
  gap: var(--sp-2);
}
.adjust__btn {
  flex: 1;
  height: 36px;
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-caption);
  font-family: inherit;
}
.adjust__btn--primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
</style>
