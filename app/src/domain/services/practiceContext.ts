/**
 * 练习上下文（业务层）
 *
 * 描述「用户当前在练什么」——科目、章节、年份、题型、难度。
 * 贯穿入口选择器、答题页展示、答题页切换三处，避免各处各自拼接字符串。
 */
import type { PracticeMode, QuestionType, SubjectId } from '@/domain/entities'

export interface PracticeContext {
  mode: PracticeMode
  subjectId: SubjectId
  /** 章节 id（章节练习 / 真题按章节横刷） */
  nodeId?: string
  /** 章节名（用于展示） */
  nodeName?: string
  /** 真题年份 */
  year?: number
  /** 专项：题型 */
  type?: QuestionType
  /** 专项：难度 1-5 */
  difficulty?: number
}

export const MODE_LABEL: Record<PracticeMode, string> = {
  review: '今日复习',
  chapter: '章节练习',
  special: '专项训练',
  real_exam: '真题演练',
  wrong: '错题重做',
  high_freq: '高频必刷',
  ai: 'AI 组卷',
  exam: '模考',
}

export const TYPE_LABEL: Record<QuestionType, string> = {
  single: '单选',
  multi: '多选',
  case: '案例分析',
}

/** 生成人类可读的上下文描述，用于答题页顶部展示 */
export function contextLabel(ctx: PracticeContext): string {
  const parts: string[] = [MODE_LABEL[ctx.mode]]

  if (ctx.year) parts.push(`${ctx.year} 年`)
  if (ctx.nodeName) parts.push(ctx.nodeName)
  if (ctx.type) parts.push(TYPE_LABEL[ctx.type])
  if (ctx.difficulty) parts.push('★'.repeat(ctx.difficulty))

  return parts.join(' · ')
}

/** 上下文 → 组卷参数（统一转换，避免页面手拼） */
export function contextToPaper(ctx: PracticeContext): {
  mode: PracticeMode
  subjectId: SubjectId
  nodeId?: string
  year?: number
  type?: QuestionType
  difficulty?: number
} {
  return {
    mode: ctx.mode,
    subjectId: ctx.subjectId,
    nodeId: ctx.nodeId,
    year: ctx.year,
    type: ctx.type,
    difficulty: ctx.difficulty,
  }
}
