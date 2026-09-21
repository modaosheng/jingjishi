/**
 * AI 服务（业务层）
 *
 * 承载 PRD §8 的 A1 出题 / A2 解析 / A4 私教对话。
 * 所有 Prompt 与校验规则集中在此，页面只负责渲染与交互。
 *
 * 防幻觉约束（PRD §8.6.4）在这里统一注入，任何一个 Prompt 都不得绕过。
 *
 * ⚠️ 接入方式：纯 BYOK（用户自填 Key，设备直连服务商）。
 *    本 App 不含任何服务端，不做中转。未配置 Key 时所有 AI 功能不可用，
 *    但这不影响任何学习功能（见 providers.ts 的 AI_IS_OPTIONAL_NOTICE）。
 */
import type { BloomLevel, Question, QuestionType, SubjectId } from '@/domain/entities'
import type { QuestionRepository } from '@/domain/repositories'
import type { ChatMessage } from '@/infrastructure/ai/llmClient'
import {
  callChat,
  describeAiError,
  isConfigured,
  currentProviderLabel,
  testConnection as testAiConnection,
} from '@/infrastructure/ai/aiClient'

/** Prompt 版本：变更时缓存自动失效 */
const PROMPT_VERSION = 'v1'

export interface AiServiceDeps {
  questions: QuestionRepository
}

/* ==================== 防幻觉系统提示（PRD §8.6.4） ==================== */

const SYSTEM_GUARD = `你是中级经济师（2026 年度）考试辅导专家。

【严格约束，违反即为失败输出】
1. 只能依据提供的【资料】作答。资料中未包含的信息，必须回答"根据提供的资料无法确定"，禁止用你的内部知识补充。
2. 当前考期为 2026 年度，教材版本为 2026 版。
3. 禁止生成任何具体的法条编号、条款序号，除非资料中明确给出。
4. 涉及税率、比例、年限、金额等数字，必须能在资料中找到出处；找不到就不要生成该题。
5. 若你对答案的把握低于 90%，必须在输出的 low_confidence 字段标注 true。`

/* ==================== 出题 ==================== */

export interface GenerateParams {
  subjectId: SubjectId
  nodeId?: string
  /** 出题依据的资料（教材片段/笔记/上传内容） */
  material: string
  count: number
  types: QuestionType[]
  bloom?: BloomLevel
}

export interface GeneratedQuestion {
  stem: string
  options: Array<{ key: string; content: string }>
  answer: string[]
  explanation: {
    keyPoint: string
    perOption: Array<{ key: string; correct: boolean; text: string }>
  }
  difficulty: number
  bloomLevel: BloomLevel
  lowConfidence?: boolean
}

const TYPE_CN: Record<QuestionType, string> = {
  single: '单项选择题（4 选 1，唯一正确答案）',
  multi: '多项选择题（5 个选项，正确答案 2-4 个，不存在 5 个全对）',
  case: '案例分析题（不定项选择，可能单选也可能多选）',
}

function buildGeneratePrompt(p: GenerateParams): string {
  return `${SYSTEM_GUARD}

请基于下方【资料】生成 ${p.count} 道${p.types.map((t) => TYPE_CN[t]).join('、')}。

【出题要求】
- 干扰项必须来自真实的易错点或邻近概念，要有迷惑性
- 禁止出现"以上都对""以上都不对"这类选项
- 禁止让某个选项因长度明显异常而暴露答案
- 每题必须给出逐项解析：正确项为什么对、干扰项为什么错（不允许只写"故选 X"）

【输出格式】严格输出 JSON，不要任何额外文字：
{
  "low_confidence": false,
  "questions": [
    {
      "stem": "题干",
      "options": [{"key": "A", "content": "选项内容"}],
      "answer": ["A"],
      "explanation": {
        "keyPoint": "一句话考点",
        "perOption": [{"key": "A", "correct": true, "text": "解析"}]
      },
      "difficulty": 3,
      "bloomLevel": "understand"
    }
  ]
}

【资料】
${p.material}`
}

/* ==================== 解析 ==================== */

function buildExplainPrompt(q: Question): string {
  return `${SYSTEM_GUARD}

请为下面这道中级经济师考试题生成解析。

【题目】${q.stem}
【选项】${q.options.map((o) => `${o.key}. ${o.content}`).join('\n')}
【正确答案】${q.answer.join(', ')}
${q.explanation?.sourceRef ? `【可能的出处】${q.explanation.sourceRef}` : ''}

【要求】
- 用一句话点明考点
- 逐项解析：每个选项都要解释对或错的原因
- 指出题干中的陷阱词（如"错误的是""不属于""主要"等）

【输出格式】严格输出 JSON：
{
  "keyPoint": "一句话考点",
  "perOption": [{"key": "A", "correct": true, "text": "..."}],
  "trapWords": ["陷阱词"],
  "low_confidence": false
}`
}

/* ==================== 从文档解析题目（OCR / PDF 结果结构化） ==================== */

/**
 * 解析 Prompt —— 与「出题」有本质区别：
 *   出题 = 依据资料**创作**新题；解析 = 把已有文本**忠实提取**成结构，不许改写、不许编造。
 * 这是应对 OCR 多题识别不准的主力手段：规则解析靠模式匹配，AI 靠语义理解，后者容忍格式混乱。
 */
function buildParsePrompt(text: string): string {
  return `你是题库结构化助手。下面是 OCR / PDF 提取的考题文本，可能存在格式错乱、噪音、多题粘连。

请把它**忠实解析**为结构化题目。

【严格约束，违反即为失败输出】
1. 忠实还原原文，**禁止改写题干与选项内容**（这不是出题，是提取）。
2. 只提取文本中已存在的信息：答案、解析、考点若原文没写，就留空，**绝对禁止编造**。
3. 忽略页眉页脚、页码、文档标题、考试须知、分节标题等非题目内容。
4. 遇到明显 OCR 错字（如「作⽤」这类兼容区异体字），可修正为规范汉字。
5. 一题一行、选项与答案紧跟其后的情况很常见，请依据语义正确切分，不要把两题并成一题。

【输出格式】严格输出 JSON，不要任何额外文字：
{
  "questions": [
    {
      "stem": "题干（含题号可去掉）",
      "type": "single",
      "options": [{"key": "A", "content": "选项内容"}],
      "answer": ["A"],
      "explanation": { "keyPoint": "考点，没有就留空字符串", "analysis": "解析原文，没有就留空字符串" }
    }
  ]
}

【待解析文本】
${text}`
}

interface ParsedQuestionDto {
  stem: string
  type?: string
  options: Array<{ key: string; content: string }>
  answer: string[]
  explanation?: { keyPoint?: string; analysis?: string }
}

/* ==================== 对话 ==================== */

const TUTOR_SYSTEM = `${SYSTEM_GUARD}

你是考生的 AI 私教。教学原则：
1. 苏格拉底式引导：用户答错时不要直接给答案，先追问引导他自己发现矛盾
2. 若用户明确要求"直接告诉我答案"，或连续追问 3 轮仍未理解，立即切换为直接讲解
3. 回答结构化：小标题 + 短段落 + 列表，避免大段文字
4. 不做空洞鼓励，给具体可执行的建议`

/* ==================== 服务实现 ==================== */

// 错误文案统一由基础设施层维护（describeAiError），此处转出以便页面沿用旧导入路径
export { describeAiError }

export class AiService {
  private readonly deps: AiServiceDeps

  constructor(deps: AiServiceDeps) {
    this.deps = deps
  }

  /** 是否已配置可用（未配置时 AI 功能不可用，但不影响学习功能） */
  get available(): boolean {
    return isConfigured()
  }

  /** 当前服务商展示名 */
  get channelLabel(): string {
    return currentProviderLabel()
  }

  /**
   * 统一调用入口。
   * 所有 AI 功能（出题 / 解析 / 私教）都必须经过这里。
   */
  private call(
    messages: ChatMessage[],
    temperature = 0.3,
    onChunk?: (t: string) => void,
  ): Promise<string> {
    return callChat({
      messages,
      temperature,
      ...(onChunk ? { onChunk } : {}),
    })
  }

  /**
   * AI 出题：生成 → 校验 → 写入题库（sourceLevel='B'）
   * 注意：绝不与官方真题混用，模考卷不引入 AI 生成题（PRD §8.6.1）
   */
  async generateQuestions(params: GenerateParams): Promise<Question[]> {
    let raw: string
    try {
      raw = await this.call([{ role: 'user', content: buildGeneratePrompt(params) }])
    } catch (err) {
      throw new Error(describeAiError(err))
    }
    const parsed = parseJson<{
      low_confidence?: boolean
      questions: GeneratedQuestion[]
    }>(raw)
    if (!parsed?.questions?.length) throw new Error('AI 返回内容无法解析为题目')

    const now = Date.now()
    const model = this.channelLabel
    const questions: Question[] = parsed.questions
      .filter((q) => q.stem && q.options?.length && q.answer?.length)
      .map((q, i) => ({
        id: `ai_${now}_${i}`,
        subjectId: params.subjectId,
        type: params.types[0] ?? 'single',
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        difficulty: q.difficulty ?? 3,
        bloomLevel: q.bloomLevel ?? params.bloom ?? 'understand',
        knowledgeNodeIds: params.nodeId ? [params.nodeId] : [],
        explanation: {
          keyPoint: q.explanation?.keyPoint ?? '',
          perOption: q.explanation?.perOption ?? [],
        },
        // AI 生成统一标记为 B 级（已校验）或 C 级（低置信度待验）
        sourceLevel: q.lowConfidence || parsed.low_confidence ? 'C' : 'B',
        ownerType: 'ai',
        aiMetadata: {
          model,
          confidence: q.lowConfidence ? 0.7 : 0.9,
          verified: !q.lowConfidence,
          generatedAt: now,
        },
        contentVersion: '2026',
        status: 'active',
      }))

    if (questions.length) await this.deps.questions.save(questions)
    return questions
  }

  /** 生成题目解析（结果缓存，避免重复消耗） */
  async explain(question: Question): Promise<Question['explanation']> {
    const cacheKey = `explain:${question.id}:${PROMPT_VERSION}`
    const cached = readCache(cacheKey)
    if (cached) return JSON.parse(cached) as Question['explanation']

    let raw: string
    try {
      raw = await this.call([{ role: 'user', content: buildExplainPrompt(question) }])
    } catch (err) {
      throw new Error(describeAiError(err))
    }
    const parsed = parseJson<{
      keyPoint: string
      perOption: Array<{ key: string; correct: boolean; text: string }>
      trapWords?: string[]
      low_confidence?: boolean
    }>(raw)
    if (!parsed) throw new Error('解析生成失败，请重试')

    const result: Question['explanation'] = {
      keyPoint: parsed.keyPoint,
      perOption: parsed.perOption,
      trapWords: parsed.trapWords,
      sourceRef: question.explanation?.sourceRef,
    }
    // 低置信度的内容不缓存，避免错误答案被反复使用
    if (!parsed.low_confidence) writeCache(cacheKey, JSON.stringify(result))
    return result
  }

  /**
   * 从文档文本解析题目（OCR / PDF 提取结果的结构化）
   *
   * 与 generateQuestions 的区别：这里是**忠实提取**用户已有的题目，不是创作新题。
   * 注意：结果**不直接入库**，交由导入流程预览确认（PRD M7-F3：绝不静默入库）。
   */
  async parseQuestions(rawText: string, subjectId: SubjectId): Promise<Question[]> {
    const text = String(rawText ?? '').trim()
    if (!text) throw new Error('没有可解析的文本')

    let raw: string
    try {
      raw = await this.call([{ role: 'user', content: buildParsePrompt(text) }])
    } catch (err) {
      throw new Error(describeAiError(err))
    }
    const parsed = parseJson<{ questions?: ParsedQuestionDto[] }>(raw)
    const list = parsed?.questions ?? []
    if (!list.length) throw new Error('AI 未能从文本中解析出题目，请检查内容或改用其他导入方式')

    const now = Date.now()
    const questions: Question[] = list
      .filter((q) => q.stem && q.options?.length && q.answer?.length)
      .map((q, i) => ({
        // 归入「我的题库」（ownerType='user'），与 AI 生成的题区分开
        id: `user_${now}_${i}`,
        subjectId,
        type: (q.type as QuestionType) ?? 'single',
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        difficulty: 3,
        bloomLevel: 'remember',
        knowledgeNodeIds: [],
        explanation: {
          keyPoint: q.explanation?.keyPoint ?? '',
          perOption: [],
          analysis: q.explanation?.analysis,
        },
        sourceLevel: 'C', // 来自用户文档，标记待验
        ownerType: 'user',
        contentVersion: '2026',
        status: 'active',
      }))

    if (!questions.length) throw new Error('AI 返回的题目缺少必要字段（题干 / 选项 / 答案）')
    return questions
  }

  /** 私教对话（流式） */
  async chat(messages: ChatMessage[], context?: string, onChunk?: (t: string) => void): Promise<string> {
    const full: ChatMessage[] = [{ role: 'system', content: TUTOR_SYSTEM }]
    if (context) full.push({ role: 'system', content: `【当前上下文】\n${context}` })
    full.push(...messages)
    return this.call(full, 0.5, onChunk)
  }

  /** 测试连接是否可用（BYOK 无额度概念，测多少次都不影响可用性） */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return testAiConnection()
  }
}

/* ==================== 缓存（后续可迁移到 SQLite 的 ai_response_cache 表） ==================== */

const LS_AI_CACHE = 'jingshi.ai_cache'

function readCache(key: string): string | null {
  try {
    const all = JSON.parse(localStorage.getItem(LS_AI_CACHE) || '{}') as Record<string, string>
    return all[key] ?? null
  } catch {
    return null
  }
}

function writeCache(key: string, value: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(LS_AI_CACHE) || '{}') as Record<string, string>
    all[key] = value
    localStorage.setItem(LS_AI_CACHE, JSON.stringify(all))
  } catch {
    /* 配额不足时静默跳过缓存 */
  }
}

function parseJson<T>(raw: string): T | null {
  try {
    // 兼容模型输出被 ```json 包裹的情况
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    return JSON.parse(cleaned) as T
  } catch {
    return null
  }
}
