<template>
  <router-view />
  <!-- PWA 安装引导（Android 原生安装流 / iOS 手动步骤） -->
  <InstallPrompt />
  <!-- 新版本就绪提示 -->
  <UpdatePrompt />

  <!--
    广告层（全局，位于路由之上）
    ⚠️ 三个组件都**不影响 App 挂载**：
       - SplashAd 只是可选遮罩，1.5 秒内没就绪就自己消失
       - AdNoticeDialog 是首次启动的一次性告知
       - AdErrorBoundary 保证广告子树崩溃不冒泡
  -->
  <AdErrorBoundary>
    <SplashAd v-if="showSplash" />
  </AdErrorBoundary>
  <AdNoticeDialog />
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import InstallPrompt from '@/components/pwa/InstallPrompt.vue'
import UpdatePrompt from '@/components/pwa/UpdatePrompt.vue'
import SplashAd from '@/components/ads/SplashAd.vue'
import AdNoticeDialog from '@/components/ads/AdNoticeDialog.vue'
import AdErrorBoundary from '@/components/ads/AdErrorBoundary.vue'

/**
 * 开屏仅在**冷启动**时尝试一次。
 *
 * ⚠️ PRD M9-F3 位置⓪ 硬约束 9：「每次冷启动展示；热启动（从后台切回）不展示」。
 *    这个 ref 只在 App 首次挂载时为 true —— 后台恢复前台不会重新挂载 App，
 *    因此天然满足「热启动不展示」。
 */
const showSplash = ref(true)

/**
 * 冷启动判定：sessionStorage 在标签页/进程存活期间保留，
 * 而 Capacitor 的 WebView 在 App 被杀掉后重建 → sessionStorage 为空。
 * 这样「冷启动」与「热启动」能被正确区分。
 */
function isColdStart(): boolean {
  try {
    const KEY = 'jingshi.session_started'
    if (sessionStorage.getItem(KEY) === '1') return false
    sessionStorage.setItem(KEY, '1')
    return true
  } catch {
    return true
  }
}

onMounted(() => {
  // 请求持久化存储：避免系统在存储紧张时清空本地数据
  // （Android Chrome 有效，iOS 为 no-op；即使失败也不影响使用）
  navigator.storage?.persist?.().catch(() => {})

  // 热启动 → 不展示开屏（M9-F3 约束 9）
  if (!isColdStart()) showSplash.value = false
})
</script>
