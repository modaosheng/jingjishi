import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'vant/lib/index.css'
import './styles/tokens.css'
import './styles/global.css'
import App from './App.vue'
import router from './router'
import { initDataSource, forceMockDataSource } from './infrastructure'
import { getServices } from './services'
import { logBoot } from './domain/boot/bootLog'

/**
 * 启动预算：数据源初始化最多等这么久。
 *
 * ⚠️ 这个值存在的意义是「**保证应用一定能起来**」。
 *    SQLite(OPFS) 初始化要加载 WASM + 迁移 + 灌题库，低端机上可能偏慢，
 *    个别 WebView 的 OPFS 实现还可能长时间无响应（见 worker 的超时说明）。
 *    超过预算就降级到 Mock（数据仍会写入 localStorage，不会丢），
 *    而不是让用户无限等待。
 */
const BOOT_BUDGET_MS = 8_000

/** 应用是否已成功挂载（挂载前的异常才需要显示到启动界面上） */
let mounted = false

/* ==================== 启动界面控制 ==================== */

/**
 * 启动界面元素来自 `index.html` 里的**静态标记**，不依赖 Vue。
 * 因此即使 JS 出错，用户看到的也是有内容的界面，而不是一片空白。
 */
const bootStartedAt = Date.now()
let bootStage = '正在启动…'

/** 把「当前阶段 + 已耗时」渲染到启动界面 */
function renderBootTip(): void {
  const el = document.getElementById('boot-tip')
  if (!el) return
  const sec = Math.floor((Date.now() - bootStartedAt) / 1000)
  // 加上秒数：一是让用户知道没死机，二是**秒数不动就说明主线程被卡住了**
  el.textContent = sec >= 1 ? `${bootStage}（${sec} 秒）` : bootStage
}

/** 切换启动阶段（同时记入启动日志，便于事后回看） */
function setBootStage(text: string): void {
  bootStage = text
  logBoot(text)
  renderBootTip()
}

function bootShowError(text: string): void {
  const el = document.getElementById('boot-error')
  if (!el) return
  el.style.display = 'block'
  // 保留首次错误：后续的连锁异常往往只是前一个的后果，信息量更低
  if (!el.textContent) el.textContent = text
  logBoot(`[错误] ${text}`)
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

/* ==================== Service Worker 处理 ==================== */

/** 是否运行在 Capacitor 原生环境（App 内） */
function isNativePlatform(): boolean {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform()
  } catch {
    return false
  }
}

/**
 * 原生环境（App 内）**必须禁用 Service Worker，并清理已存在的旧 SW 与缓存**。
 *
 * ══════════════════════════════════════════════════════════════
 *  ⚠️ 这段逻辑是必需的，删掉会导致「App 永久停留在旧版本」。
 *
 *  问题链条：
 *    ① SW 的注册代码原本写在 `mount()` **之后**；
 *    ② 一旦某次启动失败（卡在启动页），新的 SW 就**永远不会被注册**；
 *    ③ 而旧 SW 仍然活着，继续用缓存里的**旧 index.html / 旧 JS** 响应请求；
 *    ④ 旧内容照旧起不来 → 继续注册不了新 SW → **死循环**。
 *
 *  结果：无论重新打包多少次、重装多少遍，设备上跑的都是那份旧的坏内容。
 *  而浏览器里打开正常（没有那个旧 SW），于是表现为「Web 正常、App 卡住」。
 *
 *  为什么原生环境根本不需要 SW：Web 资源已经打包在安装包里，
 *  本来就是本地加载，SW 只能额外引入一层可能失效的缓存。
 *  （Web/PWA 部署仍然保留 SW，见下方注册逻辑。）
 * ══════════════════════════════════════════════════════════════
 */
async function neutralizeServiceWorkerIfNative(): Promise<void> {
  const native = isNativePlatform()
  logBoot(`运行环境：${native ? '原生 App' : '浏览器'}`)
  if (!native) return
  if (!('serviceWorker' in navigator)) return

  const LS_FLAG = 'jingshi.sw_neutralized'
  try {
    // 已经清理过就不再重复做（清理本身有成本）
    if (localStorage.getItem(LS_FLAG) === '1') return
  } catch {
    /* 读不到标记就执行一次清理，代价很小 */
  }

  let cleaned = false

  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    for (const r of regs) {
      await r.unregister()
      cleaned = true
    }
    if (regs.length) logBoot(`已注销 ${regs.length} 个旧 Service Worker`)
  } catch (err) {
    logBoot(`注销 Service Worker 失败：${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys()
      for (const n of names) await caches.delete(n)
      if (names.length) {
        logBoot(`已清理 ${names.length} 个缓存`)
        cleaned = true
      }
    }
  } catch (err) {
    logBoot(`清理缓存失败：${err instanceof Error ? err.message : String(err)}`)
  }

  // ⚠️ 先落标记再刷新，避免刷新后又发现旧 SW 而造成无限刷新
  try {
    localStorage.setItem(LS_FLAG, '1')
  } catch {
    /* noop */
  }

  if (cleaned) {
    // 本次页面正是由旧缓存加载的，清理后必须重新加载一次才能拿到新内容
    logBoot('已清理旧缓存，重新加载以应用最新版本')
    window.location.reload()
  }
}

/* ==================== 启动流程 ==================== */

async function bootstrap(): Promise<void> {
  // 告知 index.html 里的启动自检脚本：应用代码已成功启动，可以停止兜底提示了。
  // ⚠️ 这行必须放在最前面 —— 它出现即证明整个模块图已成功解析并执行。
  ;(window as unknown as { __appBooted?: boolean }).__appBooted = true

  installGlobalErrorHandlers()

  // 心跳：每 500ms 刷新一次「已耗时」。
  // 只要这个秒数在走，就证明主线程是活的 —— 这是区分
  // 「卡在等异步」与「主线程被同步阻塞」的关键证据。
  window.setInterval(renderBootTip, 500)

  logBoot('模块已加载，开始初始化')

  // ---------- ⓪ 原生环境先清理旧 Service Worker（必须在加载任何资源之前） ----------
  setBootStage('正在检查运行环境…')
  await neutralizeServiceWorkerIfNative()

  setBootStage('正在初始化数据存储…')

  // ---------- ① 数据源初始化（带启动预算，超时降级） ----------
  try {
    const raced = await Promise.race([
      initDataSource().then(() => 'ok' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), BOOT_BUDGET_MS)),
    ])
    if (raced === 'timeout') {
      setBootStage('数据加载较慢，正在切换为兼容模式…')
      await forceMockDataSource(`数据源初始化超过 ${BOOT_BUDGET_MS / 1000} 秒，已切换为兼容模式`)
      logBoot('已降级为兼容模式（Mock）')
    } else {
      logBoot('数据源初始化完成')
    }
  } catch (err) {
    console.error('[bootstrap] 数据源初始化失败', err)
    logBoot(`数据源初始化失败：${err instanceof Error ? err.message : String(err)}`)
    // 走到这里说明连降级路径都抛错了 —— 再兜一次，仍不行才展示错误
    try {
      setBootStage('正在切换为兼容模式…')
      await forceMockDataSource(err instanceof Error ? err.message : '数据源初始化异常')
    } catch (fallbackErr) {
      setBootStage('应用启动失败')
      bootShowError(
        `数据源无法初始化：${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
      )
      return
    }
  }

  // ---------- ② 挂载（会清空 #app，启动界面随之消失） ----------
  setBootStage('正在准备工作区…')
  try {
    createApp(App).use(createPinia()).use(router).mount('#app')
    mounted = true
    logBoot('应用已挂载')
  } catch (err) {
    setBootStage('应用启动失败')
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

  // ---------- ④ Service Worker 注册（**仅浏览器 / PWA 环境**） ----------
  // ⚠️ 原生环境刻意不注册：资源已在安装包内，SW 只会引入一层可能失效的缓存，
  //    并可能造成「旧内容永远换不掉」的死循环（详见 neutralizeServiceWorkerIfNative）。
  if (!isNativePlatform() && 'serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[PWA] Service Worker 注册失败', err)
      })
    })
  }
}

bootstrap()
