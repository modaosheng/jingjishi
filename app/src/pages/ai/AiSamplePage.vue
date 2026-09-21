<script setup lang="ts">
/**
 * AI 示例解析页（零网络请求）
 *
 * 产品逻辑：BYOK 下未配置 Key 的用户用不了 AI。若他看不到"配了能换来什么"，
 * 就没有任何理由去配置 —— 这个可选功能等于永久沉没。
 *
 * 所以本页承担一个明确的转化职责：
 *   拿真实考点做样例 → 让用户判断"这东西对我有用" → 才可能去配 Key。
 *
 * 纪律：内容全部本地预置，标注为示例，不给准确性背书。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { SAMPLE_GROUPS, SAMPLE_DISCLAIMER } from '@/domain/ai/samples'

const router = useRouter()

const activeGroup = ref<string>(SAMPLE_GROUPS[0]?.id ?? '')
const openTurn = ref<string | null>(null)

const groups = computed(() => SAMPLE_GROUPS)
const current = computed(() => SAMPLE_GROUPS.find((g) => g.id === activeGroup.value) ?? SAMPLE_GROUPS[0])

function turnKey(gi: number, ti: number) {
  return `${gi}-${ti}`
}

function toggleTurn(k: string) {
  openTurn.value = openTurn.value === k ? null : k
}

function goSettings() {
  void router.push('/ai/settings')
}

function goTutorial() {
  void router.push('/ai/tutorial')
}
</script>

<template>
  <div class="page page--no-tab sample">
    <header class="bar">
      <button class="back" @click="router.back()">返回</button>
      <h1 class="bar__title">AI 能帮你做什么</h1>
      <span class="bar__spacer" />
    </header>

    <!-- 必须醒目：这是示例，不是 AI 现场回答 -->
    <div class="notice">
      <div class="notice__t">这是本地预置的示例</div>
      <div class="notice__d">{{ SAMPLE_DISCLAIMER.replace(/\*\*/g, '') }}</div>
    </div>

    <!-- 分组切换 -->
    <div class="tabs">
      <button
        v-for="g in groups"
        :key="g.id"
        class="tab"
        :class="{ 'tab--on': g.id === activeGroup }"
        @click="activeGroup = g.id"
      >
        {{ g.title }}
      </button>
    </div>

    <div v-if="current" class="grp">
      <p class="grp__sub">{{ current.subtitle }}</p>

      <div class="turns">
        <div v-for="(t, ti) in current.turns" :key="ti" class="turn">
          <!-- 用户提问 -->
          <div class="ask">
            <span class="ask__tag">{{ t.tag }}</span>
            <div class="ask__q">{{ t.ask }}</div>
          </div>

          <!-- AI 作答（折叠，点开看全文） -->
          <button class="ans__toggle" @click="toggleTurn(turnKey(groups.indexOf(current), ti))">
            {{ openTurn === turnKey(groups.indexOf(current), ti) ? '收起解析' : '看 AI 会怎么答' }}
          </button>
          <div
            v-if="openTurn === turnKey(groups.indexOf(current), ti)"
            class="ans"
          >
            <div class="ans__label">AI 示例回答</div>
            <div class="ans__body">{{ t.answer }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 转化区 -->
    <section class="card block cta-block">
      <div class="cta-block__t">想让它回答你自己的问题？</div>
      <div class="cta-block__d">
        配置一个 API Key 就能启用。Key 存在你手机上，我们不收钱也不经手你的对话。
      </div>
      <div class="cta-block__btns">
        <button class="btn btn--ghost" @click="goTutorial">先看怎么申请 Key</button>
        <button class="btn btn--primary" @click="goSettings">去配置</button>
      </div>
    </section>

    <!-- 诚实声明：不配置也完全能备考 -->
    <p class="optional-note">
      AI 是可选增强。不配置 Key，刷题、错题本、记忆曲线、全真模考全部照常使用。
    </p>
  </div>
</template>

<style scoped>
.sample {
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

.notice {
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  padding: var(--sp-3);
}
.notice__t {
  font-size: var(--fs-aux);
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: var(--sp-1);
}
.notice__d {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  line-height: 1.7;
}

/* 分组 tab */
.tabs {
  display: flex;
  gap: var(--sp-2);
  overflow-x: auto;
  padding-bottom: var(--sp-1);
}
.tab {
  flex-shrink: 0;
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-secondary);
  border-radius: 16px;
  padding: 0 12px;
  font-size: var(--fs-caption);
  min-height: 32px;
  white-space: nowrap;
}
.tab--on {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.grp__sub {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  line-height: 1.6;
}

.turns {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.turn {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.ask {
  background: var(--color-primary);
  color: #fff;
  border-radius: var(--radius-md);
  padding: var(--sp-3);
  margin-left: auto;
  max-width: 88%;
}
.ask__tag {
  display: block;
  font-size: 11px;
  opacity: 0.75;
  margin-bottom: 2px;
}
.ask__q {
  font-size: var(--fs-aux);
  line-height: 1.6;
}

.ans__toggle {
  align-self: flex-start;
  background: none;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--color-primary);
  font-size: var(--fs-caption);
  padding: 0 var(--sp-3);
  min-height: 32px;
}
.ans {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--sp-3);
}
.ans__label {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: var(--sp-2);
}
.ans__body {
  font-size: var(--fs-aux);
  color: var(--text-primary);
  line-height: 1.8;
  white-space: pre-wrap;
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  border: 1px solid var(--border-color);
}
.cta-block__t {
  font-size: var(--fs-body);
  font-weight: 500;
}
.cta-block__d {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.7;
}
.cta-block__btns {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
}
.btn {
  flex: 1;
  height: var(--btn-h);
  border-radius: var(--radius-md);
  font-size: var(--fs-aux);
  border: none;
}
.btn--primary {
  background: var(--color-primary);
  color: #fff;
}
.btn--ghost {
  background: var(--bg-primary);
  border: 1px solid var(--border-strong);
  color: var(--text-primary);
}

.optional-note {
  margin: 0;
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  line-height: 1.7;
}
</style>
