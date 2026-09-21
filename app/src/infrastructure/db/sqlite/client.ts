/**
 * SQLite Worker 客户端 —— Promise 化封装
 * 所有 SQL 都在这里转成消息发给 Worker，主线程不直接触碰 WASM
 */
import SqliteWorker from '@/worker/sqlite.worker?worker'
import schemaSql from '@/infrastructure/db/schema.sql?raw'

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export class SqliteClient {
  private worker: Worker | null = null
  private seq = 0
  private pending = new Map<number, Pending>()
  private initPromise: Promise<void> | null = null

  private ensureWorker() {
    if (this.worker) return this.worker
    this.worker = new SqliteWorker()
    this.worker.onmessage = (e: MessageEvent) => {
      const data = e.data as { id: number; ok: boolean; rows?: unknown[]; error?: string }
      const p = this.pending.get(data.id)
      if (!p) return
      this.pending.delete(data.id)
      if (data.ok) p.resolve(data.rows)
      else p.reject(new Error(data.error ?? 'SQLite 错误'))
    }
    this.worker.onerror = (e) => {
      this.pending.forEach((p) => p.reject(new Error(e.message || 'Worker 错误')))
      this.pending.clear()
    }
    return this.worker
  }

  private call<T>(payload: Record<string, unknown>): Promise<T> {
    const worker = this.ensureWorker()
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      worker.postMessage({ id, ...payload })
      // 超时保护，避免请求悬挂
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('SQLite 请求超时'))
        }
      }, 15000)
    })
  }

  /** 初始化：加载 WASM + 建表。失败会抛出，由上层降级处理 */
  init(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.call<void>({ type: 'init', schema: schemaSql }).then(() => undefined)
    return this.initPromise
  }

  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.call<T[]>({ type: 'exec', sql, params })
  }

  async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.all<T>(sql, params)
    return rows[0] ?? null
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.call({ type: 'run', sql, params })
  }

  async batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    await this.call({ type: 'batch', statements })
  }

  destroy() {
    this.worker?.terminate()
    this.worker = null
    this.initPromise = null
    this.pending.clear()
  }
}

export const sqliteClient = new SqliteClient()
