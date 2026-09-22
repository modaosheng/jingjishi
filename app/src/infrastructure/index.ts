/**
 * 数据源工厂 —— 业务层唯一入口
 *
 * 切换方式：环境变量 VITE_DATA_SOURCE = sqlite | mock | http
 * SQLite 初始化失败（如浏览器不支持 OPFS、Safari 无痕模式）时自动降级为 Mock，
 * 保证应用永远可用。
 */
import type { DataSource } from '@/domain/repositories'

let current: DataSource | null = null
let fallbackReason = ''

/**
 * 启动兜底是否已经定局。
 *
 * ⚠️ 为什么需要这个标志：`initDataSource()` 可能很慢，启动流程等不了那么久，
 *    于是会在超时后用 `forceMockDataSource()` 先把应用拉起来。
 *    而**原来那次 initDataSource() 仍在后台继续跑** —— 如果它稍后成功了，
 *    就会把数据源从 Mock 换成 SQLite，出现「界面已经用 Mock 跑起来，
 *    中途数据源被换掉」的错乱。
 *
 *    定局后一律不再改写，保证一次启动内数据源稳定。
 */
let bootSettled = false

/**
 * 环境诊断：提前判断 OPFS 不可用的常见原因，给出比原始报错更准确、可操作的原因
 *
 * 最常见的情况是「非安全上下文」——用 http 协议经局域网 IP 在手机上访问开发服务器时，
 * OPFS / Worker 模块都会被浏览器禁用，从而降级为 Mock。
 * 打包成 App（Capacitor）后页面加载在 https://localhost 或 capacitor://localhost，
 * 属安全上下文，OPFS 可用（要求系统 WebView 版本达标）。
 */
function diagnoseEnv(): string | null {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return (
      '当前不是安全上下文（需 HTTPS 或 localhost）。用 http 经局域网 IP 在手机上访问时，' +
      'OPFS 会被浏览器禁用——这是手机浏览器降级为 Mock 最常见的原因。' +
      '解决：改用 https 访问，或打包成 App（App 内为安全上下文）。'
    )
  }
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return '当前浏览器不支持 OPFS（需 Chrome 108+ / Safari 16.4+ / Firefox 111+）'
  }
  return null
}

export async function initDataSource(): Promise<DataSource> {
  const mode = import.meta.env.VITE_DATA_SOURCE ?? 'sqlite'

  if (mode === 'http') {
    // 预留：将来对接真实后端时在此加载 HttpDataSource
    fallbackReason = 'HTTP 数据源尚未实现，已降级为 SQLite'
  }

  if (mode !== 'mock') {
    const envIssue = diagnoseEnv()
    if (envIssue) {
      fallbackReason = envIssue
      console.warn('[DataSource] 环境不支持 SQLite，降级为 Mock：', envIssue)
    } else {
      try {
        const { sqliteDataSource } = await import('./db/sqlite')
        await sqliteDataSource.init()
        // 兜底已定局 → 保持现状，不覆盖（见 bootSettled 的说明）
        if (bootSettled && current) return current
        current = sqliteDataSource
        console.info('[DataSource] SQLite(OPFS) 已就绪')
        return current
      } catch (err) {
        fallbackReason = err instanceof Error ? err.message : String(err)
        console.warn('[DataSource] SQLite 初始化失败，降级为 Mock：', fallbackReason)
      }
    }
  }

  if (bootSettled && current) return current
  const { mockDataSource } = await import('./mock/mockDataSource')
  await mockDataSource.init()
  current = mockDataSource
  console.info('[DataSource] Mock 已就绪')
  return current
}

/**
 * 启动兜底：强制使用 Mock 数据源。
 *
 * ⚠️ 只有一个用途 —— `initDataSource()` **超出启动预算仍未返回**时，
 *    保证应用还能起来，而不是让用户一直盯着启动界面。
 *
 * 为什么需要它：SQLite(OPFS) 初始化要加载 WASM、执行迁移、灌入知识树与题库，
 * 在低端机上可能明显偏慢；个别 WebView 的 OPFS 实现还可能长时间无响应。
 * 这种情况下**宁可降级，也不要让用户用不了 App**。
 *
 * 数据说明（不含糊，如实交代）：
 *   - 题库与知识树在内存中重建，与 SQLite 一致
 *   - **用户数据（答题状态、答题流水、自建题）仍然写入 localStorage**，
 *     因此降级期间的学习记录不会丢失
 *   - 下次启动会重新尝试 SQLite；若恢复成功，历史学习记录仍在
 *
 * @param reason 记入降级原因，供「我的 → 存储信息」展示
 */
export async function forceMockDataSource(reason: string): Promise<DataSource> {
  const { mockDataSource } = await import('./mock/mockDataSource')
  await mockDataSource.init()
  current = mockDataSource
  fallbackReason = reason
  // 标记定局：此后 initDataSource() 即使成功也不再改写数据源
  bootSettled = true
  console.warn('[DataSource] 启动兜底触发，已切换为 Mock：', reason)
  return current
}

export function getDataSource(): DataSource {
  if (!current) throw new Error('数据源尚未初始化，请先调用 initDataSource()')
  return current
}

/** 供「存储管理」页展示当前数据源与降级原因 */
export function getDataSourceInfo() {
  return {
    name: current?.name ?? '未初始化',
    fallbackReason,
  }
}
