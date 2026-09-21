/**
 * AI 调用客户端（基础设施层）—— 纯 BYOK
 *
 * ⚠️ 架构决策（2026-09-20 修订）：
 *   本 App **不涉及任何服务端**。所有 AI 请求由浏览器**直连**用户自己选择的
 *   服务商，我们不中转、不代理、不经手任何请求或数据。
 *
 * 这与项目的架构基石完全一致：
 *   - 无账号、无云端同步、设备即身份、数据 100% 本地
 *   - 零服务器、零运维、零持续成本、零备案风险
 *
 * 代价与取舍（写在这里，避免后续被误读为"功能缺失"）：
 *   - 未配置 Key 的用户无法使用 AI
 *   - 因此 AI 在本产品中的定位是**可选增强**，而非核心功能
 *   - 不配置 Key 不影响任何学习功能（刷题 / 错题 / 记忆曲线全部可用）
 */
import { getProvider, PROVIDERS, type ProviderMeta } from '@/domain/ai/providers'
import {
  chat as llmChat,
  chatStream as llmChatStream,
  LlmError,
  loadConfig,
  saveConfig,
  clearConfig,
  type ChatMessage,
  type LlmConfig,
} from './llmClient'

/* ==================== 配置管理（单一路径，无需"路由"） ==================== */

/** AI 是否已配置可用 */
export function isConfigured(): boolean {
  return !!loadConfig()?.apiKey
}

/** 当前使用的服务商（用于 UI 展示；自定义地址返回 null） */
export function currentProvider(): ProviderMeta | null {
  const config = loadConfig()
  if (!config) return null
  // 按 baseUrl 反查注册表，查不到说明是用户自定义地址
  return PROVIDERS.find((p) => p.baseUrl === config.baseUrl) ?? null
}

/** 当前服务商展示名 */
export function currentProviderLabel(): string {
  const p = currentProvider()
  if (p) return p.name
  return isConfigured() ? '自定义服务商' : '未配置'
}

/* ==================== 错误归一化 ==================== */

/**
 * 统一错误类型：把底层 LlmError 映射为 UI 可直接使用的分类。
 * 页面用同一段文案逻辑处理，无需关心底层细节。
 */
export class AiError extends Error {
  readonly code: AiErrorCode
  readonly retryable: boolean
  readonly status: number

  constructor(code: AiErrorCode, message: string, retryable: boolean, status = 0) {
    super(message)
    this.name = 'AiError'
    this.code = code
    this.retryable = retryable
    this.status = status
  }
}

export type AiErrorCode =
  | 'NOT_CONFIGURED'
  | 'AUTH'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'SERVER'
  | 'UNKNOWN'

function mapError(err: unknown): AiError {
  if (err instanceof LlmError) {
    if (err.status === 401) return new AiError('AUTH', err.message, false, 401)
    if (err.status === 403) return new AiError('AUTH', err.message, false, 403)
    if (err.status === 429) return new AiError('RATE_LIMITED', err.message, false, 429)
    if (err.status === 0) return new AiError('NETWORK', err.message, true, 0)
    return new AiError('SERVER', err.message, err.retryable, err.status)
  }
  const msg = err instanceof Error ? err.message : 'AI 请求失败'
  return new AiError('UNKNOWN', msg, false)
}

/** 把错误转成对用户可读的文案 */
export function describeAiError(err: unknown): string {
  if (err instanceof AiError) {
    switch (err.code) {
      case 'NOT_CONFIGURED':
        return '还没有配置 AI 服务。到「AI 设置」填入自己的 Key 即可启用（不配置不影响刷题与错题功能）'
      case 'AUTH':
        return 'API Key 无效或已过期，请到设置中检查'
      case 'RATE_LIMITED':
        return '请求过于频繁，休息一下再试'
      case 'NETWORK':
        return '网络连接失败。请检查网络，或确认该服务商在你所在地区可访问'
      case 'SERVER':
        return '服务商暂时不稳定，稍后再试'
      default:
        return err.message || 'AI 请求失败，请重试'
    }
  }
  return err instanceof Error ? err.message : 'AI 请求失败，请重试'
}

/* ==================== 统一调用入口 ==================== */

export interface CallOptions {
  messages: ChatMessage[]
  temperature?: number
  onChunk?: (t: string) => void
}

/**
 * 统一对话入口。
 *
 * 保留与原「双路径路由器」相同的函数签名（只是去掉了 consumeQuota），
 * 这样上层 AiService 无需改动即可继续工作。
 *
 * @throws AiError
 */
export async function callChat(opts: CallOptions): Promise<string> {
  const { messages, temperature = 0.3, onChunk } = opts

  if (!isConfigured()) {
    throw new AiError('NOT_CONFIGURED', '尚未配置 API Key', false)
  }

  try {
    return onChunk
      ? await llmChatStream(messages, onChunk, temperature)
      : await llmChat(messages, temperature)
  } catch (err) {
    throw mapError(err)
  }
}

/** 测试连接是否可用（不消耗任何额度 —— BYOK 本身也不限次） */
export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  if (!isConfigured()) {
    return { ok: false, message: '尚未配置 API Key' }
  }
  try {
    await llmChat([{ role: 'user', content: '回复"ok"两个字即可' }], 0)
    return { ok: true, message: '连接正常' }
  } catch (err) {
    return { ok: false, message: describeAiError(err) }
  }
}

/* ==================== 配置读写（转出，供设置页使用） ==================== */

export type { ProviderMeta, LlmConfig, ChatMessage }
export { getProvider }
export {
  loadConfig as loadByokConfig,
  saveConfig as saveByokConfig,
  clearConfig as clearByokConfig,
}
