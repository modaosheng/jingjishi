/**
 * 备份服务（业务层）
 *
 * 编排 PRD M10-F3 的「三重备份机制」：
 *   ① 自动快照（每日/每周/迁移前）→ 时间机器可回滚
 *   ② 手动导出文件 → 用户自行保管（防设备丢失）
 *   ③ 系统级云备份 → 由系统负责，本服务不参与
 *
 * 规则（创建时机、保留策略、恢复流程）集中在此；Repository 只做存取。
 */
import type { BackupManifest } from '@/domain/repositories'
import type { BackupRepository, StateRepository } from '@/domain/repositories'
import { BackupCryptoError, decryptBackup, encryptBackup, isEncryptedEnvelope } from './backupCrypto'

/** 快照保留策略（PRD M10-F3） */
const KEEP = {
  auto_daily: 7,
  auto_weekly: 4,
  pre_migration: 3,
  manual: 50,
} as const

const LS_LAST_DAILY = 'jingshi.last_daily_snapshot'
const LS_LAST_WEEKLY = 'jingshi.last_weekly_snapshot'

export interface BackupServiceDeps {
  backup: BackupRepository
  states: StateRepository
}

/** 导出选项 */
export interface ExportOptions {
  /**
   * 加密密码。
   *
   * ⚠️ PRD Q11：**备份文件导出时应默认加密**。
   *    「默认开启」由 UI 层保证（加密开关默认勾选、密码必填）；
   *    服务层只负责「给了密码就加密」这一确定性行为。
   *    不传密码 = 导出明文，调用方必须已明确告知用户风险。
   */
  password?: string
}

/** 导出结果 */
export interface ExportResult {
  filename: string
  payload: string
  /** 是否为加密备份（UI 据此提示用户"请记住密码"） */
  encrypted: boolean
}

export interface SnapshotView {
  id: number
  type: keyof typeof KEEP
  createdAt: number
  sizeBytes: number
  /** 解析后的统计摘要，用于时间机器展示 */
  stats: { questionsAnswered: number; wrongCount: number; examRecords: number }
}

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10)
const isoWeek = (t: number) => {
  const d = new Date(t)
  const onejan = new Date(d.getFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7)
  return `${d.getFullYear()}-W${week}`
}

export class BackupService {
  constructor(private readonly deps: BackupServiceDeps) {}

  /** 应用启动时调用：按需创建每日/每周快照 */
  async ensureAutoSnapshot(): Promise<void> {
    const now = Date.now()
    const day = isoDay(now)
    if (localStorage.getItem(LS_LAST_DAILY) !== day) {
      await this.createSnapshot('auto_daily')
      localStorage.setItem(LS_LAST_DAILY, day)
    }

    const week = isoWeek(now)
    if (localStorage.getItem(LS_LAST_WEEKLY) !== week) {
      await this.createSnapshot('auto_weekly')
      localStorage.setItem(LS_LAST_WEEKLY, week)
    }

    await this.pruneSnapshots()
  }

  /** 创建快照（导出当前数据 → 写入仓储） */
  async createSnapshot(type: keyof typeof KEEP): Promise<number> {
    const { payload, manifest } = await this.deps.backup.export()
    return this.deps.backup.createSnapshot(type, payload, JSON.stringify(manifest.stats))
  }

  /** 时间机器：列出可回滚的快照 */
  async listSnapshots(): Promise<SnapshotView[]> {
    const list = await this.deps.backup.listSnapshots()
    return list.map((s) => ({
      id: s.id,
      type: s.type,
      createdAt: s.createdAt,
      sizeBytes: s.sizeBytes,
      stats: safeParseStats(s.stats),
    }))
  }

  /** 回滚到指定快照（覆盖式，调用前由 UI 二次确认） */
  async restoreSnapshot(id: number): Promise<BackupManifest> {
    const payload = await this.deps.backup.getSnapshot(id)
    if (!payload) throw new Error('快照数据不存在或已被清理')
    // 回滚前先保护当前数据，避免用户回滚错了无法撤销
    await this.createSnapshot('pre_migration')
    return this.deps.backup.import(payload)
  }

  /**
   * 导出为文件（返回内容与建议文件名，由页面触发下载）
   *
   * 传入 `password` 时产出**加密备份**（PRD Q11 推荐路径）。
   * 加密由 Web Crypto 完成，密码不离开本机、不留存任何副本。
   */
  async exportToFile(options: ExportOptions = {}): Promise<ExportResult> {
    const { manifest, payload } = await this.deps.backup.export()
    const date = new Date().toISOString().slice(0, 10)
    const base = `经济师上岸助手备份_${date}_${manifest.stats.questionsAnswered}题`

    if (options.password) {
      const encrypted = await encryptBackup(payload, options.password)
      return { filename: `${base}.encrypted.json`, payload: encrypted, encrypted: true }
    }

    return { filename: `${base}.json`, payload, encrypted: false }
  }

  /**
   * 从文件导入。
   *
   * ⚠️ **自动识别**是否为加密备份 —— 不让用户先回答"这是加密的吗"，
   *    那种问法既烦人又容易选错。
   *
   * @throws BackupCryptoError（code: wrong_password）密码错误
   */
  async importFromFile(payload: string, password?: string): Promise<BackupManifest> {
    if (!isEncryptedEnvelope(payload)) {
      return this.deps.backup.import(payload)
    }
    if (!password) {
      throw new BackupCryptoError('wrong_password', '这份备份已加密，请输入导出时设置的密码。')
    }
    const plain = await decryptBackup(payload, password)
    return this.deps.backup.import(plain)
  }

  /** 这份备份内容是否需要密码（供 UI 提前显示密码输入框） */
  needsPassword(payload: string): boolean {
    return isEncryptedEnvelope(payload)
  }

  /** 清理超出保留策略的快照 */
  async pruneSnapshots(): Promise<number> {
    const list = await this.deps.backup.listSnapshots()
    const counter: Record<string, number> = {}
    let removed = 0

    for (const s of list) {
      const keep = KEEP[s.type] ?? 5
      counter[s.type] = (counter[s.type] ?? 0) + 1
      if (counter[s.type] > keep) {
        await this.deps.backup.deleteSnapshot(s.id)
        removed++
      }
    }
    return removed
  }

  /** 是否已备份过（用于「答满 500 题未备份」提醒） */
  hasEverExported(): boolean {
    return !!localStorage.getItem('jingshi.last_export')
  }

  markExported(): void {
    localStorage.setItem('jingshi.last_export', String(Date.now()))
  }

  /** 距上次导出天数（用于每月提醒） */
  daysSinceExport(): number | null {
    const t = localStorage.getItem('jingshi.last_export')
    if (!t) return null
    return Math.floor((Date.now() - Number(t)) / 86400000)
  }
}

function safeParseStats(raw: string): SnapshotView['stats'] {
  try {
    const o = JSON.parse(raw)
    return {
      questionsAnswered: Number(o?.questionsAnswered ?? 0),
      wrongCount: Number(o?.wrongCount ?? 0),
      examRecords: Number(o?.examRecords ?? 0),
    }
  } catch {
    return { questionsAnswered: 0, wrongCount: 0, examRecords: 0 }
  }
}
