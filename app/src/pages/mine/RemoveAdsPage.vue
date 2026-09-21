<script setup lang="ts">
/**
 * 去广告购买页（占位）
 *
 * PRD v1.4：¥68 一次性买断，永久移除全部广告位。
 * ⚠️ 与「会员制」的本质区别：**一次性、永久、不做订阅、不解锁任何学习内容**。
 *    广告位在 D1–D6 渐进出现，购买后立即全部消失。
 *
 * TODO（待接入）：
 *   1. 支付渠道（微信/支付宝/App Store 内购）
 *   2. 恢复购买（换设备需能找回）
 *   3. 购买凭证本地校验与防篡改
 */
import { useRouter } from 'vue-router'
import { showToast } from 'vant'

const router = useRouter()

const PENDING = true // 支付未接入

function buy() {
  if (PENDING) {
    showToast('支付功能尚未接入')
    return
  }
}

function restore() {
  showToast('暂无可恢复的购买记录')
}
</script>

<template>
  <div class="page page--no-tab remove-ads">
    <header class="bar">
      <button class="back" @click="router.back()">返回</button>
      <h1 class="bar__title">去广告</h1>
      <span class="bar__spacer" />
    </header>

    <div class="card hero">
      <div class="hero__price">¥68</div>
      <div class="hero__once">一次性付费 · 永久生效</div>
      <ul class="hero__list">
        <li>移除开屏广告</li>
        <li>移除成果卡广告</li>
        <li>移除奖励中心广告</li>
      </ul>
      <button class="buy" @click="buy">立即购买</button>
      <button class="restore" @click="restore">恢复购买</button>
    </div>

    <div class="card note">
      <div class="note__t">我们不会这样做</div>
      <div class="note__d">
        不做订阅制扣费，不做「付费才能解锁题目」，不在考前突然撤掉广告让你误以为被欺骗。
        买断就是买断：一次付清，永久去广告，学习内容对所有人始终一致。
      </div>
    </div>
  </div>
</template>

<style scoped>
.remove-ads {
  padding: var(--sp-4);
  padding-top: calc(var(--safe-top) + var(--sp-4));
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
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
.hero {
  text-align: center;
  padding: var(--sp-6) var(--sp-4);
}
.hero__price {
  font-size: 40px;
  font-weight: 600;
  color: var(--text-primary);
}
.hero__once {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  margin-top: var(--sp-1);
}
.hero__list {
  list-style: none;
  padding: 0;
  margin: var(--sp-5) 0;
  text-align: left;
}
.hero__list li {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
  padding: var(--sp-2) 0;
  padding-left: var(--sp-5);
  position: relative;
}
.hero__list li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 8px;
  border-left: 2px solid var(--color-success);
  border-bottom: 2px solid var(--color-success);
  rotate: -45deg;
}
.buy {
  width: 100%;
  height: var(--btn-h);
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--fs-body);
}
.restore {
  width: 100%;
  height: var(--tap-min);
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: var(--fs-caption);
}
.note {
  background: var(--bg-primary);
}
.note__t {
  font-size: var(--fs-aux);
  font-weight: 500;
  margin-bottom: var(--sp-2);
}
.note__d {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.7;
}
</style>
