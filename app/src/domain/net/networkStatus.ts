/**
 * 网络状态检测
 *
 * ══════════════════════════════════════════════════════════════
 *  PRD M9-F11 铁律：**广告加载失败，绝不能让任何一个学习功能受影响。**
 *
 *  本产品的核心使用场景是**地铁通勤、飞机、电梯、老小区弱网** ——
 *  这些恰恰是「每天碎片时间学习」的主战场。而广告 SDK 是**唯一**
 *  依赖网络的非核心组件。
 *
 *  因此我们**主动**检测网络状态，而不是等 SDK 超时：
 *    - 完全离线 → 开屏直接跳过，内容区广告位整体不渲染
 *    - 用户看到的是「App 正常」，而不是「广告加载失败」
 *
 *  ⚠️ 设计原则：**宁可少一次曝光，也不能让用户觉得这 App 有问题。**
 * ══════════════════════════════════════════════════════════════
 */

/**
 * 当前是否有网络。
 *
 * ⚠️ `navigator.onLine` 的语义是「设备是否连上了某个网络」，
 *    而不是「能否访问公网」 —— 连了 WiFi 但路由器没外网时它仍返回 true。
 *    这是**已知局限**，我们接受它，因为：
 *      ① 它便宜（同步、零延迟），适合放在广告决策的关键路径上
 *      ② 误判方向是「以为在线」→ 后续 SDK 请求会失败 → 由超时与熔断兜住
 *      ③ 反向误判（以为离线但实际在线）几乎不会发生
 */
export function isOnline(): boolean {
  try {
    // 无 navigator（如 SSR / 测试环境）时保守认为在线，交由下层超时兜底
    if (typeof navigator === 'undefined') return true
    // onLine 为 undefined 的环境（极老浏览器）同样保守处理
    if (typeof navigator.onLine !== 'boolean') return true
    return navigator.onLine
  } catch {
    return true
  }
}

/** 当前是否离线 */
export function isOffline(): boolean {
  return !isOnline()
}

/**
 * 订阅网络状态变化。
 *
 * @returns 取消订阅函数（务必在组件卸载时调用，避免内存泄漏）
 *
 * 用途：离线时若正在加载广告，应立即放弃（而不是等 1.5 秒超时）。
 */
export function onNetworkChange(handler: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const onOnline = () => handler(true)
  const onOffline = () => handler(false)

  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)

  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }
}
