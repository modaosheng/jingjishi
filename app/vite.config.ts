import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { VantResolver } from 'unplugin-vue-components/resolvers'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    Components({
      resolvers: [VantResolver()],
      dts: 'src/components.d.ts',
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: '经师 AI · 中级经济师上岸',
        short_name: '经师AI',
        description: '科学计划 + 全真模考 + AI 私教，帮你一次上岸',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#2B5CE6',
        background_color: '#FFFFFF',
        categories: ['education'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        /**
         * ⚠️ `html` 必须包含在内，不能省。
         *
         * 原因：下面的 `navigateFallback: '/index.html'` 在生成的 Service Worker 里
         * 会展开为 `createHandlerBoundToURL("/index.html")` —— 该 API 要求目标 URL
         * **必须存在于预缓存清单中**，否则 Workbox 会抛 `non-precached-url`，
         * 导致整个 Service Worker 安装失败。
         *
         * 曾经这里只写了 `js,css,svg,woff2`，于是 index.html 不在清单里、
         * 而 navigateFallback 又指向它 —— 两者互相冲突。
         *
         * 至于"不预缓存 HTML 才能及时拿到更新"的顾虑：`registerType: 'autoUpdate'`
         * 配合下面的 skipWaiting/clientsClaim 会在下次启动时应用新版本，
         * 不会让用户长期停在旧版。
         */
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // 页面导航：Network First，3 秒超时后回落缓存
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              networkTimeoutSeconds: 3,
              cacheName: 'pages-cache',
              expiration: { maxEntries: 20 },
            },
          },
          {
            // 静态资源：Cache First（文件名带 hash，内容变即失效）
            urlPattern: /\.(?:js|css|woff2|svg)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'assets-cache',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // 只排除确实需要原生加载的包：
  // - @sqlite.org/sqlite-wasm：含 .wasm，必须原样加载
  // - pdfjs-dist：ESM(.mjs)，worker 用 ?url 导入，预打包会破坏 worker 路径
  // 注意：tesseract.js 是 CommonJS，必须让 Vite 预打包转成 ESM，不能 exclude
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm', 'pdfjs-dist'] },
  worker: { format: 'es' },
  server: { host: true, port: 5173 },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
      // Vite 8 起 manualChunks 必须为函数
      manualChunks(id: string) {
        if (!id.includes('node_modules')) return
        if (id.includes('vant')) return 'vant'
        if (id.includes('@sqlite.org')) return 'sqlite'
        if (id.includes('vue') || id.includes('pinia')) return 'vendor'
      },
      },
    },
  },
})
