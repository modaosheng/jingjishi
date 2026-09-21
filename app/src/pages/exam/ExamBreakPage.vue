<script setup lang="ts">
/**
 * 两科连考 · 中场休息（PRD R3）
 *
 * 真实考试两科在同一批次内连续组织，间隔 40 分钟。
 * 休息本身也是考试的一部分 —— 这里练的是「节奏与体力」，不只是知识。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getDataSource } from '@/infrastructure'

const route = useRoute()
const router = useRouter()

const nextSubject = (route.query.next as string) || 'hr'
/** 真实考场的中场休息时长 */
const TOTAL = 40 * 60
const remaining = ref(TOTAL)
let timer: number | undefined

const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

const pct = computed(() => Math.round((1 - remaining.value / TOTAL) * 100))

/** 上一科成绩（休息时回顾用） */
const lastExam = ref<{ subjectName: string; score: number; passed: boolean } | null>(null)

function startNext() {
  router.replace({
    path: '/exam/room',
    query: { subject: nextSubject, mode: 'strict', series: '1', stage: '2' },
  })
}

onMounted(async () => {
  const exams = await getDataSource().exams.list(1)
  const e = exams[0]
  if (e) {
    lastExam.value = {
      subjectName: e.subjectId === 'econ_base' ? '经济基础知识' : '人力资源管理',
      score: e.score,
      passed: e.passed,
    }
  }

  timer = window.setInterval(() => {
    remaining.value -= 1
    if (remaining.value <= 0) {
      clearInterval(timer)
      startNext()
    }
  }, 1000)
})

onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="page--no-tab break">
    <div class="break__head">
      <div class="break__title">中场休息</div>
      <div class="text-aux">两科连考 · 真实考场间隔 40 分钟</div>
    </div>

    <!-- 倒计时 -->
    <div class="timer card">
      <div class="timer__num">{{ fmt(remaining) }}</div>
      <div class="bar"><div class="bar__fill" :style="{ width: `${pct}%` }" /></div>
      <div class="text-caption">倒计时结束将自动进入下一科</div>
    </div>

    <!-- 上一科成绩 -->
    <div v-if="lastExam" class="card last">
      <div class="last__label">上一科已完成</div>
      <div class="last__row">
        <span>{{ lastExam.subjectName }}</span>
        <span class="last__score" :class="lastExam.passed ? 'ok' : 'bad'">
          {{ lastExam.score }} 分
        </span>
      </div>
    </div>

    <!-- 休息建议 -->
    <div class="card tips">
      <div class="tips__title">休息时建议</div>
      <ul class="tips__list">
        <li>起身活动、喝水、上厕所 —— 真实考场也只有这段时间</li>
        <li><b>别对答案</b>，上一科的情绪会直接影响下一科的判断</li>
        <li>提前 5 分钟回来，让注意力重新上线</li>
      </ul>
    </div>

    <button class="primary-btn" @click="startNext">跳过休息，直接开始下一科</button>
    <button class="btn-ghost" @click="router.replace('/exam')">放弃连考，返回模考</button>
  </div>
</template>

<style scoped>
.break {
  padding: calc(var(--safe-top) + var(--sp-4)) var(--sp-4) calc(var(--safe-bottom) + var(--sp-4));
  min-height: 100%;
}
.break__head {
  margin-bottom: var(--sp-4);
}
.break__title {
  font-size: 22px;
  font-weight: 600;
  margin-bottom: 4px;
}
.timer {
  text-align: center;
  margin-bottom: var(--sp-3);
}
.timer__num {
  font-size: 44px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-primary);
  line-height: 1.2;
}
.bar {
  height: 6px;
  border-radius: 3px;
  background: var(--bg-secondary);
  overflow: hidden;
  margin: var(--sp-3) 0 var(--sp-2);
}
.bar__fill {
  height: 100%;
  background: var(--color-primary);
  transition: width 1s linear;
}
.last {
  margin-bottom: var(--sp-3);
}
.last__label {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.last__row {
  display: flex;
  justify-content: space-between;
  font-size: var(--fs-body);
}
.last__score {
  font-weight: 600;
}
.last__score.ok {
  color: var(--color-success);
}
.last__score.bad {
  color: var(--color-danger);
}
.tips {
  margin-bottom: var(--sp-4);
}
.tips__title {
  font-size: var(--fs-aux);
  font-weight: 600;
  margin-bottom: var(--sp-2);
}
.tips__list {
  margin: 0;
  padding-left: 18px;
  font-size: var(--fs-caption);
  line-height: 1.9;
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
