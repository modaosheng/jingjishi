/**
 * 服务商注册表 —— BYOK 模式的单一数据源。
 *
 * 设计原则：
 * - 展示给用户的信息必须**去技术化**（场景标签，不是参数）
 * - 排序由**客观评分卡**决定：中文能力 40% / 单次成本 30% / 稳定性 30%
 * - ⚠️ **不回传任何形式的商业加权**：本产品不从中转或返利中获利，
 *   排序纯粹反映"哪个更适合备考"。这条是纪律，写在代码里而非仅文档里。
 */

export interface ProviderMeta {
  id: string
  /** 展示名 */
  name: string
  /** OpenAI 兼容 baseUrl */
  baseUrl: string
  /** 推荐默认模型 */
  defaultModel: string
  /** 面向用户的场景标签（去技术化，≤5 字） */
  tags: string[]
  /** 场景建议文案（写给用户看） */
  advice: string
  /**
   * 客观评分卡（0-100）。排序权重：
   *   chinese*0.4 + cost*0.3 + stability*0.3
   */
  score: { chinese: number; cost: number; stability: number }
  /** 服务商控制台的 Key 管理页（教程里作为跳转目标） */
  consoleUrl: string
}

export const CHINESE_WEIGHT = 0.4
export const COST_WEIGHT = 0.3
export const STABILITY_WEIGHT = 0.3

export const PROVIDERS: readonly ProviderMeta[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    tags: ['快', '便宜'],
    advice: '日常出题、解析错题，性价比最高',
    score: { chinese: 92, cost: 98, stability: 88 },
    consoleUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    tags: ['长文强'],
    advice: '需要读大段教材原文、做长材料分析时选它',
    score: { chinese: 90, cost: 74, stability: 86 },
    consoleUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    tags: ['法规准'],
    advice: '问法条、问政策原文类的题目，准确度更稳',
    score: { chinese: 94, cost: 76, stability: 90 },
    consoleUrl: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    tags: ['推理稳'],
    advice: '需要多步推导的题目（如计算题思路）表现好',
    score: { chinese: 88, cost: 86, stability: 84 },
    consoleUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    tags: ['通用'],
    advice: '已有账号的用户可直接接入',
    score: { chinese: 78, cost: 60, stability: 92 },
    consoleUrl: 'https://platform.openai.com/api-keys',
  },
] as const

/** 客观综合分（0-100） */
export function compositeScore(p: ProviderMeta): number {
  return Math.round(
    p.score.chinese * CHINESE_WEIGHT + p.score.cost * COST_WEIGHT + p.score.stability * STABILITY_WEIGHT,
  )
}

/** 按客观分降序排列（推荐首选排第一） */
export function rankProviders(list: readonly ProviderMeta[] = PROVIDERS): ProviderMeta[] {
  return [...list].sort((a, b) => compositeScore(b) - compositeScore(a))
}

export function getProvider(id: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

export function getProviderByBaseUrl(baseUrl: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.baseUrl === baseUrl)
}

/** 推荐首选（综合分最高者） */
export function defaultProviderId(): string {
  return rankProviders()[0]?.id ?? 'deepseek'
}

export function defaultProvider(): ProviderMeta {
  return getProvider(defaultProviderId()) ?? PROVIDERS[0]!
}

/* ==================== 文案 ==================== */

export const DISCLAIMER_BYOK =
  'AI 功能由你选择的第三方服务商提供，请求由你的设备直接发送给该服务商，我们不接收、不存储你的任何对话内容。其输出内容不代表本产品的立场，我们不对其准确性负责。请以教材与官方文件为准。'

/**
 * 「AI 是可选增强」的明示。
 * ⚠️ 这句话是产品诚实性的一部分，不可删除：
 *    因为本产品不提供免费额度，必须让用户清楚知道"不配置也能完整备考"。
 */
export const AI_IS_OPTIONAL_NOTICE =
  'AI 是可选增强功能。不配置 Key 也能完整使用刷题、错题本、记忆曲线、模考等全部学习功能。'
