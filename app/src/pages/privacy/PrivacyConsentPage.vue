<script setup lang="ts">
/**
 * 隐私政策同意页（首次启动的强制闸门）
 *
 * ══════════════════════════════════════════════════════════════
 *  合规要点（这些不是 UI 偏好，是审核硬要求）：
 *    ① **必须由用户主动点击**才视为同意 —— 不做默认勾选、不做「继续即同意」的暗示
 *    ② 同意前**不得初始化任何第三方 SDK**（广告 SDK 尤其敏感）
 *    ③ 必须提供**查看完整政策**的入口，且政策内容可读
 *    ④ 「不同意」必须是**真实可选**的，不能只留一个按钮逼用户同意
 * ══════════════════════════════════════════════════════════════
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { acceptConsent } from '@/domain/privacy/consent'
import { CONSENT_SUMMARY, PRIVACY_VERSION } from '@/domain/privacy/policy'

const router = useRouter()
const showFull = ref(false)
const declined = ref(false)

function agree(): void {
  acceptConsent()
  // 同意成功后进入正常流程（路由守卫会接管到 onboarding 或首页）
  router.replace('/study')
}

function decline(): void {
  declined.value = true
}
</script>

<template>
  <div class="page--no-tab consent">
    <!-- 不同意时的说明态：给出真实出路，不是死胡同 -->
    <div v-if="declined" class="declined">
      <div class="declined__icon">🔒</div>
      <h2 class="declined__title">我们理解你的顾虑</h2>
      <p class="declined__text">
        这个 App 需要在本机保存你的学习数据才能工作。如果你不同意，
        我们无法为你提供任何功能 —— 因为没有本地存储，就没有学习记录、错题本和计划。
      </p>
      <p class="declined__text">
        你可以随时关闭 App。如果你改变主意，下次打开时会再次看到这个页面。
      </p>
      <button class="btn btn--primary" @click="declined = false">返回看看</button>
    </div>

    <template v-else>
      <div class="head">
        <div class="head__badge">纯本地 · 无账号 · 无云端</div>
        <h1 class="head__title">开始之前，先说清楚一件事</h1>
        <p class="head__sub">这个 App 怎么处理你的数据，一页讲完。</p>
      </div>

      <!-- 摘要：用户 10 秒能读完 -->
      <ul class="summary">
        <li v-for="(s, i) in CONSENT_SUMMARY" :key="i" class="summary__item">
          <span class="summary__dot">✓</span>
          <span>{{ s }}</span>
        </li>
      </ul>

      <!-- 完整政策（可折叠，但内容必须可得） -->
      <div class="policy">
        <button class="policy__toggle" @click="showFull = !showFull">
          {{ showFull ? '收起完整政策' : '查看完整隐私政策' }}
          <span class="policy__arrow" :class="{ 'policy__arrow--up': showFull }">›</span>
        </button>

        <div v-if="showFull" class="policy__body">
          <p class="policy__ver">版本 {{ PRIVACY_VERSION }}</p>
          <p class="policy__p">
            本应用不收集任何个人信息。你的全部学习数据仅保存在本机。
          </p>
          <p class="policy__p">
            完整政策全文可在同意后随时通过「我的 → 隐私政策」查看。
            其中包含广告与第三方 SDK 的数据边界说明。
          </p>
          <router-link class="policy__link" to="/privacy">打开完整政策 →</router-link>
        </div>
      </div>

      <!-- 明确的操作区：两个按钮，都是真实可选 -->
      <div class="actions">
        <button class="btn btn--primary" @click="agree">我已阅读并同意</button>
        <button class="btn btn--ghost" @click="decline">不同意</button>
      </div>

      <p class="foot">
        点击「我已阅读并同意」即表示你接受本政策。我们不会因为你同意就开始收集数据 ——
        因为我们本来就不收集。
      </p>
    </template>
  </div>
</template>

<style scoped>
.consent {
  padding: calc(var(--safe-top) + var(--sp-6)) var(--sp-5) calc(var(--safe-bottom) + var(--sp-5));
  min-height: 100%;
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
}

.head__badge {
  display: inline-block;
  font-size: var(--fs-caption);
  color: var(--color-primary);
  background: var(--color-primary-light);
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  margin-bottom: var(--sp-3);
}

.head__title {
  font-size: var(--fs-title);
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
}

.head__sub {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
  margin-top: var(--sp-2);
}

.summary {
  list-style: none;
  padding: var(--sp-4);
  margin: var(--sp-5) 0 0;
  background: var(--bg-primary);
  border-radius: var(--radius-md);
}

.summary__item {
  display: flex;
  gap: var(--sp-2);
  align-items: flex-start;
  padding: var(--sp-2) 0;
  font-size: var(--fs-body);
  color: var(--text-primary);
  line-height: 1.6;
}

.summary__dot {
  color: var(--color-primary);
  font-weight: 600;
  flex-shrink: 0;
}

.policy {
  margin-top: var(--sp-3);
  background: var(--bg-primary);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.policy__toggle {
  width: 100%;
  min-height: var(--tap-min);
  padding: var(--sp-3) var(--sp-4);
  background: transparent;
  border: none;
  color: var(--color-primary);
  font-size: var(--fs-body);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.policy__arrow {
  transition: transform 0.2s;
  font-size: 20px;
  line-height: 1;
}

.policy__arrow--up {
  transform: rotate(90deg);
}

.policy__body {
  padding: 0 var(--sp-4) var(--sp-4);
}

.policy__ver {
  font-size: var(--fs-caption);
  color: var(--text-tertiary, var(--text-secondary));
  margin-bottom: var(--sp-2);
}

.policy__p {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: var(--sp-2);
}

.policy__link {
  font-size: var(--fs-aux);
  color: var(--color-primary);
  text-decoration: none;
}

.actions {
  margin-top: auto;
  padding-top: var(--sp-6);
}

.btn {
  width: 100%;
  height: var(--btn-h);
  border-radius: var(--radius-md);
  font-size: var(--fs-body);
  border: none;
}

.btn--primary {
  background: var(--color-primary);
  color: #fff;
}

.btn--ghost {
  margin-top: var(--sp-3);
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-strong);
}

.foot {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.6;
  margin-top: var(--sp-4);
  text-align: center;
}

/* ---- 不同意态 ---- */
.declined {
  margin: auto 0;
  text-align: center;
}

.declined__icon {
  font-size: 40px;
}

.declined__title {
  font-size: var(--fs-title);
  font-weight: 600;
  color: var(--text-primary);
  margin: var(--sp-4) 0 var(--sp-3);
}

.declined__text {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
  line-height: 1.7;
  text-align: left;
  margin-bottom: var(--sp-3);
}

.declined .btn--primary {
  margin-top: var(--sp-5);
}
</style>
