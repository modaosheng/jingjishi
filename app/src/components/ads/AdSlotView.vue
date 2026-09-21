<script setup lang="ts">
/**
 * 广告位容器（三个广告位共用的唯一渲染入口）
 *
 * ══════════════════════════════════════════════════════════════
 *  这个组件承载全部「广告失败不能让用户感知」的产品约束：
 *
 *   - 未释放 / 已去广告 / 频次超限 → **整个节点不渲染**（v-if）
 *   - 加载中 → 展示骨架，不展示"加载中…"字样
 *   - 加载失败 → **静默移除，绝不出现"加载失败"**
 *   - 完全离线   → 与加载失败同样静默处理
 * ══════════════════════════════════════════════════════════════
 *
 * 组件自身挂在 <AdErrorBoundary> 内，SDK 崩溃不会冒泡出去。
 */
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { getServices } from '@/services'
import { isAdFree, shouldShowAd, type AdSlot } from '@/domain/ads/releaseEngine'
import { canShowByFrequency } from '@/domain/ads/frequencyCap'
import { hasConsented } from '@/domain/privacy/consent'
import { isOffline } from '@/domain/net/networkStatus'

const props = withDefaults(
  defineProps<{
    /** 广告位 */
    slot: AdSlot
    /** 是否为用户主动点击触发（激励视频）—— 决定失败时是否「赠送奖励」 */
    rewarded?: boolean
    /** 展示形态：横幅卡片 / 全屏开屏 */
    variant?: 'card' | 'splash'
  }>(),
  { rewarded: false, variant: 'card' },
)

const emit = defineEmits<{
  /** 广告成功展示 */
  (e: 'shown'): void
  /**
   * 广告失败但应发放奖励（PRD M9-F11「失败即赠送」）
   * 上层据此告知用户「本次奖励直接发放给你」—— 坦荡的处理反而加信任分
   */
  (e: 'grant'): void
  /** 广告被点击 */
  (e: 'click'): void
}>()

type Phase = 'idle' | 'loading' | 'ready' | 'gone'

const phase = ref<Phase>('idle')

/**
 * 是否应当存在这个广告位（未通过此判断则整个节点不渲染）。
 *
 * ⚠️ 这里重复了 AdService 的部分闸门判断，是**刻意的**：
 *    AdService 的返回决定了「最终要不要展示」，而这里决定「要不要先渲染骨架」。
 *    若不做这个前置判断，未同意/离线时会出现「闪一下骨架再消失」的视觉瑕疵 ——
 *    而 PRD M9-F11 明确要求「用户根本不知道这里本该有广告」。
 */
const eligible = computed(() => {
  if (!hasConsented()) return false
  if (isOffline()) return false
  if (isAdFree()) return false
  if (!shouldShowAd(props.slot)) return false
  return canShowByFrequency(props.slot, props.rewarded).allowed
})

let disposed = false

async function mount(): Promise<void> {
  if (!eligible.value) {
    phase.value = 'gone'
    return
  }
  phase.value = 'loading'

  try {
    const svc = getServices().ads
    const result = await svc.tryShow(props.slot, props.rewarded)
    if (disposed) return

    if (result.shown) {
      phase.value = 'ready'
      emit('shown')
      return
    }

    // 失败：如果是用户主动触发的，走「失败即赠送」
    if (result.grantReward) {
      phase.value = 'gone'
      emit('grant')
      return
    }

    // 其他失败一律静默移除 —— 用户不该知道这里"本来有广告"
    phase.value = 'gone'
  } catch {
    // 兜底：即便服务层意外抛错也不影响页面（它本不该抛）
    if (!disposed) phase.value = 'gone'
  }
}

function onClick(): void {
  getServices().ads.noteClick(props.slot)
  emit('click')
}

/** 用户点击主按钮 / 切到后台时放弃加载（PRD M9-F11：用户意图优先于收入） */
function abort(): void {
  getServices().ads.abort(props.slot)
}

function onVisibility(): void {
  if (document.visibilityState === 'hidden') abort()
}

onMounted(() => {
  void mount()
  document.addEventListener('visibilitychange', onVisibility)
})

onUnmounted(() => {
  disposed = true
  document.removeEventListener('visibilitychange', onVisibility)
  abort()
})

defineExpose({ abort })
</script>

<template>
  <!-- ⚠️ 不渲染时整个节点消失，不留任何占位或空白 -->
  <div v-if="phase === 'loading'" class="ad-slot ad-slot--loading" :class="`ad-slot--${variant}`">
    <div class="ad-slot__skeleton" />
  </div>

  <div
    v-else-if="phase === 'ready'"
    class="ad-slot ad-slot--ready"
    :class="`ad-slot--${variant}`"
    @click="onClick"
  >
    <div class="ad-slot__body">
      <span class="ad-slot__tag">广告</span>
      <span class="ad-slot__text">这里是广告位（{{
        slot === 'splash' ? '开屏' : slot === 'result_card' ? '成果卡' : '奖励中心'
      }}）</span>
    </div>
    <span class="ad-slot__hint">Mock 适配器 · 待接入真实 SDK</span>
  </div>
  <!-- phase === 'gone' → 什么都不渲染 -->
</template>

<style scoped>
.ad-slot {
  border-radius: 12px;
  overflow: hidden;
}

/* ---- 骨架态：低调、不闪烁 ---- */
.ad-slot--loading {
  background: var(--c-surface-2, #f2f3f5);
}

.ad-slot--card .ad-slot__skeleton {
  height: 72px;
}

.ad-slot--splash .ad-slot__skeleton {
  height: 100%;
}

.ad-slot__skeleton {
  width: 100%;
  background: linear-gradient(90deg, transparent, rgba(0, 0, 0, 0.04), transparent);
  animation: adSkeleton 1.4s ease-in-out infinite;
}

@keyframes adSkeleton {
  0% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0.5;
  }
}

/* ---- 就绪态 ---- */
.ad-slot--ready {
  background: var(--c-surface-2, #f7f8fa);
  border: 1px solid var(--c-border, #ebedf0);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
}

.ad-slot__body {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ad-slot__tag {
  font-size: 10px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 3px;
  border: 1px solid var(--c-border, #dcdee0);
  color: var(--c-text-3, #969799);
  flex-shrink: 0;
}

.ad-slot__text {
  font-size: 13px;
  color: var(--c-text-2, #646566);
}

.ad-slot__hint {
  font-size: 11px;
  color: var(--c-text-3, #969799);
}

/* ---- 开屏形态 ---- */
.ad-slot--splash {
  position: fixed;
  inset: 0;
  z-index: 3000;
  border: none;
  border-radius: 0;
  background: var(--c-bg, #fff);
  align-items: center;
  justify-content: center;
}
</style>
