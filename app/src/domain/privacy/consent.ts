/**
 * 隐私政策同意状态
 *
 * ══════════════════════════════════════════════════════════════
 *  ⚠️ 这是**广告 SDK 初始化的合规前置条件**。
 *
 *  《个人信息保护法》与各应用商店的审核规则都要求：
 *  **在用户明确同意隐私政策之前，不得初始化任何采集设备信息的第三方 SDK。**
 *  广告 SDK 恰好就属于这类 SDK —— 无数 App 因"启动即初始化广告 SDK"被下架。
 *
 *  因此本模块是整个广告链路的**第一道闸门**，位置在 AdService 闸门链最前端。
 * ══════════════════════════════════════════════════════════════
 */

import { PRIVACY_VERSION } from './policy'

const LS_CONSENT = 'jingshi.privacy_consent'

export interface ConsentRecord {
  /** 用户已同意的政策版本 */
  version: string
  /** 同意时间戳 */
  acceptedAt: number
}

/**
 * 读取同意记录（不做版本校验）。
 * 存储损坏或缺失时返回 null，**绝不让异常冒泡** —— 隐私模块不能成为崩溃源。
 */
export function loadConsent(): ConsentRecord | null {
  try {
    const raw = localStorage.getItem(LS_CONSENT)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<ConsentRecord>
    if (typeof p.version !== 'string' || typeof p.acceptedAt !== 'number') return null
    return { version: p.version, acceptedAt: p.acceptedAt }
  } catch {
    return null
  }
}

/**
 * 是否已完成**当前版本**的隐私政策同意。
 *
 * ⚠️ 版本不匹配视为**未同意** —— 政策有实质变更时必须重新征求确认。
 *    这是合规要求，也是对用户的诚实：不能因为"他一年前点过一次"就默认他同意新条款。
 */
export function hasConsented(): boolean {
  const rec = loadConsent()
  return rec !== null && rec.version === PRIVACY_VERSION
}

/** 记录用户同意（由同意页调用，是唯一的写入入口） */
export function acceptConsent(now: number = Date.now()): ConsentRecord {
  const rec: ConsentRecord = { version: PRIVACY_VERSION, acceptedAt: now }
  try {
    localStorage.setItem(LS_CONSENT, JSON.stringify(rec))
  } catch {
    /* 配额不足：同意状态无法持久化，用户下次启动会再看到一次，属可接受降级 */
  }
  return rec
}

/**
 * 撤销同意（用于「清除全部数据」）。
 *
 * ⚠️ 撤销后必须确保广告 SDK 不再被调用 —— 但注意：
 *    撤销只影响**未来**的初始化决策，已加载的 SDK 需在重启后彻底清除。
 *    对纯 Web 环境这天然成立（刷新即清空）。
 */
export function revokeConsent(): void {
  try {
    localStorage.removeItem(LS_CONSENT)
  } catch {
    /* noop */
  }
}
