<script setup lang="ts">
/**
 * 启动闸门（应用内）
 *
 * ══════════════════════════════════════════════════════════════
 *  它替代了「index.html 里的静态启动界面」，区别是：
 *    · 静态界面**完全不知道**后台在做什么，只能显示一句固定文案；
 *    · 本组件由**响应式状态**驱动 —— 只要 JS 活着，界面就一定会更新。
 *
 *  这在真机排障上是决定性的：以前「卡住」只能看到一句静止的文案，
 *  现在能看到**具体停在哪一步、已经等了多久、上一步做了什么**。
 * ══════════════════════════════════════════════════════════════
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  bootDegraded,
  bootError,
  bootStage,
  bootStartedAt,
  markDataReady,
  setStage,
} from '@/domain/boot/bootState'
import { formatBootTime, readBootLog, type BootLogEntry } from '@/domain/boot/bootLog'
import { forceMockDataSource } from '@/infrastructure'

const elapsed = ref(0)
const log = ref<BootLogEntry[]>([])
const escaping = ref(false)

let timer: ReturnType<typeof setInterval> | undefined
let rafId: number | undefined

/**
 * 超过这个秒数才展示诊断信息与逃生按钮。
 * 正常启动 1-3 秒就完成了，用户不会看到它们。
 */
const DIAG_AFTER_SEC = 4

const showDiag = computed(() => elapsed.value >= DIAG_AFTER_SEC || !!bootError.value)

/** 刷新已耗时 —— 只在秒数变化时写 ref，避免每帧触发渲染 */
let lastSec = -1
function tick(): void {
  const sec = Math.floor((Date.now() - bootStartedAt) / 1000)
  if (sec === lastSec) return
  lastSec = sec
  elapsed.value = sec
  // 超时后持续刷新日志，便于看到最新一步停在哪
  if (sec >= DIAG_AFTER_SEC) log.value = readBootLog()
}

onMounted(() => {
  log.value = readBootLog()
  tick()

  /*
    ⚠️ 同时用 setInterval 与 requestAnimationFrame 驱动计时，这是刻意的。

    Android WebView 在特定情况下会**抑制定时器**（例如 Activity 尚未完全可见时）。
    如果只依赖 setInterval，被抑制时秒数会静止不动，用户会以为整机卡死。
    rAF 与渲染管线绑定，两者的抑制条件不完全重合 —— 双保险能显著提高
    「至少有一种在跑」的概率。

    计时只用于展示；即使两者都失效，界面正确性也不受影响
    （Vue 的响应式更新走微任务，不需要定时器）。
  */
  timer = setInterval(tick, 500)
  const loop = () => {
    tick()
    rafId = requestAnimationFrame(loop)
  }
  rafId = requestAnimationFrame(loop)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (rafId !== undefined) cancelAnimationFrame(rafId)
})

/**
 * 逃生出口：改用兼容模式立即启动。
 *
 * ⚠️ 这是给「卡住但主线程还活着」的情况准备的。
 *    如果主线程被同步阻塞，这个按钮也点不动 —— 那种情况只能靠
 *    移除阻塞源来解决，按钮至少不会让情况更糟。
 */
async function escapeToCompat(): Promise<void> {
  if (escaping.value) return
  escaping.value = true
  setStage('正在改用兼容模式…')
  try {
    await forceMockDataSource('用户手动切换到兼容模式')
    markDataReady()
  } catch (err) {
    bootError.value = `切换兼容模式失败：${err instanceof Error ? err.message : String(err)}`
    escaping.value = false
  }
}
</script>

<template>
  <div class="gate">
    <div class="gate__logo">经济师上岸助手</div>
    <div class="gate__spinner" />

    <div class="gate__stage">{{ bootStage }}</div>
    <div v-if="elapsed >= 1" class="gate__elapsed">已等待 {{ elapsed }} 秒</div>

    <div v-if="bootDegraded" class="gate__degraded">
      已切换为兼容模式。学习记录仍会保存在本机，但查询能力有所下降。
    </div>

    <div v-if="bootError" class="gate__error">{{ bootError }}</div>

    <!-- 诊断区：只在耗时异常时出现，正常启动用户看不到 -->
    <div v-if="showDiag" class="gate__diag">
      <div class="gate__diag-title">启动步骤</div>
      <div v-for="(e, i) in log" :key="i" class="gate__diag-row">
        <span class="gate__diag-t">{{ formatBootTime(e.t) }}</span>
        <span class="gate__diag-m">{{ e.m }}</span>
      </div>

      <button class="gate__escape" :disabled="escaping" @click="escapeToCompat">
        {{ escaping ? '正在切换…' : '一直卡住？改用兼容模式启动' }}
      </button>
      <div class="gate__hint">
        兼容模式：跳过本地数据库，直接用内存数据。功能都能用，学习记录也会保存。
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
  样式刻意与 index.html 里的静态启动界面保持一致 ——
  这样从「静态界面」切换到「应用内闸门」时用户察觉不到跳变。
*/
.gate {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1a1a1a);
  padding: var(--safe-top, 0) 24px calc(var(--safe-bottom, 0) + 24px);
  box-sizing: border-box;
  overflow-y: auto;
}

.gate__logo {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #2b5ce6;
}

.gate__spinner {
  width: 26px;
  height: 26px;
  border: 2.5px solid var(--border-color, #e8ecf5);
  border-top-color: #2b5ce6;
  border-radius: 50%;
  animation: gate-spin 0.8s linear infinite;
}

@keyframes gate-spin {
  to {
    transform: rotate(360deg);
  }
}

.gate__stage {
  font-size: var(--fs-body, 15px);
  color: var(--text-primary, #1a1a1a);
  text-align: center;
}

.gate__elapsed {
  font-size: var(--fs-caption, 12px);
  color: var(--text-secondary, #969799);
  font-variant-numeric: tabular-nums;
}

.gate__degraded,
.gate__error {
  max-width: 320px;
  font-size: var(--fs-caption, 12px);
  line-height: 1.6;
  text-align: center;
}

.gate__degraded {
  color: #b8860b;
}

.gate__error {
  color: #c8342b;
  word-break: break-all;
}

.gate__diag {
  width: 100%;
  max-width: 360px;
  margin-top: 8px;
  padding: 12px;
  background: var(--bg-tertiary, #f5f6f8);
  border-radius: 8px;
}

.gate__diag-title {
  font-size: var(--fs-caption, 12px);
  color: var(--text-secondary, #969799);
  margin-bottom: 6px;
}

.gate__diag-row {
  display: flex;
  gap: 8px;
  font-size: var(--fs-caption, 12px);
  line-height: 1.7;
  color: var(--text-secondary, #969799);
}

.gate__diag-t {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.gate__diag-m {
  word-break: break-all;
}

.gate__escape {
  width: 100%;
  margin-top: 12px;
  padding: 10px;
  background: #2b5ce6;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: var(--fs-aux, 14px);
}

.gate__escape:disabled {
  opacity: 0.6;
}

.gate__hint {
  margin-top: 8px;
  font-size: var(--fs-caption, 12px);
  line-height: 1.6;
  color: var(--text-secondary, #969799);
}
</style>
