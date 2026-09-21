<script setup lang="ts">
/**
 * AI 服务设置（BYOK）
 *
 * 架构前提（2026-09-20 修订）：本 App **不含任何服务端**，AI 请求由设备
 * 直连用户自己选择的第三方服务商。因此设置页只做一件事：帮用户把 Key 配对。
 *
 * 设计纪律：
 *   1. **必须明示「AI 是可选增强」** —— 我们不提供免费额度，就要诚实告知
 *      不配置也不影响任何学习功能，否则用户会产生"功能缺失"的误解
 *   2. **必须降低「Key 是什么」的认知门槛** —— 提供图文教程与一键跳转控制台
 *   3. 不写"免费"二字误导 —— BYOK 的真实成本由用户向服务商支付，要说清楚
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast, showConfirmDialog } from 'vant'
import {
  rankProviders,
  compositeScore,
  getProvider,
  getProviderByBaseUrl,
  defaultProvider,
  DISCLAIMER_BYOK,
  AI_IS_OPTIONAL_NOTICE,
} from '@/domain/ai/providers'
import {
  loadByokConfig,
  saveByokConfig,
  clearByokConfig,
  isConfigured,
  testConnection as testAiConnection,
} from '@/infrastructure/ai/aiClient'

const router = useRouter()

const initial = loadByokConfig()
const current = defaultProvider()

const baseUrl = ref(initial?.baseUrl ?? current.baseUrl)
const model = ref(initial?.model ?? current.defaultModel)
const apiKey = ref(initial?.apiKey ?? '')
const showKey = ref(false)
const testing = ref(false)
const configured = ref(isConfigured())
const expandedProvider = ref<string | null>(null)

/** 按客观综合分排序（无任何商业加权） */
const ranked = computed(() => rankProviders())

/** 当前选中的服务商（用于展示教程跳转） */
const selectedProvider = computed(() => getProviderByBaseUrl(baseUrl.value))

function pickProvider(id: string) {
  const p = getProvider(id)
  if (!p) return
  baseUrl.value = p.baseUrl
  model.value = p.defaultModel
}

function toggleDetail(id: string) {
  expandedProvider.value = expandedProvider.value === id ? null : id
}

function scoreBreakdown(id: string) {
  const p = getProvider(id)
  if (!p) return []
  return [
    { label: '中文能力', value: p.score.chinese },
    { label: '成本优势', value: p.score.cost },
    { label: '稳定性', value: p.score.stability },
  ]
}

/* ---------------- 保存与测试 ---------------- */

async function save() {
  const key = apiKey.value.trim()
  if (!key) {
    showToast('请先填入 API Key')
    return
  }
  if (!model.value.trim()) {
    showToast('请填写模型名')
    return
  }
  saveByokConfig({ apiKey: key, baseUrl: baseUrl.value, model: model.value.trim() })
  configured.value = true
  showToast('已保存，Key 仅存在本机')
}

async function test() {
  const key = apiKey.value.trim()
  if (!key) {
    showToast('请先填入 API Key')
    return
  }
  // 先临时写入再测试，测试完保留（用户点保存才算正式启用）
  saveByokConfig({ apiKey: key, baseUrl: baseUrl.value, model: model.value.trim() })
  testing.value = true
  try {
    const r = await testAiConnection()
    showToast(r.message)
    if (r.ok) configured.value = true
  } finally {
    testing.value = false
  }
}

async function clear() {
  try {
    await showConfirmDialog({
      title: '清除已保存的 Key？',
      message: '清除后 AI 功能将不可用（但刷题、错题本、记忆曲线等学习功能不受影响）。',
    })
    clearByokConfig()
    apiKey.value = ''
    configured.value = false
    showToast('已清除')
  } catch {
    /* 取消 */
  }
}

function goTutorial() {
  void router.push('/ai/tutorial')
}

function goSample() {
  void router.push('/ai/sample')
}

function openConsole() {
  const url = selectedProvider.value?.consoleUrl
  if (!url) {
    showToast('请到服务商官网申请 Key')
    return
  }
  window.open(url, '_blank', 'noopener')
}
</script>

<template>
  <div class="page page--no-tab settings">
    <header class="bar">
      <button class="back" @click="router.back()">返回</button>
      <h1 class="bar__title">AI 服务设置</h1>
      <span class="bar__spacer" />
    </header>

    <!-- 「可选增强」明示：不可省略，这是产品诚实性的一部分 -->
    <div class="notice">
      <div class="notice__t">AI 是可选增强功能</div>
      <div class="notice__d">{{ AI_IS_OPTIONAL_NOTICE }}</div>
      <button class="notice__link" @click="goSample">先看看 AI 能帮我做什么 ›</button>
    </div>

    <!-- 状态条 -->
    <div class="status" :class="configured ? 'status--ok' : ''">
      <span class="dot" :class="configured ? 'dot--ok' : 'dot--off'" />
      <span class="status__text">
        {{ configured ? `已配置 · ${selectedProvider?.name ?? '自定义服务商'}` : '尚未配置' }}
      </span>
    </div>

    <!-- 服务商选择 -->
    <section class="card block">
      <div class="block__title">第一步 · 选服务商</div>
      <div class="block__sub">点击选择，会自动填好它的接口地址与推荐模型</div>

      <div class="pick__list">
        <button
          v-for="p in ranked"
          :key="p.id"
          class="prov"
          :class="{ 'prov--sel': baseUrl === p.baseUrl }"
          @click="pickProvider(p.id)"
        >
          <div class="prov__row">
            <span class="prov__name">{{ p.name }}</span>
            <span class="prov__score">{{ compositeScore(p) }}</span>
          </div>
          <div class="prov__tags">
            <span v-for="t in p.tags" :key="t" class="chip">{{ t }}</span>
          </div>
          <div class="prov__advice">{{ p.advice }}</div>
          <span class="prov__info" @click.stop="toggleDetail(p.id)">
            {{ expandedProvider === p.id ? '收起' : '为什么推荐它' }}
          </span>
          <div v-if="expandedProvider === p.id" class="prov__detail">
            <div v-for="s in scoreBreakdown(p.id)" :key="s.label" class="prov__score-row">
              <span>{{ s.label }}</span>
              <span class="prov__score-val">{{ s.value }}</span>
            </div>
            <div class="text-caption">
              综合分 = 中文能力×40% + 成本×30% + 稳定性×30%（客观实测，无任何商业加权）
            </div>
          </div>
        </button>
      </div>
    </section>

    <!-- Key 配置 -->
    <section class="card block">
      <div class="block__title">第二步 · 填 API Key</div>

      <button class="tutorial-entry" @click="goTutorial">
        <span>不知道怎么申请 Key？看图文教程</span>
        <span class="tutorial-entry__arrow">›</span>
      </button>

      <button v-if="selectedProvider" class="console-entry" @click="openConsole">
        打开 {{ selectedProvider.name }} 的 Key 管理页 ↗
      </button>

      <label class="field">
        <span class="field__label">API Key</span>
        <div class="key-wrap">
          <input
            v-model="apiKey"
            class="input"
            :type="showKey ? 'text' : 'password'"
            placeholder="粘贴服务商后台的 API Key"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
          <button class="key-eye" @click="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</button>
        </div>
      </label>

      <label class="field">
        <span class="field__label">模型</span>
        <input v-model="model" class="input" placeholder="如 deepseek-chat" autocomplete="off" />
      </label>

      <div class="actions">
        <button class="btn btn--ghost" :disabled="testing" @click="test">
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
        <button class="btn btn--primary" @click="save">保存并启用</button>
      </div>

      <button v-if="configured" class="link-danger" @click="clear">清除已保存的 Key</button>
    </section>

    <!-- 成本说明：BYOK 的钱是付给服务商的，必须说清楚 -->
    <section class="card block">
      <div class="block__title">关于费用</div>
      <div class="cost">
        <div class="cost__row">
          <span>本 App</span>
          <strong>不收费</strong>
        </div>
        <div class="cost__row">
          <span>AI 调用</span>
          <span>由你直接向服务商支付</span>
        </div>
        <div class="cost__note">
          备考场景的调用量很小（每次解析约几分钱），多数服务商都有新用户赠送额度，
          日常使用通常花不到几块钱。费用明细请见服务商后台。
        </div>
      </div>
    </section>

    <p class="disclaimer">{{ DISCLAIMER_BYOK }}</p>
  </div>
</template>

<style scoped>
.settings {
  padding: var(--sp-4);
  padding-top: calc(var(--safe-top) + var(--sp-4));
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.bar__title {
  font-size: var(--fs-title);
  font-weight: 600;
}
.bar__spacer,
.back {
  min-width: 56px;
}
.back {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: var(--fs-aux);
  text-align: left;
  padding: 0;
  min-height: var(--tap-min);
}

/* 「可选增强」明示块 */
.notice {
  background: var(--color-primary-light);
  border-radius: var(--radius-md);
  padding: var(--sp-3);
}
.notice__t {
  font-size: var(--fs-aux);
  font-weight: 500;
  color: var(--color-primary);
  margin-bottom: var(--sp-1);
}
.notice__d {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.6;
}
.notice__link {
  margin-top: var(--sp-2);
  background: none;
  border: none;
  padding: 0;
  color: var(--color-primary);
  font-size: var(--fs-caption);
  min-height: 28px;
}

.status {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-primary);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
}
.status--ok {
  border-color: var(--color-success);
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot--ok {
  background: var(--color-success);
}
.dot--off {
  background: var(--text-tertiary);
}
.status__text {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  border: 1px solid var(--border-color);
}
.block__title {
  font-size: var(--fs-aux);
  font-weight: 500;
}
.block__sub {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  margin-top: calc(var(--sp-1) * -1);
}

/* 教程入口 */
.tutorial-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--sp-3);
  background: var(--bg-secondary);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-primary);
  font-size: var(--fs-aux);
  text-align: left;
  min-height: var(--tap-min);
}
.tutorial-entry__arrow {
  font-size: 18px;
  color: var(--text-tertiary);
}
.console-entry {
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  background: none;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--fs-caption);
  min-height: var(--tap-min);
}

/* 服务商 */
.pick__list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.prov {
  text-align: left;
  width: 100%;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  border-radius: var(--radius-sm);
  padding: var(--sp-3);
  color: var(--text-primary);
  min-height: var(--tap-min);
}
.prov--sel {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}
.prov__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.prov__name {
  font-size: var(--fs-body);
  font-weight: 500;
}
.prov__score {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
}
.prov--sel .prov__score {
  color: var(--color-primary);
}
.prov__tags {
  display: flex;
  gap: var(--sp-1);
  margin: var(--sp-2) 0;
}
.chip {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}
.prov--sel .chip {
  background: var(--bg-primary);
}
.prov__advice {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.5;
}
.prov__info {
  display: inline-block;
  margin-top: var(--sp-2);
  font-size: var(--fs-caption);
  color: var(--color-primary);
}
.prov__detail {
  margin-top: var(--sp-2);
  padding-top: var(--sp-2);
  border-top: 1px solid var(--border-color);
}
.prov__score-row {
  display: flex;
  justify-content: space-between;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  padding: 2px 0;
}
.prov__score-val {
  color: var(--text-primary);
}

/* 表单 */
.field {
  display: block;
}
.field__label {
  display: block;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  margin-bottom: var(--sp-1);
}
.input {
  width: 100%;
  height: var(--tap-min);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  padding: 0 var(--sp-3);
  font-size: var(--fs-aux);
  background: var(--bg-primary);
  color: var(--text-primary);
}
.key-wrap {
  position: relative;
}
.key-eye {
  position: absolute;
  right: var(--sp-1);
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: var(--fs-caption);
  padding: var(--sp-2) var(--sp-3);
  min-height: var(--tap-min);
}
.actions {
  display: flex;
  gap: var(--sp-2);
}
.btn {
  flex: 1;
  height: var(--btn-h);
  border-radius: var(--radius-md);
  font-size: var(--fs-body);
  border: none;
}
.btn--primary {
  background: var(--color-primary);
  color: #fff;
}
.btn--primary:disabled,
.btn--ghost:disabled {
  opacity: 0.6;
}
.btn--ghost {
  background: var(--bg-primary);
  border: 1px solid var(--border-strong);
  color: var(--text-primary);
}
.link-danger {
  background: none;
  border: none;
  color: var(--color-danger);
  font-size: var(--fs-caption);
  padding: var(--sp-2) 0;
  text-align: left;
}

/* 费用说明 */
.cost__row {
  display: flex;
  justify-content: space-between;
  font-size: var(--fs-aux);
  color: var(--text-secondary);
  padding: var(--sp-2) 0;
  border-bottom: 1px solid var(--border-color);
}
.cost__row:last-of-type {
  border-bottom: none;
}
.cost__note {
  margin-top: var(--sp-2);
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  line-height: 1.7;
}

.disclaimer {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.6;
}
</style>
