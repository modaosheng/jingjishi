/**
 * 启动状态（响应式）
 *
 * ══════════════════════════════════════════════════════════════
 *  为什么用响应式而不是定时器轮询：
 *
 *  之前的设计是「先 await 数据源就绪，再挂载 Vue」，并用 `setTimeout`
 *  做超时兜底。这个结构有两个致命弱点：
 *    ① 数据源初始化若卡住，界面就**永远停在启动页**；
 *    ② 兜底完全依赖 `setTimeout` —— 而 Android WebView 在某些情况下
 *       会抑制定时器，定时器不触发，兜底也就形同虚设。
 *
 *  改成「**立即挂载 Vue，用响应式状态驱动界面**」之后：
 *    · 只要 JS 跑起来，界面就一定在（Vue 挂载是同步的）
 *    · 状态变化走 Vue 的响应式系统（微任务），**不依赖定时器**
 *    · 定时器只用于展示耗时秒数，坏了也不影响正确性
 * ══════════════════════════════════════════════════════════════
 */

import { ref } from 'vue'

/**
 * 数据源是否已就绪。
 *
 * ⚠️ 这是整个启动闸门的唯一依据 —— `App.vue` 在它为 false 时
 *    只渲染启动界面，不渲染任何业务页面（避免页面调用尚未就绪的数据源）。
 */
export const dataReady = ref(false)

/** 当前启动阶段（展示用） */
export const bootStage = ref('正在启动…')

/** 启动失败信息（非空时界面会显著提示） */
export const bootError = ref('')

/** 是否已降级为兼容模式（Mock），用于提示用户 */
export const bootDegraded = ref(false)

/** 启动开始时间（用于计算耗时） */
export const bootStartedAt = Date.now()

/** 标记数据源就绪 */
export function markDataReady(): void {
  dataReady.value = true
}

/** 更新启动阶段 */
export function setStage(text: string): void {
  bootStage.value = text
}
