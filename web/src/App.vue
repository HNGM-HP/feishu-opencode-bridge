<template>
  <el-config-provider :locale="elementPlusLocale">
    <el-container class="app-container">
    <!-- 侧边栏 -->
    <el-aside width="220px" class="sidebar">
      <div class="logo">
        <el-icon size="24"><Monitor /></el-icon>
        <span>Bridge</span>
      </div>
      <el-menu :router="true" :default-active="activeMenu" class="nav-menu">
        <el-menu-item index="/dashboard">
          <el-icon><DataAnalysis /></el-icon>
          <span>系统状态</span>
        </el-menu-item>
        <el-menu-item index="/chat">
          <el-icon><ChatLineSquare /></el-icon>
          <span>AI 工作区</span>
        </el-menu-item>
        <el-menu-item index="/platforms">
          <el-icon><ChatDotRound /></el-icon>
          <span>平台接入</span>
        </el-menu-item>
        <el-menu-item index="/sessions">
          <el-icon><Link /></el-icon>
          <span>Session 管理</span>
        </el-menu-item>
        <el-menu-item index="/opencode">
          <el-icon><Connection /></el-icon>
          <span>OpenCode 对接</span>
        </el-menu-item>
        <el-menu-item index="/reliability">
          <el-icon><Warning /></el-icon>
          <span>高可用配置</span>
        </el-menu-item>
        <el-menu-item index="/routing">
          <el-icon><Setting /></el-icon>
          <span>核心行为</span>
        </el-menu-item>
        <el-menu-item index="/cron">
          <el-icon><Timer /></el-icon>
          <span>Cron 任务管理</span>
          <el-badge v-if="store.cronJobCount > 0" :value="store.runningJobCount" type="success" class="cron-badge" />
        </el-menu-item>
        <el-menu-item index="/logs">
          <el-icon><Document /></el-icon>
          <span>日志管理</span>
          <el-badge v-if="errorLogCount > 0" :value="errorLogCount" type="danger" class="cron-badge" />
        </el-menu-item>
        <el-menu-item index="/settings">
          <el-icon><Setting /></el-icon>
          <span>系统设置</span>
        </el-menu-item>
      </el-menu>

      <!-- 底部状态区 -->
      <div class="sidebar-footer">
        <div v-if="status" class="status-info">
          <el-text size="small" type="info">v{{ status.version }}</el-text>
          <el-text size="small" type="info">运行 {{ formatUptime(status.uptime) }}</el-text>
        </div>
        <div class="footer-row">
          <el-button
            size="small"
            :icon="Key"
            @click="handleChangePassword"
            class="footer-btn"
          >
            修改密码
          </el-button>
          <el-button
            type="danger"
            size="small"
            :icon="SwitchButton"
            @click="handleLogout"
            class="footer-btn"
            plain
          >
            退出
          </el-button>
        </div>
      </div>
    </el-aside>

    <!-- 内容区 -->
    <el-main :class="['main-content', { 'main-content--workspace': isChatRoute }]">
      <!-- 待重启提示横幅 -->
      <el-alert
        v-if="store.pendingRestart"
        type="warning"
        :closable="false"
        show-icon
        class="restart-banner"
      >
        <template #title>
          以下配置需要重启服务才能生效：{{ store.pendingRestartKeys.join('、') }}
        </template>
        <template #default>
          <el-button size="small" type="warning" @click="handleRestart">立即重启</el-button>
          <el-button size="small" @click="goToSettings">前往系统设置</el-button>
          <el-button size="small" @click="store.pendingRestart = false">稍后手动重启</el-button>
        </template>
      </el-alert>

      <router-view v-if="!store.loading" />
      <div v-else class="loading-mask">
        <el-icon class="is-loading" size="40"><Loading /></el-icon>
      </div>
    </el-main>
    </el-container>

    <!-- 重启确认弹窗 -->
    <el-dialog v-model="restartDialogVisible" title="确认重启服务" width="420px">
      <p>重启将中断当前所有连接，服务将在 1 秒后退出（需配合 PM2/systemd 自动拉起）。</p>
      <p v-if="store.pendingRestartKeys.length">待生效配置：<strong>{{ store.pendingRestartKeys.join('、') }}</strong></p>
      <template #footer>
        <el-button @click="restartDialogVisible = false">取消</el-button>
        <el-button type="warning" :loading="restarting" @click="confirmRestart">确认重启</el-button>
      </template>
    </el-dialog>
  </el-config-provider>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { DataAnalysis, Loading, Document, SwitchButton, Key, Link, ChatLineSquare, ChatDotRound, Connection, Warning, Setting, Timer, Monitor } from '@element-plus/icons-vue'
import { useConfigStore } from './stores/config'
import { configApi } from './api/index'
import type { ServiceStatus } from './api/index'
import { appLocale, elementPlusLocale, isEnglishLocale, translateUiText } from './i18n/runtime'

const route = useRoute()
const router = useRouter()
const store = useConfigStore()
const status = ref<ServiceStatus | null>(null)
const restartDialogVisible = ref(false)
const restarting = ref(false)
const loginError = ref(false)
const errorLogCount = ref(0)

// 登录超时相关
const loginTimeoutMinutes = ref(0)
const lastActivityTime = ref(Date.now())
let timeoutCheckInterval: ReturnType<typeof setInterval> | null = null

const isChatRoute = computed(() => route.path === '/chat' || route.path.startsWith('/chat/'))
const activeMenu = computed(() => isChatRoute.value ? '/chat' : route.path)

async function loadAppData() {
  if (route.path === '/login' || !localStorage.getItem('admin_token')) return
  try {
    await store.initializeAll()
    status.value = store.status
    // 加载日志统计
    const logStats = await configApi.getLogStats()
    errorLogCount.value = logStats.error
    // 加载登录超时配置
    const timeoutRes = await configApi.getLoginTimeout()
    loginTimeoutMinutes.value = timeoutRes.timeoutMinutes
    startTimeoutChecker()
  } catch (e: any) {
    if (e.response?.status === 401) {
      loginError.value = true
      router.push('/login')
    }
  }
}

// 启动超时检查器
function startTimeoutChecker() {
  stopTimeoutChecker()
  if (loginTimeoutMinutes.value <= 0) return // 0 表示不限制

  // 每分钟检查一次
  timeoutCheckInterval = setInterval(() => {
    const timeoutMs = loginTimeoutMinutes.value * 60 * 1000
    const elapsed = Date.now() - lastActivityTime.value
    if (elapsed >= timeoutMs) {
      ElMessage.warning('登录已超时，请重新登录')
      handleLogout()
    }
  }, 60000) // 每分钟检查一次
}

// 停止超时检查器
function stopTimeoutChecker() {
  if (timeoutCheckInterval) {
    clearInterval(timeoutCheckInterval)
    timeoutCheckInterval = null
  }
}

// 更新活动时间
function updateActivity() {
  lastActivityTime.value = Date.now()
}

onMounted(() => {
  loadAppData()
  // 监听用户活动
  document.addEventListener('click', updateActivity)
  document.addEventListener('keydown', updateActivity)
  document.addEventListener('mousemove', updateActivity)
})

onUnmounted(() => {
  stopTimeoutChecker()
  document.removeEventListener('click', updateActivity)
  document.removeEventListener('keydown', updateActivity)
  document.removeEventListener('mousemove', updateActivity)
})

// 监听路由变化，登录成功后跳转到 Dashboard 时加载数据
watch(() => route.path, (newPath, oldPath) => {
  if (oldPath === '/login' && newPath !== '/login' && localStorage.getItem('admin_token')) {
    loadAppData()
  }
})

watch(
  [() => route.meta.title, appLocale],
  ([title]) => {
    const pageTitle = typeof title === 'string' && title.trim()
      ? `${translateUiText(title)} · OpenCode Bridge`
      : 'OpenCode Bridge'
    document.title = pageTitle
  },
  { immediate: true }
)

function formatUptime(seconds: number): string {
  if (isEnglishLocale()) {
    if (seconds < 60) return `${seconds} sec`
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min`
    return `${Math.floor(seconds / 3600)} hr`
  }

  if (seconds < 60) return `${seconds}秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`
  return `${Math.floor(seconds / 3600)}小时`
}

function handleRestart() {
  restartDialogVisible.value = true
}

async function confirmRestart() {
  restarting.value = true
  try {
    await store.restart()
    ElMessage.success('重启指令已发送，服务即将退出...')
    restartDialogVisible.value = false
  } catch {
    ElMessage.error('重启失败，请手动执行')
  } finally {
    restarting.value = false
  }
}

function handleLogout() {
  localStorage.removeItem('admin_token')
  stopTimeoutChecker()
  router.push('/login')
}

function handleChangePassword() {
  router.push('/change-password')
}

function goToSettings() {
  router.push('/settings')
}
</script>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f7fa; }

.app-container { height: 100vh; }

.sidebar {
  background: #1a1a2e;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 16px;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  border-bottom: 1px solid #2a2a4a;
}

.nav-menu {
  flex: 1;
  border-right: none;
  background: transparent;
  --el-menu-bg-color: transparent;
  --el-menu-text-color: #a0a8c0;
  --el-menu-active-color: #fff;
  --el-menu-hover-bg-color: rgba(255,255,255,0.08);
  --el-menu-item-height: 48px;
}

.nav-menu .el-menu-item.is-active {
  background-color: rgba(64, 158, 255, 0.2) !important;
  color: #409eff;
}

.cron-badge { margin-left: auto; }

.sidebar-footer {
  padding: 16px;
  border-top: 1px solid #2a2a4a;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.status-info { display: flex; flex-direction: column; gap: 2px; }
.footer-row { display: flex; gap: 8px; margin-top: 4px; }
.footer-btn { flex: 1; }

.main-content {
  padding: 24px;
  overflow-y: auto;
  background: #f5f7fa;
}

.main-content--workspace {
  padding: 0;
  overflow: hidden;
}

.restart-banner { margin-bottom: 20px; }
.loading-mask {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 300px;
}
</style>
