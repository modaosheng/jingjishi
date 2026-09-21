/**
 * 备份加密单测
 *
 * 覆盖：加解密往返、密码错误、篡改检测、信封格式校验、边界条件。
 *
 * ⚠️ 这些测试**不能省** —— 加密逻辑一旦有 bug，用户丢的是全部历史数据，
 *    而且是在最需要它的时刻（换设备/重装）才发现。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  encryptBackup,
  decryptBackup,
  isEncryptedEnvelope,
  isCryptoAvailable,
  BackupCryptoError,
  MIN_PASSWORD_LENGTH,
  ENCRYPTED_FORMAT,
  ENVELOPE_VERSION,
} from '../src/domain/services/backupCrypto.ts'

const PWD = 'test-password-123'
const PLAINTEXT = JSON.stringify({ hello: '世界', n: 42, arr: [1, 2, 3] })

/* ==================== 环境 ==================== */

test('测试环境提供 Web Crypto 能力（前置条件）', () => {
  assert.equal(isCryptoAvailable(), true, 'Node 22 应内置 Web Crypto')
})

/* ==================== 往返 ==================== */

test('加密后能用自己的密码解回原文', async () => {
  const envelope = await encryptBackup(PLAINTEXT, PWD)
  const plain = await decryptBackup(envelope, PWD)
  assert.equal(plain, PLAINTEXT)
})

test('中文与 emoji 能正确往返（UTF-8 编码正确）', async () => {
  const text = JSON.stringify({ 题目: '财政政策工具包括哪些？', emoji: '🎯📘', mark: '「引号」' })
  const envelope = await encryptBackup(text, PWD)
  assert.equal(await decryptBackup(envelope, PWD), text)
})

test('空字符串与超长内容都能往返', async () => {
  const empty = await encryptBackup('', PWD)
  assert.equal(await decryptBackup(empty, PWD), '')

  const long = JSON.stringify({ data: 'x'.repeat(200_000) })
  const envLong = await encryptBackup(long, PWD)
  assert.equal(await decryptBackup(envLong, PWD), long, '大内容不应因分块转换出错')
})

/* ==================== 安全性 ==================== */

test('密码错误时解密失败，且错误码为 wrong_password', async () => {
  const envelope = await encryptBackup(PLAINTEXT, PWD)
  await assert.rejects(
    () => decryptBackup(envelope, 'wrong-password-xxx'),
    (e: unknown) => e instanceof BackupCryptoError && e.code === 'wrong_password',
  )
})

test('同一明文加密两次产出不同密文（随机盐 + 随机 IV）', async () => {
  const a = await encryptBackup(PLAINTEXT, PWD)
  const b = await encryptBackup(PLAINTEXT, PWD)
  assert.notEqual(a, b, '必须使用随机盐与随机 IV，否则相同内容会产生相同密文')

  const oa = JSON.parse(a)
  const ob = JSON.parse(b)
  assert.notEqual(oa.kdf.salt, ob.kdf.salt, '盐必须每次随机')
  assert.notEqual(oa.cipher.iv, ob.cipher.iv, 'IV 必须每次随机')
})

test('密文被篡改时解密失败（AES-GCM 认证标签生效）', async () => {
  const envelope = await encryptBackup(PLAINTEXT, PWD)
  const o = JSON.parse(envelope)

  // ⚠️ 必须改**解码后的字节**，不能改 base64 字符串的末尾字符 ——
  //    末尾字符可能只承载填充位，改了也解不出不同的字节，测试会假通过。
  const raw = Buffer.from(o.data, 'base64')
  assert.ok(raw.length > 4, '前置条件：密文应足够长')
  const mid = Math.floor(raw.length / 2)
  raw[mid] = raw[mid] ^ 0xff // 翻转中间一个字节
  o.data = raw.toString('base64')

  await assert.rejects(
    () => decryptBackup(JSON.stringify(o), PWD),
    (e: unknown) => e instanceof BackupCryptoError,
    '篡改的密文必须解密失败 —— 这是防篡改的基础',
  )
})

test('IV 被篡改时解密失败', async () => {
  const envelope = await encryptBackup(PLAINTEXT, PWD)
  const o = JSON.parse(envelope)
  const iv = Buffer.from(o.cipher.iv, 'base64')
  iv[0] = iv[0] ^ 0xff
  o.cipher.iv = iv.toString('base64')

  await assert.rejects(
    () => decryptBackup(JSON.stringify(o), PWD),
    (e: unknown) => e instanceof BackupCryptoError,
  )
})

test('信封里的迭代次数被篡改也会导致解密失败', async () => {
  const envelope = await encryptBackup(PLAINTEXT, PWD)
  const o = JSON.parse(envelope)
  o.kdf.iterations = 1000 // 派生出的密钥不同 → 解密失败

  await assert.rejects(
    () => decryptBackup(JSON.stringify(o), PWD),
    (e: unknown) => e instanceof BackupCryptoError && e.code === 'wrong_password',
  )
})

/* ==================== 密码长度 ==================== */

test('密码过短时拒绝加密', async () => {
  await assert.rejects(
    () => encryptBackup(PLAINTEXT, '12345'),
    (e: unknown) => e instanceof BackupCryptoError && e.code === 'password_too_short',
  )
})

test('恰好达到最短长度的密码可用', async () => {
  const pwd = 'a'.repeat(MIN_PASSWORD_LENGTH)
  const env = await encryptBackup(PLAINTEXT, pwd)
  assert.equal(await decryptBackup(env, pwd), PLAINTEXT)
})

/* ==================== 格式识别 ==================== */

test('isEncryptedEnvelope 能区分加密与明文备份', async () => {
  const envelope = await encryptBackup(PLAINTEXT, PWD)
  assert.equal(isEncryptedEnvelope(envelope), true)
  assert.equal(isEncryptedEnvelope(PLAINTEXT), false, '明文 JSON 不应被误判为加密')
})

test('isEncryptedEnvelope 对垃圾输入返回 false 而非抛错', () => {
  assert.equal(isEncryptedEnvelope(''), false)
  assert.equal(isEncryptedEnvelope('not json'), false)
  assert.equal(isEncryptedEnvelope('{{{'), false)
  assert.equal(isEncryptedEnvelope('[1,2,3]'), false)
})

test('信封包含完整的算法参数（便于将来升级兼容旧文件）', async () => {
  const o = JSON.parse(await encryptBackup(PLAINTEXT, PWD))
  assert.equal(o.format, ENCRYPTED_FORMAT)
  assert.equal(o.version, ENVELOPE_VERSION)
  assert.equal(o.kdf.name, 'PBKDF2')
  assert.equal(o.kdf.hash, 'SHA-256')
  assert.ok(o.kdf.iterations >= 100_000, '迭代次数不应过低')
  assert.equal(o.cipher.name, 'AES-GCM')
  assert.ok(typeof o.createdAt === 'number')
})

/* ==================== 畸形信封 ==================== */

test('结构不完整的信封被拒绝', async () => {
  await assert.rejects(
    () => decryptBackup(JSON.stringify({ format: ENCRYPTED_FORMAT, version: ENVELOPE_VERSION }), PWD),
    (e: unknown) => e instanceof BackupCryptoError && e.code === 'malformed',
  )
})

test('不支持的版本号给出明确错误（而非静默解错）', async () => {
  const o = JSON.parse(await encryptBackup(PLAINTEXT, PWD))
  o.version = 999
  await assert.rejects(
    () => decryptBackup(JSON.stringify(o), PWD),
    (e: unknown) => e instanceof BackupCryptoError && e.code === 'unsupported_version',
  )
})

test('非加密内容走 decryptBackup 会得到 malformed', async () => {
  await assert.rejects(
    () => decryptBackup('{"format":"something-else"}', PWD),
    (e: unknown) => e instanceof BackupCryptoError && e.code === 'malformed',
  )
})
