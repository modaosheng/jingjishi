<script setup lang="ts">
/**
 * 隐私政策全文页（只读）
 *
 * 入口：① 同意页的「打开完整政策」；② 「我的 → 隐私政策」
 *
 * ⚠️ 全文必须**随时可访问**（合规要求）。同意后也不能藏起来。
 */
import { useRouter } from 'vue-router'
import { PRIVACY_SECTIONS, PRIVACY_VERSION } from '@/domain/privacy/policy'

const router = useRouter()

function back(): void {
  if (window.history.length > 1) router.back()
  else router.replace('/mine')
}
</script>

<template>
  <div class="page--no-tab policy">
    <header class="bar">
      <button class="bar__back" @click="back">返回</button>
      <h1 class="bar__title">隐私政策</h1>
      <span class="bar__spacer" />
    </header>

    <div class="meta">版本 {{ PRIVACY_VERSION }}</div>

    <section v-for="(sec, i) in PRIVACY_SECTIONS" :key="i" class="sec">
      <h2 class="sec__title">{{ sec.title }}</h2>

      <p v-for="(p, j) in sec.paragraphs ?? []" :key="`p${j}`" class="sec__p">{{ p }}</p>

      <ul v-if="sec.bullets?.length" class="sec__list">
        <li v-for="(b, k) in sec.bullets" :key="`b${k}`" class="sec__li">{{ b }}</li>
      </ul>

      <div v-if="sec.highlight" class="sec__hl">{{ sec.highlight }}</div>
    </section>

    <div class="end">以上即为本政策的全部内容。</div>
  </div>
</template>

<style scoped>
.policy {
  padding: calc(var(--safe-top) + var(--sp-3)) var(--sp-5) calc(var(--safe-bottom) + var(--sp-8));
  min-height: 100%;
  background: var(--bg-secondary);
}

.bar {
  display: flex;
  align-items: center;
  margin-bottom: var(--sp-4);
}

.bar__title {
  flex: 1;
  text-align: center;
  font-size: var(--fs-title);
  font-weight: 600;
  color: var(--text-primary);
}

.bar__back,
.bar__spacer {
  width: 56px;
}

.bar__back {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: var(--fs-body);
  text-align: left;
  padding: 0;
}

.meta {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  margin-bottom: var(--sp-4);
}

.sec {
  background: var(--bg-primary);
  border-radius: var(--radius-md);
  padding: var(--sp-4);
  margin-bottom: var(--sp-3);
}

.sec__title {
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--sp-3);
}

.sec__p {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
  line-height: 1.75;
  margin-bottom: var(--sp-2);
}

.sec__list {
  padding-left: var(--sp-4);
  margin: var(--sp-2) 0;
}

.sec__li {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
  line-height: 1.75;
  margin-bottom: var(--sp-2);
}

.sec__hl {
  margin-top: var(--sp-3);
  padding: var(--sp-3);
  background: var(--color-primary-light);
  border-left: 3px solid var(--color-primary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-aux);
  color: var(--text-primary);
  line-height: 1.7;
}

.end {
  text-align: center;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  padding: var(--sp-5) 0;
}
</style>
