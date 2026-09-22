import { createRouter, createWebHistory } from 'vue-router'
import TabBarLayout from '@/layouts/TabBarLayout.vue'
import { getServices } from '@/services'
import { hasConsented } from '@/domain/privacy/consent'

const routes = [
  {
    path: '/',
    component: TabBarLayout,
    children: [
      { path: '', redirect: '/study' },
      { path: 'study', component: () => import('@/pages/study/TodayPage.vue'), meta: { title: '今日任务' } },
      {
        path: 'study/tree',
        component: () => import('@/pages/study/KnowledgeTreePage.vue'),
        meta: { title: '知识图谱' },
      },
      {
        // 上岸作战地图：四阶段时间表（PRD §6.2）
        path: 'study/roadmap',
        component: () => import('@/pages/study/RoadmapPage.vue'),
        meta: { title: '作战地图' },
      },
      {
        path: 'study/knowledge/:id',
        component: () => import('@/pages/study/KnowledgeDetailPage.vue'),
        meta: { title: '章节精讲' },
      },
      { path: 'practice', component: () => import('@/pages/practice/PracticePage.vue'), meta: { title: '题库' } },
      {
        path: 'practice/wrong',
        component: () => import('@/pages/practice/WrongBookPage.vue'),
        meta: { title: '错题本' },
      },
      {
        path: 'practice/sets',
        component: () => import('@/pages/practice/QuestionSetPage.vue'),
        meta: { title: '我的题库' },
      },
      {
        // 首屏：三个入口三选一。保留底部导航，用户可随时切走
        path: 'practice/import',
        component: () => import('@/pages/practice/ImportPage.vue'),
        meta: { title: '导入题库' },
      },
      {
        // 各入口子流程（text / file / ai）：沉浸式操作，隐藏底部导航
        path: 'practice/import/:mode',
        component: () => import('@/pages/practice/ImportPage.vue'),
        meta: { title: '导入题库', hideTabBar: true },
      },
      { path: 'ai', component: () => import('@/pages/ai/AiPage.vue'), meta: { title: 'AI 私教' } },
      {
        // AI 服务设置（纯 BYOK）：沉浸式，隐藏底部导航
        path: 'ai/settings',
        component: () => import('@/pages/ai/AiSettingsPage.vue'),
        meta: { title: 'AI 服务设置', hideTabBar: true },
      },
      {
        // Key 申请图文教程：纯静态内容，零网络请求
        path: 'ai/tutorial',
        component: () => import('@/pages/ai/AiKeyTutorialPage.vue'),
        meta: { title: '怎么拿 API Key', hideTabBar: true },
      },
      {
        // AI 示例解析：本地预置样例，未配置 Key 也能看（零网络请求）
        path: 'ai/sample',
        component: () => import('@/pages/ai/AiSamplePage.vue'),
        meta: { title: 'AI 能帮你做什么', hideTabBar: true },
      },
      {
        // 去广告购买页（占位，待接入支付）
        path: 'mine/remove-ads',
        component: () => import('@/pages/mine/RemoveAdsPage.vue'),
        meta: { title: '去广告', hideTabBar: true },
      },
      {
        // 奖励中心（PRD M9-F3 位置②，广告位 reward_center 的宿主）
        path: 'mine/reward-center',
        component: () => import('@/pages/mine/RewardCenterPage.vue'),
        meta: { title: '奖励中心', hideTabBar: true },
      },
      { path: 'exam', component: () => import('@/pages/exam/ExamHomePage.vue'), meta: { title: '全真模考' } },
      {
        path: 'exam/room',
        component: () => import('@/pages/exam/ExamRoomPage.vue'),
        meta: { title: '作答中', hideTabBar: true },
      },
      {
        // 两科连考的中场休息（PRD R3）
        path: 'exam/break',
        component: () => import('@/pages/exam/ExamBreakPage.vue'),
        meta: { title: '中场休息', hideTabBar: true },
      },
      { path: 'mine', component: () => import('@/pages/mine/MinePage.vue'), meta: { title: '我的' } },
      {
        path: 'mine/dashboard',
        component: () => import('@/pages/mine/DashboardPage.vue'),
        meta: { title: '数据看板' },
      },
      {
        path: 'quiz',
        component: () => import('@/pages/quiz/QuizPage.vue'),
        meta: { title: '答题', hideTabBar: true },
      },
    ],
  },
  {
    path: '/onboarding',
    component: () => import('@/pages/onboarding/OnboardingPage.vue'),
    meta: { title: '开始备考' },
  },
  {
    /**
     * 隐私政策同意页（首次启动的强制闸门）
     *
     * ⚠️ 它是**广告 SDK 初始化的合规前置条件** —— 未同意前不得初始化任何
     *    采集设备信息的第三方 SDK（《个人信息保护法》与应用商店审核硬要求）。
     *    因此这个页面必须排在 onboarding 之前，见下方 beforeEach。
     */
    path: '/privacy-consent',
    component: () => import('@/pages/privacy/PrivacyConsentPage.vue'),
    meta: { title: '隐私政策' },
  },
  {
    // 隐私政策全文（随时可访问，合规要求）
    path: '/privacy',
    component: () => import('@/pages/privacy/PrivacyPolicyPage.vue'),
    meta: { title: '隐私政策', hideTabBar: true },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

/**
 * 路由守卫（顺序很重要，不要调整）
 *
 * ① **隐私同意闸门**（最高优先级）
 *    —— 未同意隐私政策前，不得进入任何业务页面。
 *       原因不只是合规，更是因为广告 SDK **绝不能**在用户同意前被初始化。
 *       放在最前面，保证「能触达广告的任何路径」都已通过同意。
 *
 * ② 首次使用引导闸门（PRD §9.1）
 */
router.beforeEach((to) => {
  // ① 隐私同意：白名单只有同意页与政策全文页
  const consentExempt = to.path === '/privacy-consent' || to.path === '/privacy'
  if (!consentExempt && !hasConsented()) {
    return '/privacy-consent'
  }
  // 已同意后又访问同意页 → 放行到正常流程
  if (to.path === '/privacy-consent' && hasConsented()) {
    return '/study'
  }

  // ② 首次使用引导
  let done = false
  try {
    done = getServices().onboarding.isDone()
  } catch {
    // 数据源尚未初始化时不拦截，交由 bootstrap 处理
    return true
  }
  if (!done && to.path !== '/onboarding') return '/onboarding'
  if (done && to.path === '/onboarding') return '/study'
  return true
})

router.afterEach((to) => {
  const title = (to.meta.title as string) || ''
  document.title = title ? `${title} · 经济师上岸助手` : '经济师上岸助手'
})

export default router
