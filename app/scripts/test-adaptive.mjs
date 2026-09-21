/**
 * 自适应难度引擎验证（Node 直接运行）
 * 运行：node scripts/test-adaptive.mjs
 * ⚠️ 本脚本是 adaptiveDifficultyService 的 JS 副本，改动后需同步。
 */

// 先 mock localStorage（服务依赖它持久化状态）
globalThis.localStorage = {
  _d: {},
  getItem(k) {
    return this._d[k] ?? null
  },
  setItem(k, v) {
    this._d[k] = String(v)
  },
  removeItem(k) {
    delete this._d[k]
  },
}

const KEY = 'jingshi.adaptive_difficulty'
const TARGET_ACCURACY = 0.85
const HIGH = 0.92
const LOW = 0.7
const WINDOW = 20
const MIN_SAMPLE = 12
const MIN_D = 1
const MAX_D = 5
const WRONG_GUARD = 3

const initialState = () => ({ difficulty: 3, recent: [], highStreak: 0, lowStreak: 0, wrongStreak: 0 })

function loadAdaptiveState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return initialState()
    const s = JSON.parse(raw)
    const d = Number(s.difficulty)
    return {
      difficulty: Number.isFinite(d) ? Math.min(Math.max(d, MIN_D), MAX_D) : 3,
      recent: Array.isArray(s.recent) ? s.recent.slice(-WINDOW) : [],
      highStreak: Number(s.highStreak) || 0,
      lowStreak: Number(s.lowStreak) || 0,
      wrongStreak: Number(s.wrongStreak) || 0,
    }
  } catch {
    return initialState()
  }
}

function saveAdaptiveState(s) {
  localStorage.setItem(KEY, JSON.stringify(s))
}

function difficultyRange(level) {
  const d = Math.min(Math.max(Math.round(level), MIN_D), MAX_D)
  return [Math.max(MIN_D, d - 1), Math.min(MAX_D, d + 1)]
}

function windowAccuracy(s) {
  if (s.recent.length < MIN_SAMPLE) return null
  return s.recent.filter(Boolean).length / s.recent.length
}

function recordResult(isCorrect, prev) {
  const s = prev ? { ...prev, recent: [...prev.recent] } : loadAdaptiveState()
  s.recent.push(isCorrect)
  if (s.recent.length > WINDOW) s.recent = s.recent.slice(-WINDOW)
  s.wrongStreak = isCorrect ? 0 : s.wrongStreak + 1

  if (s.wrongStreak >= WRONG_GUARD) {
    const canDrop = s.difficulty > MIN_D
    if (canDrop) s.difficulty -= 1
    s.wrongStreak = 0
    s.lowStreak = 0
    s.highStreak = 0
    saveAdaptiveState(s)
    return { changed: canDrop ? -1 : 0, difficulty: s.difficulty, insertEasy: true, reason: '情绪保护' }
  }

  const acc = windowAccuracy(s)
  let changed = 0
  let insertEasy = false

  if (acc !== null && s.recent.length >= WINDOW) {
    if (acc > HIGH) {
      s.highStreak += 1
      s.lowStreak = 0
      if (s.highStreak >= 2 && s.difficulty < MAX_D) {
        s.difficulty += 1
        changed = 1
      }
    } else if (acc < LOW) {
      s.lowStreak += 1
      s.highStreak = 0
      if (s.lowStreak >= 2 && s.difficulty > MIN_D) {
        s.difficulty -= 1
        changed = -1
        insertEasy = true
      }
    } else {
      s.highStreak = 0
      s.lowStreak = 0
    }
    // 评估后无条件清空窗口（独立批次语义）
    s.recent = []
  }

  saveAdaptiveState(s)
  return { changed, difficulty: s.difficulty, insertEasy, reason: '' }
}

const resetAdaptiveState = () => saveAdaptiveState(initialState())

/* ---------- 辅助 ---------- */

/** 高正确率窗口：先错 1 题再对 19 题（避免触发连续答错保护） */
const HIGH_SEQ = [false, ...Array(19).fill(true)]

/** 低正确率窗口：对错交替（错题分散，不会连续 3 错） */
const LOW_SEQ = Array.from({ length: WINDOW }, (_, i) => i % 2 === 0)

/** 目标区窗口：20 题对 17 题（85%），错题必须分散 —— 连续 3 错会触发情绪保护 */
const TARGET_SEQ = Array.from({ length: WINDOW }, (_, i) => ![3, 9, 15].includes(i))

function feed(seq) {
  return seq.map((c) => recordResult(c))
}

let failed = 0
const check = (name, actual, expect) => {
  let ok
  if (typeof expect === 'function') ok = expect(actual)
  else ok = JSON.stringify(actual) === JSON.stringify(expect)
  if (!ok) failed++
  console.log(`${ok ? '✅' : '❌'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ' (期望不符)'}`)
}

/* ---------- ① 初始状态 ---------- */
resetAdaptiveState()
check('① 初始难度为 3（中等）', loadAdaptiveState().difficulty, 3)
check('① 难度区间 = ±1', difficultyRange(3), [2, 4])
check('① 难度 1 的区间不越界', difficultyRange(1), [1, 2])
check('① 难度 5 的区间不越界', difficultyRange(5), [4, 5])

/* ---------- ② 连续 2 个高窗口 → 难度 +1 ---------- */
resetAdaptiveState()
feed(HIGH_SEQ)
check('② 仅 1 个高窗口不调整（需连续 2 次）', loadAdaptiveState().difficulty, 3)
feed(HIGH_SEQ)
check('② 连续 2 个高窗口 → 难度升到 4', loadAdaptiveState().difficulty, 4)

/* ---------- ③ 连续 2 个低窗口 → 难度 -1 且插入基础题 ---------- */
resetAdaptiveState()
feed(LOW_SEQ)
check('③ 仅 1 个低窗口不调整', loadAdaptiveState().difficulty, 3)
const lowOut = feed(LOW_SEQ)
check('③ 连续 2 个低窗口 → 难度降到 2', loadAdaptiveState().difficulty, 2)
check('③ 降难度时标记「插入基础题」', lowOut.some((o) => o.insertEasy), true)

/* ---------- ④ 落在目标区 → 不调整且清零连续计数 ---------- */
resetAdaptiveState()
feed(HIGH_SEQ) // highStreak = 1
feed(TARGET_SEQ) // 落入目标区，应清零 highStreak
check('④ 目标区不调整难度', loadAdaptiveState().difficulty, 3)
check('④ 目标区清零高正确率计数', loadAdaptiveState().highStreak, 0)
feed(HIGH_SEQ) // 若上次没清零，这次会误升难度
check('④ 目标区确实打断了连续计数', loadAdaptiveState().difficulty, 3)

/* ---------- ⑤ 情绪保护：连续答错 3 题 ---------- */
resetAdaptiveState()
recordResult(false)
recordResult(false)
check('⑤ 连错 2 题不触发', loadAdaptiveState().difficulty, 3)
const guardOut = recordResult(false)
check('⑤ 连错 3 题 → 立即降难度', guardOut.changed, -1)
check('⑤ 降后难度为 2', guardOut.difficulty, 2)
check('⑤ 标记插入简单题', guardOut.insertEasy, true)
check('⑤ 答对后连错计数归零', (recordResult(true), loadAdaptiveState().wrongStreak), 0)

/* ---------- ⑥ 难度边界 ---------- */
resetAdaptiveState()
// 手动把难度推到 5
saveAdaptiveState({ ...initialState(), difficulty: MAX_D })
feed(HIGH_SEQ)
feed(HIGH_SEQ)
check('⑥ 难度 5 时不再上升', loadAdaptiveState().difficulty, MAX_D)

resetAdaptiveState()
saveAdaptiveState({ ...initialState(), difficulty: MIN_D })
feed(LOW_SEQ)
feed(LOW_SEQ)
check('⑥ 难度 1 时不再下降', loadAdaptiveState().difficulty, MIN_D)

/* ---------- ⑦ 情绪保护在最低难度时不越界 ---------- */
resetAdaptiveState()
saveAdaptiveState({ ...initialState(), difficulty: MIN_D })
recordResult(false)
recordResult(false)
const floorOut = recordResult(false)
check('⑦ 最低难度连错 3 题不越界', floorOut.difficulty, MIN_D)
check('⑦ 仍会标记插入简单题', floorOut.insertEasy, true)

/* ---------- ⑧ 窗口只保留最近 20 题 ---------- */
resetAdaptiveState()
feed(Object.assign([], HIGH_SEQ))
check('⑧ 窗口长度不超过 20', loadAdaptiveState().recent.length <= WINDOW, true)

console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项未通过`}`)
process.exit(failed === 0 ? 0 : 1)
