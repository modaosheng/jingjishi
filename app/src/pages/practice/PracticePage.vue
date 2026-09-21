<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSubjectStore } from '@/stores/subject'
import PracticeConfigSheet from '@/components/practice/PracticeConfigSheet.vue'
import type { PracticeContext } from '@/domain/services/practiceContext'
import type { PracticeMode } from '@/domain/entities'

const router = useRouter()
const subjectStore = useSubjectStore()

/** 需要上下文信息的模式：先弹选择器 */
const sheetMode = ref<'chapter' | 'special' | 'real_exam' | null>(null)
/** 题目来源说明展开状态 */
const showSource = ref(false)

/** 各板块的题目来源（用户最容易困惑的点） */
const SOURCE_NOTES: Array<{ icon: string; name: string; desc: string }> = [
  { icon: '📖', name: '章节练习', desc: '按所选章节从题库抽题（含你导入并归类到该章节的题）' },
  { icon: '🎯', name: '专项训练', desc: '按题型 / 难度从题库抽题' },
  { icon: '📜', name: '真题演练', desc: '近 5 年真题，可按年份筛选' },
  { icon: '❌', name: '错题重做', desc: '你做错过的题，按遗忘曲线安排重做' },
  { icon: '🔥', name: '高频必刷', desc: '近 5 年考查 ≥3 次的高频考点题' },
  { icon: '🔁', name: '今日复习', desc: '按 FSRS 算法算出「快要忘了」的题' },
]

/**
 * 练习模式：5 个
 * 注：「今日复习」不在此列——复习由首页「每日任务包」驱动（PRD §6.4），
 *     两处都放会让用户不知道该点哪个。
 */
const MODES: Array<{ key: PracticeMode; icon: string; title: string; desc: string }> = [
  { key: 'chapter', icon: '📖', title: '章节练习', desc: '学完即练，支持乱序' },
  { key: 'special', icon: '🎯', title: '专项训练', desc: '按知识点 / 题型突破' },
  { key: 'real_exam', icon: '📜', title: '真题演练', desc: '历年真题，可按考点横刷' },
  { key: 'wrong', icon: '❌', title: '错题重做', desc: '按遗忘曲线延迟调度' },
  { key: 'high_freq', icon: '🔥', title: '高频必刷', desc: '近 5 年考查≥3 次' },
]

function go(mode: PracticeMode) {
  if (mode === 'chapter' || mode === 'special' || mode === 'real_exam') {
    // 需要上下文（章节/年份/筛选条件）的模式：先弹选择器
    sheetMode.value = mode
    return
  }
  // 语义自明的模式（复习/错题/高频）：科目统一由 store 提供
  router.push({ path: '/quiz', query: { mode, count: 10 } })
}

function onConfirm(ctx: PracticeContext) {
  router.push({
    path: '/quiz',
    query: {
      mode: ctx.mode,
      count: 10,
      nodeId: ctx.nodeId || undefined,
      year: ctx.year ? String(ctx.year) : undefined,
      type: ctx.type || undefined,
      difficulty: ctx.difficulty ? String(ctx.difficulty) : undefined,
    },
  })
}
</script>

<template>
  <div class="page practice">
    <div class="head">
      <h1 class="h1">题库</h1>
      <button class="subj" @click="subjectStore.toggle()">
        {{ subjectStore.shortName() }}
        <span class="subj__swap">⇄</span>
      </button>
    </div>

    <!-- 上传入口：提到首屏，不再藏在底部 -->
    <div class="upload-card" role="button" @click="router.push('/practice/import')">
      <div class="upload-card__icon">📤</div>
      <div class="upload-card__body">
        <div class="upload-card__title">把你的资料变成练习题</div>
        <div class="upload-card__desc">粘贴文本 / PDF / 图片 / 拍照 · 识别后逐题确认才入库</div>
      </div>
      <span class="upload-card__go">›</span>
    </div>

    <div class="grid">
      <button v-for="m in MODES" :key="m.key" class="mode-card" @click="go(m.key)">
        <div class="mode-card__icon">{{ m.icon }}</div>
        <div class="mode-card__title">{{ m.title }}</div>
        <div class="mode-card__desc">{{ m.desc }}</div>
      </button>
    </div>

    <!-- 题目来源说明：回答「这些题是哪来的」 -->
    <section class="card block">
      <div class="src__head" @click="showSource = !showSource">
        <span class="src__title">这些题目是从哪来的？</span>
        <span class="src__toggle">{{ showSource ? '收起 ▲' : '展开 ▼' }}</span>
      </div>
      <div v-if="showSource" class="src__body">
        <div v-for="s in SOURCE_NOTES" :key="s.name" class="src__row">
          <span class="src__icon">{{ s.icon }}</span>
          <div>
            <div class="src__name">{{ s.name }}</div>
            <div class="text-caption">{{ s.desc }}</div>
          </div>
        </div>
        <div class="src__extra">
          <div>📌 <b>每日任务</b>的题来自：到期复习题 + 错题 + 按知识点选的新学题</div>
          <div>📌 <b>你导入的题</b>进入「我的题库」，已归类的题可在章节练习中练到</div>
        </div>
        <button class="src__go" @click="router.push('/practice/sets')">管理我的题库 ›</button>
      </div>
    </section>

    <section class="card block">
      <div class="block__title">我的</div>
      <div class="entry" @click="router.push('/practice/sets')">
        <span>我的题库</span>
        <span class="text-caption">导入的题 · 可练习 / 删除 ›</span>
      </div>
      <div class="entry" @click="router.push('/practice/wrong')">
        <span>错题本</span>
        <span class="text-caption">按知识点聚合 ›</span>
      </div>
    </section>

    <!-- 上下文选择器（章节/专项/年份） -->
    <PracticeConfigSheet
      :model-value="!!sheetMode"
      :mode="sheetMode ?? 'chapter'"
      :subject-id="subjectStore.current"
      @update:model-value="sheetMode = null"
      @confirm="onConfirm"
    />
  </div>
</template>

<style scoped>
.practice {
  padding: calc(var(--safe-top) + var(--sp-4)) var(--sp-4) calc(var(--tabbar-h) + var(--safe-bottom) + var(--sp-4));
  min-height: 100%;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-3);
}
.h1 {
  font-size: 22px;
  font-weight: 600;
}
.subj {
  display: flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
  border-radius: 16px;
  padding: 6px 14px;
  font-size: var(--fs-aux);
  min-height: 34px;
}
.subj__swap {
  font-size: 13px;
}
.upload-card {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
  color: #fff;
  border-radius: var(--radius-md);
  padding: var(--sp-4);
  margin-bottom: var(--sp-4);
  cursor: pointer;
}
.upload-card__icon {
  font-size: 24px;
}
.upload-card__body {
  flex: 1;
}
.upload-card__title {
  font-size: var(--fs-body);
  font-weight: 500;
  margin-bottom: 2px;
}
.upload-card__desc {
  font-size: var(--fs-caption);
  opacity: 0.85;
}
.upload-card__go {
  font-size: 22px;
  opacity: 0.8;
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--sp-3);
}
.mode-card {
  text-align: left;
  background: var(--bg-primary);
  border-radius: var(--radius-md);
  padding: var(--sp-4);
  border: none;
  min-height: 96px;
}
.mode-card__icon {
  font-size: 22px;
  margin-bottom: var(--sp-2);
}
.mode-card__title {
  font-size: var(--fs-body);
  font-weight: 500;
  margin-bottom: 2px;
}
.mode-card__desc {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.block {
  margin-top: var(--sp-4);
}
.block__title {
  font-size: var(--fs-body);
  font-weight: 500;
  margin-bottom: var(--sp-2);
}
.entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-3) 0;
  border-bottom: 1px solid var(--border-color);
  min-height: var(--tap-min);
  font-size: var(--fs-body);
}
.entry:last-child {
  border-bottom: none;
}
.src__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.src__title {
  font-size: var(--fs-body);
  font-weight: 500;
}
.src__toggle {
  font-size: var(--fs-caption);
  color: var(--color-primary);
}
.src__body {
  margin-top: var(--sp-3);
  border-top: 1px solid var(--border-color);
  padding-top: var(--sp-3);
}
.src__row {
  display: flex;
  gap: var(--sp-2);
  margin-bottom: var(--sp-3);
}
.src__icon {
  font-size: 18px;
  flex-shrink: 0;
}
.src__name {
  font-size: var(--fs-aux);
  font-weight: 500;
  margin-bottom: 2px;
}
.src__extra {
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  padding: var(--sp-3);
  font-size: var(--fs-caption);
  line-height: 2;
  color: var(--text-secondary);
}
.src__extra b {
  color: var(--color-primary);
}
.src__go {
  width: 100%;
  margin-top: var(--sp-3);
  height: 40px;
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-aux);
}
</style>
