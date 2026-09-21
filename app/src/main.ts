import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'vant/lib/index.css'
import './styles/tokens.css'
import './styles/global.css'
import App from './App.vue'
import router from './router'
import { initDataSource } from './infrastructure'
import { getServices } from './services'

async function bootstrap() {
  // 数据源初始化失败也要保证应用可用（内部已做降级）
  try {
    await initDataSource()
  } catch (err) {
    console.error('[bootstrap] 数据源初始化失败', err)
  }

  createApp(App).use(createPinia()).use(router).mount('#app')

  // 后台任务：生成今日任务包 + 自动快照（异步，不阻塞首屏）
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
