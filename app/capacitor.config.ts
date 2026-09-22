/**
 * Capacitor 配置 —— 打包为可安装的 Android App
 *
 * ⚠️ 本文件不被 Web 构建引用（Vite 只处理被 import 的模块），因此**未安装
 *    Capacitor 依赖时也不会影响 `npm run build`**。
 *
 * 完整打包步骤：
 *      npm i -D @capacitor/cli
 *      npm i @capacitor/core @capacitor/android
 *      npm run build
 *      npx cap add android
 *      npx cap sync
 *      npx cap open android      # 用 Android Studio 构建 APK
 *
 * 关键点：`server.androidScheme = 'https'` 让 WebView 运行在 https://localhost，
 * 属于**安全上下文** —— 这是 OPFS 可用的前提，也就是说
 * **App 内 SQLite(OPFS) 能正常工作，不会再降级为 Mock**。
 * 同一原因，`crypto.subtle`（备份加密依赖）也只在安全上下文可用。
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ 🔒 包名一旦在广告平台（芒果联盟）注册，将**永久不可修改**        │
 * │    注册前必须确认 `appId` 正确，否则只能放弃该媒体账号重来。      │
 * └─────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ ⏱️ 启动耗时预算（PRD §12：冷启动 ≤2s 优先于广告加载）           │
 * │                                                             │
 * │   原生 SplashScreen  : 1200ms（下方 launchShowDuration）      │
 * │   广告就绪等待上限     : 1500ms（SPLASH_TIMEOUT_MS）           │
 * │                                                             │
 * │   ⚠️ 两者是**串行**关系：原生启动屏消失后，开屏广告才可能覆盖。    │
 * │      最坏情况 1.2s + 1.5s ≈ 2.7s，**超出 2s 目标**。            │
 * │                                                             │
 * │   这是 PRD 明确标注的「唯一技术前置验证项」，必须在**真机**上实测： │
 * │     · 若实测超标 → 优先下调 launchShowDuration（本值是最容易调的）│
 * │     · 或降低 SPLASH_TIMEOUT_MS（宁可少一次曝光，也不让用户觉得慢）│
 * │   详见 PRD §12 开屏性能要求 与 R-15 风险条目。                  │
 * └─────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ ⚠️ 合规红线：广告 SDK 初始化必须在用户同意隐私政策之后           │
 * │    落点已实现：`domain/privacy/consent.ts` 的 hasConsented()，  │
 * │    它是 `AdService.tryShow()` 的**第一道闸门**。                │
 * │    接入真实 SDK 时，`MangoAdapter.init()` 必须由该闸门把关 ——    │
 * │    严禁在 App 启动时无条件初始化（无数 App 因此被下架）。          │
 * └─────────────────────────────────────────────────────────────┘
 */
const config = {
  appId: 'cn.jingshi.ai',
  // ⚠️ 应用显示名。**真正决定桌面图标名称的是
  //    android/app/src/main/res/values/strings.xml 的 app_name**，
  //    两处必须保持一致（cap sync 不会自动同步 strings.xml）。
  appName: '经济师上岸助手',
  webDir: 'dist',

  server: {
    // https://localhost → 安全上下文 → OPFS / sqlite-wasm / Web Crypto 可用
    androidScheme: 'https',
  },

  android: {
    // 生产环境保持关闭（仅调试 http 资源时才需要）
    allowMixedContent: false,
    // WebView 调试：release 包自动关闭，debug 包可用 chrome://inspect
    webContentsDebuggingEnabled: false,
  },

  plugins: {
    SplashScreen: {
      /**
       * 原生启动屏展示时长（毫秒）。
       *
       * ⚠️ 它与 Web 层的开屏广告是**串行**的，共同占用启动耗时预算。
       *    修改此值前先读文件头的「启动耗时预算」说明。
       */
      launchShowDuration: 1200,
      backgroundColor: '#2B5CE6',
      showSpinner: false,
    },
  },
}

export default config
