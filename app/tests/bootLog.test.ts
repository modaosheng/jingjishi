/**
 * 启动日志单测
 *
 * 重点守住一条硬承诺：**logBoot 绝不允许抛错**。
 * 它服务于排障，本身不能成为故障源 —— 一旦它在启动路径上抛错，
 * 就会把「用户看不见日志」升级成「用户用不了 App」。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { logBoot, readBootLog, clearBootLog, formatBootTime } from '../src/domain/boot/bootLog.ts'

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

const reset = () => globalThis.localStorage.clear()

/* ==================== 基本读写 ==================== */

test('无日志时返回空数组', () => {
  reset()
  assert.deepEqual(readBootLog(), [])
})

test('写入后能读回，且保留顺序', () => {
  reset()
  logBoot('模块已加载')
  logBoot('正在初始化数据存储…')
  logBoot('应用已挂载')

  const log = readBootLog()
  assert.equal(log.length, 3)
  assert.deepEqual(
    log.map((e) => e.m),
    ['模块已加载', '正在初始化数据存储…', '应用已挂载'],
  )
  assert.ok(log.every((e) => typeof e.t === 'number' && e.t > 0), '每条都要有时间戳')
})

test('超过上限时丢弃最旧的条目（避免无限增长）', () => {
  reset()
  for (let i = 0; i < 60; i++) logBoot(`阶段 ${i}`)

  const log = readBootLog()
  assert.ok(log.length <= 40, `条目数应被限制，实际 ${log.length}`)
  // 保留的应是最近的
  assert.equal(log[log.length - 1].m, '阶段 59')
})

/* ==================== 健壮性（核心承诺） ==================== */

test('⛔ logBoot 在存储不可用时也不抛错', () => {
  const saved = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem() {
        throw new Error('存储被禁用')
      },
      setItem() {
        throw new Error('配额已满')
      },
      removeItem() {
        throw new Error('存储被禁用')
      },
    },
    configurable: true,
    writable: true,
  })

  assert.doesNotThrow(() => logBoot('这条不该导致崩溃'), 'logBoot 抛错会把排障工具变成故障源')
  assert.doesNotThrow(() => readBootLog(), 'readBootLog 同样不能抛错')
  assert.doesNotThrow(() => clearBootLog())

  Object.defineProperty(globalThis, 'localStorage', { value: saved, configurable: true, writable: true })
})

test('存储内容损坏时不抛错，降级为空数组', () => {
  reset()
  globalThis.localStorage.setItem('jingshi.boot_log', '{{{ 不是合法 JSON')
  assert.doesNotThrow(() => readBootLog())
  assert.deepEqual(readBootLog(), [])
})

test('存储内容不是数组时降级为空数组', () => {
  reset()
  globalThis.localStorage.setItem('jingshi.boot_log', JSON.stringify({ oops: true }))
  assert.deepEqual(readBootLog(), [])
})

test('内容损坏后仍能继续写入并恢复正常', () => {
  reset()
  globalThis.localStorage.setItem('jingshi.boot_log', '坏数据')
  logBoot('恢复后的第一条')
  const log = readBootLog()
  assert.equal(log.length, 1)
  assert.equal(log[0].m, '恢复后的第一条')
})

/* ==================== 清理与格式化 ==================== */

test('clearBootLog 清空日志', () => {
  reset()
  logBoot('a')
  clearBootLog()
  assert.deepEqual(readBootLog(), [])
})

test('时间格式化补零正确', () => {
  const t = new Date(2026, 8, 22, 9, 5, 3).getTime()
  assert.equal(formatBootTime(t), '09:05:03')
})
