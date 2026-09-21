/**
 * Node 测试运行器的模块解析钩子
 *
 * 解决两个 Node 原生不支持的写法（Vite / TypeScript 环境下却合法）：
 *
 *   ① 路径别名：`@/foo`  →  `<项目根>/src/foo`
 *   ② 省略扩展名：`./foo` →  `./foo.ts`（Node 的 ESM 解析**不做**扩展名补全）
 *
 * 有了这层，业务源码可以保持与 Vite 一致的导入风格，
 * 而 `npm test` 依然能直接测试它们 —— 不需要把业务代码降级、也不需要第三方依赖。
 *
 * ⚠️ 纯 JS（.mjs 不走 TypeScript 转换），不能用 import type。
 * ⚠️ 仅测试期使用，不参与 Vite 构建，不影响产物。
 */

import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve as resolvePath, dirname, extname } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = resolvePath(HERE, '..', 'src')

/** Node 内建模块与包名不需要我们处理 */
function isBareSpecifier(spec) {
  return !spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('file:')
}

/** 依次尝试原样 / .ts / .js / /index.ts */
async function tryResolve(basePath, context, nextResolve) {
  const candidates = extname(basePath) ? [basePath] : [basePath, `${basePath}.ts`, `${basePath}.js`, `${basePath}/index.ts`]
  for (const candidate of candidates) {
    try {
      return await nextResolve(pathToFileURL(candidate).href, context)
    } catch {
      /* 继续尝试 */
    }
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  // ① 别名：@/xxx → src/xxx
  if (specifier.startsWith('@/')) {
    const hit = await tryResolve(resolvePath(SRC_ROOT, specifier.slice(2)), context, nextResolve)
    if (hit) return hit
    throw new Error(`[aliasLoader] 无法解析别名：${specifier}`)
  }

  // ② 相对路径省略扩展名 → 补全（只处理本项目内的相对导入）
  if (!isBareSpecifier(specifier) && !extname(specifier)) {
    const parentPath = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : process.cwd()
    const hit = await tryResolve(resolvePath(parentPath, specifier), context, nextResolve)
    if (hit) return hit
    // 补全失败则交回默认解析，让 Node 报它自己的错（便于定位）
  }

  return nextResolve(specifier, context)
}
