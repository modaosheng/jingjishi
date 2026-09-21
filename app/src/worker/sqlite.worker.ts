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

type Res = { id: number; ok: true; rows?: unknown[]; changes?: number } | { id: number; ok: false; error: string }

interface Db {
  exec: (opts: unknown) => void
  close: () => void
}

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>

const DB_FILE = '/jingshi.db'

let db: Db | null = null

/**
 * 打开数据库：按优先级尝试两种 OPFS VFS，都不可用则抛错（上层会降级到 Mock）
 */
async function openDatabase(sqlite3: Sqlite3): Promise<Db> {
  // ① opfs-sahpool：无需 COOP/COEP，部署友好（推荐）
  if (typeof sqlite3.installOpfsSAHPoolVfs === 'function') {
    try {
      const pool = await sqlite3.installOpfsSAHPoolVfs({
        name: 'opfs-sahpool',
        directory: '/jingshi-db',
        // 容量需 ≥ 数据库文件数的两倍（含 journal），单个库 6 足够
        initialCapacity: 6,
      })
      return new pool.OpfsSAHPoolDb(DB_FILE) as unknown as Db
    } catch (err) {
      console.warn('[SQLite] opfs-sahpool VFS 不可用，尝试 opfs:', err)
    }
  }

  // ② opfs：需要 COOP/COEP（Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy）
  if (sqlite3.oo1?.OpfsDb) {
    return new sqlite3.oo1.OpfsDb(DB_FILE) as unknown as Db
  }

  throw new Error(
    '当前环境不支持持久化 SQLite（OPFS 不可用）。请用 Chrome 108+ / Safari 16.4+，或改用 Mock 数据源。',
  )
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id } = e.data
  try {
    if (e.data.type === 'init') {
      // sqlite3InitModule 不接受参数；日志由 worker 自身静默处理
      const sqlite3 = await sqlite3InitModule()
      db = await openDatabase(sqlite3)
      db.exec(e.data.schema)
      self.postMessage({ id, ok: true } satisfies Res)
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
