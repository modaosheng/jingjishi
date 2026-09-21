<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getServices } from '@/services'
import type { SubjectId } from '@/domain/entities'
import type { TreeNodeView } from '@/domain/services/knowledgeService'

const router = useRouter()
const subject = ref<SubjectId>('econ_base')
const nodes = ref<TreeNodeView[]>([])
const expanded = ref<Set<string>>(new Set())
const loading = ref(true)

const MASTERY_COLOR: Record<string, string> = {
  unlearned: 'var(--mastery-0)',
  weak: 'var(--mastery-1)',
  fair: 'var(--mastery-2)',
  good: 'var(--mastery-3)',
  mastered: 'var(--mastery-4)',
}
const MASTERY_ICON: Record<string, string> = {
  unlearned: '○',
  weak: '✕',
  fair: '△',
  good: '◐',
  mastered: '●',
}
const MASTERY_TEXT: Record<string, string> = {
  unlearned: '未学',
  weak: '薄弱',
  fair: '一般',
  good: '良好',
  mastered: '掌握',
}

const modules = computed(() => nodes.value.filter((n) => n.level === 1))
const chaptersOf = (modId: string) => nodes.value.filter((n) => n.level === 2 && n.parentId === modId)
const isOpen = (id: string) => expanded.value.has(id)

function toggle(id: string) {
  const s = new Set(expanded.value)
  s.has(id) ? s.delete(id) : s.add(id)
  expanded.value = s
}

async function load() {
  loading.value = true
  const svc = getServices()
  nodes.value = await svc.knowledge.getTreeWithMastery(subject.value)
  loading.value = false
}

onMounted(load)

function openChapter(id: string) {
  router.push(`/study/knowledge/${id}`)
}
</script>

<template>
  <div class="page tree">
    <h1 class="h1">知识图谱</h1>

    <div class="tabs">
      <button :class="{ on: subject === 'econ_base' }" @click="(subject = 'econ_base'), load()">
        经济基础
      </button>
      <button :class="{ on: subject === 'hr' }" @click="(subject = 'hr'), load()">人力资源</button>
    </div>

    <div v-if="loading" class="loading">加载中…</div>

    <div v-else class="mods">
      <div v-for="m in modules" :key="m.id" class="mod card">
        <div class="mod__head" @click="toggle(m.id)">
          <div class="mod__info">
            <div class="mod__name">
              {{ m.name }}
              <span class="weight">{{ m.weight }} 分</span>
            </div>
            <div class="bar">
              <div
                class="bar__fill"
                :style="{ width: `${m.mastery}%`, background: MASTERY_COLOR[m.masteryLevel] }"
              />
            </div>
          </div>
          <div class="mod__score">
            <span class="icon" :style="{ color: MASTERY_COLOR[m.masteryLevel] }">
              {{ MASTERY_ICON[m.masteryLevel] }}
            </span>
            <span class="num">{{ m.mastery }}%</span>
            <span class="lvl">{{ MASTERY_TEXT[m.masteryLevel] }}</span>
          </div>
          <span class="caret">{{ isOpen(m.id) ? '⌄' : '›' }}</span>
        </div>

        <div v-if="isOpen(m.id)" class="chapters">
          <div
            v-for="c in chaptersOf(m.id)"
            :key="c.id"
            class="chapter"
            @click="openChapter(c.id)"
          >
            <span class="c-icon" :style="{ color: MASTERY_COLOR[c.masteryLevel] }">
              {{ MASTERY_ICON[c.masteryLevel] }}
            </span>
            <span class="c-name">{{ c.name }}</span>
            <span class="c-meta">{{ c.questionCount }} 题 · {{ c.mastery }}%</span>
          </div>
        </div>
      </div>
    </div>

    <p class="tip text-caption">
      颜色 + 图标双重标识掌握度（不依赖颜色，色觉障碍用户同样可读）
    </p>
  </div>
</template>

<style scoped>
.tree {
  padding: calc(var(--safe-top) + var(--sp-4)) var(--sp-4) calc(var(--tabbar-h) + var(--safe-bottom) + var(--sp-4));
  min-height: 100%;
}
.h1 {
  font-size: 22px;
  font-weight: 600;
  margin-bottom: var(--sp-3);
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
  padding: 6px 16px;
  font-size: var(--fs-aux);
  min-height: 34px;
}
.tabs .on {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
}
.mods {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.mod__head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  cursor: pointer;
}
.mod__info {
  flex: 1;
}
.mod__name {
  font-size: var(--fs-body);
  font-weight: 500;
  margin-bottom: 6px;
}
.weight {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  margin-left: 6px;
}
.bar {
  height: 6px;
  background: var(--bg-tertiary);
  border-radius: 3px;
  overflow: hidden;
}
.bar__fill {
  height: 100%;
  border-radius: 3px;
}
.mod__score {
  text-align: right;
  min-width: 56px;
}
.icon {
  font-size: 14px;
  margin-right: 4px;
}
.num {
  font-size: var(--fs-aux);
  font-weight: 600;
}
.lvl {
  display: block;
  font-size: 11px;
  color: var(--text-tertiary);
}
.caret {
  color: var(--text-tertiary);
  font-size: 18px;
}
.chapters {
  margin-top: var(--sp-3);
  border-top: 1px solid var(--border-color);
  padding-top: var(--sp-2);
}
.chapter {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) 0;
  min-height: var(--tap-min);
  font-size: var(--fs-aux);
}
.c-name {
  flex: 1;
}
.c-meta {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
}
.tip {
  margin-top: var(--sp-4);
  line-height: 1.6;
}
.loading {
  text-align: center;
  padding: var(--sp-8);
  color: var(--text-secondary);
}
</style>
