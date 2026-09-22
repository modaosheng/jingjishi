/// <reference lib="webworker" />
/**
 * SQLite Worker
 *
 * 关键点：
 * 1. 使用 @sqlite.org/sqlite-wasm 官方包（npm 上的 `sqlite-wasm` 是无关废弃包）
 * 2. **VFS 选择（按优先级降级）**：
 *    ① opfs-sahpool —— 持久化，且**不需要 COOP/COEP 响应头**（默认走这条）
 *    ② opfs        —— 持久化，但需要 COOP/COEP（SharedArrayBuffer），未配置时会不可用
 *    注意：`sqlite3.oo1.OpfsDb` 属于 ②，在没配 COOP/COEP 的项目里是 undefined，
 *          直接 new 会报 "is not a constructor"，因此必须优先用 ①。
 * 3. OPFS 同步访问句柄只能在 Dedicated Worker 中使用，因此 SQLite 必须跑在这里
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

type Req =
  | { id: number; type: 'init'; schema: string }
  | { id: number; type: 'exec'; sql: string; params?: unknown[] }
  | { id: number; type: 'run'; sql: string; params?: unknown[] }
  | { id: number; type: 'batch'; statements: Array<{ sql: string; params?: unknown[] }> }

type Res =
  | { id: number; ok: true; rows?: unknown[]; changes?: number; note?: string }
  | { id: number; ok: false; error: string }

interface Db {
  exec: (opts: unknown) => void
  close: () => void
}

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>

const DB_FILE = '/jingshi.db'

/**
 * OPFS SAH Pool 安装超时（毫秒）。
 *
 * ⚠️ 这个超时**不是可选的**，缺了它整个初始化会永远卡住。
 *
 * 原因：`installOpfsSAHPoolVfs()` 在部分 Android WebView 上会
 * **既不 resolve 也不 reject** —— 它内部在等同步访问句柄，
 * 拿不到时就静默挂住。因为没有抛错，try/catch 完全救不了，
 * 后面那条 `oo1.OpfsDb` 降级路径也永远轮不到执行。
 *
 * 表现出来就是「App 永远停在启动页」——而且因为主线程在等 worker 回消息，
 * 连超时兜底都要等满 15 秒才触发（见 client.ts 的请求超时）。
 *
 * 加上超时后，挂住会变成 4 秒内快速失败 → 干净地降级到 Mock，
 * 用户至少能用上 App。
 */
const VFS_INSTALL_TIMEOUT_MS = 4000

/**
 * SQLite WASM 模块加载超时（毫秒）。
 *
 * ⚠️ 同样必需：`sqlite3InitModule()` 要取回并编译 .wasm，
 *    在部分 WebView 上可能长时间不返回（静默挂住，不抛错）。
 *    没有超时的话 worker 永远不回消息，主线程只能干等。
 */
const WASM_INIT_TIMEOUT_MS = 8000

/** 给可能挂住的 Promise 加超时（超时后 reject，让上层能走降级分支） */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms 内未响应）`)), ms)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  }) as Promise<T>
}

let db: Db | null = null

/** 实际生效的存储后端，供上层展示与排障 */
let activeVfs = ''

/**
 * 打开数据库：按优先级尝试两种 OPFS VFS，都不可用则抛错（上层会降级到 Mock）
 */
async function openDatabase(sqlite3: Sqlite3): Promise<Db> {
  const failures: string[] = []

  // ① opfs-sahpool：不需要 COOP/COEP，部署友好（首选）
  if (typeof sqlite3.installOpfsSAHPoolVfs === 'function') {
    try {
      const pool = await withTimeout(
        sqlite3.installOpfsSAHPoolVfs({
          name: 'opfs-sahpool',
          directory: '/jingshi-db',
          // 容量需 ≥ 数据库文件数的两倍（含 journal），单个库 6 足够
          initialCapacity: 6,
        }),
        VFS_INSTALL_TIMEOUT_MS,
        'opfs-sahpool 安装',
      )
      activeVfs = 'opfs-sahpool'
      return new pool.OpfsSAHPoolDb(DB_FILE) as unknown as Db
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failures.push(`opfs-sahpool: ${msg}`)
      console.warn('[SQLite] opfs-sahpool 不可用，尝试下一种：', msg)
    }
  } else {
    failures.push('opfs-sahpool: 当前 sqlite-wasm 版本未提供该 VFS')
  }

  // ② opfs：需要 COOP/COEP（Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy）
  if (sqlite3.oo1?.OpfsDb) {
    try {
      const instance = new sqlite3.oo1.OpfsDb(DB_FILE) as unknown as Db
      activeVfs = 'opfs'
      return instance
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failures.push(`opfs: ${msg}`)
      console.warn('[SQLite] opfs VFS 不可用：', msg)
    }
  } else {
    failures.push('opfs: 需要 COOP/COEP 响应头（SharedArrayBuffer），当前环境未提供')
  }

  // 把每种 VFS 的失败原因一起抛出，便于定位到底卡在哪一种
  throw new Error(`无可用的持久化存储后端 → ${failures.join(' | ')}`)
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id } = e.data
  try {
    if (e.data.type === 'init') {
      // ⚠️ WASM 模块加载同样要加超时。
      //    `sqlite3InitModule()` 内部要取回 .wasm 并编译，在部分 WebView 上
      //    可能长时间不返回 —— 和下面的 VFS 一样，属于「静默挂住」而非报错。
      //    没有超时的话，worker 永远不回消息，主线程只能干等到自己的请求超时。
      const sqlite3 = await withTimeout(sqlite3InitModule(), WASM_INIT_TIMEOUT_MS, 'SQLite WASM 加载')
      db = await openDatabase(sqlite3)
      db.exec(e.data.schema)
      // 回报实际生效的存储后端，便于上层与排障页确认走的是哪条路径
      self.postMessage({ id, ok: true, note: activeVfs } satisfies Res)
      return
    }

    if (!db) throw new Error('SQLite 未初始化')

    if (e.data.type === 'exec') {
      const rows: unknown[] = []
      db.exec({
        sql: e.data.sql,
        bind: e.data.params ?? [],
        rowMode: 'object',
        resultRows: rows,
      })
      self.postMessage({ id, ok: true, rows } satisfies Res)
      return
    }

    if (e.data.type === 'run') {
      db.exec({ sql: e.data.sql, bind: e.data.params ?? [] })
      self.postMessage({ id, ok: true, changes: 0 } satisfies Res)
      return
    }

    if (e.data.type === 'batch') {
      db.exec('BEGIN')
      try {
        for (const st of e.data.statements) {
          db.exec({ sql: st.sql, bind: st.params ?? [] })
        }
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
      self.postMessage({ id, ok: true } satisfies Res)
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies Res)
  }
}
