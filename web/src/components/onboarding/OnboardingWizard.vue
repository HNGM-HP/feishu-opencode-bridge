<template>
  <el-dialog
    v-model="dialogVisible"
    :title="dialogTitle"
    width="520px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    align-center
    class="onboarding-dialog"
  >
    <!-- Step 1：界面语言 -->
    <div v-if="step === 'language'" class="onboarding-step">
      <p class="onboarding-step__lead">
        欢迎使用 OpenCode Bridge。先选择一下你习惯的界面语言，随时可以在系统设置里切换。
      </p>
      <div class="onboarding-step__choices">
        <div
          class="lang-card"
          :class="{ 'lang-card--active': pickedLocale === 'zh-CN' }"
          @click="pickedLocale = 'zh-CN'"
        >
          <div class="lang-card__title">中文（默认）</div>
          <div class="lang-card__sub">简体中文界面</div>
        </div>
        <div
          class="lang-card"
          :class="{ 'lang-card--active': pickedLocale === 'en-US' }"
          @click="pickedLocale = 'en-US'"
        >
          <div class="lang-card__title">English</div>
          <div class="lang-card__sub">English interface</div>
        </div>
      </div>
    </div>

    <!-- Step 2：先接入哪个平台 -->
    <div v-else-if="step === 'platform'" class="onboarding-step">
      <p class="onboarding-step__lead">
        挑一个最常用的平台先接入，后续可以在「平台接入」里继续配置其它平台。也可以现在跳过这一步。
      </p>
      <div class="platform-grid">
        <div
          v-for="p in platforms"
          :key="p.id"
          class="platform-card"
          :class="{ 'platform-card--active': pickedPlatform === p.id }"
          @click="pickedPlatform = p.id"
        >
          <div class="platform-card__icon">{{ p.icon }}</div>
          <div class="platform-card__body">
            <div class="platform-card__label">{{ p.label }}</div>
            <div class="platform-card__desc">{{ p.desc }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Step 3：侧边栏导览说明（驱动 driver.js 的提示页） -->
    <div v-else-if="step === 'tour'" class="onboarding-step">
      <p class="onboarding-step__lead">
        最后用一分钟熟悉一下左侧导航：每一项都是后续配置 / 排错的入口。点击「开始导览」会逐一高亮讲解。
      </p>
      <ul class="onboarding-step__list">
        <li>系统状态：服务概览、版本、运行时长</li>
        <li>AI 工作区：直接发送 Prompt 调试 OpenCode</li>
        <li>平台接入：八个 IM 平台的开关与凭据</li>
        <li>Session / OpenCode 对接 / 高可用 / 核心行为：精细化能力</li>
        <li>Cron / 日志 / 系统设置：运行期监控与系统级开关</li>
      </ul>
      <p class="onboarding-step__note">
        想跳过导览也没关系，之后可以在左下角的「帮助」里再次访问对应文档。
      </p>
    </div>

    <template #footer>
      <div class="onboarding-footer">
        <el-button text @click="handleSkip">跳过引导</el-button>
        <div class="onboarding-footer__actions">
          <el-button v-if="step !== 'language'" @click="goBack">上一步</el-button>
          <el-button
            v-if="step !== 'tour'"
            type="primary"
            @click="goNext"
            :disabled="!canAdvance"
          >
            下一步
          </el-button>
          <el-button
            v-else
            type="primary"
            @click="handleStartTour"
          >
            开始导览
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElButton, ElDialog } from 'element-plus'
import { driver, type DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'
import { setAppLocale, type AppLocale } from '../../i18n/runtime'
import { useOnboarding } from '../../composables/useOnboarding'
import { ONBOARDING_PLATFORMS } from '../../composables/onboarding-platforms'

type Step = 'language' | 'platform' | 'tour'

const router = useRouter()
const onboarding = useOnboarding()

const dialogVisible = computed({
  get: () => onboarding.visible.value,
  set: value => {
    if (!value) onboarding.hide()
  },
})

const step = ref<Step>('language')
const pickedLocale = ref<AppLocale>('zh-CN')
const pickedPlatform = ref<string | null>(null)
const platforms = ONBOARDING_PLATFORMS

const dialogTitle = computed(() => {
  switch (step.value) {
    case 'language': return '步骤 1 / 3 · 选择界面语言'
    case 'platform': return '步骤 2 / 3 · 选择首个接入平台'
    case 'tour':     return '步骤 3 / 3 · 熟悉左侧导航'
  }
})

const canAdvance = computed(() => {
  if (step.value === 'language') return pickedLocale.value !== null
  // platform 允许"未选 = 跳过"，下一步按钮始终可点
  return true
})

watch(pickedLocale, locale => {
  setAppLocale(locale)
})

function goNext(): void {
  if (step.value === 'language') {
    step.value = 'platform'
  } else if (step.value === 'platform') {
    step.value = 'tour'
  }
}

function goBack(): void {
  if (step.value === 'tour') step.value = 'platform'
  else if (step.value === 'platform') step.value = 'language'
}

async function handleSkip(): Promise<void> {
  await onboarding.markSkipped()
}

async function handleStartTour(): Promise<void> {
  // 先关闭引导对话框，让 driver.js 直接覆盖在主界面
  onboarding.hide()

  // 若用户在第二步选了平台，跳到平台页便于后续直接配置
  if (pickedPlatform.value) {
    try {
      await router.push({ path: '/platforms', query: { focus: pickedPlatform.value } })
    } catch {
      // 路由失败不影响后续导览
    }
  } else {
    // 没选平台时也要确保停留在 dashboard，导览基于左侧栏即可
    if (router.currentRoute.value.path === '/login' || router.currentRoute.value.path === '/') {
      try { await router.push('/dashboard') } catch { /* ignore */ }
    }
  }

  // 等待路由切换 + DOM 更新
  await new Promise(resolve => setTimeout(resolve, 200))

  const steps: DriveStep[] = [
    {
      element: '[data-tour="nav-dashboard"]',
      popover: { title: '系统状态', description: '服务版本、运行时长、依赖健康度都在这里。' },
    },
    {
      element: '[data-tour="nav-chat"]',
      popover: { title: 'AI 工作区', description: '不绑定任何 IM 也能直接调用 OpenCode 跑 Prompt 与工具调用。' },
    },
    {
      element: '[data-tour="nav-platforms"]',
      popover: { title: '平台接入', description: '飞书 / Discord / 微信 / 钉钉 / Telegram / QQ / WhatsApp 共八个平台开关与凭据。' },
    },
    {
      element: '[data-tour="nav-sessions"]',
      popover: { title: 'Session 管理', description: '查看 / 解绑各平台的会话绑定与轮询状态。' },
    },
    {
      element: '[data-tour="nav-opencode"]',
      popover: { title: 'OpenCode 对接', description: 'OpenCode 服务安装、启动方式与连接参数。' },
    },
    {
      element: '[data-tour="nav-reliability"]',
      popover: { title: '高可用配置', description: '心跳 / 救援策略 / 失败阈值 / 冷却窗口等可靠性参数。' },
    },
    {
      element: '[data-tour="nav-routing"]',
      popover: { title: '核心行为', description: '群聊触发条件、思考链与工具链显隐、默认工作目录等核心开关。' },
    },
    {
      element: '[data-tour="nav-cron"]',
      popover: { title: 'Cron 任务管理', description: '定时触发的提醒 / 巡检 / 自动化任务，可在这里新建启停。' },
    },
    {
      element: '[data-tour="nav-logs"]',
      popover: { title: '日志管理', description: '运行日志检索与清理，错误条数会在菜单上以红色徽标提示。' },
    },
    {
      element: '[data-tour="nav-settings"]',
      popover: { title: '系统设置', description: '界面语言、版本升级、Bridge 重启等系统级操作。' },
    },
  ]

  const tour = driver({
    showProgress: true,
    allowClose: true,
    overlayOpacity: 0.55,
    nextBtnText: '下一项',
    prevBtnText: '上一项',
    doneBtnText: '完成',
    onDestroyed: () => {
      // 用户走完或主动关闭，都视为完成
      void onboarding.markCompleted()
    },
    steps,
  })

  tour.drive()
}
</script>

<style scoped>
.onboarding-dialog :deep(.el-dialog__title) {
  font-weight: 600;
}

.onboarding-step {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.onboarding-step__lead {
  margin: 0;
  color: #5b6478;
  font-size: 14px;
  line-height: 1.6;
}

.onboarding-step__list {
  margin: 0;
  padding-left: 20px;
  color: #4a5266;
  font-size: 13px;
  line-height: 1.8;
}

.onboarding-step__note {
  margin: 0;
  color: #909399;
  font-size: 12px;
}

.onboarding-step__choices {
  display: flex;
  gap: 16px;
}

.lang-card {
  flex: 1;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 16px 18px;
  cursor: pointer;
  transition: all 0.18s ease;
  background: #fff;
}

.lang-card:hover {
  border-color: #c0c4cc;
  background: #fafbfc;
}

.lang-card--active {
  border-color: #409eff;
  background: rgba(64, 158, 255, 0.08);
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.18);
}

.lang-card__title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 4px;
}

.lang-card__sub {
  font-size: 12px;
  color: #909399;
}

.platform-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.platform-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: all 0.18s ease;
}

.platform-card:hover {
  border-color: #c0c4cc;
  background: #fafbfc;
}

.platform-card--active {
  border-color: #409eff;
  background: rgba(64, 158, 255, 0.08);
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.18);
}

.platform-card__icon {
  font-size: 22px;
  line-height: 1;
}

.platform-card__body { flex: 1; min-width: 0; }
.platform-card__label {
  font-size: 13px;
  font-weight: 600;
  color: #1f2937;
}

.platform-card__desc {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.onboarding-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.onboarding-footer__actions {
  display: flex;
  gap: 8px;
}
</style>
