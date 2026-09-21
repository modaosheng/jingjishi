/**
 * 在 Node 测试进程启动时注册 `@/` 别名解析钩子。
 *
 * 与 `_aliasLoader.mjs` 的分工：
 *   - 本文件：注册动作（`--import` 入口，同步执行）
 *   - _aliasLoader.mjs：实际的 resolve 逻辑
 *
 * 之所以要拆成两个文件：Node 的 `--import` 要求入口是**普通模块**，
 * 而 loader hooks 必须通过 `module.register()` 单独注册。
 */

import { register } from 'node:module'

register('./_aliasLoader.mjs', import.meta.url)
