<script setup lang="ts">
/**
 * 机考科学计算器（PRD R5：内置科学计算器）
 *
 * 考试只允许使用系统内置计算器，因此这里模拟的是「够用且稳」的版本：
 * 四则运算 + 平方根 / 平方 / 倒数 / 百分比 / 正负号。
 * 用状态机实现而非 eval，避免注入风险。
 */
import { ref } from 'vue'

defineEmits<{ (e: 'close'): void }>()

const display = ref('0')
const acc = ref<number | null>(null)
const op = ref<string | null>(null)
/** 下一个数字是否重新开始输入 */
const fresh = ref(true)

interface CalcKey {
  label: string
  type: 'num' | 'op' | 'eq' | 'clear' | 'back' | 'unary' | 'dot'
  value?: string
  cls?: string
}

const KEYS: CalcKey[] = [
  { label: 'C', type: 'clear', cls: 'fn' },
  { label: '←', type: 'back', cls: 'fn' },
  { label: '%', type: 'unary', value: 'pct', cls: 'fn' },
  { label: '÷', type: 'op', value: '/', cls: 'op' },

  { label: '7', type: 'num', value: '7' },
  { label: '8', type: 'num', value: '8' },
  { label: '9', type: 'num', value: '9' },
  { label: '×', type: 'op', value: '*', cls: 'op' },

  { label: '4', type: 'num', value: '4' },
  { label: '5', type: 'num', value: '5' },
  { label: '6', type: 'num', value: '6' },
  { label: '−', type: 'op', value: '-', cls: 'op' },

  { label: '1', type: 'num', value: '1' },
  { label: '2', type: 'num', value: '2' },
  { label: '3', type: 'num', value: '3' },
  { label: '+', type: 'op', value: '+', cls: 'op' },

  { label: '±', type: 'unary', value: 'neg', cls: 'fn' },
  { label: '0', type: 'num', value: '0' },
  { label: '.', type: 'dot' },
  { label: '=', type: 'eq', cls: 'eq' },

  { label: '√', type: 'unary', value: 'sqrt', cls: 'sci' },
  { label: 'x²', type: 'unary', value: 'sqr', cls: 'sci' },
  { label: '1/x', type: 'unary', value: 'inv', cls: 'sci' },
  { label: '', type: 'num', value: '', cls: 'blank' },
]

/** 保留 10 位有效数字，去掉浮点误差尾巴 */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '错误'
  return String(Math.round(n * 1e10) / 1e10)
}

function equals() {
  const b = parseFloat(display.value)
  if (op.value == null || acc.value == null) return
  const a = acc.value
  const r =
    op.value === '+' ? a + b : op.value === '-' ? a - b : op.value === '*' ? a * b : b === 0 ? NaN : a / b
  display.value = fmt(r)
  acc.value = null
  op.value = null
  fresh.value = true
}

function unary(fn: string) {
  const v = parseFloat(display.value)
  const r =
    fn === 'sqrt'
      ? Math.sqrt(v)
      : fn === 'sqr'
        ? v * v
        : fn === 'inv'
          ? v === 0
            ? NaN
            : 1 / v
          : fn === 'pct'
            ? v / 100
            : -v
  display.value = fmt(r)
  fresh.value = true
}

function press(k: CalcKey) {
  switch (k.type) {
    case 'num':
      if (!k.value) return
      display.value = fresh.value || display.value === '0' ? k.value : display.value + k.value
      fresh.value = false
      break
    case 'dot':
      if (fresh.value) {
        display.value = '0.'
        fresh.value = false
      } else if (!display.value.includes('.')) {
        display.value += '.'
      }
      break
    case 'op':
      if (op.value != null && !fresh.value) equals()
      acc.value = parseFloat(display.value)
      op.value = k.value ?? null
      fresh.value = true
      break
    case 'eq':
      equals()
      break
    case 'clear':
      display.value = '0'
      acc.value = null
      op.value = null
      fresh.value = true
      break
    case 'back':
      display.value = display.value.length > 1 ? display.value.slice(0, -1) : '0'
      break
    case 'unary':
      unary(k.value ?? '')
      break
  }
}
</script>

<template>
  <div class="calc">
    <div class="calc__head">
      <span class="calc__title">计算器</span>
      <button class="calc__x" @click="$emit('close')">✕</button>
    </div>

    <div class="calc__display">{{ display }}</div>

    <div class="calc__grid">
      <button
        v-for="(k, i) in KEYS"
        :key="i"
        class="calc__key"
        :class="k.cls ? `calc__key--${k.cls}` : ''"
        :disabled="k.cls === 'blank'"
        @click="press(k)"
      >
        {{ k.label }}
      </button>
    </div>

    <p class="calc__tip">考试只允许使用系统内置计算器，练的时候就用它</p>
  </div>
</template>

<style scoped>
.calc {
  width: min(340px, 92vw);
  background: var(--bg-primary);
  border-radius: var(--radius-md);
  padding: var(--sp-3);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.calc__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-2);
}
.calc__title {
  font-size: var(--fs-aux);
  font-weight: 500;
}
.calc__x {
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 16px;
  padding: 4px 8px;
}
.calc__display {
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  padding: var(--sp-3);
  text-align: right;
  font-size: 24px;
  font-weight: 600;
  font-family: ui-monospace, monospace;
  color: var(--text-primary);
  margin-bottom: var(--sp-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.calc__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.calc__key {
  height: 42px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 15px;
  font-family: inherit;
}
.calc__key:active {
  background: var(--bg-secondary);
}
.calc__key--op {
  color: var(--color-primary);
  font-weight: 600;
}
.calc__key--fn,
.calc__key--sci {
  color: var(--text-secondary);
  font-size: 13px;
}
.calc__key--eq {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
  font-weight: 600;
}
.calc__key--blank {
  visibility: hidden;
}
.calc__tip {
  margin-top: var(--sp-2);
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.5;
  text-align: center;
}
</style>
