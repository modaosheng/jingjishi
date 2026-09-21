<script setup lang="ts">
/**
 * PWA 版本更新提示
 *
 * registerType 为 autoUpdate：Service Worker 会自动更新，
 * 但**已打开的页面仍运行旧代码**，需刷新才生效——这里负责告知并引导刷新，
 * 避免用户长期停留在旧版本。
 */
import { useRegisterSW } from 'virtual:pwa-register/vue'

const { needRefresh, updateServiceWorker } = useRegisterSW()
</script>

<template>
  <div v-if="needRefresh" class="update">
    <span class="update__text">新版本已就绪</span>
    <button class="update__btn" @click="updateServiceWorker(true)">立即更新</button>
  </div>
</template>

<style scoped>
.update {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  top: calc(var(--safe-top) + var(--sp-3));
  z-index: 960;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  background: var(--text-primary);
  color: var(--bg-primary);
  border-radius: 20px;
  padding: 8px 8px 8px 16px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
  font-size: var(--fs-caption);
  white-space: nowrap;
}
.update__btn {
  border: none;
  background: var(--color-primary);
  color: #fff;
  border-radius: 14px;
  padding: 5px 12px;
  font-size: var(--fs-caption);
  font-family: inherit;
}
</style>
