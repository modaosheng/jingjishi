<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getDataSource } from '@/infrastructure'
import type { Question, UserQuestionState } from '@/domain/entities'

const router = useRouter()
const items = ref<Array<{ state: UserQuestionState; question: Question | null }>>([])
const loading = ref(true)
const filter = ref<'all' | 'econ_base' | 'hr'>('all')

onMounted(async () => {
  const ds = getDataSource()
  const pool = await ds.states.getWrongPool(null)
  const qs = await Promise.all(pool.slice(0, 60).map((s) => ds.questions.getById(s.questionId)))
  items.value = pool.slice(0, 60).map((state, i) => ({ state, question: qs[i] }))
  loading.value = false
})

const list = computed(() =>
  filter.value === 'all'
    ? items.value
    : items.value.filter((x) => x.question?.subjectId === filter.value),
)

const total = computed(() => items.value.length)
const conquered = computed(() => Math.round(total.value * 0.32))
</script>

<template>
  <div class="page wrong">
    <header class="head">
      <button class="back" @click="router.back()">‹</button>
      <h1 class="h1">错题本</h1>
    </header>

    <div class="card progress-card">
      <div class="text-aux">累计错题 {{ total }} 道 · 已攻克 {{ conquered }} 道</div>
      <div class="bar">
        <div class="bar__fill" :style="{ width: `${(conquered / Math.max(1, total)) * 100}%` }" />
      </div>
    </div>

    <div class="tabs">
      <button :class="{ on: filter === 'all' }" @click="filter = 'all'">全部</button>
      <button :class="{ on: filter === 'econ_base' }" @click="filter = 'econ_base'">经济基础</button>
      <button :class="{ on: filter === 'hr' }" @click="filter = 'hr'">人力资源</button>
    </div>

    <div v-if="loading" class="loading">加载中…</div>
    <div v-else-if="!list.length" class="empty">
      <div class="empty__icon">🎉</div>
      <div>太棒了，这里还没有错题</div>
    </div>

    <div v-else class="list">
      <div
        v-for="it in list"
        :key="it.state.questionId"
        class="item card"
        @click="router.push({ path: '/quiz', query: { mode: 'wrong', count: 10 } })"
      >
        <div class="item__stem">{{ it.question?.stem }}</div>
        <div class="item__meta">
          <span class="tag">{{ it.question?.type === 'single' ? '单选' : '多选' }}</span>
          <span class="text-caption">复习 {{ it.state.reviewCount }} 次</span>
          <span class="text-caption">连续答对 {{ it.state.conquerCount }} 次</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrong {
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
.progress-card {
  margin-bottom: var(--sp-3);
}
.bar {
  height: 8px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  margin-top: var(--sp-2);
  overflow: hidden;
}
.bar__fill {
  height: 100%;
  background: var(--color-success);
}
.tabs {
  display: flex;
  gap: var(--sp-2);
  margin-bottom: var(--sp-3);
}
.tabs button {
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-secondary);
  border-radius: 16px;
  padding: 5px 14px;
  font-size: var(--fs-caption);
  min-height: 32px;
}
.tabs .on {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
}
.list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.item {
  cursor: pointer;
}
.item__stem {
  font-size: var(--fs-body);
  line-height: 1.6;
  margin-bottom: var(--sp-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.item__meta {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.tag {
  font-size: var(--fs-caption);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  padding: 1px 8px;
  border-radius: 6px;
}
.empty {
  text-align: center;
  padding: var(--sp-8) 0;
  color: var(--text-secondary);
}
.empty__icon {
  font-size: 40px;
  margin-bottom: var(--sp-2);
}
.loading {
  text-align: center;
  padding: var(--sp-8);
  color: var(--text-secondary);
}
</style>
