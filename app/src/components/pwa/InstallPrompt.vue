<script setup lang="ts">
/**
 * PWA 安装引导
 *
 * - Android / Chrome：捕获 beforeinstallprompt，给「立即安装」按钮（原生安装流程）
 * - iOS Safari：系统不支持自动安装，改为给出「分享 → 添加到主屏幕」的手动步骤
 * - 已安装（standalone）或用户明确拒绝后不再打扰
 */
import { onMounted, ref } from 'vue'

const DISMISS_KEY = 'jingshi.install_dismissed'

const visible = ref(false)
const isIOS = ref(false)

/** Chrome 的安装事件（需 preventDefault 后手动触发） */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
let deferred: BeforeInstallPromptEvent | null = null

const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as unknown as { standalone?: boolean }).standalone === true

onMounted(() => {
  if (isInstalled() || localStorage.getItem(DISMISS_KEY)) return

  const ua = navigator.userAgent
  isIOS.value = /iPad|iPhone|iPod/.test(ua)

  if (isIOS.value) {
    // iOS 只有 Safari 支持「添加到主屏幕」，且无自动事件
    if (/Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)) visible.value = true
    return
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    visible.value = true
  })
})

async function install() {
  if (!deferred) {
    close(true)
    return
  }
  await deferred.prompt()
  const { outcome } = await deferred.userChoice
  deferred = null
  if (outcome === 'accepted') close(true)
}

function close(permanent = false) {
  visible.value = false
  if (permanent) localStorage.setItem(DISMISS_KEY, '1')
}
</script>

<template>
  <div v-if="visible" class="install">
    <div class="install__body">
      <div class="install__title">📱 装到桌面，像 App 一样用</div>
      <div v-if="isIOS" class="install__desc">
        点底部「分享」按钮 → 选择「添加到主屏幕」
      </div>
      <div v-else class="install__desc">
        全屏无地址栏 · 支持离线 · 数据存在本机，不上传
      </div>
    </div>

    <div class="install__ops">
      <button v-if="!isIOS" class="btn btn--primary" @click="install">立即安装</button>
      <button class="btn" @click="close(true)">{{ isIOS ? '知道了' : '以后再说' }}</button>
    </div>
  </div>
</template>

<style scoped>
.install {
  position: fixed;
  left: var(--sp-3);
  right: var(--sp-3);
  bottom: calc(var(--tabbar-h) + var(--safe-bottom) + var(--sp-3));
  z-index: 950;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--sp-3);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
}
.install__title {
  font-size: var(--fs-aux);
  font-weight: 600;
  margin-bottom: 4px;
}
.install__desc {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.6;
}
.install__ops {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.btn {
  flex: 1;
  height: 38px;
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-aux);
  font-family: inherit;
}
.btn--primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
</style>
