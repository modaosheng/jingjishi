<script setup lang="ts">
/**
 * 错误边界（PRD M9-F11 兜底机制 1：广告 SDK 崩溃隔离）
 *
 * 背景：广告 SDK 崩溃是**最常见的事故来源**。原生桥接异常、
 *      渲染崩溃、内存问题都可能让整个 WebView 白屏。
 *
 * 本组件把广告子树关进独立错误边界：
 *   - 子树抛错 → 只移除子树，**父页面毫发无伤**
 *   - 崩溃后可选上报（埋点），但绝不冒泡
 *
 * ⚠️ Vue 的 onErrorCaptured 只能捕获**子组件生命周期内的同步错误**，
 *    异步 Promise 异常由 `withAdErrorBoundary()` 在服务层兜住。
 *    两道防线叠加，才能保证"广告的任何异常都不影响学习功能"。
 */
import { ref, onErrorCaptured } from 'vue'

const crashed = ref(false)

onErrorCaptured((err, _instance, info) => {
  // 记录但不冒泡：返回 false 阻止继续向上传播
  if (import.meta.env.DEV) {
    console.warn('[AdErrorBoundary] 广告子树异常已隔离：', err, info)
  }
  crashed.value = true
  return false
})
</script>

<template>
  <!-- 崩溃后整棵子树消失，不留任何痕迹 -->
  <slot v-if="!crashed" />
</template>
