<script setup lang="ts">
/**
 * API Key 配置图文教程
 *
 * 存在理由：BYOK 最大的门槛不是"技术"，是**认知**。
 *   很多在职考生从没听说过 API Key，看到"填入你的 API Key"就退出了。
 *   这个页面要把这条路径拆成"照着做就行"的四步，并提前拦掉常见报错。
 *
 * 纪律：
 *   - 全部静态内容，零网络请求
 *   - 不承诺任何服务商的赠金/免费额度（政策会变，说死了要背锅）
 *   - 明确告知 Key 存在本机、不经过我们
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PROVIDERS, DISCLAIMER_BYOK } from '@/domain/ai/providers'

const router = useRouter()

interface Step {
  no: number
  title: string
  detail: string[]
}

const STEPS: readonly Step[] = [
  {
    no: 1,
    title: '注册一个服务商账号',
    detail: [
      '打开下面表格里任意一家的官网，用手机号注册。',
      '注册这一步只跟服务商有关，跟我们没有任何关系 —— 我们不需要你注册。',
    ],
  },
  {
    no: 2,
    title: '找到「API Key」页面',
    detail: [
      '登录后进入控制台，找「API Key」/「密钥管理」/「API Keys」这类字眼。',
      '每家叫法不同，通常都在「个人中心」或「账户设置」下面。',
      '也可以直接点下面表格里的「去申请」按钮，一步跳到该页面。',
    ],
  },
  {
    no: 3,
    title: '创建一个 Key 并复制',
    detail: [
      '点「创建新密钥」，随便起个名字（比如 kaoshi）。',
      '创建后会出现一串 sk- 开头的长字符 —— 这就是 Key。',
      '⚠️ 这串字符通常**只显示一次**，务必当场复制。没复制到就删掉重建一个。',
    ],
  },
  {
    no: 4,
    title: '回到 App 粘贴并测试',
    detail: [
      '回到「AI 服务设置」页，选同一家服务商，把 Key 粘进输入框。',
      '点「测试连接」，出现「连接正常」就成功了。',
      'Key 只保存在你这台设备的本地存储里，不上传、不经过我们。',
    ],
  },
] as const

const FAQ: readonly { q: string; a: string }[] = [
  {
    q: '提示「API Key 无效或已过期」',
    a: '多半是复制时带了空格或漏了字符。重新复制完整的一串（以 sk- 开头的那种）再粘贴。仍然不行就回控制台删掉旧 Key 重建一个。',
  },
  {
    q: '提示「网络连接失败」',
    a: '两种情况：① 你当前网络不通；② 该服务商在你所在地区无法直接访问（部分海外服务商需要自行解决网络问题）。备考优先选国内服务商，一般不会遇到这个问题。',
  },
  {
    q: '提示「请求过于频繁」',
    a: '这是服务商对你账号的限流，稍等一两分钟再试。免费账号的限流阈值通常更低。',
  },
  {
    q: '提示余额不足 / 需要充值',
    a: 'BYOK 的费用是你直接付给服务商的，需要到该服务商的控制台充值。备考场景用量很小，充最小额度一般够用很久。',
  },
  {
    q: '换了设备，AI 不能用了',
    a: '本 App 不做云端同步，Key 只存在原来那台设备上。在新设备重新粘贴一次即可。这也是"无账号、数据 100% 本地"的必然结果。',
  },
  {
    q: '不配 Key 会影响我备考吗',
    a: '完全不会。刷题、错题本、记忆曲线、全真模考、知识点精讲全部正常使用。AI 只是可选增强。',
  },
]

const openedProvider = ref<string | null>(null)

const providerRows = computed(() => PROVIDERS)

function toggle(id: string) {
  openedProvider.value = openedProvider.value === id ? null : id
}

function openConsole(url: string) {
  window.open(url, '_blank', 'noopener')
}

function goSettings() {
  void router.push('/ai/settings')
}
</script>

<template>
  <div class="page page--no-tab tutorial">
    <header class="bar">
      <button class="back" @click="router.back()">返回</button>
      <h1 class="bar__title">怎么拿 API Key</h1>
      <span class="bar__spacer" />
    </header>

    <div class="intro">
      <div class="intro__t">API Key 是什么？</div>
      <div class="intro__d">
        可以理解成一把「钥匙」：它证明"这些 AI 调用是我本人发起的"，服务商凭它给你计费。
        你申请它、你持有它、你付费给服务商 —— 我们从头到尾不经手。
      </div>
    </div>

    <!-- 四步流程 -->
    <section class="card block">
      <div class="block__title">四步搞定</div>
      <ol class="steps">
        <li v-for="s in STEPS" :key="s.no" class="step">
          <span class="step__no">{{ s.no }}</span>
          <div class="step__body">
            <div class="step__title">{{ s.title }}</div>
            <p v-for="(d, i) in s.detail" :key="i" class="step__detail">{{ d }}</p>
          </div>
        </li>
      </ol>
    </section>

    <!-- 按服务商给入口 -->
    <section class="card block">
      <div class="block__title">去哪家申请</div>
      <div class="block__sub">下方按客观评分排序，无任何商业合作</div>
      <div class="provs">
        <div v-for="p in providerRows" :key="p.id" class="prov">
          <button class="prov__head" @click="toggle(p.id)">
            <div class="prov__left">
              <span class="prov__name">{{ p.name }}</span>
              <span class="prov__model">{{ p.defaultModel }}</span>
            </div>
            <span class="prov__chev">{{ openedProvider === p.id ? '收起' : '展开' }}</span>
          </button>

          <div v-if="openedProvider === p.id" class="prov__body">
            <div class="prov__tags">
              <span v-for="t in p.tags" :key="t" class="chip">{{ t }}</span>
            </div>
            <p class="prov__advice">{{ p.advice }}</p>
            <button class="prov__go" @click="openConsole(p.consoleUrl)">
              去 {{ p.name }} 申请 Key ↗
            </button>
          </div>
        </div>
      </div>
      <p class="tip">
        拿不定主意就选排第一的那个。备考场景的调用量很小，任何一家都够用。
      </p>
    </section>

    <!-- 常见问题 -->
    <section class="card block">
      <div class="block__title">遇到问题看这里</div>
      <div class="faq">
        <details v-for="(f, i) in FAQ" :key="i" class="faq__item">
          <summary class="faq__q">{{ f.q }}</summary>
          <p class="faq__a">{{ f.a }}</p>
        </details>
      </div>
    </section>

    <!-- 安全说明 -->
    <section class="card block">
      <div class="block__title">关于安全</div>
      <ul class="safe">
        <li>Key 只保存在你这台设备的本地存储中，不会上传到任何服务器。</li>
        <li>对话请求由你的设备直接发往服务商，我们不中转、不记录。</li>
        <li>本 App 没有账号系统 —— 我们没有任何途径拿到你的 Key。</li>
        <li>换设备需重新粘贴一次 Key，这是「无云端同步」的代价，也是隐私的来源。</li>
      </ul>
    </section>

    <button class="cta" @click="goSettings">我现在就去配置</button>

    <p class="disclaimer">{{ DISCLAIMER_BYOK }}</p>
  </div>
</template>

<style scoped>
.tutorial {
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

/* 开篇解释 */
.intro {
  background: var(--color-primary-light);
  border-radius: var(--radius-md);
  padding: var(--sp-3);
}
.intro__t {
  font-size: var(--fs-aux);
  font-weight: 500;
  color: var(--color-primary);
  margin-bottom: var(--sp-1);
}
.intro__d {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.7;
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  border: 1px solid var(--border-color);
}
.block__title {
  font-size: var(--fs-aux);
  font-weight: 500;
}
.block__sub {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  margin-top: calc(var(--sp-1) * -1);
}

/* 步骤 */
.steps {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.step {
  display: flex;
  gap: var(--sp-3);
}
.step__no {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--color-primary);
  color: #fff;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}
.step__body {
  min-width: 0;
}
.step__title {
  font-size: var(--fs-aux);
  font-weight: 500;
  margin-bottom: 2px;
}
.step__detail {
  margin: 2px 0 0;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.7;
}

/* 服务商 */
.provs {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.prov {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  overflow: hidden;
}
.prov__head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-3);
  background: none;
  border: none;
  color: var(--text-primary);
  min-height: var(--tap-min);
}
.prov__left {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  min-width: 0;
}
.prov__name {
  font-size: var(--fs-body);
  font-weight: 500;
}
.prov__model {
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prov__chev {
  flex-shrink: 0;
  font-size: var(--fs-caption);
  color: var(--color-primary);
}
.prov__body {
  padding: 0 var(--sp-3) var(--sp-3);
  border-top: 1px solid var(--border-color);
  padding-top: var(--sp-3);
}
.prov__tags {
  display: flex;
  gap: var(--sp-1);
  margin-bottom: var(--sp-2);
}
.chip {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}
.prov__advice {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.6;
}
.prov__go {
  width: 100%;
  padding: var(--sp-2);
  background: var(--color-primary-light);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-primary);
  font-size: var(--fs-caption);
  min-height: var(--tap-min);
}
.tip {
  margin: 0;
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  line-height: 1.6;
}

/* FAQ */
.faq {
  display: flex;
  flex-direction: column;
}
.faq__item {
  border-bottom: 1px solid var(--border-color);
  padding: var(--sp-2) 0;
}
.faq__item:last-child {
  border-bottom: none;
}
.faq__q {
  font-size: var(--fs-aux);
  color: var(--text-primary);
  list-style: none;
  min-height: var(--tap-min);
  display: flex;
  align-items: center;
  cursor: pointer;
}
.faq__q::-webkit-details-marker {
  display: none;
}
.faq__q::before {
  content: '›';
  color: var(--color-primary);
  margin-right: var(--sp-2);
  font-size: 16px;
  transition: transform 0.15s;
  display: inline-block;
}
.faq__item[open] .faq__q::before {
  transform: rotate(90deg);
}
.faq__a {
  margin: 0 0 var(--sp-2);
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.7;
}

/* 安全 */
.safe {
  margin: 0;
  padding-left: 1.1em;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.9;
}

.cta {
  height: var(--btn-h);
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: #fff;
  font-size: var(--fs-body);
}
.disclaimer {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.6;
}
</style>
