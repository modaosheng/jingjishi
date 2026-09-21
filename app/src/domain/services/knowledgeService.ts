/**
 * 知识树服务（业务层）
 *
 * 负责知识树与掌握度的聚合视图。聚合规则（如何由章的掌握度推算模块掌握度、
 * 高频考点如何筛选）集中在此，页面只做渲染。
 */
import type { KnowledgeNode, MasteryLevel, SubjectId } from '@/domain/entities'
import type { KnowledgeRepository, MasteryRepository, QuestionRepository } from '@/domain/repositories'

/**
 * 知识树视图模型。
 *
 * ⚠️ 注意 `level` 与 `masteryLevel` 是两个不同的东西，不要混用：
 *   - `level`（继承自 KnowledgeNode）= 层级 1/2/3（模块/章/知识点）
 *   - `masteryLevel` = 掌握度档位（unlearned/weak/fair/good/mastered）
 * 此前二者同名，导致 `n.level === 1` 与 `MASTERY_COLOR[n.level]` 互相冲突。
 */
export interface TreeNodeView extends KnowledgeNode {
  mastery: number
  masteryLevel: MasteryLevel
  /** 子节点数（模块→章数，章→知识点数） */
  childCount: number
  /** 该节点下的题目数 */
  questionCount: number
}

const levelOf = (s: number): MasteryLevel =>
  s < 20 ? 'unlearned' : s < 45 ? 'weak' : s < 65 ? 'fair' : s < 82 ? 'good' : 'mastered'

export interface KnowledgeServiceDeps {
  knowledge: KnowledgeRepository
  mastery: MasteryRepository
  questions: QuestionRepository
}

export class KnowledgeService {
  constructor(private readonly deps: KnowledgeServiceDeps) {}

  /**
   * 获取带掌握度的完整知识树
   * - 章（level 2）：直接取掌握度记录
   * - 模块（level 1）：由下属章节按分值加权平均推算
   */
  async getTreeWithMastery(subjectId: SubjectId): Promise<TreeNodeView[]> {
    const tree = await this.deps.knowledge.getTree(subjectId)
    const masteryList = await this.deps.mastery.listBySubject(subjectId)
    const byNode = new Map(masteryList.map((m) => [m.nodeId, m]))

    const chapters = tree.filter((n) => n.level === 2)
    const modules = tree.filter((n) => n.level === 1)

    const views: TreeNodeView[] = []

    for (const mod of modules) {
      const subChapters = chapters.filter((c) => c.parentId === mod.id)
      const scores = subChapters.map((c) => byNode.get(c.id)?.masteryScore ?? 0)
      const avg = scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : 0
      views.push({
        ...mod,
        mastery: Math.round(avg),
        masteryLevel: levelOf(avg),
        childCount: subChapters.length,
        questionCount: 0,
      })
    }

    for (const ch of chapters) {
      const m = byNode.get(ch.id)
      views.push({
        ...ch,
        mastery: Math.round(m?.masteryScore ?? 0),
        masteryLevel: m?.level ?? 'unlearned',
        childCount: tree.filter((p) => p.parentId === ch.id).length,
        questionCount: m?.questionCount ?? 0,
      })
    }

    // 先按模块排序，再按章内顺序 —— 用 `level`（层级）而非掌握度排序
    return views.sort((a, b) => a.level - b.level || a.order - b.order)
  }

  /** 章节详情：含下属知识点与该章题目 */
  async getChapterDetail(chapterId: string) {
    const subjectId = (chapterId.startsWith('econ') ? 'econ_base' : 'hr') as SubjectId
    const tree = await this.deps.knowledge.getTree(subjectId)
    const chapter = tree.find((n) => n.id === chapterId)
    if (!chapter) return null

    const points = tree.filter((n) => n.parentId === chapterId)
    const questions = await this.deps.questions.query({ nodeId: chapterId, limit: 200 })
    const mastery = await this.deps.mastery.get(chapterId)

    return { chapter, points, questions, mastery }
  }

  /**
   * 高频考点：近 5 年考查次数 ≥ minFreq 的章节（PRD M2-F4）
   */
  async getHighFreqChapters(subjectId: SubjectId, minFreq = 3): Promise<TreeNodeView[]> {
    const all = await this.getTreeWithMastery(subjectId)
    return all.filter((n) => n.level === 2 && n.examFreq >= minFreq)
  }

  /** 全科加权掌握度（供数据看板使用） */
  async weightedMastery(subjectId: SubjectId): Promise<number> {
    const views = await this.getTreeWithMastery(subjectId)
    const modules = views.filter((n) => n.level === 1)
    let sum = 0
    let weight = 0
    for (const m of modules) {
      sum += m.mastery * (m.weight || 1)
      weight += m.weight || 1
    }
    return weight ? Math.round(sum / weight) : 0
  }
}
