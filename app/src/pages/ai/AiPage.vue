<script setup lang="ts">
/**
 * AI 私教对话页（A4）—— 纯 BYOK
 *
 * 架构前提：本 App 无服务端。所有 AI 请求由浏览器直连用户自己选择的服务商，
 * 我们不中转、不代理、不经手任何请求或数据。
 *
 * 因此本页只有两种状态：
 *   - 已配置 Key → 正常对话
 *   - 未配置     → 顶部状态条提示「未配置」，发送时引导去设置页
 *
 * 注意：这里**没有**"剩余次数"概念。BYOK 下次数由用户自己的服务商账号决定，
 * 我们无从知晓也不该假装知道。
 */
import { computed, nextTick, ref, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { getServices } from '@/services'
import { describeAiError } from '@/domain/services/aiService'
import { isConfigured, currentProviderLabel } from '@/infrastructure/ai/aiClient'

interface Msg {
  role: 'user' | 'ai'
  text: string
  streaming?: boolean
}

const router = useRouter()

const messages = ref<Msg[]>([
  {
    role: 'ai',
    text:
      '你好，我是你的 AI 私教，可以问我任何考点，比如「用大白话解释挤出效应」。' +
      '\n\n（想让我批量出题并入库？请到「题库 → 导入 → AI 生成」）',
  },
])
const input = ref('')
const thinking = ref(false)
const listEl = ref<HTMLElement | null>(null)

// 只放「问答类」快捷问题；出题走导入页，避免用户以为这里能直接生成题目
const QUICK = ['帮我区分财政政策和货币政策', '用大白话解释挤出效应', '编个口诀记住反倾销措施']

/** 已配置才可用 —— 未配置时不是"出错"，只是这个可选功能没开启 */
const usable = computed(() => isConfigured())
const channelName = computed(() => currentProviderLabel())

async function send(text?: string) {
  const content = (text ?? input.value).trim()
  if (!content || thinking.value) return

  // 未配置 → 引导去设置，而不是让用户对着报错发呆
  if (!usable.value) {
    showToast('AI 是可选功能，配置 Key 后即可使用')
    void router.push('/ai/settings')
    return
  }

  messages.value.push({ role: 'user', text: content })
  input.value = ''
  thinking.value = true
  await scroll()

  // 先占位再流式填充，让用户立刻看到反馈
  const placeholder: Msg = { role: 'ai', text: '', streaming: true }
  messages.value.push(placeholder)

  try {
    const { ai } = getServices()
    await ai.chat([{ role: 'user', content }], undefined, (delta) => {
      placeholder.text += delta
      void scroll()
    })
    placeholder.streaming = false
    if (!placeholder.text) placeholder.text = '（模型没有返回内容，请重试）'
  } catch (err) {
    // 失败时移除空气泡，换成可读文案
    messages.value.pop()
    messages.value.push({ role: 'ai', text: describeAiError(err) })
    showToast('发送失败')
  } finally {
    thinking.value = false
    await scroll()
  }
}

async function scroll() {
  await nextTick()
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
}

function openSettings() {
  void router.push('/ai/settings')
}

/** 未配置用户看示例，判断值不值得去配 Key */
function openSample() {
  void router.push('/ai/sample')
}

/**
 * 从设置页返回本页时，useActivated 会触发一次重渲染，
 * 使 computed 重新读取 localStorage 中的配置状态。
 * （配置存在 localStorage，不是响应式对象，必须主动触发一次更新）
 */
const reviveKey = ref(0)
onActivated(() => {
  reviveKey.value++
})
</script>

<template>
  <div class="page ai">
    <header class="ai__bar">
      <h1 class="h1">AI 私教</h1>
      <button class="ai__set" @click="openSettings">设置</button>
    </header>

    <!-- 通道状态条：让用户随时知道 AI 是否已就绪 -->
    <div class="status" :class="{ 'status--off': !usable }" :data-revive="reviveKey">
      <div class="status__left">
        <span class="dot" :class="usable ? 'dot--ok' : 'dot--off'" />
        <span class="status__name">
          <template v-if="usable">{{ channelName }}</template>
          <template v-else>未配置 · AI 为可选功能</template>
        </span>
      </div>
      <button class="status__right" @click="openSettings">
        {{ usable ? '已配置' : '去配置' }}
      </button>
    </div>

    <!-- 未配置时的引导：先让用户看见「配了能换来什么」，再谈配置 -->
    <button v-if="!usable" class="preview" @click="openSample">
      <span class="preview__t">AI 到底能帮我做什么？</span>
      <span class="preview__s">看几道真实考点的示例解析 ›</span>
    </button>

    <div ref="listEl" class="chat">
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="`msg--${m.role}`">
        <div class="bubble" :class="{ 'bubble--streaming': m.streaming }">
          {{ m.text || (m.streaming ? '思考中…' : '') }}
        </div>
      </div>
      <div v-if="thinking && !messages[messages.length - 1]?.streaming" class="msg msg--ai">
        <div class="bubble bubble--thinking">思考中…</div>
      </div>
    </div>

    <div class="quick">
      <button v-for="q in QUICK" :key="q" class="chip" @click="send(q)">{{ q }}</button>
    </div>

    <div class="composer">
      <input
        v-model="input"
        class="input input--flex"
        placeholder="问点什么…"
        @keyup.enter="send()"
      />
      <button class="send" :disabled="!input.trim() || thinking" @click="send()">发送</button>
    </div>
  </div>
</template>

<style scoped>
.ai {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: calc(var(--safe-top) + var(--sp-4)) var(--sp-4)
    calc(var(--tabbar-h) + var(--safe-bottom) + var(--sp-4));
  background: var(--bg-secondary);
}
.ai__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.h1 {
  font-size: 22px;
  font-weight: 600;
}
.ai__set {
  background: none;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  padding: 0 12px;
  font-size: var(--fs-aux);
  color: var(--text-secondary);
  min-height: 32px;
}

/* 通道状态条 */
.status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-primary);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
}
.status--off {
  border-color: var(--border-strong);
}
.status__left {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
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
.status__name {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status__right {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: var(--fs-caption);
  padding: var(--sp-1) 0 var(--sp-1) var(--sp-2);
  min-height: 28px;
}

/* 未配置引导卡 */
.preview {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  margin-top: var(--sp-2);
  padding: var(--sp-3);
  background: var(--color-primary-light);
  border: none;
  border-radius: var(--radius-sm);
  text-align: left;
  width: 100%;
  min-height: var(--tap-min);
}
.preview__t {
  font-size: var(--fs-aux);
  font-weight: 500;
  color: var(--color-primary);
}
.preview__s {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}

.chat {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-3) 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.msg {
  display: flex;
}
.msg--user {
  justify-content: flex-end;
}
.bubble {
  max-width: 82%;
  padding: var(--sp-3);
  border-radius: var(--radius-md);
  font-size: var(--fs-body);
  line-height: 1.7;
  white-space: pre-wrap;
  background: var(--bg-primary);
  color: var(--text-primary);
}
.msg--user .bubble {
  background: var(--color-primary);
  color: #fff;
}
.bubble--thinking {
  color: var(--text-tertiary);
}
.bubble--streaming::after {
  content: '';
  display: inline-block;
  width: 6px;
  height: 14px;
  margin-left: 2px;
  vertical-align: -2px;
  background: var(--text-tertiary);
  animation: blink 1s step-end infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
.quick {
  display: flex;
  gap: var(--sp-2);
  overflow-x: auto;
  padding-bottom: var(--sp-2);
}
.chip {
  flex-shrink: 0;
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-secondary);
  border-radius: 16px;
  padding: 0 12px;
  font-size: var(--fs-caption);
  min-height: 32px;
}
.composer {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
}
.input {
  width: 100%;
  height: 44px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  padding: 0 var(--sp-3);
  font-size: var(--fs-body);
  background: var(--bg-primary);
  color: var(--text-primary);
}
.input--flex {
  flex: 1;
}
.send {
  height: 44px;
  padding: 0 var(--sp-4);
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--fs-body);
}
.send:disabled {
  background: var(--text-tertiary);
}
</style>
