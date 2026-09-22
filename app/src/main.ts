import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'vant/lib/index.css'
import './styles/tokens.css'
import './styles/global.css'
import App from './App.vue'
import router from './router'
import { initDataSource, forceMockDataSource } from './infrastructure'
import { getServices } from './services'

/**
 * 启动预算：数据源初始化最多等这么久。
 *
 * ⚠️ 这个值存在的意义是「**保证应用一定能起来**」。
 *    SQLite(OPFS) 初始化要加载 WASM + 迁移 + 灌题库，低端机上可能偏慢，
 *    个别 WebView 的 OPFS 实现还可能长时间无响应。
 *    超过预算就降级到 Mock（数据仍会写入 localStorage，不会丢），
 *    而不是让用户无限等待。
 */
const BOOT_BUDGET_MS = 12_000

/** 应用是否已成功挂载（挂载前的异常才需要显示到启动界面上） */
let mounted = false

/* ==================== 启动界面控制 ==================== */

/**
 * 这些元素来自 `index.html` 里的**静态标记**，不依赖 Vue。
 * 因此即使 JS 出错，用户看到的也是"正在准备"，而不是一片空白。
 */
function bootTip(text: string): void {
  const el = document.getElementById('boot-tip')
  if (el) el.textContent = text
}

function bootShowError(text: string): void {
  const el = document.getElementById('boot-error')
  if (!el) return
  el.style.display = 'block'
  // 保留首次错误：后续的连锁异常往往只是前一个的后果，信息量更低
  if (!el.textContent) el.textContent = text
  console.error('[bootstrap]', text)
}

/**
 * 兜底：挂载前的任何未捕获异常都显示在启动界面上。
 *
 * ⚠️ 目的是**把白屏换成可读的错误信息** —— 用户看到"启动失败：xxx"
 *    才知道该反馈什么，而白屏什么都说明不了。
 *    挂载成功后不再接管，交给页面自身处理。
 */
function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (e) => {
    if (mounted) return
    bootShowError(`启动时发生错误：${e.message}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    if (mounted) return
    const r = e.reason as unknown
    bootShowError(`启动时发生错误：${r instanceof Error ? r.message : String(r)}`)
  })
}

/* ==================== 启动流程 ==================== */

async function bootstrap(): Promise<void> {
  installGlobalErrorHandlers()

  // ---------- ① 数据源初始化（带启动预算，超时降级） ----------
  bootTip('正在准备你的学习数据…')
  try {
    const raced = await Promise.race([
      initDataSource().then(() => 'ok' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), BOOT_BUDGET_MS)),
    ])
    if (raced === 'timeout') {
      bootTip('数据加载较慢，正在切换为兼容模式…')
      await forceMockDataSource(`数据源初始化超过 ${BOOT_BUDGET_MS / 1000} 秒，已切换为兼容模式`)
    }
  } catch (err) {
    console.error('[bootstrap] 数据源初始化失败', err)
    // 走到这里说明连降级路径都抛错了 —— 再兜一次，仍不行才展示错误
    try {
      await forceMockDataSource(err instanceof Error ? err.message : '数据源初始化异常')
    } catch (fallbackErr) {
      bootTip('应用启动失败')
      bootShowError(
        `数据源无法初始化：${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
      )
      return
    }
  }

  // ---------- ② 挂载（会清空 #app，启动界面随之消失） ----------
  try {
    createApp(App).use(createPinia()).use(router).mount('#app')
    mounted = true
  } catch (err) {
    bootTip('应用启动失败')
    bootShowError(`应用挂载失败：${err instanceof Error ? err.message : String(err)}`)
    return
  }

  // ---------- ③ 后台任务（异步，不阻塞首屏） ----------
  getServices()
    .scheduler.onAppStart()
    .catch((err) => console.warn('[bootstrap] 启动调度失败', err))

  // 会话结束（进入后台）时兜底重算掌握度与快照
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void getServices().scheduler.onSessionEnd()
    }
  })

  // 注册 Service Worker（生产环境由 vite-plugin-pwa 注入）
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[PWA] Service Worker 注册失败', err)
      })
    })
  }
}

bootstrap()
