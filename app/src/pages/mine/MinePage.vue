<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getDataSource, getDataSourceInfo } from '@/infrastructure'
import { getServices } from '@/services'
import { adFreeDaysLeft, loadAdFree } from '@/domain/ads/releaseEngine'
import { revokeConsent } from '@/domain/privacy/consent'
import { clearBootLog, formatBootTime, readBootLog, type BootLogEntry } from '@/domain/boot/bootLog'

const router = useRouter()
const ds = () => getDataSource()
const info = getDataSourceInfo()

const stats = ref({ total: 0, correct: 0, today: 0 })
const dueCount = ref(0)
const theme = ref<'light' | 'dark'>('light')
const snapshots = ref<Array<{ id: number; type: string; createdAt: number; stats: { questionsAnswered: number } }>>([])

/** 去广告状态摘要（买断 / 限期体验），驱动「奖励中心」入口的副标题 */
const adFreeLabel = ref('')

/**
 * 启动日志：记录上一次启动各阶段。
 * 真机上的启动问题只在特定机型复现，控制台又拿不到，
 * 所以把过程留在这里供回看 —— 这是排查「启动卡住」的主要依据。
 */
const bootLog = ref<BootLogEntry[]>([])
const showBootLog = ref(false)

onMounted(async () => {
  stats.value = await ds().answerLogs.stats()
  dueCount.value = await ds().states.getDueCount()
  snapshots.value = await getServices().backup.listSnapshots()
  const saved = localStorage.getItem('jingshi.theme')
  if (saved === 'dark') {
    theme.value = 'dark'
    document.documentElement.setAttribute('data-theme', 'dark')
  }
  // 无广告状态摘要
  const state = loadAdFree()
  if (state.purchased) adFreeLabel.value = '已永久去广告'
  else {
    const left = adFreeDaysLeft()
    adFreeLabel.value = left > 0 ? `免广告 · 剩 ${left} 天` : ''
  }
  bootLog.value = readBootLog()
})

function onClearBootLog() {
  clearBootLog()
  bootLog.value = []
  showBootLog.value = false
}

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', theme.value)
  localStorage.setItem('jingshi.theme', theme.value)
}

/** 触发文件下载（导出与快照共用） */
function download(filename: string, payload: string): void {
  const blob = new Blob([payload], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 导出备份。
 *
 * ⚠️ PRD Q11：**备份文件默认加密**。
 *    理由：学习数据是「可迁移资产」，用户会把它丢进网盘、通过微信传输，
 *    一旦外泄就是完整的个人学习档案（含错题、笔记、模考成绩）。
 *    精准加密备份文件，比全库加密更合理也更划算。
 */
async function exportBackup() {
  const pwd = prompt(
    '为备份文件设置密码（推荐）\n\n' +
      '· 至少 6 位\n' +
      '· 密码只在你手上，我们无法帮你找回\n' +
      '· 留空则不加密（不推荐）',
  )
  if (pwd === null) return // 用户取消

  if (!pwd) {
    const ok = confirm(
      '不加密导出？\n\n' +
        '备份文件包含你的全部学习记录。\n' +
        '如果它被上传网盘或通过微信传输，任何人都能直接打开查看。\n\n' +
        '确定不加密？',
    )
    if (!ok) return
  }

  try {
    const { filename, payload, encrypted } = await getServices().backup.exportToFile(
      pwd ? { password: pwd } : {},
    )
    download(filename, payload)
    getServices().backup.markExported()
    alert(
      encrypted
        ? '加密备份已导出。\n\n请牢记密码 —— 没有密码将无法恢复数据。'
        : '备份已导出（未加密）。',
    )
  } catch (e) {
    alert(e instanceof Error ? e.message : '导出失败')
  }
}

/**
 * 导入备份。
 * 自动识别是否为加密备份 —— 不让用户先回答「这是加密的吗」。
 */
function importBackup() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const text = await file.text()

    const svc = getServices().backup
    let password: string | undefined

    if (svc.needsPassword(text)) {
      const p = prompt('这份备份已加密，请输入导出时设置的密码')
      if (p === null) return // 用户取消
      password = p
    }

    try {
      const m = await svc.importFromFile(text, password)
      alert(`已恢复 ${m.stats.questionsAnswered} 条答题记录，${m.stats.wrongCount} 道错题`)
      location.reload()
    } catch (e) {
      // 服务层已把错误映射为可读文案（密码错误 / 文件损坏），直接展示
      alert(e instanceof Error ? e.message : '备份文件无法识别，请确认选择的是本应用导出的备份')
    }
  }
  input.click()
}

/** 时间机器：回滚到某个自动快照 */
async function restoreSnapshot(id: number) {
  if (!confirm('回滚将覆盖当前学习数据（会先自动保护当前状态），确定继续？')) return
  try {
    await getServices().backup.restoreSnapshot(id)
    location.reload()
  } catch (e) {
    alert(e instanceof Error ? e.message : '回滚失败')
  }
}

const snapLabel: Record<string, string> = {
  auto_daily: '每日',
  auto_weekly: '每周',
  manual: '手动',
  pre_migration: '回滚前',
}

/**
 * 重置全部数据：清空学习记录与自建题，保留官方题库
 * 用于重新体验「首次使用 → 摸底 → 每日计划 → 答题」完整流程
 */
async function resetAll() {
  const msg =
    '⚠️ 重置全部数据\n\n' +
    '将清空：\n' +
    '· 答题记录 / 错题本 / 复习进度\n' +
    '· 模拟考试成绩\n' +
    '· 导入的自建题目\n' +
    '· 引导状态与偏好设置\n\n' +
    '官方题库会保留。此操作不可恢复，确定继续？'
  if (!confirm(msg)) return
  if (!confirm('再次确认：真的要清空所有数据吗？')) return

  try {
    await getDataSource().reset?.()
  } catch (e) {
    alert(e instanceof Error ? e.message : '重置失败')
    return
  }
  // 显式撤销隐私同意：虽然紧随其后的 clear() 也会清掉它，
  // 但把意图写出来能防止将来把 clear() 改成定向删除时漏掉同意记录。
  revokeConsent()
  localStorage.clear()
  alert('已重置，页面即将刷新')
  location.reload()
}
</script>

<template>
  <div class="page mine">
    <h1 class="h1">我的</h1>

    <section class="card stats">
      <div class="stat">
        <div class="stat__num">{{ stats.total }}</div>
        <div class="stat__label">累计答题</div>
      </div>
      <div class="stat">
        <div class="stat__num">
          {{ stats.total ? Math.round((stats.correct / stats.total) * 100) : 0 }}%
        </div>
        <div class="stat__label">总正确率</div>
      </div>
      <div class="stat">
        <div class="stat__num">{{ dueCount }}</div>
        <div class="stat__label">待复习</div>
      </div>
    </section>

    <section class="card block">
      <div class="block__title">学习</div>
      <div class="entry" @click="router.push('/study/tree')">
        <span>知识图谱</span>
        <span class="text-caption">掌握度热力 ›</span>
      </div>
      <div class="entry" @click="router.push('/mine/dashboard')">
        <span>数据看板 · 过线预测</span>
        <span class="text-caption">›</span>
      </div>
    </section>

    <section class="card block">
      <div class="block__title">数据备份</div>
      <div class="text-caption">
        数据仅存本机。iOS Safari 若未添加到主屏幕，7 天不打开会被系统清空，请定期导出备份。
      </div>
      <div class="row">
        <button class="btn" @click="exportBackup">导出备份</button>
        <button class="btn" @click="importBackup">导入恢复</button>
      </div>

      <!-- 时间机器：自动快照回滚 -->
      <div v-if="snapshots.length" class="tm">
        <div class="tm__title">时间机器（自动快照）</div>
        <div v-for="s in snapshots.slice(0, 5)" :key="s.id" class="tm__item">
          <span class="tm__tag">{{ snapLabel[s.type] ?? s.type }}</span>
          <span class="text-caption">{{ new Date(s.createdAt).toLocaleString('zh-CN') }}</span>
          <span class="text-caption">{{ s.stats.questionsAnswered }} 题</span>
          <button class="tm__btn" @click="restoreSnapshot(s.id)">回滚</button>
        </div>
      </div>
    </section>

    <section class="card block">
      <div class="block__title">奖励与购买</div>
      <div class="entry entry--link" @click="router.push('/mine/reward-center')">
        <span>奖励中心</span>
        <span class="entry__hint">
          <template v-if="adFreeLabel">{{ adFreeLabel }}</template>
          <template v-else>做任务换免广告 →</template>
        </span>
      </div>
      <div class="entry entry--link" @click="router.push('/mine/remove-ads')">
        <span>账号与购买状态</span>
        <span class="entry__hint">去广告 ¥68 →</span>
      </div>
      <div class="text-caption adfree-tip">
        我们没有账号体系，你的数据只在这台设备上。购买去广告后，可用「恢复购买」在新设备上找回。
      </div>
    </section>

    <section class="card block">
      <div class="block__title">外观</div>
      <div class="entry">
        <span>深色模式</span>
        <button class="switch" :class="{ 'switch--on': theme === 'dark' }" @click="toggleTheme">
          <span class="switch__dot" />
        </button>
      </div>
    </section>

    <section class="card block">
      <div class="block__title">存储信息</div>
      <div class="entry">
        <span>数据源</span>
        <span class="text-caption">{{ info.name === 'sqlite' ? 'SQLite (OPFS)' : '内存 Mock' }}</span>
      </div>
      <div v-if="info.fallbackReason" class="entry">
        <span>降级原因</span>
        <span class="text-caption">{{ info.fallbackReason }}</span>
      </div>

      <!-- 启动日志：真机启动异常时的主要排查依据 -->
      <div v-if="bootLog.length" class="entry entry--link" @click="showBootLog = !showBootLog">
        <span>启动日志</span>
        <span class="entry__hint">{{ showBootLog ? '收起' : `查看（${bootLog.length} 条）` }}</span>
      </div>
      <div v-if="showBootLog" class="bootlog">
        <div v-for="(e, i) in bootLog" :key="i" class="bootlog__row">
          <span class="bootlog__t">{{ formatBootTime(e.t) }}</span>
          <span class="bootlog__m">{{ e.m }}</span>
        </div>
        <button class="bootlog__clear" @click="onClearBootLog">清空日志</button>
      </div>
    </section>

    <section class="card block">
      <div class="block__title">关于与法律</div>
      <div class="entry entry--link" @click="router.push('/privacy')">
        <span>隐私政策</span>
        <span class="entry__hint">全文 →</span>
      </div>
      <div class="text-caption adfree-tip">
        我们不收集你的任何个人信息。全部学习数据只保存在本机，广告 SDK 无法访问。
      </div>
    </section>

    <section class="card block">
      <div class="block__title">危险操作</div>
      <div class="text-caption danger-tip">
        重置会清空所有学习数据与自建题目（官方题库保留），用于重新体验首次使用流程。此操作不可恢复。
      </div>
      <button class="btn btn--danger" @click="resetAll">重置全部数据</button>
    </section>
  </div>
</template>

<style scoped>
.mine {
  padding: calc(var(--safe-top) + var(--sp-4)) var(--sp-4) calc(var(--tabbar-h) + var(--safe-bottom) + var(--sp-4));
  min-height: 100%;
}
.h1 {
  font-size: 22px;
  font-weight: 600;
  margin-bottom: var(--sp-4);
}
.danger-tip {
  line-height: 1.6;
  margin-bottom: var(--sp-3);
}
.btn--danger {
  width: 100%;
  height: var(--btn-h);
  border: 1px solid var(--color-danger);
  background: var(--bg-primary);
  color: var(--color-danger);
  border-radius: var(--radius-md);
  font-size: var(--fs-body);
}
.stats {
  display: flex;
  justify-content: space-around;
  text-align: center;
}
.stat__num {
  font-size: 24px;
  font-weight: 600;
  color: var(--color-primary);
}
.stat__label {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  margin-top: 2px;
}
.block {
  margin-top: var(--sp-3);
}
.block__title {
  font-weight: 500;
  margin-bottom: var(--sp-2);
}
.row {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.btn {
  flex: 1;
  height: var(--tap-min);
  border: 1px solid var(--border-strong);
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-aux);
}
.entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--tap-min);
  font-size: var(--fs-body);
}
.entry--link {
  cursor: pointer;
}
.entry__hint {
  font-size: var(--fs-aux);
  color: var(--text-tertiary);
}
.adfree-tip {
  margin-top: var(--sp-2);
}
.bootlog {
  margin-top: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  max-height: 240px;
  overflow: auto;
}
.bootlog__row {
  display: flex;
  gap: var(--sp-2);
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.8;
}
.bootlog__t {
  flex-shrink: 0;
  color: var(--text-tertiary, var(--text-secondary));
  font-variant-numeric: tabular-nums;
}
.bootlog__m {
  word-break: break-all;
}
.bootlog__clear {
  width: 100%;
  margin-top: var(--sp-2);
  padding: var(--sp-2);
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--fs-caption);
}
.switch {
  width: 48px;
  height: 28px;
  border-radius: 14px;
  border: none;
  background: var(--bg-tertiary);
  position: relative;
}
.switch--on {
  background: var(--color-primary);
}
.switch__dot {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}
.switch--on .switch__dot {
  transform: translateX(20px);
}
.tm {
  margin-top: var(--sp-4);
  border-top: 1px solid var(--border-color);
  padding-top: var(--sp-2);
}
.tm__title {
  font-size: var(--fs-aux);
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.tm__item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 6px 0;
}
.tm__tag {
  font-size: 11px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  padding: 1px 6px;
  border-radius: 4px;
}
.tm__btn {
  margin-left: auto;
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  padding: 3px 10px;
  font-size: var(--fs-caption);
  min-height: 28px;
}
</style>
