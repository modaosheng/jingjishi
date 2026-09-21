<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getServices } from '@/services'
import type { SubjectId } from '@/domain/entities'
import type { BaseLevel, StudyPeriod } from '@/domain/services/onboardingService'

const router = useRouter()
const step = ref(0)
const TOTAL = 5

const subjectIds = ref<SubjectId[]>(['econ_base', 'hr'])
const examDate = ref('2026-11-07')
const dailyMinutes = ref(60)
const studyPeriod = ref<StudyPeriod>('night')
const baseLevel = ref<BaseLevel>('zero')
const targetScore = ref(100)
const submitting = ref(false)

const canNext = computed(() => {
  if (step.value === 0) return subjectIds.value.length > 0
  if (step.value === 1) return !!examDate.value
  return true
})

function toggleSubject(id: SubjectId) {
  const i = subjectIds.value.indexOf(id)
  if (i >= 0) {
    if (subjectIds.value.length > 1) subjectIds.value.splice(i, 1)
  } else {
    subjectIds.value.push(id)
  }
}

async function finish(withPlacement: boolean) {
  submitting.value = true
  await getServices().onboarding.complete({
    subjectIds: subjectIds.value,
    examDate: examDate.value,
    dailyMinutes: dailyMinutes.value,
    studyPeriod: studyPeriod.value,
    baseLevel: baseLevel.value,
    targetScore: targetScore.value,
    placementDone: false,
  })
  if (withPlacement) {
    router.replace({ path: '/quiz', query: { mode: 'chapter', count: 30, subject: subjectIds.value[0] } })
  } else {
    router.replace('/study')
  }
}
</script>

<template>
  <div class="page--no-tab ob">
    <div class="ob__bar">
      <span v-for="i in TOTAL" :key="i" class="dot" :class="{ 'dot--on': i <= step + 1 }" />
    </div>

    <!-- S1 科目 -->
    <section v-if="step === 0">
      <h2 class="h2">你要考哪一科？</h2>
      <p class="text-aux">《经济基础知识》为公共必考，实务可任选其一（当前支持人力资源管理）</p>
      <button class="opt" :class="{ 'opt--on': subjectIds.includes('econ_base') }" @click="toggleSubject('econ_base')">
        <div>经济基础知识</div>
        <div class="text-caption">105 题 · 140 分 · 84 分合格</div>
      </button>
      <button class="opt" :class="{ 'opt--on': subjectIds.includes('hr') }" @click="toggleSubject('hr')">
        <div>人力资源管理</div>
        <div class="text-caption">100 题 · 140 分 · 84 分合格</div>
      </button>
    </section>

    <!-- S2 考试日期 -->
    <section v-else-if="step === 1">
      <h2 class="h2">考试日期</h2>
      <p class="text-aux">2026 年度考试为 11 月 7-8 日，分批次进行</p>
      <input v-model="examDate" class="input" type="date" />
    </section>

    <!-- S3 每日时长与时段 -->
    <section v-else-if="step === 2">
      <h2 class="h2">每天能学多久？</h2>
      <div class="chips">
        <button
          v-for="m in [15, 30, 45, 60, 90, 120]"
          :key="m"
          class="chip"
          :class="{ 'chip--on': dailyMinutes === m }"
          @click="dailyMinutes = m"
        >
          {{ m }} 分钟
        </button>
      </div>
      <h2 class="h2 mt">通常什么时候学？</h2>
      <div class="chips">
        <button class="chip" :class="{ 'chip--on': studyPeriod === 'morning' }" @click="studyPeriod = 'morning'">早起</button>
        <button class="chip" :class="{ 'chip--on': studyPeriod === 'commute' }" @click="studyPeriod = 'commute'">通勤</button>
        <button class="chip" :class="{ 'chip--on': studyPeriod === 'noon' }" @click="studyPeriod = 'noon'">午休</button>
        <button class="chip" :class="{ 'chip--on': studyPeriod === 'night' }" @click="studyPeriod = 'night'">睡前</button>
      </div>
    </section>

    <!-- S4 基础与目标 -->
    <section v-else-if="step === 3">
      <h2 class="h2">你的基础如何？</h2>
      <div class="chips col">
        <button class="chip" :class="{ 'chip--on': baseLevel === 'zero' }" @click="baseLevel = 'zero'">
          零基础，没接触过
        </button>
        <button class="chip" :class="{ 'chip--on': baseLevel === 'some' }" @click="baseLevel = 'some'">
          学过一些，忘了大半
        </button>
        <button class="chip" :class="{ 'chip--on': baseLevel === 'experienced' }" @click="baseLevel = 'experienced'">
          有相关工作经验
        </button>
      </div>
      <h2 class="h2 mt">目标分数</h2>
      <p class="text-aux">合格线 84 分。建议留出安全垫，默认目标 100 分</p>
      <div class="chips">
        <button v-for="s in [84, 95, 100, 110, 120]" :key="s" class="chip" :class="{ 'chip--on': targetScore === s }" @click="targetScore = s">
          {{ s }} 分
        </button>
      </div>
    </section>

    <!-- S5 摸底测评 -->
    <section v-else>
      <h2 class="h2">做个摸底测评？</h2>
      <p class="text-aux">
        30 道分模块抽样的题，用来建立你的初始掌握度画像。做了之后计划会更准，也可以跳过。
      </p>
      <button class="primary-btn" :disabled="submitting" @click="finish(true)">开始测评（约 15 分钟）</button>
      <button class="ghost-btn" :disabled="submitting" @click="finish(false)">跳过，直接开始</button>
    </section>

    <footer class="ob__foot">
      <button v-if="step > 0" class="nav" @click="step--">上一步</button>
      <button v-if="step < TOTAL - 1" class="nav nav--primary" :disabled="!canNext" @click="step++">
        下一步
      </button>
    </footer>
  </div>
</template>

<style scoped>
.ob {
  padding: calc(var(--safe-top) + var(--sp-6)) var(--sp-5) calc(var(--safe-bottom) + var(--sp-5));
  min-height: 100%;
  background: var(--bg-secondary);
}
.ob__bar {
  display: flex;
  gap: 6px;
  margin-bottom: var(--sp-5);
}
.dot {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--bg-tertiary);
}
.dot--on {
  background: var(--color-primary);
}
.h2 {
  font-size: var(--fs-title);
  font-weight: 600;
  margin-bottom: var(--sp-2);
}
.mt {
  margin-top: var(--sp-6);
}
.opt {
  width: 100%;
  text-align: left;
  padding: var(--sp-4);
  border: 1.5px solid var(--border-color);
  background: var(--bg-primary);
  border-radius: var(--radius-md);
  margin-bottom: var(--sp-2);
  min-height: 64px;
}
.opt--on {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}
.input {
  width: 100%;
  height: var(--btn-h);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  padding: 0 var(--sp-3);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--fs-body);
  margin-top: var(--sp-3);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.chips.col {
  flex-direction: column;
}
.chip {
  padding: 10px 16px;
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-aux);
  min-height: var(--tap-min);
}
.chip--on {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
}
.primary-btn {
  width: 100%;
  height: var(--btn-h);
  margin-top: var(--sp-5);
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--fs-body);
}
.ghost-btn {
  width: 100%;
  height: var(--btn-h);
  margin-top: var(--sp-3);
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  font-size: var(--fs-body);
}
.ob__foot {
  display: flex;
  gap: var(--sp-3);
  margin-top: var(--sp-6);
}
.nav {
  flex: 1;
  height: var(--btn-h);
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: var(--radius-md);
}
.nav--primary {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
</style>
