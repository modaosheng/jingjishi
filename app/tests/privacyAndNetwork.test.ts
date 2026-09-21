/**
 * 隐私同意与网络状态单测
 *
 * 隐私同意是**广告 SDK 初始化的合规闸门**，它出问题的后果是 App 被下架，
 * 因此必须严格单测（尤其是「政策版本变更 → 必须重新同意」这条）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  hasConsented,
  acceptConsent,
  revokeConsent,
  loadConsent,
} from '../src/domain/privacy/consent.ts'
import { PRIVACY_VERSION, PRIVACY_SECTIONS, CONSENT_SUMMARY } from '../src/domain/privacy/policy.ts'
import { isOnline, isOffline } from '../src/domain/net/networkStatus.ts'

/* ---------------- 环境准备 ---------------- */

function installStorageShim(): void {
  const store = new Map<string, string>()
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  } as Storage
}

installStorageShim()

function reset(): void {
  globalThis.localStorage.clear()
}

/* ==================== 隐私同意 ==================== */

test('未同意时 hasConsented 为 false', () => {
  reset()
  assert.equal(hasConsented(), false)
  assert.equal(loadConsent(), null)
})

test('同意后 hasConsented 为 true', () => {
  reset()
  acceptConsent()
  assert.equal(hasConsented(), true)
})

test('同意记录包含版本号与时间戳', () => {
  reset()
  acceptConsent(1_700_000_000_000)
  const rec = loadConsent()
  assert.ok(rec)
  assert.equal(rec.version, PRIVACY_VERSION)
  assert.equal(rec.acceptedAt, 1_700_000_000_000)
})

test('⛔ 政策版本变更后必须重新同意（合规要求）', () => {
  reset()
  acceptConsent()
  assert.equal(hasConsented(), true)

  // 模拟：用户同意的是旧版本
  globalThis.localStorage.setItem(
    'jingshi.privacy_consent',
    JSON.stringify({ version: '2020-01-01', acceptedAt: Date.now() }),
  )
  assert.equal(hasConsented(), false, '旧版本同意不得视为对新政策的同意')
})

test('撤销同意后回到未同意状态', () => {
  reset()
  acceptConsent()
  revokeConsent()
  assert.equal(hasConsented(), false)
})

test('存储内容损坏时降级为「未同意」而非抛错', () => {
  reset()
  globalThis.localStorage.setItem('jingshi.privacy_consent', '{{{ 坏数据')
  assert.doesNotThrow(() => hasConsented())
  assert.equal(hasConsented(), false, '读不出记录时必须保守地视为未同意')
})

test('结构不完整的记录被拒绝', () => {
  reset()
  globalThis.localStorage.setItem('jingshi.privacy_consent', JSON.stringify({ version: PRIVACY_VERSION }))
  assert.equal(hasConsented(), false, '缺少 acceptedAt 应视为无效记录')
})

/* ==================== 政策内容完整性 ==================== */

test('政策内容包含广告与第三方 SDK 章节（合规必需）', () => {
  const hasAdSection = PRIVACY_SECTIONS.some((s) => s.title.includes('广告'))
  assert.equal(hasAdSection, true, 'PRD M10-F6 要求单列「广告与第三方 SDK」章节')
})

test('政策内容包含 AI 数据边界章节', () => {
  const hasAiSection = PRIVACY_SECTIONS.some((s) => s.title.includes('AI'))
  assert.equal(hasAiSection, true, 'PRD 要求显著告知 AI 数据流向')
})

test('政策内容包含数据导出与删除说明（PIPL 可携带权与删除权）', () => {
  const all = PRIVACY_SECTIONS.map((s) => s.title).join('|')
  assert.match(all, /导出|删除/, '需说明数据的导出与删除途径')
})

test('每条章节都有实质性内容（不留空壳章节）', () => {
  for (const sec of PRIVACY_SECTIONS) {
    const hasContent = (sec.paragraphs?.length ?? 0) > 0 || (sec.bullets?.length ?? 0) > 0 || !!sec.highlight
    assert.equal(hasContent, true, `章节「${sec.title}」没有内容`)
  }
})

test('同意页摘要非空且条目精简（用户 10 秒能读完）', () => {
  assert.ok(CONSENT_SUMMARY.length > 0)
  assert.ok(CONSENT_SUMMARY.length <= 6, '摘要过长会没人看，失去意义')
})

test('政策版本号格式合法（YYYY-MM-DD）', () => {
  assert.match(PRIVACY_VERSION, /^\d{4}-\d{2}-\d{2}$/)
})

/* ==================== 网络状态 ==================== */

/**
 * 模拟 navigator。
 * ⚠️ Node 22 的 `navigator` 是只读 getter，必须用 defineProperty 覆盖。
 */
function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })
}

test('无 navigator 时保守返回在线（交由下层超时兜底）', () => {
  setNavigator(undefined)
  assert.equal(isOnline(), true, '无法判断时应保守认为在线，而非误判离线导致广告永不展示')
})

test('navigator.onLine 为 false 时判定离线', () => {
  setNavigator({ onLine: false })
  assert.equal(isOffline(), true)
  assert.equal(isOnline(), false)
})

test('navigator.onLine 为 true 时判定在线', () => {
  setNavigator({ onLine: true })
  assert.equal(isOnline(), true)
  assert.equal(isOffline(), false)
})

test('onLine 字段类型异常时保守返回在线', () => {
  setNavigator({ onLine: 'yes' })
  assert.equal(isOnline(), true, '字段异常时不应误判为离线')
})

test('navigator 为 null 时不抛错且保守返回在线', () => {
  setNavigator(null)
  assert.doesNotThrow(() => isOnline())
  assert.equal(isOnline(), true)
})
