/**
 * 广告服务（业务层唯一入口）
 *
 * ══════════════════════════════════════════════════════════════
 *  调用链（严格顺序，缺一不可）：
 *
 *    UI 想展示广告
 *      ↓
 *    ⓿ 用户已同意隐私政策？  （未同意 → 直接静默返回，**不得初始化任何 SDK**）
 *      ↓
 *    ① 网络是否可用？        （离线 → 直接静默返回，PRD M9-F11 铁律）
 *      ↓
 *    ② 已购买去广告？        （adFree → 直接静默返回）
 *      ↓
 *    ③ 渐进释放已开启？      （releaseEngine → 没到阶段不放）
 *      ↓
 *    ④ 频次还有额度？        （frequencyCap → 超限不放）
 *      ↓
 *    ⑤ 会话熔断已触发？      （连续 3 次失败 → 本会话禁用）
 *      ↓
 *    ⑥ 真正调用适配器（含超时 + 错误边界）
 *      ↓
 *    ⑦ 成功后 recordImpression（**只有真正展示了才记数**）
 * ══════════════════════════════════════════════════════════════
 *
 * ⚠️ 这个顺序本身就是产品决策与合规要求，不是实现细节：
 *    - ⓿ 同意闸门必须**最前**：合规红线，未同意前碰 SDK 会被下架
 *    - ① 网络闸门必须**早于广告判定**：离线时连「要不要展示」都不用算，直接跳过
 *    - ② 已去广告排在渐进释放之前 = **付费用户的判断路径最短**
 *      付费用户永远不该因为任何广告逻辑被多绕一步
 */

import { isAdFree, shouldShowAd, type AdSlot } from '@/domain/ads/releaseEngine'
import { canShowByFrequency, recordClick, recordImpression } from '@/domain/ads/frequencyCap'
import { hasConsented } from '@/domain/privacy/consent'
import { isOffline } from '@/domain/net/networkStatus'
import type { AdAdapter, AdFailReason, AdResult } from '@/infrastructure/ads/adAdapter'
import { withAdErrorBoundary } from '@/infrastructure/ads/adAdapter'

/** 开屏的超时标准比其他位置更严（PRD M9-F11 明确要求） */
export const SPLASH_TIMEOUT_MS = 1500

/** 内容区广告位的超时标准 */
export const CONTENT_TIMEOUT_MS = 5000

/** 同一会话内连续失败 N 次后禁用广告请求（PRD M9-F11 兜底机制 2） */
export const SESSION_FAILURE_LIMIT = 3

/** 一次广告展示尝试的完整结果 */
export interface AdAttempt {
  /** 是否成功展示了广告 */
  shown: boolean
  /**
   * 用户主动触发但失败时，是否应**直接发放奖励**。
   * PRD M9-F11「失败即赠送」——同一次技术故障，可以是一次扣分，也可以是一次加分。
   */
  grantReward: boolean
  /** 失败原因（供埋点，**不展示给用户**） */
  reason?: AdFailReason
}

/** 静默不展示：用户不该知道这里「本来有广告」 */
const SILENT: AdAttempt = { shown: false, grantReward: false }

/**
 * 广告服务。
 *
 * ⚠️ 本类**不持有任何 UI 状态**，只负责决策与调用。
 *    展示与否的视觉呈现由 UI 组件负责。
 */
export class AdService {
  private adapter: AdAdapter
  private sessionFailures = 0
  private sessionDisabled = false

  constructor(adapter: AdAdapter) {
    this.adapter = adapter
  }

  /** 供设置页展示当前适配器（'mock' 或 'mango'） */
  get adapterName(): string {
    return this.adapter.name
  }

  /** 当前会话是否已被熔断 */
  get isSessionDisabled(): boolean {
    return this.sessionDisabled
  }

  /**
   * 尝试展示一个广告位。
   *
   * @param slot        广告位
   * @param isRewarded  是否为「用户主动点击换取奖励」的激励视频
   *                    —— 这个参数决定失败时是否「赠送奖励」
   */
  async tryShow(slot: AdSlot, isRewarded = false): Promise<AdAttempt> {
    // ⓿ 隐私同意闸门（**合规红线，必须最前**）
    //    《个人信息保护法》与应用商店审核均要求：用户明确同意隐私政策之前，
    //    不得初始化任何采集设备信息的第三方 SDK。广告 SDK 正属此类。
    //    未同意 → 直接返回，连适配器的 init 都不会被调用。
    if (!hasConsented()) return SILENT

    // ① 网络闸门（PRD M9-F11 铁律）
    //    完全离线时**主动**跳过，而不是等 SDK 超时 ——
    //    用户看到的是「App 正常」，而不是「广告加载失败」。
    if (isOffline()) return SILENT

    // ② 会话已熔断：静默跳过
    if (this.sessionDisabled) return SILENT

    // ③ 已购买去广告：**付费用户路径最短**，不做任何后续判断
    if (isAdFree()) return SILENT

    // ④ 渐进释放
    if (!shouldShowAd(slot)) return SILENT

    // ⑤ 频次闸门
    const gate = canShowByFrequency(slot, isRewarded)
    if (!gate.allowed) return SILENT

    // ⑥ 真正调用（含超时 + 错误边界）
    const timeout = slot === 'splash' ? SPLASH_TIMEOUT_MS : CONTENT_TIMEOUT_MS
    const result = await this.withTimeout(
      withAdErrorBoundary(() => this.adapter.show(slot, timeout), slot, () => {
        this.noteFailure()
      }),
      timeout,
      slot,
    )

    if (!result.ok) {
      this.noteFailure()
      return {
        shown: false,
        // ⭐ 「失败即赠送」：只有用户**主动点击**的场景才赠送。
        //    开屏是被动展示，用户没有付出期待，失败时静默跳过即可。
        grantReward: isRewarded,
        reason: result.reason,
      }
    }

    // ⑥ 成功：重置失败计数 + 记账
    this.sessionFailures = 0
    recordImpression(slot, isRewarded)
    return { shown: true, grantReward: false }
  }

  /** 由 UI 在广告被点击时上报（用于疲劳熔断判断） */
  noteClick(slot: AdSlot): void {
    recordClick(slot)
  }

  /**
   * 放弃正在进行的加载。
   * ⚠️ 必须在两种场景下调用（PRD M9-F11）：
   *    ① 广告加载中用户点了主按钮（继续学习）
   *    ② 应用被切到后台
   */
  abort(slot: AdSlot): void {
    try {
      this.adapter.abort(slot)
    } catch {
      /* 适配器 abort 失败不影响任何功能 */
    }
  }

  /** 应用启动时重置会话级状态（熔断计数不跨会话） */
  resetSession(): void {
    this.sessionFailures = 0
    this.sessionDisabled = false
    this.adapter.destroy()
  }

  /* ---------------- 内部：超时与熔断 ---------------- */

  /**
   * 硬超时包裹：无论适配器是否响应，都在 timeoutMs 后返回失败。
   *
   * ⚠️ 这是「开屏 1.5 秒」能被真正保证的地方。
   *    真实 SDK 卡死时不会自己报超时，必须由我们在外层兜住。
   */
  private withTimeout(
    promise: Promise<AdResult>,
    timeoutMs: number,
    slot: AdSlot,
  ): Promise<AdResult> {
    return new Promise<AdResult>((resolve) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.adapter.abort(slot) // 通知适配器放弃，避免资源泄漏
        resolve({ ok: false, slot, reason: 'timeout' })
      }, timeoutMs)

      promise
        .then((r) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(r)
        })
        .catch(() => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({ ok: false, slot, reason: 'sdk_error' })
        })
    })
  }

  /** 记录一次失败，达到阈值则本会话熔断 */
  private noteFailure(): void {
    this.sessionFailures += 1
    if (this.sessionFailures >= SESSION_FAILURE_LIMIT) {
      this.sessionDisabled = true
    }
  }
}
