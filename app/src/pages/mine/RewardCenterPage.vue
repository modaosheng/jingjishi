<script setup lang="ts">
/**
 * 奖励中心（PRD M9-F3 位置②）
 *
 * ══════════════════════════════════════════════════════════════
 *  产品定位：一个用户**完全主动进入**的页面，本质是「任务墙」。
 *
 *  三条设计纪律：
 *   ① 用户不来这里，就永远看不到任何东西 → 零打扰
 *   ② 奖励均为**便利性**（免广告天数），无一涉及学习结果（T3 铁律）
 *   ③ v1.5 起**不再包含任何 AI 额度类奖励**（无额度体系）
 * ══════════════════════════════════════════════════════════════
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AdSlotView from '@/components/ads/AdSlotView.vue'
import AdErrorBoundary from '@/components/ads/AdErrorBoundary.vue'
import { adFreeDaysLeft, grantAdFreeDays, isAdFree, loadAdFree } from '@/domain/ads/releaseEngine'
import { shouldShowAd } from '@/domain/ads/releaseEngine'

const router = useRouter()

/** toast 提示（轻量，不引入 vant 组件依赖） */
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2400)
}

/* ---------------- 状态 ---------------- */

const refreshKey = ref(0)

const purchased = computed(() => loadAdFree().purchased)
const freeDays = computed(() => {
  void refreshKey.value
  return adFreeDaysLeft()
})
const anyAdFree = computed(() => {
  void refreshKey.value
  return isAdFree()
})
/** 奖励中心广告位是否已释放 */
const adEligible = computed(() => {
  void refreshKey.value
  return shouldShowAd('reward_center')
})

/* ---------------- 任务定义（PRD M9-F3 位置② 任务墙） ---------------- */

interface Task {
  id: string
  icon: string
  title: string
  desc: string
  reward: string
  days: number
  /** 是否已完成（本期先做本地可判定的部分） */
  done: boolean
  /** 是否可领取 */
  claimable: boolean
}

const tasks = ref<Task[]>([
  {
    id: 'daily_all',
    icon: '📚',
    title: '完成今日全部任务包',
    desc: '把今天计划里的任务都做完',
    reward: '+1 天免广告',
    days: 1,
    done: false,
    claimable: true,
  },
  {
    id: 'streak_7',
    icon: '🔥',
    title: '连续打卡 7 天',
    desc: '坚持一周，养成习惯',
    reward: '+1 天免广告',
    days: 1,
    done: false,
    claimable: true,
  },
  {
    id: 'share',
    icon: '📤',
    title: '邀请同学（分享战绩图）',
    desc: '分享给一起备考的朋友',
    reward: '+30 天免广告',
    days: 30,
    done: false,
    claimable: true,
  },
  {
    id: 'feedback',
    icon: '💡',
    title: '帮助改进产品',
    desc: '开启匿名使用数据上报',
    reward: '+1 天免广告',
    days: 1,
    done: false,
    claimable: true,
  },
  {
    id: 'bug_report',
    icon: '🐞',
    title: '举报题库错误并被采纳',
    desc: '发现题目有问题就告诉我们',
    reward: '+7 天免广告',
    days: 7,
    done: false,
    claimable: true,
  },
])

function claim(task: Task): void {
  if (task.done) {
    showToast('该奖励已领取')
    return
  }
  grantAdFreeDays(task.days)
  task.done = true
  refreshKey.value++
  showToast(`已获得 ${task.days} 天免广告体验`)
}

/* ---------------- 广告位事件 ---------------- */

function onAdShown(): void {
  refreshKey.value++
}

/**
 * 「失败即赠送」：用户主动点击解锁但广告加载失败 →
 * 明确告知奖励照发，不惩罚用户（PRD M9-F11）
 */
function onAdGrant(): void {
  grantAdFreeDays(1)
  refreshKey.value++
  showToast('网络不太稳定，本次奖励直接发给你了')
}

function onAdClick(): void {
  showToast('广告已被点击（Mock）')
}

onMounted(() => {
  refreshKey.value++
})
</script>

<template>
  <div class="page page--no-tab reward-center">
    <header class="bar">
      <button class="back" @click="router.back()">返回</button>
      <h1 class="bar__title">奖励中心</h1>
      <span class="bar__spacer" />
    </header>

    <!-- 当前状态 -->
    <div class="card status">
      <div class="status__row">
        <span class="status__label">当前状态</span>
        <span class="status__value">
          <template v-if="purchased">已永久去广告</template>
          <template v-else-if="freeDays > 0">免广告体验中 · 剩余 {{ freeDays }} 天</template>
          <template v-else>免费版</template>
        </span>
      </div>
      <button v-if="!anyAdFree" class="status__buy" @click="router.push('/mine/remove-ads')">
        了解永久去广告 ¥68
      </button>
    </div>

    <!-- 任务墙 -->
    <div class="card">
      <div class="card__title">做点小事，换几天清净</div>
      <div class="card__sub">
        所有奖励都是「免广告天数」——不涉及任何学习结果，不买通任何题目。
      </div>

      <ul class="tasks">
        <li v-for="t in tasks" :key="t.id" class="task" :class="{ 'task--done': t.done }">
          <span class="task__icon">{{ t.icon }}</span>
          <div class="task__main">
            <div class="task__title">{{ t.title }}</div>
            <div class="task__desc">{{ t.desc }}</div>
          </div>
          <button class="task__btn" :disabled="t.done" @click="claim(t)">
            {{ t.done ? '已领取' : t.reward }}
          </button>
        </li>
      </ul>
    </div>

    <!-- 广告位（仅在此页主动进入时出现，且受渐进释放与频次控制） -->
    <AdErrorBoundary v-if="adEligible">
      <div class="card">
        <div class="card__title">看一段视频，换 1 天免广告</div>
        <div class="card__sub">完全可选。不看也不影响任何功能。</div>
        <AdSlotView
          slot="reward_center"
          :rewarded="true"
          @shown="onAdShown"
          @grant="onAdGrant"
          @click="onAdClick"
        />
      </div>
    </AdErrorBoundary>

    <!-- 说明 -->
    <div class="card note">
      <div class="note__t">关于这里的奖励</div>
      <div class="note__d">
        免广告体验期间，全部广告位（含开屏）都会一并移除 —— 说免广告就是全免，
        不打折扣。这是我们对你的一句承诺。
      </div>
    </div>

    <Transition name="toastFade">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.reward-center {
  padding-bottom: 32px;
}

.bar {
  display: flex;
  align-items: center;
  padding: 12px 16px;
}

.bar__title {
  flex: 1;
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  margin: 0;
}

.bar__spacer,
.back {
  width: 56px;
}

.back {
  border: none;
  background: none;
  font-size: 15px;
  color: var(--c-primary, #2b5ce6);
  text-align: left;
  cursor: pointer;
  padding: 0;
}

.card {
  background: var(--c-surface, #fff);
  border-radius: 14px;
  margin: 0 16px 12px;
  padding: 16px;
}

.card__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text-1, #1a1a1a);
}

.card__sub {
  font-size: 12px;
  color: var(--c-text-3, #969799);
  margin-top: 6px;
  line-height: 1.6;
}

.status {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.status__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status__label {
  font-size: 14px;
  color: var(--c-text-2, #646566);
}

.status__value {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-primary, #2b5ce6);
}

.status__buy {
  border: none;
  border-radius: 10px;
  background: var(--c-primary, #2b5ce6);
  color: #fff;
  font-size: 14px;
  padding: 11px;
  cursor: pointer;
}

.tasks {
  list-style: none;
  padding: 0;
  margin: 14px 0 0;
}

.task {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid var(--c-border, #f2f3f5);
}

.task:first-child {
  border-top: none;
}

.task__icon {
  font-size: 22px;
  width: 32px;
  text-align: center;
}

.task__main {
  flex: 1;
  min-width: 0;
}

.task__title {
  font-size: 14px;
  color: var(--c-text-1, #1a1a1a);
}

.task__desc {
  font-size: 12px;
  color: var(--c-text-3, #969799);
  margin-top: 3px;
}

.task__btn {
  flex-shrink: 0;
  border: 1px solid var(--c-primary, #2b5ce6);
  background: transparent;
  color: var(--c-primary, #2b5ce6);
  font-size: 12px;
  border-radius: 8px;
  padding: 7px 10px;
  cursor: pointer;
}

.task__btn:disabled {
  border-color: var(--c-border, #dcdee0);
  color: var(--c-text-3, #969799);
  cursor: default;
}

.note {
  background: var(--c-surface-2, #f7f8fa);
}

.note__t {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text-2, #646566);
}

.note__d {
  font-size: 12px;
  color: var(--c-text-3, #969799);
  line-height: 1.7;
  margin-top: 6px;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 80px;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.78);
  color: #fff;
  font-size: 13px;
  padding: 10px 16px;
  border-radius: 8px;
  max-width: 80vw;
  z-index: 3000;
}

.toastFade-enter-active,
.toastFade-leave-active {
  transition: opacity 0.2s ease;
}

.toastFade-enter-from,
.toastFade-leave-to {
  opacity: 0;
}
</style>
