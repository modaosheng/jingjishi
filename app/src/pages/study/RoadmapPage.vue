<script setup lang="ts">
/**
 * 上岸作战地图（PRD §6.2 / §6.3）
 *
 * 展示四阶段时间表：我在哪、还有多远、每阶段该干什么、为什么是这个顺序。
 * 这是 PRD 点名的「第一次让用户感到这个 App 真的懂考试」的地方。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { buildRoadmap, type Roadmap } from '@/domain/services/planEngineService'
import { useSubjectStore } from '@/stores/subject'

const router = useRouter()
const subjectStore = useSubjectStore()
const roadmap = ref<Roadmap | null>(null)

const PLAN_START_KEY = 'jingshi.plan_start'

/** 计划开始日：首次访问时记录，用于推算「已进行天数」 */
function planStart(): string | undefined {
  const saved = localStorage.getItem(PLAN_START_KEY)
  if (saved) return saved
  return undefined
}

onMounted(() => {
  roadmap.value = buildRoadmap(new Date(), planStart())
  if (!localStorage.getItem(PLAN_START_KEY)) {
    localStorage.setItem(PLAN_START_KEY, new Date().toISOString().slice(0, 10))
  }
})

const progressPct = computed(() => Math.round((roadmap.value?.progress ?? 0) * 100))

/** 模块学习顺序的排序理由（PRD §6.3，本身就是卖点） */
const whyText = computed(() => {
  if (subjectStore.current !== 'econ_base') {
    return '实务科目按「教材章节 + 近 5 年真题频次」动态排序——权重高、考得多的章节优先，不写死顺序。'
  }
  return [
    '按「分值权重 × 学习性价比 × 遗忘敏感度」排序：',
    '① 经济学基础分值最高（29-30 分），且是所有模块的理解底座——先啃最难的骨头，因为此刻精力最充沛；',
    '② 货币与金融贴近生活、理解难度低，早期快速提分建立信心；',
    '③ 财政考点细碎、记忆量大，放中期配合对比记忆；',
    '④ 统计公式为主、套路固定，短期可突破；',
    '⑤ 会计需要一定理解成本；',
    '⑥ 法律纯记忆、遗忘最快，放在临考前，使「记忆 → 考试」的间隔最短。',
  ].join('\n')
})
</script>

<template>
  <div class="page roadmap">
    <header class="head">
      <button class="back" @click="router.back()">‹</button>
      <h1 class="h1">上岸作战地图</h1>
    </header>

    <template v-if="roadmap">
      <!-- 概览 -->
      <section class="card overview">
        <div class="overview__top">
          <div class="overview__days">
            <span class="overview__num">{{ roadmap.daysLeft }}</span>
            <span class="overview__unit">天后考试</span>
          </div>
          <span class="tag">{{ roadmap.templateLabel }}</span>
        </div>

        <div class="bar">
          <div class="bar__fill" :style="{ width: `${progressPct}%` }" />
        </div>
        <div class="overview__meta text-caption">
          计划共 {{ roadmap.totalDays }} 天 · 已进行 {{ roadmap.elapsedDays }} 天 · {{ progressPct }}%
        </div>
        <p class="overview__note text-caption">{{ roadmap.templateNote }}</p>
      </section>

      <!-- 四阶段时间轴 -->
      <section class="timeline">
        <div
          v-for="s in roadmap.stages"
          :key="s.id"
          class="stage"
          :class="[`stage--${s.status}`, { 'stage--now': s.id === roadmap.currentStageId }]"
        >
          <div class="stage__rail">
            <div class="stage__dot">
              {{ s.status === 'past' ? '✓' : s.id === roadmap.currentStageId ? '▶' : '' }}
            </div>
            <div class="stage__line" />
          </div>

          <div class="stage__body">
            <div class="stage__head">
              <span class="stage__name">{{ s.id }} · {{ s.name }}</span>
              <span v-if="s.id === roadmap.currentStageId" class="stage__now">你在这里</span>
            </div>
            <div class="text-caption">{{ s.startDate }} ~ {{ s.endDate }}（{{ s.days }} 天）</div>
            <div class="stage__goal">🎯 {{ s.goal }}</div>
            <div class="stage__actions">{{ s.actions }}</div>
            <div class="stage__ratio">{{ s.ratio }}</div>
          </div>
        </div>
      </section>

      <!-- 排序理由 -->
      <section class="card why">
        <div class="why__title">为什么是这个顺序？</div>
        <p class="why__text">{{ whyText }}</p>
      </section>

      <p class="text-caption tip">
        计划会根据你的完成情况自动调整——连续落后会降档保节奏，超额完成会提前推进。
      </p>
    </template>

    <div v-else class="text-caption loading">生成地图中…</div>
  </div>
</template>

<style scoped>
.roadmap {
  padding: calc(var(--safe-top) + var(--sp-2)) var(--sp-4)
    calc(var(--tabbar-h) + var(--safe-bottom) + var(--sp-4));
  min-height: 100%;
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

/* ---------- 概览 ---------- */
.overview {
  margin-bottom: var(--sp-4);
}
.overview__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-3);
}
.overview__days {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.overview__num {
  font-size: 34px;
  font-weight: 700;
  color: var(--color-primary);
  line-height: 1;
}
.overview__unit {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
}
.tag {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 10px;
  background: rgba(59, 130, 246, 0.12);
  color: var(--color-primary);
}
.bar {
  height: 6px;
  border-radius: 3px;
  background: var(--bg-secondary);
  overflow: hidden;
}
.bar__fill {
  height: 100%;
  background: var(--color-primary);
  transition: width 0.3s;
}
.overview__meta {
  margin-top: 6px;
}
.overview__note {
  margin-top: var(--sp-2);
  line-height: 1.6;
}

/* ---------- 时间轴 ---------- */
.timeline {
  margin-bottom: var(--sp-4);
}
.stage {
  display: flex;
  gap: var(--sp-3);
}
.stage__rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 24px;
  flex-shrink: 0;
}
.stage__dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  background: var(--bg-secondary);
  color: var(--text-tertiary);
  border: 1px solid var(--border-color);
  flex-shrink: 0;
}
.stage__line {
  flex: 1;
  width: 1px;
  background: var(--border-color);
  min-height: 12px;
}
.stage:last-child .stage__line {
  display: none;
}
.stage__body {
  flex: 1;
  min-width: 0;
  padding-bottom: var(--sp-4);
}
.stage__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: 2px;
}
.stage__name {
  font-size: var(--fs-body);
  font-weight: 600;
}
.stage__now {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  background: var(--color-primary);
  color: #fff;
}
.stage__goal {
  margin-top: 6px;
  font-size: var(--fs-aux);
  color: var(--text-primary);
}
.stage__actions {
  margin-top: 4px;
  line-height: 1.6;
  color: var(--text-secondary);
}
.stage__ratio {
  margin-top: 6px;
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-tertiary);
}

/* 状态色 */
.stage--past .stage__dot {
  background: var(--color-success);
  border-color: var(--color-success);
  color: #fff;
}
.stage--past .stage__name {
  color: var(--text-tertiary);
}
.stage--current .stage__dot {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.stage--current .stage__name {
  color: var(--color-primary);
}
.stage--future {
  opacity: 0.65;
}

/* ---------- 排序理由 ---------- */
.why {
  margin-bottom: var(--sp-3);
}
.why__title {
  font-size: var(--fs-body);
  font-weight: 600;
  margin-bottom: var(--sp-2);
}
.why__text {
  font-size: var(--fs-caption);
  line-height: 1.9;
  color: var(--text-secondary);
  white-space: pre-line;
}
.tip {
  line-height: 1.6;
}
.loading {
  padding: var(--sp-6);
  text-align: center;
}
</style>
