<script setup lang="ts">
/**
 * 识别规则面板（导入首屏使用）
 *
 * 主流程（面向普通用户）：
 *   粘贴一道真实题目 → 自动推导规则 → 立即回测并展示识别结果
 * 高级（折叠，面向进阶用户）：
 *   选模板 / 手动调整占位符 / 查看完整模板预览
 *
 * rule 以对象引用传入，此处直接修改其字段（父子共享同一响应式对象）。
 */
import { computed, ref } from 'vue'
import {
  buildFieldSample,
  buildSample,
  inferRule,
  RULE_PRESETS,
  type InferenceReport,
  type ParseRule,
} from '@/domain/services/parseRule'

const props = defineProps<{ rule: ParseRule; open: boolean }>()
const emit = defineEmits<{ (e: 'toggle'): void }>()

const sample = ref('')
const report = ref<InferenceReport | null>(null)
const showAdvanced = ref(false)

/** 从样例自动识别规则，并用推导结果回测（结果直接展示给用户确认） */
function doInfer() {
  if (!sample.value.trim()) return
  const { rule, report: r } = inferRule(sample.value, props.rule)
  Object.assign(props.rule, rule)
  report.value = r
}

const allOk = computed(
  () => !!report.value && report.value.question.ok && report.value.option.ok && report.value.answer.ok,
)

const fullSample = computed(() => buildSample(props.rule))

function applyPreset(id: string) {
  const p = RULE_PRESETS.find((r) => r.id === id)
  if (p) {
    Object.assign(props.rule, p)
    report.value = null
  }
}

const ADV_FIELDS: Array<{
  key: keyof ParseRule
  label: string
  placeholder: string
  sample?: (r: ParseRule) => string
}> = [
  {
    key: 'questionPattern',
    label: '题号长什么样（多种写法用分号隔开）',
    placeholder: '{n}{d} ; 第{c}题',
    sample: (r) => buildFieldSample(r.questionPattern),
  },
  {
    key: 'optionPattern',
    label: '选项长什么样',
    placeholder: '{L}{d}',
    sample: (r) => buildFieldSample(r.optionPattern),
  },
  {
    key: 'answerPattern',
    label: '答案长什么样',
    placeholder: '答案{o}{a}',
    sample: (r) => buildFieldSample(r.answerPattern),
  },
  { key: 'analysisKeywords', label: '解析关键词（逗号分隔）', placeholder: '解析,【解析】,详解' },
  { key: 'metaKeywords', label: '考点/出处关键词（逗号分隔）', placeholder: '考点,出处,来源' },
  { key: 'startAfter', label: '从哪开始（留空 = 第一个题号）', placeholder: '一、单项选择题' },
  { key: 'endBefore', label: '到哪结束（留空 = 文末）', placeholder: '参考答案及解析' },
]

const HINTS: Array<[string, string]> = [
  ['{n}', '阿拉伯题号，如 1'],
  ['{c}', '中文题号，如 一'],
  ['{t}', '题型标记（可省略），如【单选题】'],
  ['{L}', '选项字母 A-E'],
  ['{a}', '答案字母，如 A 或 AB'],
  ['{d}', '分隔符（. 、 ， ： 任一）'],
  ['{o}', '可选分隔符（有冒号没冒号都匹配）'],
]
</script>

<template>
  <div class="card">
    <div class="head" @click="emit('toggle')">
      <span class="head__title">识别规则</span>
      <span class="head__toggle">{{ open ? '收起 ▲' : '设置 ▼' }}</span>
    </div>

    <div v-if="open" class="body">
      <!-- 主流程：粘一道题，自动识别 -->
      <div class="step">
        <span class="step__num">1</span>粘贴一道你文档里的题目
      </div>
      <textarea
        v-model="sample"
        class="ta"
        rows="5"
        placeholder="把一道题完整复制进来（含题号、选项、答案最好）"
      />
      <button class="primary" :disabled="!sample.trim()" @click="doInfer">自动识别规则</button>

      <!-- 回测结果：让用户确信规则可用 -->
      <div v-if="report" class="report">
        <div class="report__title">识别结果</div>
        <div class="report__row" :class="report.question.ok ? 'ok' : 'bad'">
          <span>{{ report.question.ok ? '✅' : '⚠️' }}</span>
          <span>题号：{{ report.question.ok ? report.question.sample : '未识别' }}</span>
        </div>
        <div class="report__row" :class="report.option.ok ? 'ok' : 'bad'">
          <span>{{ report.option.ok ? '✅' : '⚠️' }}</span>
          <span>选项：{{ report.option.ok ? report.option.keys.join(' ') + ' 共 ' + report.option.keys.length + ' 项' : '未识别' }}</span>
        </div>
        <div class="report__row" :class="report.answer.ok ? 'ok' : 'bad'">
          <span>{{ report.answer.ok ? '✅' : '⚠️' }}</span>
          <span>答案：{{ report.answer.ok ? report.answer.sample : '未识别' }}</span>
        </div>
        <div class="report__row" :class="report.analysis || report.point ? 'ok' : 'dim'">
          <span>{{ report.analysis || report.point ? '✅' : '➖' }}</span>
          <span>解析 / 考点：{{ report.analysis || report.point ? '已识别' : '样例未包含（可不填）' }}</span>
        </div>

        <div v-if="allOk" class="report__hint hint--ok">
          规则已就绪，上传文件时会按它识别题目。
        </div>
        <div v-else class="report__hint hint--warn">
          有项目没识别出来，多半是样例不完整。可以补全样例再试，或展开下方「高级」手动设置。
        </div>
      </div>

      <!-- 高级：默认折叠 -->
      <div class="adv" @click="showAdvanced = !showAdvanced">
        {{ showAdvanced ? '▾' : '▸' }} 高级：选模板 / 手动调整
      </div>

      <div v-if="showAdvanced" class="adv__body">
        <div class="field">
          <label class="label">常用模板（选一个即可）</label>
          <select
            class="mini"
            :value="rule.id"
            @change="applyPreset(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="p in RULE_PRESETS" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>

        <details class="hint">
          <summary>占位符说明</summary>
          <div v-for="[k, d] in HINTS" :key="k" class="hint__row">
            <code>{{ k }}</code>
            <span>{{ d }}</span>
          </div>
        </details>

        <div v-for="f in ADV_FIELDS" :key="f.key" class="field">
          <label class="label">{{ f.label }}</label>
          <input v-model="rule[f.key] as string" class="mini" :placeholder="f.placeholder" />
          <div v-if="f.sample" class="sample-inline">可匹配：<code>{{ f.sample(rule) }}</code></div>
        </div>

        <label class="check">
          <input v-model="rule.denoise" type="checkbox" />
          自动去除页码与页眉页脚
        </label>

        <div class="preview">
          <div class="preview__title">当前规则可匹配的完整题目</div>
          <pre class="preview__body">{{ fullSample }}</pre>
        </div>
      </div>

      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.head__title {
  font-size: var(--fs-aux);
  font-weight: 500;
}
.head__toggle {
  font-size: var(--fs-caption);
  color: var(--color-primary);
}
.body {
  margin-top: var(--sp-3);
  border-top: 1px solid var(--border-color);
  padding-top: var(--sp-3);
}
.step {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-aux);
  font-weight: 500;
  margin-bottom: var(--sp-2);
}
.step__num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-primary);
  color: #fff;
  font-size: 11px;
  flex-shrink: 0;
}
.ta {
  width: 100%;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  padding: var(--sp-2);
  font-size: var(--fs-caption);
  line-height: 1.6;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: inherit;
  resize: vertical;
}
.primary {
  width: 100%;
  height: var(--btn-h);
  margin-top: var(--sp-2);
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: #fff;
  font-size: var(--fs-body);
}
.primary:disabled {
  background: var(--text-tertiary);
}
.report {
  margin-top: var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: var(--sp-3);
  background: var(--bg-secondary);
}
.report__title {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.report__row {
  display: flex;
  gap: var(--sp-2);
  font-size: var(--fs-caption);
  line-height: 1.9;
}
.report__row.ok {
  color: var(--color-success);
}
.report__row.bad {
  color: var(--color-warning);
}
.report__row.dim {
  color: var(--text-tertiary);
}
.report__hint {
  margin-top: var(--sp-2);
  padding-top: var(--sp-2);
  border-top: 1px dashed var(--border-color);
  font-size: var(--fs-caption);
  line-height: 1.6;
}
.hint--ok {
  color: var(--color-success);
}
.hint--warn {
  color: var(--color-warning);
}
.adv {
  margin-top: var(--sp-3);
  font-size: var(--fs-caption);
  color: var(--color-primary);
}
.adv__body {
  margin-top: var(--sp-2);
  padding-top: var(--sp-2);
  border-top: 1px solid var(--border-color);
}
.field {
  margin-bottom: var(--sp-2);
}
.label {
  display: block;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.mini {
  width: 100%;
  height: 34px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  padding: 0 var(--sp-2);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
.sample-inline {
  margin-top: 4px;
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
}
.sample-inline code {
  color: var(--color-primary);
  font-size: 11px;
}
.hint {
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  padding: var(--sp-2) var(--sp-3);
  margin-bottom: var(--sp-3);
  font-size: var(--fs-caption);
}
.hint summary {
  cursor: pointer;
  color: var(--text-secondary);
}
.hint__row {
  display: flex;
  gap: var(--sp-2);
  line-height: 1.9;
  margin-top: 4px;
}
.hint__row code {
  background: var(--bg-tertiary);
  padding: 0 4px;
  border-radius: 3px;
  min-width: 34px;
  text-align: center;
}
.check {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.preview {
  margin-top: var(--sp-3);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-secondary);
}
.preview__title {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  margin-bottom: var(--sp-1);
}
.preview__body {
  margin: 0;
  font-size: 11px;
  line-height: 1.9;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: inherit;
  color: var(--text-primary);
}
</style>
