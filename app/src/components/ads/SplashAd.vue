<script setup lang="ts">
/**
 * 开屏广告（PRD M9-F3 位置⓪）
 *
 * ══════════════════════════════════════════════════════════════
 *  这是全产品**唯一**的被动展示广告位，受 M9-F3 位置⓪ 的 10 条硬约束管。
 *  其中与本组件直接相关的关键约束：
 *
 *   ① 仅**冷启动**展示（热启动 / 后台恢复前台一律不展示）
 *   ② 超时标准 **1.5 秒**（比其他位置 5 秒更严）
 *   ③ **绝不阻塞首屏** —— App 初始化与广告请求完全并行
 *   ④ 可跳过，且跳过按钮必须**始终可见**
 *   ⑤ 加载失败 / 离线 → 直接跳过，**用户不知道这里本该有广告**
 *   ⑥ 不参与首屏关键渲染路径
 * ══════════════════════════════════════════════════════════════
 *
 * 设计要点：本组件**不影响 App 的挂载**。
 *   它只是盖在上层的一个可选遮罩，1.5 秒内没就绪就自己消失，
 *   用户的 App 体验完全不受它存在的影响。
 */
import { ref, onMounted, onUnmounted } from 'vue'
import AdSlotView from '@/components/ads/AdSlotView.vue'
import { SPLASH_TIMEOUT_MS } from '@/services/ads'

const visible = ref(false)
const canSkip = ref(false)

const slotRef = ref<InstanceType<typeof AdSlotView> | null>(null)
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null
let skipEnableTimer: ReturnType<typeof setTimeout> | null = null
let hardTimeoutTimer: ReturnType<typeof setTimeout> | null = null
let disposed = false

/** 跳过按钮延迟出现：避免"一进来就点掉"，但必须始终可达 */
const SKIP_ENABLE_DELAY = 600
/** 展示成功后最多停留时长（PRD 要求开屏可跳过且不超时太久） */
const MAX_VISIBLE_MS = 3000

function close(): void {
  visible.value = false
  clearTimers()
}

function clearTimers(): void {
  if (autoCloseTimer) clearTimeout(autoCloseTimer)
  if (skipEnableTimer) clearTimeout(skipEnableTimer)
  if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer)
  autoCloseTimer = skipEnableTimer = hardTimeoutTimer = null
}

function onShown(): void {
  if (disposed) return
  visible.value = true
  // 展示成功后自动倒计时关闭 + 启用跳过
  skipEnableTimer = setTimeout(() => {
    canSkip.value = true
  }, SKIP_ENABLE_DELAY)
  autoCloseTimer = setTimeout(close, MAX_VISIBLE_MS)
}

function onGrant(): void {
  // 开屏是被动展示，不该走「失败即赠送」；此处仅防御性关闭
  close()
}

function skip(): void {
  close()
}

onMounted(() => {
  // ⚠️ 硬超时：无论 AdSlotView 内部走到哪一步，1.5 秒后必须收场。
  //    这是「宁可少一次曝光，也不能让用户觉得启动慢」的技术保证。
  hardTimeoutTimer = setTimeout(() => {
    if (!visible.value) {
      slotRef.value?.abort()
    }
    close()
  }, SPLASH_TIMEOUT_MS)
})

onUnmounted(() => {
  disposed = true
  slotRef.value?.abort()
  clearTimers()
})
</script>

<template>
  <Teleport to="body">
    <!-- 只有真正就绪才可见；其余所有情况（失败/超时/未释放/已去广告）都不可见 -->
    <Transition name="splashFade">
      <div v-if="visible" class="splash" @click.self="close">
        <AdSlotView
          ref="slotRef"
          slot="splash"
          variant="splash"
          @shown="onShown"
          @grant="onGrant"
        />
        <button v-if="canSkip" class="splash__skip" @click.stop="skip">跳过</button>
      </div>
    </Transition>

    <!-- 请求发起者：本身不渲染任何东西，只负责触发一次尝试 -->
    <AdSlotView v-show="false" slot="splash" @shown="onShown" @grant="onGrant" />
  </Teleport>
</template>

<style scoped>
.splash {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: #fff;
}

.splash__skip {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 16px);
  right: 16px;
  z-index: 3010;
  padding: 6px 14px;
  border: none;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
}

.splashFade-enter-active,
.splashFade-leave-active {
  transition: opacity 0.2s ease;
}

.splashFade-enter-from,
.splashFade-leave-to {
  opacity: 0;
}
</style>
