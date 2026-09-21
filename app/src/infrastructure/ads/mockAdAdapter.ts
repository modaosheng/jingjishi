/**
 * Mock 广告适配器（浏览器开发期使用）
 *
 * 目的：让**全部上层逻辑**（渐进释放 / 频次控制 / 三个广告位 UI / 超时降级 /
 *      错误隔离 / 失败即赠送）在没有 SDK、没有广告位 ID、没有真机的情况下
 *      就能被完整开发与验证。
 *
 * ⚠️ 这不是「假数据占位」，而是一个**行为可配置的仿真器**：
 *    它刻意模拟了真实环境的四类失败（离线 / 超时 / 无填充 / SDK 崩溃），
 *    以便我们在浏览器里就能确认「广告出问题时，学习功能毫发无伤」。
 *
 * 切换方式：见 `services/ads.ts` 的 `createAdAdapter()`。
 */

import type { AdSlot } from '@/domain/ads/releaseEngine'
import type { AdAdapter, AdResult } from './adAdapter'

/** 仿真场景：可通过 localStorage 或调试面板切换 */
export type MockScenario =
  | 'success' // 正常展示
  | 'offline' // 无网络
  | 'timeout' // 加载超时（不响应）
  | 'no_fill' // 平台无填充
  | 'crash' // SDK 崩溃（抛异常，用于验证错误边界）

const LS_MOCK_SCENARIO = 'jingshi.ad_mock_scenario'

function readScenario(): MockScenario {
  try {
    const v = localStorage.getItem(LS_MOCK_SCENARIO)
    if (v === 'offline' || v === 'timeout' || v === 'no_fill' || v === 'crash' || v === 'success') return v
  } catch {
    /* noop */
  }
  return 'success'
}

/** 供调试面板切换仿真场景 */
export function setMockScenario(s: MockScenario): void {
  try {
    localStorage.setItem(LS_MOCK_SCENARIO, s)
  } catch {
    /* noop */
  }
}

export function getMockScenario(): MockScenario {
  return readScenario()
}

/** 模拟网络延迟的可配置区间（毫秒） */
function mockLatency(): number {
  // 300~900ms：足够真实，又不至于让开发等待太久
  return 300 + Math.random() * 600
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class MockAdAdapter implements AdAdapter {
  readonly name = 'mock'
  /** 浏览器环境标注为「不支持真实广告」，但在 Mock 下可完整演示 */
  readonly supported = false

  private initialized = false
  private abortFlags = new Set<AdSlot>()

  async init(): Promise<void> {
    this.initialized = true
    await delay(120) // 模拟 SDK 初始化的轻微耗时
  }

  async preload(slot: AdSlot): Promise<void> {
    if (!this.initialized) await this.init()
    this.abortFlags.delete(slot)
    await delay(mockLatency())
  }

  async show(slot: AdSlot, timeoutMs: number): Promise<AdResult> {
    if (!this.initialized) await this.init()

    const scenario = readScenario()

    // —— 场景：无网络。立即失败，不等待。
    if (scenario === 'offline') {
      return { ok: false, slot, reason: 'offline' }
    }

    // —— 场景：SDK 崩溃。抛异常，用于验证错误边界真的兜得住。
    if (scenario === 'crash') {
      throw new Error('[MockAds] simulated SDK crash in AdNetworkBridge.show()')
    }

    // —— 场景：平台无填充。模拟真实平台的正常返回，不是错误。
    if (scenario === 'no_fill') {
      await delay(Math.min(200, timeoutMs))
      return { ok: false, slot, reason: 'no_fill' }
    }

    // —— 场景：加载超时。永不在超时窗口内返回，由调用方的超时机制接管。
    if (scenario === 'timeout') {
      // 故意返回一个永远 pending 的 Promise：真实 SDK 卡死时就是这个表现
      return new Promise<AdResult>(() => {
        /* 永不 resolve —— 调用方的 timeout 会兜住 */
      })
    }

    // —— 正常路径：模拟一次完整加载
    const latency = mockLatency()
    if (latency > timeoutMs) {
      // 加载时间超过超时窗口 → 视为超时（真实 SDK 的常见表现）
      return new Promise<AdResult>(() => {
        /* 永不 resolve，交给调用方超时 */
      })
    }

    await delay(latency)

    // 加载过程中被 abort（用户点了主按钮 / 切后台）
    if (this.abortFlags.has(slot)) {
      this.abortFlags.delete(slot)
      return { ok: false, slot, reason: 'not_ready' }
    }

    return { ok: true, slot }
  }

  abort(slot: AdSlot): void {
    this.abortFlags.add(slot)
  }

  destroy(): void {
    this.initialized = false
    this.abortFlags.clear()
  }
}
