/**
 * 广告适配器接口（唯一与广告 SDK 耦合的边界层）
 *
 * ══════════════════════════════════════════════════════════════
 *  设计原则：**上层业务永远不 import 任何广告 SDK**
 * ══════════════════════════════════════════════════════════════
 *
 * 为什么要有这层：
 *   芒果联盟等广告 SDK 是**闭源商业 Native SDK**，它的 API 形态、生命周期、
 *   错误码都由第三方决定且可能随版本变化。如果业务代码直接调用它，那么：
 *     ① 无法在浏览器里开发（Native SDK 在 Web 环境根本不存在）
 *     ② 无法单测（需要真机 + 真实广告位）
 *     ③ SDK 升级或更换供应商时要改动所有调用点
 *
 * 因此约定：**本文件是业务层能看到的全部广告能力**。
 *   - 现在：由 MockAdapter 实现，浏览器里可完整跑通
 *   - 以后：由 MangoAdapter 实现，业务层零改动
 *
 * ⚠️ 铁律（PRD M9-F11）：广告失败绝不能让任何学习功能受影响。
 *    所以本接口的**所有方法都不得抛错**——失败一律通过返回值表达。
 */

import type { AdSlot } from '@/domain/ads/releaseEngine'

/** 广告展示失败的原因分类（用于埋点与降级决策，**绝不直接展示给用户**） */
export type AdFailReason =
  | 'offline' // 无网络
  | 'timeout' // 加载超时
  | 'no_fill' // 平台无广告可投（初期常见，属正常）
  | 'sdk_error' // SDK 内部错误
  | 'not_ready' // 尚未就绪
  | 'circuit_open' // 熔断中
  | 'unsupported' // 当前环境不支持（如浏览器降级模式）

/** 广告展示结果：成功或失败，**没有第三种状态** */
export type AdResult =
  | { ok: true; slot: AdSlot }
  | { ok: false; slot: AdSlot; reason: AdFailReason }

/** 广告适配器的能力契约 */
export interface AdAdapter {
  /** 适配器名称，用于日志与设置页展示（如 'mock' / 'mango'） */
  readonly name: string

  /**
   * 当前环境是否支持真实广告展示。
   * 浏览器里开发时为 false —— 此时应走 Mock 或直接不展示。
   */
  readonly supported: boolean

  /**
   * 初始化 SDK。
   *
   * ⚠️ **必须在用户同意隐私政策之后才能调用**（合规红线，无数 App 因此被下架）。
   * ⚠️ **严禁在 App 启动时同步调用**（PRD M9-F11 兜底机制 3）——
   *    应由调用方在「首次到达可展示广告位时」才触发，且不阻塞首屏渲染。
   */
  init(): Promise<void>

  /**
   * 预加载某个广告位的素材。
   * 允许失败，允许超时；调用方不应依赖它一定成功。
   */
  preload(slot: AdSlot): Promise<void>

  /**
   * 展示广告。
   *
   * @param slot     广告位
   * @param timeoutMs 超时上限。开屏传 1500（PRD 明确更严），其他位置传 5000。
   * @returns 成功 / 失败（带原因）。**绝不抛错。**
   */
  show(slot: AdSlot, timeoutMs: number): Promise<AdResult>

  /**
   * 放弃正在进行的加载（用户点了主按钮 / 应用被切到后台）。
   * 设计意图：**用户的意图永远优先于我们的收入**（PRD M9-F11）。
   */
  abort(slot: AdSlot): void

  /**
   * 销毁适配器（释放原生资源）。
   */
  destroy(): void
}

/* ---------------- 错误边界：把「可能抛错」收敛成「返回值」 ---------------- */

/**
 * 用独立错误边界包裹一次广告调用。
 *
 * ⚠️ 这是 PRD M9-F11 兜底机制 1「广告 SDK 崩溃隔离」的落地实现。
 *    广告 SDK 崩溃是**最常见的事故来源**，绝不能让它冒泡成页面级错误。
 *
 * 用法（唯一正确的调用姿势）：
 * ```ts
 * const result = await withAdErrorBoundary(() => adapter.show('splash', 1500), 'splash')
 * if (!result.ok) { /* 静默跳过，不提示用户 *\/ }
 * ```
 */
export async function withAdErrorBoundary(
  fn: () => Promise<AdResult>,
  slot: AdSlot,
  onError?: (err: unknown) => void,
): Promise<AdResult> {
  try {
    return await fn()
  } catch (err) {
    // 绝不 rethrow：广告的任何异常都不允许影响学习功能
    try {
      onError?.(err)
    } catch {
      /* 连日志回调都失败时，静默 */
    }
    return { ok: false, slot, reason: 'sdk_error' }
  }
}

/** 把各种异常归一化为 AdFailReason（供适配器内部使用） */
export function classifyAdError(err: unknown): AdFailReason {
  const msg = String((err as { message?: string })?.message ?? err ?? '').toLowerCase()
  if (msg.includes('network') || msg.includes('offline') || msg.includes('failed to fetch')) return 'offline'
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout'
  if (msg.includes('no fill') || msg.includes('nofill') || msg.includes('no_fill')) return 'no_fill'
  return 'sdk_error'
}
