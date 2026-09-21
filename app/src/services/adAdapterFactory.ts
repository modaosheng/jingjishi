/**
 * 广告适配器工厂（接入真实 SDK 时**只需要改这个文件**）
 *
 * ══════════════════════════════════════════════════════════════
 *  当前状态：Mock
 *  目标状态：芒果联盟（MangoAdapter）
 *
 *  切换步骤（拿到 APPID / AppKey / PlacementId 之后）：
 *    ① Capacitor 与原生工程**已就绪**（无需再做）：
 *         @capacitor/core + @capacitor/android + @capacitor/cli 已安装
 *         android/ 工程已生成，applicationId = cn.jingshi.ai
 *    ② 在 android/app/build.gradle 加入芒果联盟的 maven 仓库与聚合 SDK 依赖
 *       （含**各 ADN 的 Adapter 依赖**，缺一不可）
 *    ③ 确认包名与芒果联盟后台创建应用时一致（当前 cn.jingshi.ai，
 *       ⚠️ 后台创建后**永久不可修改**）
 *    ④ 新建 `mangoAdAdapter.ts` 实现 `AdAdapter` 接口
 *    ⑤ 把下面 `createAdAdapter()` 的返回值从 MockAdAdapter 换成 MangoAdAdapter
 *    ⑥ ⚠️ **合规红线**：`init()` 必须在用户同意隐私政策之后调用。
 *       **该闸门已实现** —— 见 `domain/privacy/consent.ts` 的 `hasConsented()`，
 *       它是 `AdService.tryShow()` 的第一道闸门，未同意时连适配器都不会被调用。
 *       因此 MangoAdapter 只需保证「init 惰性执行」（被 show/preload 触发时才初始化），
 *       不得在构造函数或模块加载时初始化。
 *
 *  ⚠️ 上层业务代码**一行都不用改**。这是适配器层的全部意义。
 * ══════════════════════════════════════════════════════════════
 */

import type { AdAdapter } from '@/infrastructure/ads/adAdapter'
import { MockAdAdapter } from '@/infrastructure/ads/mockAdAdapter'

/** 芒果联盟的媒体参数（拿到后填入，或从环境变量注入） */
export interface MangoCredentials {
  /** 媒体 AppID */
  appId: string
  /** 媒体 AppKey */
  appKey: string
  /** 各广告位的 PlacementId */
  placements: {
    splash: string
    result_card: string
    reward_center: string
  }
}

/**
 * 从构建期环境变量读取芒果联盟参数。
 *
 * ⚠️ 这些值**不是密钥**（AppID/PlacementId 会出现在客户端包里，无法保密），
 *    所以放环境变量只是为了「方便切换测试/正式」，不是为了安全。
 *    真正的安全边界在服务端的签名校验，而本产品**没有服务端** → 无需担心。
 */
export function readMangoCredentials(): MangoCredentials | null {
  const env = import.meta.env as Record<string, string | undefined>
  const appId = env.VITE_MANGO_APP_ID
  const appKey = env.VITE_MANGO_APP_KEY
  const splash = env.VITE_MANGO_SLOT_SPLASH
  const resultCard = env.VITE_MANGO_SLOT_RESULT_CARD
  const rewardCenter = env.VITE_MANGO_SLOT_REWARD_CENTER

  if (!appId || !appKey || !splash || !resultCard || !rewardCenter) return null

  return {
    appId,
    appKey,
    placements: { splash, result_card: resultCard, reward_center: rewardCenter },
  }
}

/**
 * 创建广告适配器。
 *
 * 决策顺序：
 *   ① 有完整芒果联盟参数 + 处于原生环境 → MangoAdapter（尚未实现）
 *   ② 其他情况 → MockAdAdapter（浏览器开发期）
 */
export function createAdAdapter(): AdAdapter {
  // 注意：这里刻意**不 try/catch 芒果联盟的 import**。
  // 因为 MangoAdapter 尚未编写，任何动态 import 都会在打包时产生悬空引用。
  // 等真正拿到 ID、装上 Capacitor 之后，把下面那个 if 分支补上即可。
  //
  // const creds = readMangoCredentials()
  // if (creds && isNativePlatform()) return new MangoAdAdapter(creds)

  void readMangoCredentials // 保留函数引用，避免 lint 报「未使用」

  return new MockAdAdapter()
}
