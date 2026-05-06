<template>
  <div class="page">
    <div class="page-header">
      <div class="header-row">
        <div>
          <h2>Cron 任务管理</h2>
          <p class="desc">查看和管理运行时动态创建的定时任务，支持创建、暂停、恢复和删除</p>
        </div>
        <div class="header-actions">
          <el-button :icon="Plus" type="primary" @click="showCreateDialog = true">新建任务</el-button>
          <el-button :icon="Refresh" @click="handleRefresh" :loading="refreshing">刷新</el-button>
        </div>
      </div>
    </div>

    <!-- 统计卡片 -->
    <el-row :gutter="16" class="stat-row">
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-num">{{ store.cronJobs.length }}</div>
          <div class="stat-label">全部任务</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-num green">{{ runningCount }}</div>
          <div class="stat-label">运行中</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-num gray">{{ pausedCount }}</div>
          <div class="stat-label">已暂停</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-num red">{{ errorCount }}</div>
          <div class="stat-label">有错误</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 任务列表 -->
    <el-card class="config-card">
      <el-table :data="store.cronJobs" stripe v-loading="!store.initialized" empty-text="暂无运行时 Cron 任务">

        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
              {{ row.enabled ? '运行中' : '已暂停' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="任务名称 / ID" min-width="180">
          <template #default="{ row }">
            <div class="job-name">{{ row.name || row.id }}</div>
            <div class="job-id">{{ row.id }}</div>
          </template>
        </el-table-column>

        <el-table-column label="Cron 表达式" width="150">
          <template #default="{ row }">
            <el-tag type="info" size="small" style="font-family:monospace">
              {{ row.cronExpression }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="平台 / 会话" width="160">
          <template #default="{ row }">
            <div>
              <el-tag size="small" :type="row.platform === 'feishu' ? 'primary' : 'warning'">
                {{ row.platform }}
              </el-tag>
            </div>
            <div class="job-id" style="margin-top:2px">{{ row.conversationId }}</div>
          </template>
        </el-table-column>

        <el-table-column label="上次执行" width="140">
          <template #default="{ row }">
            <span v-if="row.lastRunAt">{{ formatTime(row.lastRunAt) }}</span>
            <el-text v-else type="info" size="small">从未执行</el-text>
          </template>
        </el-table-column>

        <el-table-column label="下次触发" width="140">
          <template #default="{ row }">
            <span v-if="row.nextRunAt" :class="{ 'text-soon': isSoon(row.nextRunAt) }">
              {{ formatTime(row.nextRunAt) }}
            </span>
            <el-text v-else type="info" size="small">—</el-text>
          </template>
        </el-table-column>

        <el-table-column label="最近错误" min-width="160">
          <template #default="{ row }">
            <el-text v-if="row.state?.lastError" type="danger" size="small" truncated>
              {{ row.state.lastError }}
            </el-text>
            <el-text v-else type="success" size="small">正常</el-text>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button
              size="small"
              :type="row.enabled ? 'warning' : 'success'"
              text
              @click="handleToggle(row)"
              :loading="toggling === row.id"
            >
              {{ row.enabled ? '暂停' : '恢复' }}
            </el-button>
            <el-button
              size="small" type="danger" text
              @click="handleDelete(row)"
              :loading="deleting === row.id"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 空状态说明 -->
    <el-card v-if="store.cronJobs.length === 0 && store.initialized" class="config-card empty-hint">
      <el-empty description="暂无运行时 Cron 任务">
        <template #description>
          <p>运行时 Cron 任务由用户在对话中通过命令创建（如 <code>/cron add "0 9 * * 1-5" 每天早 9 点提醒</code>）</p>
        </template>
      </el-empty>
    </el-card>

    <!-- 新建任务对话框 -->
    <el-dialog v-model="showCreateDialog" title="新建 Cron 任务" width="600px">
      <el-form :model="createForm" label-position="top" label-width="140px">
        <el-form-item label="任务名称（可选）">
          <el-input v-model="createForm.name" placeholder="例如：每日提醒" />
          <div class="field-tip">用于标识任务的名称，可留空</div>
        </el-form-item>
        <el-form-item label="Cron 表达式" required>
          <el-input v-model="createForm.cronExpression" placeholder="0 9 * * 1-5" />
          <div class="field-tip">标准 Cron 表达式，例如：每 30 分钟=*/30 * * * *，每天 9 点=0 9 * * *</div>
        </el-form-item>
        <el-form-item label="平台" required>
          <el-select v-model="createForm.platform" style="width:100%" @change="onPlatformChange">
            <el-option value="feishu" label="飞书 (Feishu)" />
            <el-option value="discord" label="Discord" />
          </el-select>
        </el-form-item>
        <el-form-item label="会话 ID" required>
          <el-select v-model="createForm.conversationId" placeholder="请选择会话" filterable style="width:100%">
            <el-option v-for="s in currentSessionOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
          <div class="field-tip">任务触发时消息发送的目标会话 ID</div>
        </el-form-item>
        <el-form-item label="提示词（可选）">
          <el-input v-model="createForm.prompt" type="textarea" :rows="3"
            placeholder="例如：请读取 HEARTBEAT.md 文件并回复 HEARTBEAT_OK" />
          <div class="field-tip">定时触发时发送给 AI 的提示词</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Plus } from '@element-plus/icons-vue'
import { useConfigStore } from '../stores/config'
import type { CronJob, CreateCronJobInput } from '../api/index'
import { getActiveDateLocale, isEnglishLocale } from '../i18n/runtime'

const store = useConfigStore()
const refreshing = ref(false)
const toggling = ref<string | null>(null)
const deleting = ref<string | null>(null)
const creating = ref(false)
const showCreateDialog = ref(false)

const createForm = ref<CreateCronJobInput>({
  cronExpression: '',
  platform: 'feishu',
  conversationId: '',
  name: '',
  prompt: '',
})

// 从 store 获取会话数据
const sessions = computed(() => {
  const list = store.sessions
  return {
    feishu: list.filter(s => s.platform === 'feishu'),
    discord: list.filter(s => s.platform === 'discord'),
  }
})

const currentSessionOptions = computed(() => {
  const platformSessions = createForm.value.platform === 'feishu' ? sessions.value.feishu : sessions.value.discord
  return platformSessions.map(s => ({
    label: `${s.title} (${s.chatId || s.conversationId})`,
    value: (s.chatId || s.conversationId) || '',
  }))
})

const runningCount = computed(() => store.cronJobs.filter(j => j.enabled).length)
const pausedCount = computed(() => store.cronJobs.filter(j => !j.enabled).length)
const errorCount = computed(() => store.cronJobs.filter(j => !!j.state?.lastError).length)

let refreshTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  // 30秒自动刷新任务状态
  refreshTimer = setInterval(() => store.fetchCronJobs(), 30000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})

async function handleRefresh() {
  refreshing.value = true
  try {
    await store.fetchCronJobs()
    ElMessage.success('刷新成功')
  } finally {
    refreshing.value = false
  }
}

function onPlatformChange() {
  createForm.value.conversationId = ''
}

async function handleToggle(row: CronJob) {
  toggling.value = row.id
  try {
    await store.toggleCronJob(row.id)
    ElMessage.success(row.enabled ? '任务已暂停' : '任务已恢复')
  } catch {
    ElMessage.error('操作失败')
  } finally {
    toggling.value = null
  }
}

async function handleDelete(row: CronJob) {
  await ElMessageBox.confirm(
    `确认删除任务「${row.name || row.id}」？此操作不可撤销。`,
    '确认删除',
    { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
  )
  deleting.value = row.id
  try {
    await store.deleteCronJob(row.id)
    ElMessage.success('任务已删除')
  } catch {
    ElMessage.error('删除失败')
  } finally {
    deleting.value = null
  }
}

async function handleCreate() {
  if (!createForm.value.cronExpression || !createForm.value.conversationId) {
    ElMessage.error('请填写 Cron 表达式和会话 ID')
    return
  }
  creating.value = true
  try {
    await store.createCronJob(createForm.value)
    ElMessage.success('任务创建成功')
    showCreateDialog.value = false
    createForm.value = { cronExpression: '', platform: 'feishu', conversationId: '', name: '', prompt: '' }
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '创建失败')
  } finally {
    creating.value = false
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffMin = Math.round(Math.abs(diffMs) / 60000)
  if (diffMin < 1) return isEnglishLocale() ? 'just now' : '刚刚'
  if (diffMin < 60) {
    return isEnglishLocale()
      ? (diffMs < 0 ? `${diffMin} min ago` : `in ${diffMin} min`)
      : (diffMs < 0 ? `${diffMin}分钟前` : `${diffMin}分钟后`)
  }

  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) {
    return isEnglishLocale()
      ? (diffMs < 0 ? `${diffHr} hr ago` : `in ${diffHr} hr`)
      : (diffMs < 0 ? `${diffHr}小时前` : `${diffHr}小时后`)
  }

  return d.toLocaleString(getActiveDateLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function isSoon(iso: string): boolean {
  const d = new Date(iso)
  return d.getTime() - Date.now() < 5 * 60 * 1000
}
</script>

<style scoped>
.page { max-width: 1100px; }
.page-header { margin-bottom: 20px; }
.header-row { display: flex; align-items: flex-start; justify-content: space-between; }
.header-actions { display: flex; gap: 8px; }
.page-header h2 { font-size: 22px; font-weight: 600; color: #1a1a2e; }
.desc { color: #666; margin-top: 6px; }

.stat-row { margin-bottom: 20px; }
.stat-card { text-align: center; padding: 8px 0; }
.stat-num { font-size: 32px; font-weight: 700; color: #1a1a2e; }
.stat-num.green { color: #67c23a; }
.stat-num.gray { color: #909399; }
.stat-num.red { color: #f56c6c; }
.stat-label { font-size: 13px; color: #909399; margin-top: 4px; }

.config-card { margin-bottom: 20px; }
.job-name { font-weight: 500; }
.job-id { font-size: 11px; color: #aaa; font-family: monospace; }
.text-soon { color: #e6a23c; font-weight: 600; }

.field-tip { font-size: 12px; color: #999; margin-top: 4px; line-height: 1.4; }

.empty-hint code {
  background: #f0f0f0;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}
</style>
