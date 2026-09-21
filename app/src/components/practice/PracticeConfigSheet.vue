<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { getDataSource } from '@/infrastructure'
import { TYPE_LABEL, type PracticeContext } from '@/domain/services/practiceContext'
import type { KnowledgeNode, QuestionType, SubjectId } from '@/domain/entities'

const props = defineProps<{
  modelValue: boolean
  mode: 'chapter' | 'special' | 'real_exam'
  subjectId: SubjectId
  current?: PracticeContext | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'confirm', ctx: PracticeContext): void
}>()

const modules = ref<KnowledgeNode[]>([])
const chapters = ref<KnowledgeNode[]>([])
const activeModule = ref<string>('')

// 专项
const type = ref<QuestionType | null>(props.current?.type ?? null)
const difficulty = ref<number | null>(props.current?.difficulty ?? null)
// 真题
const years = [2025, 2024, 2023, 2022, 2021]
const year = ref<number | null>(props.current?.year ?? null)

onMounted(loadTree)
watch(
  () => props.subjectId,
  () => loadTree(),
)

async function loadTree() {
  if (props.mode !== 'chapter') return
  const tree = await getDataSource().knowledge.getTree(props.subjectId)
  modules.value = tree.filter((n) => n.level === 1)
  if (modules.value.length && !activeModule.value) {
    activeModule.value = modules.value[0].id
  }
  chapters.value = tree.filter((n) => n.level === 2)
}

function chaptersOf(modId: string) {
  return chapters.value.filter((c) => c.parentId === modId)
}

function close() {
  emit('update:modelValue', false)
}

function pickChapter(ch: KnowledgeNode) {
  emit('confirm', {
    mode: 'chapter',
    subjectId: props.subjectId,
    nodeId: ch.id,
    nodeName: ch.name,
  })
  close()
}

function confirmSpecial() {
  emit('confirm', {
    mode: 'special',
    subjectId: props.subjectId,
    type: type.value ?? undefined,
    difficulty: difficulty.value ?? undefined,
  })
  close()
}

function confirmYear() {
  emit('confirm', {
    mode: 'real_exam',
    subjectId: props.subjectId,
    year: year.value ?? undefined,
  })
  close()
}
</script>

<template>
  <div v-if="modelValue" class="mask" @click.self="close">
    <div class="sheet">
      <div class="sheet__head">
        <span class="sheet__title">
          {{ mode === 'chapter' ? '选择章节' : mode === 'special' ? '专项筛选' : '选择年份' }}
        </span>
        <button class="sheet__close" @click="close">✕</button>
      </div>

      <!-- 章节选择 -->
      <div v-if="mode === 'chapter'" class="body">
        <div class="mod-tabs">
          <button
            v-for="m in modules"
            :key="m.id"
            class="mod-tab"
            :class="{ on: activeModule === m.id }"
            @click="activeModule = m.id"
          >
            {{ m.name }}
          </button>
        </div>
        <div class="chap-list">
          <button
            v-for="c in chaptersOf(activeModule)"
            :key="c.id"
            class="chap"
            @click="pickChapter(c)"
          >
            <span class="chap__name">{{ c.name }}</span>
            <span class="chap__go">›</span>
          </button>
        </div>
      </div>

      <!-- 专项筛选 -->
      <div v-else-if="mode === 'special'" class="body">
        <div class="grp">
          <div class="grp__label">题型</div>
          <div class="chips">
            <button
              v-for="(label, t) in TYPE_LABEL"
              :key="t"
              class="chip"
              :class="{ 'chip--on': type === t }"
              @click="type = type === t ? null : (t as QuestionType)"
            >
              {{ label }}
            </button>
          </div>
        </div>
        <div class="grp">
          <div class="grp__label">难度</div>
          <div class="chips">
            <button
              v-for="d in 5"
              :key="d"
              class="chip"
              :class="{ 'chip--on': difficulty === d }"
              @click="difficulty = difficulty === d ? null : d"
            >
              {{ '★'.repeat(d) }}
            </button>
          </div>
        </div>
        <button class="confirm" @click="confirmSpecial">开始练习</button>
      </div>

      <!-- 年份选择 -->
      <div v-else class="body">
        <div class="chips col">
          <button class="chip" :class="{ 'chip--on': year === null }" @click="year = null">全部年份</button>
          <button
            v-for="y in years"
            :key="y"
            class="chip"
            :class="{ 'chip--on': year === y }"
            @click="year = y"
          >
            {{ y }} 年
          </button>
        </div>
        <button class="confirm" @click="confirmYear">开始练习</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: var(--z-modal);
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  background: var(--bg-primary);
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  padding-bottom: var(--safe-bottom);
}
.sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-4);
  border-bottom: 1px solid var(--border-color);
}
.sheet__title {
  font-size: var(--fs-body);
  font-weight: 600;
}
.sheet__close {
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 16px;
  width: 32px;
  height: 32px;
}
.body {
  padding: var(--sp-4);
  overflow-y: auto;
}
.mod-tabs {
  display: flex;
  gap: var(--sp-2);
  overflow-x: auto;
  margin-bottom: var(--sp-3);
  padding-bottom: var(--sp-1);
}
.mod-tab {
  flex-shrink: 0;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-secondary);
  border-radius: 14px;
  padding: 5px 12px;
  font-size: var(--fs-caption);
  min-height: 30px;
}
.mod-tab.on {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
}
.chap-list {
  display: flex;
  flex-direction: column;
}
.chap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-3) 0;
  border-bottom: 1px solid var(--border-color);
  background: none;
  border-left: none;
  border-right: none;
  border-top: none;
  text-align: left;
  min-height: var(--tap-min);
  font-size: var(--fs-body);
  color: var(--text-primary);
}
.chap__go {
  color: var(--text-tertiary);
}
.grp {
  margin-bottom: var(--sp-4);
}
.grp__label {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.chips.col {
  flex-direction: column;
}
.chip {
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  padding: 8px 16px;
  font-size: var(--fs-aux);
  min-height: var(--tap-min);
}
.chip--on {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
}
.confirm {
  width: 100%;
  height: var(--btn-h);
  margin-top: var(--sp-4);
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--fs-body);
}
</style>
