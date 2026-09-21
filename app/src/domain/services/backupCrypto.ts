/**
 * 备份文件加密（PRD Q11 决策）
 *
 * ══════════════════════════════════════════════════════════════
 *  PRD Q11：**本地数据库默认不加密；备份文件导出时提供加密选项（默认开启）。**
 *
 *  理由（原文）：数据库加密牺牲 5-15% 读写性能，且系统沙箱已提供主要保护；
 *  风险真正集中在「备份文件外泄」这一场景 —— 备份文件是**可迁移资产**，
 *  可能被丢进网盘、微信传输、邮箱，一旦外泄就是完整的个人学习档案。
 *  **精准加密比全库加密更合理。**
 * ══════════════════════════════════════════════════════════════
 *
 * 算法选择（都是 Web Crypto 原生能力，零依赖）：
 *   - 密钥派生：PBKDF2-HMAC-SHA256，250,000 次迭代
 *     （迭代次数按 OWASP 2023 对 PBKDF2-SHA256 的建议下限设定）
 *   - 加密：AES-256-GCM
 *     GCM 自带认证标签 → **密码错误时解密会失败**，无需额外校验字段，
 *     同时保证密文未被篡改（防篡改是「购买状态随备份迁移」的前提）。
 *
 * 🔒 安全边界（必须写清楚，避免被误读）：
 *   这是一份**用户自持密码**的本地加密。我们**没有、也不可能有**后门或
 *   密钥托管 —— 密码丢失即数据无法恢复。这是本地架构的必然结果，
 *   也是它值得信任的原因。
 */

import type { BackupEnvelope } from './backupCryptoTypes'
export type { BackupEnvelope }

/** 加密信封的格式标识（用于识别一份备份是否已加密） */
export const ENCRYPTED_FORMAT = 'jingshi-backup-encrypted'

/** 信封格式版本（将来换算法时用于兼容旧文件） */
export const ENVELOPE_VERSION = 1

/** PBKDF2 迭代次数 */
export const PBKDF2_ITERATIONS = 250_000

/** 密码最短长度 */
export const MIN_PASSWORD_LENGTH = 6

/** 加密相关的错误码（供 UI 映射为可读文案） */
export type BackupCryptoErrorCode =
  | 'crypto_unavailable' // 环境不支持 Web Crypto（非安全上下文）
  | 'password_too_short'
  | 'wrong_password' // 密码错误，或密文被篡改
  | 'malformed' // 信封结构不合法
  | 'unsupported_version'

export class BackupCryptoError extends Error {
  readonly code: BackupCryptoErrorCode

  constructor(code: BackupCryptoErrorCode, message: string) {
    super(message)
    this.name = 'BackupCryptoError'
    this.code = code
  }
}

/* ==================== 环境能力检测 ==================== */

/**
 * 当前环境是否支持 Web Crypto。
 *
 * ⚠️ `crypto.subtle` **只在安全上下文可用**（HTTPS / localhost / Capacitor 的
 *    `https` scheme）。Capacitor 配置里 `androidScheme: 'https'` 正是为此。
 *    若在普通 HTTP 页面打开，此能力不存在 —— 必须优雅降级而非崩溃。
 */
export function isCryptoAvailable(): boolean {
  try {
    return typeof globalThis.crypto?.subtle !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function'
  } catch {
    return false
  }
}

function requireCrypto(): SubtleCrypto {
  if (!isCryptoAvailable()) {
    throw new BackupCryptoError(
      'crypto_unavailable',
      '当前环境不支持加密（需要 HTTPS 或 App 内打开）。你的数据不会被导出，请换个环境重试。',
    )
  }
  return globalThis.crypto.subtle
}

/* ==================== 编解码工具 ==================== */

function bytesToBase64(bytes: Uint8Array): string {
  // 分块转换：避免 String.fromCharCode(...largeArray) 造成调用栈溢出
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

const utf8Encode = (s: string) => new TextEncoder().encode(s)
const utf8Decode = (b: Uint8Array) => new TextDecoder().decode(b)

/* ==================== 识别与校验 ==================== */

/**
 * 判断一份备份内容是否已加密。
 *
 * 用途：导入时自动识别用户给的是明文还是密文，无需让用户先选「这是加密的吗」——
 * 那种问法既烦人又容易选错。
 */
export function isEncryptedEnvelope(payload: string): boolean {
  try {
    const head = payload.trimStart().slice(0, 200)
    if (!head.startsWith('{')) return false
    const o = JSON.parse(payload) as { format?: string }
    return o?.format === ENCRYPTED_FORMAT
  } catch {
    return false
  }
}

function parseEnvelope(payload: string): BackupEnvelope {
  let o: Partial<BackupEnvelope>
  try {
    o = JSON.parse(payload) as Partial<BackupEnvelope>
  } catch {
    throw new BackupCryptoError('malformed', '备份文件不是合法的 JSON，可能已损坏。')
  }

  if (o?.format !== ENCRYPTED_FORMAT) {
    throw new BackupCryptoError('malformed', '这不是一份加密备份文件。')
  }
  if (o.version !== ENVELOPE_VERSION) {
    throw new BackupCryptoError(
      'unsupported_version',
      `备份文件版本（${String(o.version)}）与当前 App 不兼容，请升级 App 后重试。`,
    )
  }
  if (!o.kdf?.salt || !o.cipher?.iv || !o.data) {
    throw new BackupCryptoError('malformed', '备份文件结构不完整，可能已损坏。')
  }
  return o as BackupEnvelope
}

/* ==================== 加密 ==================== */

/**
 * 加密备份内容。
 *
 * @param plaintext 明文备份（即 `BackupRepository.export()` 产出的 payload）
 * @param password  用户自设密码
 * @returns 加密信封的 JSON 字符串（可直接写入文件）
 */
export async function encryptBackup(plaintext: string, password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new BackupCryptoError(
      'password_too_short',
      `密码至少 ${MIN_PASSWORD_LENGTH} 位。这个密码丢了数据就找不回来了，请设得稳妥些。`,
    )
  }
  const subtle = requireCrypto()

  // 每次加密都用新的随机盐与 IV —— 同样的明文+密码也会产出不同密文
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12)) // GCM 推荐 96 bit

  const key = await deriveKey(subtle, password, salt)
  const cipherBuf = await subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8Encode(plaintext))

  const envelope: BackupEnvelope = {
    format: ENCRYPTED_FORMAT,
    version: ENVELOPE_VERSION,
    createdAt: Date.now(),
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
    },
    cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
    data: bytesToBase64(new Uint8Array(cipherBuf)),
  }

  return JSON.stringify(envelope)
}

/* ==================== 解密 ==================== */

/**
 * 解密备份内容。
 *
 * @throws BackupCryptoError，code 为 `wrong_password` 表示密码错误**或**密文被篡改
 *         （AES-GCM 无法区分这两者，这是算法的固有性质，不是缺陷）
 */
export async function decryptBackup(payload: string, password: string): Promise<string> {
  const env = parseEnvelope(payload)
  const subtle = requireCrypto()

  const salt = base64ToBytes(env.kdf.salt)
  const iv = base64ToBytes(env.cipher.iv)
  const data = base64ToBytes(env.data)

  // 用信封里记录的迭代次数派生密钥（兼容将来调整迭代次数）
  const key = await deriveKey(subtle, password, salt, env.kdf.iterations)

  try {
    const plainBuf = await subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return utf8Decode(new Uint8Array(plainBuf))
  } catch {
    // GCM 认证失败：密码错误或文件损坏
    throw new BackupCryptoError(
      'wrong_password',
      '密码不正确，或备份文件已损坏。请确认密码后重试。',
    )
  }
}

/* ==================== 内部：密钥派生 ==================== */

async function deriveKey(
  subtle: SubtleCrypto,
  password: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const baseKey = await subtle.importKey('raw', utf8Encode(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}
