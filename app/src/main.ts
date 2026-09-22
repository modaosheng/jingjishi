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
import { bootDegraded, bootError, dataReady, markDataReady, setStage } from './domain/boot/bootState'

/**
 * 数据源初始化预算：超过这个时间就降级到兼容模式（Mock）。
 *
 * ⚠️ 这个值保证「**应用一定能用起来**」。
 *    SQLite(OPFS) 初始化要加载 WASM + 迁移 + 灌题库，低端机上可能偏慢；
 *    个别 WebView 的 OPFS 实现还会长时间无响应（见 worker 的超时说明）。
 *    超过预算就降级 —— Mock 的学习记录同样写入 localStorage，不会丢。
 */
const BOOT_BUDGET_MS = 8_000

/** Vue 是否已挂载（挂载后错误交给 BootGate 展示） */
let appMounted = false

/* ==================== 启动界面控制 ==================== */

/**
 * 启动界面有**两层**，这是刻意的：
 *
 *   ① `index.html` 里的静态界面（内联样式，不依赖任何 JS）
 *      —— 负责覆盖「JS 还没加载完」那段空白
 *   ② Vue 的 `BootGate` 组件
 *      —— 负责「JS 已启动但数据还没就绪」的阶段，能显示**真实进度**
 *
 * 旧设计只有 ①，且 Vue 要等数据就绪才挂载 —— 于是数据一旦卡住，
 * 用户只能看到一句静止的文案，**无法判断到底卡在哪一步**。
 */
function bootShowError(text: string): void {
  logBoot(`[错误] ${text}`)
  console.error('[bootstrap]', text)

  // 挂载前写静态界面；挂载后由 BootGate 读 bootError 展示
  if (!appMounted) {
    const el = document.getElementById('boot-error')
    if (el) {
      el.style.display = 'block'
      // 保留首次错误：后续连锁异常往往只是前一个的后果，信息量更低
      if (!el.textContent) el.textContent = text
    }
  }
  if (!bootError.value) bootError.value = text
}

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
 * 全局异常兜底 —— 目的是**把白屏换成可读的错误信息**。
 *
 * ⚠️ 判断依据是 `dataReady` 而非「是否已挂载」：
 *    现在 Vue 是立即挂载的，用「已挂载」会在数据初始化阶段就停止接管，
 *    而那恰恰是最需要显示错误的阶段。
 */
function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (e) => {
    if (dataReady.value) return
    bootShowError(`启动时发生错误：${e.message}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    if (dataReady.value) return
    const r = e.reason as unknown
    bootShowError(`启动时发生错误：${r instanceof Error ? r.message : String(r)}`)
  })
}

/* ==================== Service Worker 处理 ==================== */

/**
 * 原生环境（App 内）**必须禁用 Service Worker，并清理已存在的旧 SW 与缓存**。
 *
 * ══════════════════════════════════════════════════════════════
 *  ⚠️ 这段逻辑是必需的，删掉会导致「App 永远停留在旧版本」。
 *
 *  问题链条：
 *    ① SW 的注册代码原本写在 `mount()` **之后**；
 *    ② 一旦某次启动失败（卡在启动页），新的 SW 就**永远不会被注册**；
 *    ③ 而旧 SW 仍然活着，继续用缓存里的**旧 index.html / 旧 JS** 响应请求；
 *    ④ 旧内容照旧起不来 → 继续注册不了新 SW → **死循环**。
 *
 *  结果：无论重新打包多少次、重装多少遍，设备上跑的都是那份旧的坏内容。
 *  浏览器里没有那个旧 SW，所以表现为「Web 正常、App 卡住」。
 *
 *  为什么原生环境根本不需要 SW：Web 资源已经打包在安装包里，
 *  本来就是本地加载，SW 只能额外引入一层可能失效的缓存。
 *  （Web/PWA 部署仍然保留 SW，见 runPostReadyTasks。）
 * ══════════════════════════════════════════════════════════════
 *
 * ⚠️ 本函数**刻意不被 await**：它要访问 `navigator.serviceWorker`，
 *    在异常环境下可能长时间不返回，不能让它拖住启动。
 */
async function neutralizeServiceWorkerIfNative(): Promise<void> {
  const native = isNativePlatform()
  logBoot(`运行环境：${native ? '原生 App' : '浏览器'}`)
  if (!native) return
  if (!('serviceWorker' in navigator)) return

  const LS_FLAG = 'jingshi.sw_neutralized'
  try {
    // 已经清理过就不再重复做
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
    logBoot('已清理旧缓存，重新加载以应用最新版本')
    window.location.reload()
  }
}

/* ==================== 数据源初始化（后台进行） ==================== */

/** 兜底流程是否已启动（防止「定时器」与「看门狗」重复触发） */
let fallbackStarted = false
/** 启动流程是否已收尾 */
let bootFinalized = false

/** 收尾：数据就绪，放行应用界面 */
function finalizeBoot(): void {
  if (bootFinalized) return
  bootFinalized = true
  setStage('正在准备工作区…')
  markDataReady()
  logBoot('数据已就绪，进入应用')
  runPostReadyTasks()
}

/**
 * 降级到兼容模式并放行。
 *
 * ⚠️ 这是**保证应用一定能用起来**的最后一道防线。
 */
async function fallbackToMock(reason: string): Promise<void> {
  if (fallbackStarted) return
  fallbackStarted = true
  setStage('数据加载较慢，正在切换为兼容模式…')
  logBoot(`触发兼容模式：${reason}`)
  try {
    await forceMockDataSource(reason)
    bootDegraded.value = true
  } catch (err) {
    bootShowError(`切换兼容模式失败：${err instanceof Error ? err.message : String(err)}`)
    return
  }
  finalizeBoot()
}

/**
 * 在后台初始化数据源，完成后置 `dataReady`。
 *
 * ⚠️ 本函数**不被 await** —— 调用方挂载完 Vue 就返回了。
 *    这样即使它卡住，用户看到的也是「带进度的启动界面」，而不是静止的启动页，
 *    并且可以用界面上的「改用兼容模式启动」按钮自救。
 */
async function initDataInBackground(): Promise<void> {
  setStage('正在初始化数据存储…')

  /*
    ⚠️ 看门狗：**不依赖 setTimeout 的第二道超时兜底**。

    为什么必需：Android WebView 在特定情况下会**抑制定时器**
    （例如 Activity 尚未完全可见时）。一旦被抑制，下面 Promise.race 的
    超时分支永远不会执行，兜底形同虚设 —— 应用就真的会一直卡在启动页。

    requestAnimationFrame 与渲染管线绑定，抑制条件与定时器不同，
    用它做第二道保险，显著提高「兜底一定能触发」的概率。
  */
  const watchdogStart = Date.now()
  const watchdog = () => {
    if (bootFinalized || fallbackStarted) return
    if (Date.now() - watchdogStart >= BOOT_BUDGET_MS) {
      void fallbackToMock(`启动超过 ${BOOT_BUDGET_MS / 1000} 秒（看门狗触发）`)
      return
    }
    requestAnimationFrame(watchdog)
  }
  requestAnimationFrame(watchdog)

  try {
    const raced = await Promise.race([
      initDataSource().then(() => 'ok' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), BOOT_BUDGET_MS)),
    ])
    if (raced === 'timeout') {
      await fallbackToMock(`数据源初始化超过 ${BOOT_BUDGET_MS / 1000} 秒`)
      return
    }
    logBoot('数据源初始化完成')
  } catch (err) {
    console.error('[bootstrap] 数据源初始化失败', err)
    logBoot(`数据源初始化失败：${err instanceof Error ? err.message : String(err)}`)
    await fallbackToMock(err instanceof Error ? err.message : '数据源初始化异常')
    return
  }

  // 看门狗可能已经接管兜底，此时不要再覆盖
  if (fallbackStarted) return
  finalizeBoot()
}

/** 数据就绪后才执行的后台任务（它们都依赖数据源） */
function runPostReadyTasks(): void {
  getServices()
    .scheduler.onAppStart()
    .catch((err) => console.warn('[bootstrap] 启动调度失败', err))

  // 会话结束（进入后台）时兜底重算掌握度与快照
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void getServices().scheduler.onSessionEnd()
    }
  })

  // ---------- Service Worker 注册（**仅浏览器 / PWA 环境**） ----------
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

/* ==================== 启动流程 ==================== */

function bootstrap(): void {
  // 告知 index.html 里的启动自检脚本：应用代码已成功启动，可以停止兜底提示了。
  // ⚠️ 这行必须放在最前面 —— 它出现即证明整个模块图已成功解析并执行。
  ;(window as unknown as { __appBooted?: boolean }).__appBooted = true

  installGlobalErrorHandlers()
  logBoot('模块已加载，开始启动')

  // ---------- ① 立即挂载 Vue ----------
  // ⚠️ 这是本轮最重要的结构改动：**挂载不再等待任何异步操作**。
  //    旧结构是「先 await 数据源，再挂载」—— 一旦数据源卡住，Vue 根本没挂载，
  //    连一个能显示进度的界面都没有，用户只能看到静止的文案。
  //    现在 Vue 同步挂载，任何异常/进度都一定能显示出来。
  try {
    createApp(App).use(createPinia()).use(router).mount('#app')
    appMounted = true
    logBoot('Vue 已挂载')
  } catch (err) {
    bootShowError(`应用挂载失败：${err instanceof Error ? err.message : String(err)}`)
    return
  }

  // ---------- ② 后台：清理旧 Service Worker（原生环境） ----------
  // 刻意不 await：它可能长时间不返回，不能拖住启动
  void neutralizeServiceWorkerIfNative()

  // ---------- ③ 后台：初始化数据源（驱动 App.vue 的启动闸门） ----------
  void initDataInBackground()
}

bootstrap()
