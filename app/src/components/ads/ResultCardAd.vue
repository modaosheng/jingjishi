<script setup lang="ts">
/**
 * 成果卡广告（PRD M9-F3 位置①）
 *
 * ══════════════════════════════════════════════════════════════
 *  这是**最容易被接受**的广告位置 —— 用户刚完成一个任务包，
 *  正处于「我做完了」的正向峰值上，对周围信息的容忍度最高。
 *
 *  但它有一条不能碰的红线（T1 学习心流禁投区）：
 *    本组件**必须挂在任务包完成之后的结算视图里**，
 *    **绝不能插入答题过程中** —— 那会打断心流。
 * ══════════════════════════════════════════════════════════════
 */
import AdSlotView from '@/components/ads/AdSlotView.vue'

/** 失败即赠送：由父页面接管（成果卡是"完成后"的展示，失败静默即可，不赠送） */
</script>

<template>
  <div class="result-ad">
    <AdSlotView slot="result_card" variant="card" />
  </div>
</template>

<style scoped>
.result-ad {
  /* 与成果卡内容保持一致的呼吸感，不带任何"广告来了"的突兀 */
  margin-top: 12px;
}
</style>
