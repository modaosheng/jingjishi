<script setup lang="ts">
/**
 * 我的题库
 *
 * 按「题集」组织（导入时命名并分类）：题集可整组练习 / 删除，单题也可删。
 * 未归入任何题集的历史题目统一显示为「未分组」，避免丢失。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getDataSource } from '@/infrastructure'
import { exportQuestions } from '@/infrastructure/fileParse/xlsx'
import { SUBJECT_META } from '@/stores/subject'
import type { Question, QuestionSet, QuestionSetCategory } from '@/domain/entities'

const router = useRouter()
const loading = ref(true)
const items = ref<Question[]>([])
const sets = ref<QuestionSet[]>([])
const itemsBySet = ref<Record<string, Question[]>>({})
const openSet = ref<Set<string>>(new Set())

/** 正在编辑的题集 id（空 = 未编辑） */
const editingId = ref('')
const editName = ref('')
const editCategory = ref<QuestionSetCategory>('custom')
const editYear = ref('')

const CATEGORIES: Array<{ key: QuestionSetCategory; label: string }> = [
  { key: 'custom', label: '自建题目' },
  { key: 'past_exam', label: '往年真题' },
  { key: 'mock', label: '模拟题' },
  { key: 'chapter', label: '章节整理' },
]

const TYPE_LABEL: Record<Question['type'], string> = {
  single: '单选',
  multi: '多选',
  case: '案例',
}

const CAT_LABEL: Record<QuestionSetCategory, string> = {
  custom: '自建题目',
  past_exam: '往年真题',
  mock: '模拟题',
  chapter: '章节整理',
}

onMounted(load)

async function load() {
  loading.value = true
  const ds = getDataSource()
  const all = await ds.questions.query({ ownerTypes: ['user', 'ai'] })
  const setList = await ds.questionSets.list()
  const qById = new Map(all.map((q) => [q.id, q]))

  const map: Record<string, Question[]> = {}
  for (const s of setList) {
    const ids = await ds.questionSets.itemIds(s.id)
    map[s.id] = ids.map((id) => qById.get(id)).filter((q): q is Question => !!q)
  }

  items.value = all
  sets.value = setList
  itemsBySet.value = map
  loading.value = false
}

/** 展示分组：题集 + 「未分组」兜底（历史数据） */
const grouped = computed(() => {
  const g = sets.value
    .map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category as QuestionSetCategory,
      year: s.year,
      list: itemsBySet.value[s.id] ?? [],
    }))
    .filter((x) => x.list.length > 0)

  const inAny = new Set(Object.values(itemsBySet.value).flat().map((q) => q.id))
  const orphans = items.value.filter((q) => !inAny.has(q.id))
  if (orphans.length) {
    g.push({ id: '__orphan', name: '未分组', category: 'custom', year: undefined, list: orphans })
  }
  return g
})

const total = computed(() => items.value.length)

function toggle(id: string) {
  const next = new Set(openSet.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  openSet.value = next
}

const classified = (q: Question) => (q.knowledgeNodeIds?.length ?? 0) > 0

function subjectsOf(list: Question[]) {
  const set = new Set(list.map((q) => SUBJECT_META[q.subjectId].short))
  return [...set].join(' / ')
}

/** 练习这一批（「我的题库」模式，只出用户自建题） */
function practice(list: Question[]) {
  router.push({
    path: '/quiz',
    query: { mode: 'chapter', owner: 'user,ai', count: String(Math.min(list.length, 20)) },
  })
}

/** 删除整个题集（连同题集内的题目） */
async function removeSet(g: { id: string; name: string; list: Question[] }) {
  const msg = `确定删除「${g.name}」？\n\n将删除其中 ${g.list.length} 道题，且不可恢复。`
  if (!confirm(msg)) return
  const ds = getDataSource()
  await ds.questions.remove(g.list.map((q) => q.id))
  if (g.id !== '__orphan') await ds.questionSets.remove(g.id)
  await load()
}

async function removeOne(q: Question) {
  if (!confirm('确定删除这道题？删除后不可恢复。')) return
  await getDataSource().questions.remove([q.id])
  await load()
}

/* ---------- 题集编辑 ---------- */

function startEdit(g: { id: string; name: string; category: QuestionSetCategory; year?: number }) {
  editingId.value = g.id
  editName.value = g.name
  editCategory.value = g.category
  editYear.value = g.year ? String(g.year) : String(new Date().getFullYear() - 1)
}

/** 保存题集信息（名称 / 类别 / 年份）。改为「往年真题」时同步给题目打上年份 */
async function saveEdit(g: { id: string; list: Question[] }) {
  if (g.id === '__orphan') {
    editingId.value = ''
    return
  }
  const ds = getDataSource()
  const existing = await ds.questionSets.get(g.id)
  if (!existing) {
    editingId.value = ''
    return
  }
  const year = editCategory.value === 'past_exam' ? Number(editYear.value) || undefined : undefined

  await ds.questionSets.save(
    {
      ...existing,
      name: editName.value.trim() || existing.name,
      category: editCategory.value,
      year,
      questionCount: g.list.length,
    },
    g.list.map((q) => q.id),
  )

  // 类别切到「往年真题」时，给题目打年份，让「真题演练」也能筛到
  if (year) {
    await ds.questions.save(g.list.map((q) => ({ ...q, examYear: year })))
  }

  editingId.value = ''
  await load()
}

/** 导出该题集为 Excel —— 列结构与导入模板一致，改完可直接再导入 */
function exportSet(g: { name: string; list: Question[] }) {
  if (!g.list.length) return
  exportQuestions(g.list, `${g.name}.xlsx`)
}
</script>

<template>
  <div class="page sets">
    <header class="head">
      <button class="back" @click="router.back()">‹</button>
      <h1 class="h1">我的题库</h1>
      <span v-if="total" class="count">{{ total }} 题</span>
    </header>

    <div class="actions">
      <button class="btn btn--primary" @click="router.push('/practice/import')">导入题目</button>
      <button class="btn" @click="router.push('/practice/import/ai')">AI 生成</button>
    </div>

    <div v-if="loading" class="text-caption empty">加载中…</div>

    <!-- 空态 -->
    <div v-else-if="!grouped.length" class="empty-state">
      <div class="empty-state__icon">📚</div>
      <div class="empty-state__title">还没有自建题目</div>
      <div class="text-aux empty-state__desc">
        导入的题目会按「题集」整理在这里。<br />
        类别选「往年真题」，该题集还会出现在模考的试卷来源里。
      </div>
      <button class="btn btn--primary" @click="router.push('/practice/import')">去导入题目</button>
    </div>

    <!-- 题集列表 -->
    <template v-else>
      <p class="text-caption note">
        共 {{ total }} 道自建题（官方题库不在此列）。按题集分组，可整组练习或删除。
      </p>

      <section v-for="g in grouped" :key="g.id" class="card set">
        <div class="set__head">
          <div class="set__info">
            <div class="set__name">
              {{ g.name }}
              <span class="cat">{{ CAT_LABEL[g.category] }}</span>
              <span v-if="g.year" class="cat cat--year">{{ g.year }} 年</span>
            </div>
            <div class="text-caption">{{ g.list.length }} 题 · {{ subjectsOf(g.list) }}</div>
          </div>
          <button class="set__toggle" @click="toggle(g.id)">
            {{ openSet.has(g.id) ? '收起' : '查看' }}
          </button>
        </div>

        <!-- 编辑表单（点「编辑」展开） -->
        <div v-if="editingId === g.id" class="editbox">
          <div class="field">
            <label class="field__label">题库名称</label>
            <input v-model="editName" class="mini" placeholder="题库名称" />
          </div>
          <div class="field">
            <label class="field__label">类别</label>
            <div class="chips">
              <button
                v-for="c in CATEGORIES"
                :key="c.key"
                class="chip"
                :class="{ 'chip--on': editCategory === c.key }"
                @click="editCategory = c.key"
              >
                {{ c.label }}
              </button>
            </div>
          </div>
          <div v-if="editCategory === 'past_exam'" class="field">
            <label class="field__label">真题年份</label>
            <input v-model="editYear" class="mini" type="number" placeholder="2024" />
          </div>
          <div class="set__ops">
            <button class="op" @click="editingId = ''">取消</button>
            <button class="op op--primary" @click="saveEdit(g)">保存</button>
          </div>
        </div>

        <div v-else class="set__ops">
          <button class="op op--primary" @click="practice(g.list)">练习这组</button>
          <button class="op" @click="exportSet(g)">导出</button>
          <button class="op" @click="startEdit(g)">编辑</button>
          <button class="op op--danger" @click="removeSet(g)">删除</button>
        </div>

        <div v-if="openSet.has(g.id)" class="qlist">
          <div v-for="q in g.list" :key="q.id" class="qrow">
            <div class="qrow__body">
              <div class="qrow__stem">
                {{ q.stem.slice(0, 60) }}{{ q.stem.length > 60 ? '…' : '' }}
              </div>
              <div class="text-caption">
                {{ TYPE_LABEL[q.type] }} · {{ SUBJECT_META[q.subjectId].short }} ·
                {{ classified(q) ? '✅ 已归类' : '⚠️ 未归类' }} · 答案 {{ q.answer.join('') }}
              </div>
            </div>
            <button class="qrow__del" @click="removeOne(q)">删除</button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.sets {
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
.count {
  margin-left: auto;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.actions {
  display: flex;
  gap: var(--sp-2);
}
.btn {
  flex: 1;
  height: var(--tap-min);
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-body);
}
.btn--primary {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
.note {
  margin: var(--sp-3) 0;
  line-height: 1.6;
}
.empty {
  padding: var(--sp-6);
  text-align: center;
}
.empty-state {
  text-align: center;
  padding: var(--sp-8) var(--sp-4);
}
.empty-state__icon {
  font-size: 44px;
  margin-bottom: var(--sp-3);
}
.empty-state__title {
  font-size: var(--fs-title);
  font-weight: 600;
  margin-bottom: var(--sp-2);
}
.empty-state__desc {
  line-height: 1.7;
  margin-bottom: var(--sp-4);
}
.empty-state .btn {
  width: 100%;
}
.set {
  margin-bottom: var(--sp-3);
}
.set__head {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  margin-bottom: var(--sp-3);
}
.set__info {
  flex: 1;
  min-width: 0;
}
.set__name {
  font-size: var(--fs-body);
  font-weight: 500;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.cat {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-weight: 400;
}
.cat--year {
  background: rgba(59, 130, 246, 0.12);
  color: var(--color-primary);
}
.set__toggle {
  flex-shrink: 0;
  background: none;
  border: 1px solid var(--border-strong);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  padding: 4px 12px;
  font-size: var(--fs-caption);
  min-height: 30px;
}
.set__ops {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.op {
  flex: 1 1 calc(50% - var(--sp-2));
  height: 38px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-aux);
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-primary);
}
/* ---------- 题集编辑表单 ---------- */
.editbox {
  border-top: 1px dashed var(--border-color);
  padding-top: var(--sp-3);
}
.field {
  margin-bottom: var(--sp-3);
}
.field__label {
  display: block;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.mini {
  width: 100%;
  height: 38px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  padding: 0 var(--sp-2);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--fs-aux);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.chip {
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-secondary);
  border-radius: 14px;
  padding: 4px 12px;
  font-size: var(--fs-caption);
  min-height: 30px;
}
.chip--on {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(59, 130, 246, 0.1);
}
.op--primary {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.op--danger {
  border-color: var(--color-danger);
  color: var(--color-danger);
}
.qlist {
  margin-top: var(--sp-3);
  border-top: 1px dashed var(--border-color);
  padding-top: var(--sp-2);
}
.qrow {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) 0;
  border-bottom: 1px solid var(--border-color);
}
.qrow:last-child {
  border-bottom: none;
}
.qrow__body {
  flex: 1;
  min-width: 0;
}
.qrow__stem {
  font-size: var(--fs-aux);
  line-height: 1.5;
  margin-bottom: 2px;
}
.qrow__del {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--color-danger);
  font-size: var(--fs-caption);
  padding: 6px;
}
</style>
