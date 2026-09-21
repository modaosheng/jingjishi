/**
 * 加密备份文件的磁盘格式定义（Wire Format）
 *
 * ⚠️ 这份结构会**落盘并被长期保存** —— 用户可能把备份文件存好几年。
 *    因此它的字段一旦发布就必须保持向后兼容：
 *      - 新增字段：可选，且旧版本忽略后仍能解密
 *      - 修改语义：必须递增 `version` 并提供兼容分支
 *      - 删除字段：禁止（会让老备份文件永久失效）
 *
 * 设计取向：把**算法参数写在文件里**而不是写死在代码中。
 * 这样将来提升 PBKDF2 迭代次数时，老文件仍能用它自己记录的次数解开。
 */

/** 加密备份信封 */
export interface BackupEnvelope {
  /** 固定标识，用于识别「这是一份加密备份」 */
  format: 'jingshi-backup-encrypted'
  /** 信封格式版本 */
  version: number
  /** 加密时间戳 */
  createdAt: number
  /** 密钥派生参数 */
  kdf: {
    name: 'PBKDF2'
    hash: 'SHA-256'
    /** 迭代次数（写进文件，便于将来升级算法时兼容旧文件） */
    iterations: number
    /** 随机盐，Base64 */
    salt: string
  }
  /** 对称加密参数 */
  cipher: {
    name: 'AES-GCM'
    /** 随机初始化向量，Base64 */
    iv: string
  }
  /** 密文（含 GCM 认证标签），Base64 */
  data: string
}
