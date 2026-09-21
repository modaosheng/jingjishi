/**
 * LLM 客户端（基础设施层）
 *
 * BYOK（自带密钥）模式：
 *   - Key 保存在本机 localStorage，请求**直达**用户选择的服务商，不经任何中间服务器
 *   - 采用 OpenAI 兼容协议，主流厂商均支持
 *
 * ⚠️ 安全说明：Web 端无法使用系统钥匙串，Key 存于 localStorage。
 *   切换到 Capacitor 原生端后应改用 @capacitor/preferences（走 Keychain/Keystore）。
 *   无论何种环境，Key 都不得写入日志或上传。
 */
export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
}

const LS_CONFIG = 'jingshi.llm_config'

export const DEFAULT_CONFIG: LlmConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
}

export function loadConfig(): LlmConfig | null {
  try {
    const raw = localStorage.getItem(LS_CONFIG)
    if (!raw) return null
    const c = JSON.parse(raw) as Partial<LlmConfig>
    if (!c.apiKey) return null
    return {
      baseUrl: c.baseUrl || DEFAULT_CONFIG.baseUrl,
      apiKey: c.apiKey,
      model: c.model || DEFAULT_CONFIG.model,
    }
  } catch {
    return null
  }
}

export function saveConfig(config: LlmConfig): void {
  localStorage.setItem(LS_CONFIG, JSON.stringify(config))
}

export function clearConfig(): void {
  localStorage.removeItem(LS_CONFIG)
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 统一错误：页面需能映射为可读文案（4xx 不重试，5xx 重试） */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

export class LlmClient {
  constructor(private readonly config: LlmConfig) {}

  private get configured(): boolean {
    return !!this.config.apiKey
  }

  async chat(messages: ChatMessage[], temperature = 0.3): Promise<string> {
    if (!this.configured) throw new LlmError('未配置 API Key', 0, false)
    const res = await this.request(messages, temperature, false)
    return res
  }

  /** 流式输出：首字延迟目标 < 1.5s */
  async chatStream(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    temperature = 0.3,
  ): Promise<string> {
    if (!this.configured) throw new LlmError('未配置 API Key', 0, false)
    return this.request(messages, temperature, true, onChunk)
  }

  private async request(
    messages: ChatMessage[],
    temperature: number,
    stream: boolean,
    onChunk?: (text: string) => void,
  ): Promise<string> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature,
          stream,
        }),
      })
    } catch (err) {
      // 网络层失败（离线/超时）：可重试
      throw new LlmError('网络请求失败，请检查网络或 API Key', 0, true)
    }

    if (!res.ok) {
      // 4xx 不重试（Key 错误/参数错误），5xx 可重试
      const retryable = res.status >= 500
      const msg =
        res.status === 401
          ? 'API Key 无效或已过期'
          : res.status === 429
            ? '请求过于频繁，请稍后再试'
            : `服务返回 ${res.status}`
      throw new LlmError(msg, res.status, retryable)
    }

    if (!stream) {
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
      return data.choices?.[0]?.message?.content ?? ''
    }

    // 解析 SSE
    const reader = res.body?.getReader()
    if (!reader) return ''
    const decoder = new TextDecoder()
    let full = ''
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>
          }
          const delta = json.choices?.[0]?.delta?.content
          if (delta) {
            full += delta
            onChunk?.(delta)
          }
        } catch {
          // 忽略不完整分片
        }
      }
    }
    return full
  }
}

/** 便捷入口：无配置时返回 null，由调用方降级 */
export function createLlmClient(): LlmClient | null {
  const config = loadConfig()
  return config ? new LlmClient(config) : null
}

/* ==================== 函数式入口（供双路径路由器复用） ====================
 * 路由器需要在"同一套代码路径"下调用 BYOK 与中转，因此这里提供
 * 与 LlmClient 等价、但无需实例化的简写形式，避免逻辑重复。
 */

export async function chat(messages: ChatMessage[], temperature = 0.3): Promise<string> {
  const client = createLlmClient()
  if (!client) throw new LlmError('未配置 API Key', 0, false)
  return client.chat(messages, temperature)
}

export async function chatStream(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  temperature = 0.3,
): Promise<string> {
  const client = createLlmClient()
  if (!client) throw new LlmError('未配置 API Key', 0, false)
  return client.chatStream(messages, onChunk, temperature)
}

