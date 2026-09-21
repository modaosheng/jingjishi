/**
 * 全局科目状态
 *
 * 科目是贯穿全局的状态（任务包、复习队列、掌握度、过线预测都要跟随），
 * 不是单次请求的筛选条件，因此统一放在 store 而非路由参数。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { SubjectId } from '@/domain/entities'

const LS_KEY = 'jingshi.current_subject'

/** 科目元信息（集中一处，避免各页面重复写三元表达式） */
export const SUBJECT_META: Record<SubjectId, { short: string; full: string; desc: string }> = {
  econ_base: { short: '经济基础', full: '经济基础知识', desc: '105 题 · 140 分 · 84 分合格' },
  hr: { short: '人力资源', full: '人力资源管理', desc: '100 题 · 140 分 · 84 分合格' },
}

/** 由知识点 id 推断所属科目（章节页跳转时用于校正科目） */
export function subjectOfNode(nodeId: string): SubjectId {
  return nodeId.startsWith('econ') ? 'econ_base' : 'hr'
}

export const useSubjectStore = defineStore('subject', () => {
  const current = ref<SubjectId>(readInitial())

  function readInitial(): SubjectId {
    const saved = localStorage.getItem(LS_KEY) as SubjectId | null
    if (saved === 'econ_base' || saved === 'hr') return saved
    // 未设置时取 onboarding 选择的第一个科目
    try {
      const ob = JSON.parse(localStorage.getItem('jingshi.onboarding') || 'null')
      const first = ob?.subjectIds?.[0]
      if (first === 'econ_base' || first === 'hr') return first
    } catch {
      /* 忽略损坏数据 */
    }
    return 'econ_base'
  }

  function setSubject(id: SubjectId) {
    if (current.value === id) return
    current.value = id
    localStorage.setItem(LS_KEY, id)
  }

  function toggle() {
    setSubject(current.value === 'econ_base' ? 'hr' : 'econ_base')
  }

  const name = () => SUBJECT_META[current.value].full
  const shortName = () => SUBJECT_META[current.value].short

  return { current, setSubject, toggle, name, shortName }
})
