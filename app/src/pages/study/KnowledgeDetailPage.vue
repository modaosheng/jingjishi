<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getServices } from '@/services'
import type { Question } from '@/domain/entities'
import type { UserKnowledgeState } from '@/domain/entities'

const route = useRoute()
const router = useRouter()
const chapterId = route.params.id as string

const detail = ref<Awaited<ReturnType<typeof loadDetail>> | null>(null)
const openKey = ref<string | null>(null)
const loading = ref(true)

async function loadDetail() {
  return getServices().knowledge.getChapterDetail(chapterId)
}

onMounted(async () => {
  detail.value = await loadDetail()
  loading.value = false
})

const mastery = () => (detail.value?.mastery as UserKnowledgeState | null)?.masteryScore ?? 0

function practice() {
  router.push({ path: '/quiz', query: { mode: 'chapter', nodeId: chapterId, count: 10 } })
}

function toggle(key: string) {
  openKey.value = openKey.value === key ? null : key
}

function answerOf(q: Question) {
  return q.answer.join('、')
}
</script>

<template>
  <div class="page detail">
    <header class="head">
      <button class="back" @click="router.back()">‹</button>
      <h1 class="h1">{{ detail?.chapter.name ?? '章节' }}</h1>
    </header>

    <div v-if="loading" class="loading">加载中…</div>

    <template v-else-if="detail">
      <div class="card meta">
        <div class="meta__row">
          <span>掌握度</span>
          <strong>{{ Math.round(mastery()) }}%</strong>
        </div>
        <div class="bar">
          <div class="bar__fill" :style="{ width: `${mastery()}%` }" />
        </div>
        <div class="meta__row text-caption">
          <span>分值权重 {{ detail.chapter.weight }} 分</span>
          <span>共 {{ detail.questions.length }} 题</span>
        </div>
      </div>

      <section class="card block">
        <div class="block__title">知识点（{{ detail.points.length }}）</div>
        <div class="points">
          <span v-for="p in detail.points" :key="p.id" class="point">{{ p.name }}</span>
        </div>
      </section>

      <!-- 以真题解析作为学习材料：不编造教材原文（合规） -->
      <section class="block">
        <div class="block__title">本章题目精讲（{{ detail.questions.length }}）</div>
        <div v-for="q in detail.questions.slice(0, 10)" :key="q.id" class="q card">
          <div class="q__stem">{{ q.stem }}</div>
          <div class="q__answer text-caption">答案：{{ answerOf(q) }}</div>
          <button class="q__toggle" @click="toggle(q.id)">
            {{ openKey === q.id ? '收起解析' : '查看解析' }}
          </button>
          <div v-if="openKey === q.id" class="q__exp">
            <div class="keypoint">{{ q.explanation.keyPoint }}</div>
            <div
              v-for="o in q.explanation.perOption"
              :key="o.key"
              class="line"
              :class="o.correct ? 'line--ok' : 'line--bad'"
            >
              {{ o.key }}. {{ o.text }}
            </div>
          </div>
        </div>
      </section>

      <button class="primary-btn" @click="practice">学完了，测一测（10 题）</button>
    </template>
  </div>
</template>

<style scoped>
.detail {
  padding: calc(var(--safe-top) + var(--sp-2)) var(--sp-4)
    calc(var(--tabbar-h) + var(--safe-bottom) + var(--sp-5));
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
  font-size: 18px;
  font-weight: 600;
}
.meta {
  margin-bottom: var(--sp-3);
}
.meta__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--sp-2);
}
.bar {
  height: 8px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: var(--sp-2);
}
.bar__fill {
  height: 100%;
  background: var(--color-primary);
}
.block {
  margin-bottom: var(--sp-3);
}
.block__title {
  font-weight: 500;
  margin-bottom: var(--sp-2);
}
.points {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.point {
  font-size: var(--fs-caption);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  padding: 4px 10px;
  border-radius: 12px;
}
.q {
  margin-bottom: var(--sp-2);
}
.q__stem {
  font-size: var(--fs-body);
  line-height: 1.6;
  margin-bottom: var(--sp-1);
}
.q__toggle {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: var(--fs-aux);
  padding: var(--sp-2) 0 0;
}
.q__exp {
  margin-top: var(--sp-2);
  border-top: 1px solid var(--border-color);
  padding-top: var(--sp-2);
}
.keypoint {
  font-size: var(--fs-aux);
  margin-bottom: var(--sp-2);
}
.line {
  font-size: var(--fs-caption);
  line-height: 1.7;
}
.line--ok {
  color: var(--color-success);
}
.line--bad {
  color: var(--text-secondary);
}
.primary-btn {
  width: 100%;
  height: var(--btn-h);
  margin-top: var(--sp-4);
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--fs-body);
}
.loading {
  text-align: center;
  padding: var(--sp-8);
  color: var(--text-secondary);
}
</style>
