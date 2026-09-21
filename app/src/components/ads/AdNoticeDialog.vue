<script setup lang="ts">
/**
 * 首次启动的广告告知（PRD M9-F11，合规必需）
 *
 * ══════════════════════════════════════════════════════════════
 *  PRD 原文：这段文案本身就是一次品牌建设 ——
 *  把商业模式坦诚地讲清楚，比藏着掖着更能赢得理解。
 *  备考用户是成年人，他们理解「免费的东西需要有人付钱」。
 * ══════════════════════════════════════════════════════════════
 *
 * 三条纪律：
 *   ① 只展示一次（用户点了「我知道了」就不再出现）
 *   ② 必须在**隐私政策同意之后**才展示（广告 SDK 的合规前提）
 *   ③ 文案不得夸大也不得隐瞒 —— 说清「有多少、在哪出现、不碰什么数据」
 */
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { hasConsented } from '@/domain/privacy/consent'

const LS_AD_NOTICE = 'jingshi.ad_notice_seen'

const router = useRouter()
const visible = ref(false)

onMounted(() => {
  // ⚠️ 前置条件：用户必须先同意隐私政策。
  //    没同意就告诉人家"我们会展示广告"是本末倒置 ——
  //    同意页已经把这件事讲清楚了，这里只是补充说明。
  if (!hasConsented()) return

  try {
    if (localStorage.getItem(LS_AD_NOTICE) !== '1') visible.value = true
  } catch {
    /* 读不到就不展示，宁可不提示也不打扰 */
  }
})

function dismiss(): void {
  visible.value = false
  try {
    localStorage.setItem(LS_AD_NOTICE, '1')
  } catch {
    /* noop */
  }
}

function goBuy(): void {
  dismiss()
  router.push('/mine/remove-ads')
}
</script>

<template>
  <Transition name="noticeFade">
    <div v-if="visible" class="notice-mask">
      <div class="notice">
        <div class="notice__title">这个 App 是免费的</div>
        <div class="notice__body">
          <p>我们会展示<strong>少量广告</strong>来支付开发与维护成本。</p>
          <p>
            广告只出现在你<strong>完成学习任务之后</strong>和<strong>打开 App 时</strong>，
            <strong>永远不会打断你的学习过程</strong>。
          </p>
          <p>我们<strong>不会</strong>把你的学习数据分享给广告商。</p>
          <p class="notice__last">
            如果你喜欢纯净的体验，可以花 ¥68 永久关闭全部广告。
          </p>
        </div>
        <button class="notice__ok" @click="dismiss">我知道了</button>
        <button class="notice__buy" @click="goBuy">看看去广告</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.notice-mask {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.notice {
  background: var(--c-surface, #fff);
  border-radius: 16px;
  padding: 22px 20px 16px;
  width: 100%;
  max-width: 340px;
}

.notice__title {
  font-size: 17px;
  font-weight: 600;
  color: var(--c-text-1, #1a1a1a);
  text-align: center;
}

.notice__body {
  margin-top: 14px;
  font-size: 13px;
  line-height: 1.75;
  color: var(--c-text-2, #646566);
}

.notice__body p {
  margin: 0 0 10px;
}

.notice__last {
  margin-bottom: 0 !important;
}

.notice__body strong {
  color: var(--c-text-1, #1a1a1a);
  font-weight: 600;
}

.notice__ok {
  width: 100%;
  margin-top: 18px;
  border: none;
  border-radius: 10px;
  background: var(--c-primary, #2b5ce6);
  color: #fff;
  font-size: 15px;
  padding: 12px;
  cursor: pointer;
}

.notice__buy {
  width: 100%;
  margin-top: 8px;
  border: none;
  background: none;
  color: var(--c-text-3, #969799);
  font-size: 13px;
  padding: 8px;
  cursor: pointer;
}

.noticeFade-enter-active,
.noticeFade-leave-active {
  transition: opacity 0.22s ease;
}

.noticeFade-enter-from,
.noticeFade-leave-to {
  opacity: 0;
}
</style>
