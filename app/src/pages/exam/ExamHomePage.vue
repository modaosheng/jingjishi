<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getDataSource } from '@/infrastructure'
import type { QuestionSet, SubjectId } from '@/domain/entities'

const router = useRouter()
const subjects: Array<{ id: SubjectId; name: string; desc: string }> = [
  { id: 'econ_base', name: '经济基础知识', desc: '105 题 · 140 分 · 84 分合格' },
  { id: 'hr', name: '人力资源管理', desc: '100 题 · 140 分 · 84 分合格' },
]

const activeSubject = ref<SubjectId>('econ_base')
const mode = ref<'strict' | 'loose'>('strict')
const history = ref<Array<{ id: string; score: number; passed: boolean; subjectId: SubjectId; startedAt: number }>>([])

/** 试卷来源：'random' = 官方题库随机组卷；否则为某个题集 id */
const sets = ref<QuestionSet[]>([])
const paperSource = ref<string>('random')

const pastSets = computed(() => sets.value.filter((s) => s.category === 'past_exam'))
const mySets = computed(() => sets.value.filter((s) => s.category !== 'past_exam'))

onMounted(async () => {
  history.value = await getDataSource().exams.list(5)
  // 题集用于「按真题/自建题库组卷」——只列当前科目的
  sets.value = await getDataSource().questionSets.list({ subjectId: activeSubject.value })
})

function start() {
  router.push({
    path: '/exam/room',
    query: {
      subject: activeSubject.value,
      mode: mode.value,
      set: paperSource.value === 'random' ? undefined : paperSource.value,
    },
  })
}

/**
 * 两科连考（PRD R3）：真实考试两科同批次连续组织，间隔 40 分钟。
 * 固定从经济基础开始 —— 与实际报考顺序一致。
 */
function startSeries() {
  router.push({
    path: '/exam/room',
    query: { subject: 'econ_base', mode: 'strict', series: '1' },
  })
}
</script>

<template>
  <div class="page exam-home">
    <h1 class="h1">全真模考</h1>
    <p class="text-aux">1:1 还原中国人事考试网机考界面，练的就是考场</p>

    <section class="card block">
      <div class="block__title">选择科目</div>
      <div class="subjects">
        <button
          v-for="s in subjects"
          :key="s.id"
          class="subject"
          :class="{ 'subject--on': activeSubject === s.id }"
          @click="activeSubject = s.id"
        >
          <div class="subject__name">{{ s.name }}</div>
          <div class="subject__desc">{{ s.desc }}</div>
        </button>
      </div>
    </section>

    <section class="card block">
      <div class="block__title">答题模式</div>
      <div class="modes">
        <button class="mode" :class="{ 'mode--on': mode === 'strict' }" @click="mode = 'strict'">
          <div class="mode__name">严格模式 <span class="badge">推荐</span></div>
          <div class="mode__desc">按题型分段锁定，进入下一题型后不可返回。最严约束，练一次性准确率</div>
        </button>
        <button class="mode" :class="{ 'mode--on': mode === 'loose' }" @click="mode = 'loose'">
          <div class="mode__name">宽松模式</div>
          <div class="mode__desc">本科目结束前可自由跳转修改答案</div>
        </button>
      </div>
    </section>

    <section class="card block">
      <div class="block__title">试卷来源</div>
      <div class="sources">
        <button
          class="source"
          :class="{ 'source--on': paperSource === 'random' }"
          @click="paperSource = 'random'"
        >
          <div class="source__name">官方题库随机卷</div>
          <div class="source__desc">按题型比例抽题，每次不同 · 最接近真实考场</div>
        </button>

        <template v-if="pastSets.length">
          <div class="source__group">往年真题</div>
          <button
            v-for="s in pastSets"
            :key="s.id"
            class="source"
            :class="{ 'source--on': paperSource === s.id }"
            @click="paperSource = s.id"
          >
            <div class="source__name">{{ s.name }}</div>
            <div class="source__desc">
              {{ s.year ? s.year + ' 年真题 · ' : '' }}{{ s.questionCount }} 题
            </div>
          </button>
        </template>

        <template v-if="mySets.length">
          <div class="source__group">我的题库</div>
          <button
            v-for="s in mySets"
            :key="s.id"
            class="source"
            :class="{ 'source--on': paperSource === s.id }"
            @click="paperSource = s.id"
          >
            <div class="source__name">{{ s.name }}</div>
            <div class="source__desc">{{ s.questionCount }} 题</div>
          </button>
        </template>

        <p v-if="!sets.length" class="text-caption source__empty">
          还没有自建题库。到「题库 → 导入」上传时把类别选为「往年真题」，就会出现在这里。
        </p>
      </div>
    </section>

    <section class="card block">
      <div class="block__title">机考工具（1:1 还原）</div>
      <div class="tools">
        <span>强调显示：选中文字标黄</span>
        <span>标记：拿不准的先标起来</span>
        <span>计算器：系统内置科学计算器</span>
        <span>文字缩放：看不清就放大</span>
        <span>案例题分栏：左右 / 上下切换</span>
      </div>
      <p class="text-caption tools__tip">
        这些工具与真实机考一致，在答题页底部作答栏使用。草稿纸考场统一发放，禁止自带计算器。
      </p>
    </section>

    <button class="primary-btn" @click="start">开始考试（90 分钟）</button>

    <!-- 两科连考（PRD R3）：练的是体力与节奏，不只是知识 -->
    <button class="series-btn" @click="startSeries">
      🔗 两科连考：基础 → 休息 40 分钟 → 人力
    </button>

    <section v-if="history.length" class="block">
      <div class="block__title">历史成绩</div>
      <div v-for="h in history" :key="h.id" class="hist">
        <span>{{ h.subjectId === 'econ_base' ? '经济基础' : '人力资源' }}</span>
        <span class="hist__score" :class="h.passed ? 'ok' : 'bad'">{{ h.score }} 分</span>
        <span class="text-caption">{{ h.passed ? '过线' : '未过线' }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.exam-home {
  padding: calc(var(--safe-top) + var(--sp-4)) var(--sp-4) calc(var(--tabbar-h) + var(--safe-bottom) + var(--sp-4));
  min-height: 100%;
}
.h1 {
  font-size: 22px;
  font-weight: 600;
  margin-bottom: 2px;
}
.block {
  margin-top: var(--sp-4);
}
.block__title {
  font-size: var(--fs-body);
  font-weight: 500;
  margin-bottom: var(--sp-3);
}
.subjects {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.subject {
  text-align: left;
  padding: var(--sp-3);
  border: 1.5px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  min-height: var(--tap-min);
}
.subject--on {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}
.subject__name {
  font-size: var(--fs-body);
  font-weight: 500;
}
.subject__desc {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.modes {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.mode {
  text-align: left;
  padding: var(--sp-3);
  border: 1.5px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
}
.mode--on {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}
.mode__name {
  font-size: var(--fs-body);
  font-weight: 500;
  margin-bottom: 2px;
}
.badge {
  font-size: 11px;
  background: var(--color-primary);
  color: #fff;
  padding: 1px 6px;
  border-radius: 8px;
  margin-left: 4px;
}
.mode__desc {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.6;
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
.hist {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3);
  background: var(--bg-primary);
  border-radius: var(--radius-sm);
  margin-bottom: var(--sp-2);
  font-size: var(--fs-aux);
}
.hist__score {
  margin-left: auto;
  font-weight: 600;
}
.ok {
  color: var(--color-success);
}
.bad {
  color: var(--color-danger);
}
.sources {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.source {
  text-align: left;
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  border-radius: var(--radius-sm);
  padding: var(--sp-3);
  color: var(--text-primary);
}
.source--on {
  border-color: var(--color-primary);
  background: rgba(59, 130, 246, 0.08);
}
.source__name {
  font-size: var(--fs-body);
  font-weight: 500;
  margin-bottom: 2px;
}
.source__desc {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.5;
}
.source__group {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  margin-top: var(--sp-1);
}
.source__empty {
  line-height: 1.6;
}
.tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--fs-aux);
  color: var(--text-secondary);
}
.tools__tip {
  margin-top: var(--sp-2);
  line-height: 1.6;
}
/* 两科连考按钮（PRD R3） */
.series-btn {
  width: 100%;
  margin-top: var(--sp-2);
  height: 46px;
  border: 1px solid var(--color-primary);
  background: rgba(59, 130, 246, 0.08);
  color: var(--color-primary);
  border-radius: var(--radius-md);
  font-size: var(--fs-aux);
  font-family: inherit;
}
</style>
