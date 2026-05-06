<template>
  <div class="page">
    <div class="page-header">
      <h2>📊 系统状态</h2>
      <p class="desc">查看服务运行状态、配置概览与统计信息</p>
    </div>

    <!-- 核心状态卡片 -->
    <el-row :gutter="20" class="stat-row">
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-icon" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%)">
            <el-icon size="28"><Monitor /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-label">服务版本</div>
            <div class="stat-value">{{ status?.version || '-' }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-icon" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%)">
            <el-icon size="28"><Timer /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-label">运行时长</div>
            <div class="stat-value">{{ formatUptime(status?.uptime || 0) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-icon" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)">
            <el-icon size="28"><DataLine /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-label">配置存储</div>
            <div class="stat-value">{{ dbStatus }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-icon" style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)">
            <el-icon size="28"><Clock /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-label">启动时间</div>
            <div class="stat-value">{{ formatStartTime(status?.startedAt) }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

        <el-card shadow="never" class="config-card">
      <template #header>
        <div class="card-header-row">
          <span class="card-title">⏱️ Cron 任务概览</span>
          <el-button size="small" @click="$router.push('/cron')">管理任务</el-button>
        </div>
      </template>
      <el-row :gutter="20">
        <el-col :span="6">
          <div class="cron-stat">
            <div class="cron-stat-num">{{ jobs.length }}</div>
            <div class="cron-stat-label">全部任务</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="cron-stat">
            <div class="cron-stat-num green">{{ runningCount }}</div>
            <div class="cron-stat-label">运行中</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="cron-stat">
            <div class="cron-stat-num gray">{{ pausedCount }}</div>
            <div class="cron-stat-label">已暂停</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="cron-stat">
            <div class="cron-stat-num red">{{ errorCount }}</div>
            <div class="cron-stat-label">有错误</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 健康状态检测 -->
    <el-card shadow="never" class="config-card">
      <template #header>
        <div class="card-header-row">
          <span class="card-title">🏥 健康状态检测</span>
          <div class="header-actions">
            <el-button size="small" :icon="Refresh" @click="checkHealth" :loading="healthLoading">检测</el-button>
            <el-button size="small" type="warning" :icon="Setting" @click="handleRepair" :loading="repairLoading">修复</el-button>
          </div>
        </div>
      </template>
      <el-row :gutter="16">
        <el-col :span="6" v-for="(check, key) in healthChecks" :key="key">
          <div class="health-item" :class="'health-' + check.status">
            <div class="health-icon">
              <el-icon v-if="check.status === 'ok'" color="#67c23a"><CircleCheck /></el-icon>
              <el-icon v-else-if="check.status === 'warning'" color="#e6a23c"><Warning /></el-icon>
              <el-icon v-else color="#f56c6c"><CircleClose /></el-icon>
            </div>
            <div class="health-info">
              <div class="health-name">{{ getHealthName(key) }}</div>
              <div class="health-message">{{ check.message }}</div>
            </div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 配置摘要 -->
    <el-card shadow="never" class="config-card">
      <template #header>
        <span class="card-title"> 配置摘要</span>
      </template>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="路由模式">{{ settings.ROUTER_MODE || 'legacy' }}</el-descriptions-item>
        <el-descriptions-item label="会话绑定">{{ settings.ENABLE_MANUAL_SESSION_BIND === 'true' ? '允许' : '禁止' }}</el-descriptions-item>
        <el-descriptions-item label="显示思维链">{{ settings.SHOW_THINKING_CHAIN === 'true' ? '是' : '否' }}</el-descriptions-item>
        <el-descriptions-item label="显示工具链">{{ settings.SHOW_TOOL_CHAIN === 'true' ? '是' : '否' }}</el-descriptions-item>
        <el-descriptions-item label="工作目录白名单">
          <el-text v-if="settings.ALLOWED_DIRECTORIES" type="primary" size="small">{{ settings.ALLOWED_DIRECTORIES }}</el-text>
          <el-text v-else type="info" size="small">未配置</el-text>
        </el-descriptions-item>
        <el-descriptions-item label="工具白名单">
          <el-text v-if="settings.TOOL_WHITELIST" type="primary" size="small">{{ settings.TOOL_WHITELIST }}</el-text>
          <el-text v-else type="info" size="small">未配置</el-text>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  Monitor, Timer, DataLine, Clock, Warning,
  Refresh, Setting, CircleCheck, CircleClose
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useConfigStore } from '../stores/config'
import { configApi } from '../api/index'
import { getActiveDateLocale, isEnglishLocale } from '../i18n/runtime'

const store = useConfigStore()

// 直接使用 store 的响应式数据
const status = computed(() => store.status)
const jobs = computed(() => store.cronJobs)
const settings = computed(() => store.settings)

// 健康检测状态
interface HealthCheck {
  status: 'ok' | 'warning' | 'error' | 'unknown'
  message: string
}

const healthLoading = ref(false)
const repairLoading = ref(false)
const healthChecks = ref<Record<string, HealthCheck>>({
  database: { status: 'unknown', message: '未检测' },
  opencode: { status: 'unknown', message: '未检测' },
  feishu: { status: 'unknown', message: '未检测' },
  discord: { status: 'unknown', message: '未检测' },
  wecom: { status: 'unknown', message: '未检测' },
  telegram: { status: 'unknown', message: '未检测' },
  qq: { status: 'unknown', message: '未检测' },
  whatsapp: { status: 'unknown', message: '未检测' },
})

const dbStatus = computed(() => {
  if (!status.value?.dbPath) return '未知'
  // 同时支持 Unix 和 Windows 路径分隔符
  const parts = status.value.dbPath.split(/[/\\]/)
  return parts[parts.length - 1] || 'SQLite'
})

const runningCount = computed(() => jobs.value.filter(j => j.enabled).length)
const pausedCount = computed(() => jobs.value.filter(j => !j.enabled).length)
const errorCount = computed(() => jobs.value.filter(j => !!j.state?.lastError).length)

onMounted(() => {
  checkHealth()
})

async function checkHealth() {
  healthLoading.value = true
  try {
    const health = await configApi.getHealth()
    healthChecks.value = health.checks as Record<string, HealthCheck>
  } catch (e: any) {
    ElMessage.error('健康检测失败: ' + e.message)
  } finally {
    healthLoading.value = false
  }
}

async function handleRepair() {
  repairLoading.value = true
  try {
    const result = await configApi.repair()
    if (result.results.length > 0) {
      ElMessage.success('修复完成: ' + result.results.join(', '))
    } else {
      ElMessage.info('无需修复')
    }
    // 重新检测健康状态
    await checkHealth()
  } catch (e: any) {
    ElMessage.error('修复失败: ' + e.message)
  } finally {
    repairLoading.value = false
  }
}

function getHealthName(key: string): string {
  const names: Record<string, string> = {
    database: '数据库',
    opencode: 'OpenCode',
    feishu: '飞书',
    discord: 'Discord',
    wecom: '企业微信',
    telegram: 'Telegram',
    qq: 'QQ',
    whatsapp: 'WhatsApp',
  }
  return names[key] || key
}

function formatUptime(seconds: number): string {
  if (isEnglishLocale()) {
    if (seconds < 60) return `${seconds} sec`
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min`
    const hours = Math.floor(seconds / 3600)
    if (hours < 24) return `${hours} hr`
    const days = Math.floor(hours / 24)
    return `${days} d ${hours % 24} hr`
  }

  if (seconds < 60) return `${seconds}秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`
  const hours = Math.floor(seconds / 3600)
  if (hours < 24) return `${hours}小时`
  const days = Math.floor(hours / 24)
  return `${days}天${hours % 24}小时`
}

function formatStartTime(iso?: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleString(getActiveDateLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.page { max-width: 1200px; }
.page-header { margin-bottom: 24px; }
.page-header h2 { font-size: 22px; font-weight: 600; color: #1a1a2e; }
.desc { color: #666; margin-top: 6px; }

.stat-row { margin-bottom: 20px; }
.stat-card {
  display: flex;
  align-items: center;
  padding: 16px;
  cursor: pointer;
  transition: transform 0.2s;
}
.stat-card:hover { transform: translateY(-2px); }
.stat-icon {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  margin-right: 16px;
  flex-shrink: 0;
}
.stat-content { flex: 1; }
.stat-label { font-size: 13px; color: #909399; margin-bottom: 4px; }
.stat-value { font-size: 18px; font-weight: 600; color: #1a1a2e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.config-card { margin-bottom: 20px; }
.card-title { font-weight: 600; font-size: 15px; }
.card-header-row { display: flex; align-items: center; justify-content: space-between; }

.cron-stat {
  text-align: center;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 8px;
}
.cron-stat-num { font-size: 28px; font-weight: 700; color: #1a1a2e; }
.cron-stat-num.green { color: #67c23a; }
.cron-stat-num.gray { color: #909399; }
.cron-stat-num.red { color: #f56c6c; }
.cron-stat-label { font-size: 12px; color: #909399; margin-top: 4px; }

.health-item {
  display: flex;
  align-items: center;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 8px;
  margin-bottom: 12px;
}
.health-ok { background: #f0f9eb; }
.health-warning { background: #fdf6ec; }
.health-error { background: #fef0f0; }
.health-icon { margin-right: 12px; }
.health-info { flex: 1; }
.health-name { font-size: 14px; font-weight: 600; color: #1a1a2e; }
.health-message { font-size: 12px; color: #909399; margin-top: 2px; }
.header-actions { display: flex; gap: 8px; }
</style>
