/**
 * 启动日志
 *
 * ══════════════════════════════════════════════════════════════
 *  为什么需要它：**真机上的启动问题只发生在那台设备上。**
 *
 *  控制台日志在手机上拿不到（release 包默认关闭 WebView 调试），
 *  而"启动页卡住"这类问题恰恰只在特定机型复现。如果每次都要
 *  重新打包 + 加调试代码才能定位，排查成本极高。
 *
 *  所以把启动各阶段写进 localStorage —— 应用起来之后，
 *  可以在「我的 → 存储信息」里回看整个过程，直接看到卡在哪一步。
 * ══════════════════════════════════════════════════════════════
 */

const LS_BOOT_LOG = 'jingshi.boot_log'

/** 最多保留的条目数（避免无限增长） */
const MAX_ENTRIES = 40

export interface BootLogEntry {
  /** 时间戳 */
  t: number
  /** 阶段描述 */
  m: string
}

/**
 * 追加一条启动日志。
 *
 * ⚠️ 本函数**绝不允许抛错** —— 它服务于排障，本身不能成为故障源。
 *
 * 另外两条健壮性要求（都来自真实踩坑）：
 *   ① 遇到损坏的旧内容要**丢弃重建**，而不是放弃写入 ——
 *      否则一旦日志文件被写坏，排障功能会**永久静默失效**，
 *      而这恰恰是最需要它的时候。
 *   ② 存储本身不可用（被禁用 / 配额满）时只能放弃记录，
 *      但绝不能影响启动流程。
 */
export function logBoot(message: string): void {
  try {
    const raw = localStorage.getItem(LS_BOOT_LOG)
    let list: BootLogEntry[] = []

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) list = parsed as BootLogEntry[]
        // 解析失败或不是数组 → 保持空数组，下面会重建
      } catch {
        /* 旧内容已损坏：丢弃并使用空数组重建，保证后续日志仍能记录 */
      }
    }

    list.push({ t: Date.now(), m: message })
    while (list.length > MAX_ENTRIES) list.shift()
    localStorage.setItem(LS_BOOT_LOG, JSON.stringify(list))
  } catch {
    /* 存储不可用 → 放弃记录，但绝不影响启动 */
  }
}

/** 读取启动日志（供「存储信息」页展示） */
export function readBootLog(): BootLogEntry[] {
  try {
    const raw = localStorage.getItem(LS_BOOT_LOG)
    if (!raw) return []
    const list = JSON.parse(raw) as BootLogEntry[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** 清空启动日志（供用户手动清理） */
export function clearBootLog(): void {
  try {
    localStorage.removeItem(LS_BOOT_LOG)
  } catch {
    /* noop */
  }
}

/** 把时间戳格式化为 HH:MM:SS（展示用） */
export function formatBootTime(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
