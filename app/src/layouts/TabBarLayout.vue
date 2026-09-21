<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()

const TABS = [
  { path: '/study', label: '学习', icon: '📘' },
  { path: '/practice', label: '题库', icon: '📝' },
  { path: '/ai', label: 'AI', icon: '✨' },
  { path: '/exam', label: '模考', icon: '🎯' },
  { path: '/mine', label: '我的', icon: '👤' },
]

/**
 * 底部导航显示规则：由路由 meta.hideTabBar 决定
 * 沉浸式页面（答题 / 机考 / 导入）声明隐藏；其余页面显示。
 * 注意：显示 TabBar 的页面必须在下边距里预留 tabbar-h，否则底部内容会被遮住。
 */
const showTabBar = computed(() => !route.meta.hideTabBar)
</script>

<template>
  <div class="layout">
    <div class="layout__body">
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </div>

    <nav v-if="showTabBar" class="tabbar" role="tablist">
      <router-link
        v-for="t in TABS"
        :key="t.path"
        :to="t.path"
        class="tabbar__item"
        role="tab"
      >
        <span class="tabbar__icon" aria-hidden="true">{{ t.icon }}</span>
        <span class="tabbar__label">{{ t.label }}</span>
      </router-link>
    </nav>
  </div>
</template>

<style scoped>
.layout {
  height: 100%;
  display: flex;
  flex-direction: column;
}
/**
 * 页面滚动容器
 *
 * 必须让页面区自己滚动（而非整个 body 滚动），否则：
 * 页面高度被固定为视口高度，内容超出时是「溢出」而不是「撑高」，
 * 溢出的内容会把页面预留的 padding-bottom（本该避开 TabBar）挤掉，
 * 导致滚到底部时最后一块内容被 TabBar 遮住。
 *
 * min-height: 0 是关键：flex item 默认 min-height:auto 会阻止收缩，
 * 不设它则不会触发 overflow，仍会溢出。
 */
.layout__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  height: calc(var(--tabbar-h) + var(--safe-bottom));
  padding-bottom: var(--safe-bottom);
  background: var(--bg-primary);
  border-top: 1px solid var(--border-color);
  z-index: 900;
}
.tabbar__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--text-tertiary);
  text-decoration: none;
  font-size: 11px;
}
.tabbar__item.router-link-active {
  color: var(--color-primary);
}
.tabbar__icon {
  font-size: 20px;
  line-height: 1;
}
</style>
