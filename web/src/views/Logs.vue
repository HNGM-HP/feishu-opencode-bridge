<template>
  <div class="page">
    <div class="page-header">
      <div class="header-row">
        <div>
          <h2>日志管理</h2>
          <p class="desc">查看和筛选系统运行日志，支持按级别、关键词搜索</p>
        </div>
        <div class="header-actions">
          <el-button :icon="Download" @click="handleExport">导出</el-button>
          <el-button :icon="Delete" type="danger" @click="handleClear">清空</el-button>
        </div>
      </div>
    </div>

    <!-- 统计卡片 -->
    <el-row :gutter="16" class="stat-row">
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-num">{{ stats.total }}</div>
          <div class="stat-label">全部日志</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-num red">{{ stats.error }}</div>
          <div class="stat-label">错误</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-num yellow">{{ stats.warn }}</div>
          <div class="stat-label">警告</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-num blue">{{ stats.info }}</div>
          <div class="stat-label">信息</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 筛选区 -->
    <el-card class="filter-card">
      <el-row :gutter="16" align="middle">
        <el-col :span="4">
          <el-select v-model="filterLevel" placeholder="日志级别" clearable style="width:100%">
            <el-option label="全部" value="" />
            <el-option label="Debug" value="debug" />
            <el-option label="Info" value="info" />
            <el-option label="Warn" value="warn" />
            <el-option label="Error" value="error" />
          </el-select>
        </el-col>
        <el-col :span="6">
          <el-input v-model="searchText" placeholder="搜索关键词..." clearable :prefix-icon="Search" />
        </el-col>
        <el-col :span="6">
          <el-button :icon="Refresh" @click="loadLogs" :loading="loading">刷新</el-button>
          <el-checkbox v-model="autoRefresh" style="margin-left:12px">自动刷新</el-checkbox>
        </el-col>
      </el-row>
    </el-card>

    <!-- 日志表格 -->
    <el-card class="log-card">
      <el-table
        :data="logs"
        stripe
        v-loading="loading"
        empty-text="暂无日志"
        :row-class-name="getRowClass"
        max-height="500"
      >
        <el-table-column label="时间" width="100">
          <template #default="{ row }">
            <span class="log-time">{{ formatTime(row.timestamp) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="级别" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="getLevelType(row.level)" size="small" effect="dark">
              {{ row.level.toUpperCase() }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="来源" width="120">
          <template #default="{ row }">
            <span class="log-source">[{{ row.source }}]</span>
          </template>
        </el-table-column>

        <el-table-column label="消息" min-width="400">
          <template #default="{ row }">
            <div class="log-message" :title="row.message">
              {{ row.message }}
            </div>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[50, 100, 200, 500]"
          layout="total, sizes, prev, pager, next"
          @size-change="loadLogs"
          @current-change="loadLogs"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Download, Delete, Search } from '@element-plus/icons-vue'
import { configApi, type LogEntry, type LogStats, type LogLevel } from '../api/index'
import { getActiveDateLocale } from '../i18n/runtime'

const loading = ref(false)
const logs = ref<LogEntry[]>([])
const stats = ref<LogStats>({ total: 0, debug: 0, info: 0, warn: 0, error: 0 })
const filterLevel = ref<LogLevel | ''>('')
const searchText = ref('')
const currentPage = ref(1)
const pageSize = ref(100)
const total = ref(0)
const autoRefresh = ref(false)

let refreshTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  loadLogs()
  loadStats()
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})

// 自动刷新
watch(autoRefresh, (val) => {
  if (val) {
    refreshTimer = setInterval(() => {
      loadLogs()
      loadStats()
    }, 5000)
  } else if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
})

// 筛选条件变化时重置页码并重新加载
watch([filterLevel, searchText], () => {
  currentPage.value = 1
  loadLogs()
})

async function loadLogs() {
  loading.value = true
  try {
    const result = await configApi.getLogs({
      level: filterLevel.value || undefined,
      search: searchText.value || undefined,
      page: currentPage.value,
      limit: pageSize.value,
    })
    logs.value = result.entries
    total.value = result.total
  } catch (e: any) {
    ElMessage.error('加载日志失败: ' + e.message)
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  try {
    stats.value = await configApi.getLogStats()
  } catch {
    // ignore
  }
}

async function handleClear() {
  await ElMessageBox.confirm('确定要清空所有日志吗？此操作不可撤销。', '确认清空', {
    type: 'warning',
    confirmButtonText: '确认清空',
    cancelButtonText: '取消',
  })
  try {
    await configApi.clearLogs()
    ElMessage.success('日志已清空')
    loadLogs()
    loadStats()
  } catch (e: any) {
    ElMessage.error('清空失败: ' + e.message)
  }
}

function handleExport() {
  const data = logs.value.map(log => ({
    时间: formatTime(log.timestamp),
    级别: log.level.toUpperCase(),
    来源: log.source,
    消息: log.message,
  }))

  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `logs-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('导出成功')
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(getActiveDateLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function getLevelType(level: LogLevel): 'danger' | 'warning' | 'primary' | 'info' {
  switch (level) {
    case 'error': return 'danger'
    case 'warn': return 'warning'
    case 'info': return 'primary'
    default: return 'info'
  }
}

function getRowClass({ row }: { row: LogEntry }): string {
  if (row.level === 'error') return 'row-error'
  if (row.level === 'warn') return 'row-warn'
  return ''
}
</script>

<style scoped>
.page { max-width: 1200px; }
.page-header { margin-bottom: 20px; }
.header-row { display: flex; align-items: flex-start; justify-content: space-between; }
.header-actions { display: flex; gap: 8px; }
.page-header h2 { font-size: 22px; font-weight: 600; color: #1a1a2e; }
.desc { color: #666; margin-top: 6px; }

.stat-row { margin-bottom: 20px; }
.stat-card { text-align: center; }
.stat-card :deep(.el-card__body) { padding: 20px; }
.stat-num { font-size: 32px; font-weight: 700; color: #1a1a2e; }
.stat-num.red { color: #f56c6c; }
.stat-num.yellow { color: #e6a23c; }
.stat-num.blue { color: #409eff; }
.stat-label { font-size: 13px; color: #909399; margin-top: 4px; }

.filter-card { margin-bottom: 16px; }
.log-card { margin-bottom: 20px; }

.log-time { font-family: monospace; font-size: 12px; color: #909399; }
.log-source { font-family: monospace; font-size: 12px; color: #606266; }
.log-message {
  font-family: monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 60px;
  overflow: hidden;
}

.pagination-wrap { margin-top: 16px; display: flex; justify-content: flex-end; }

:deep(.row-error) { background-color: #fef0f0 !important; }
:deep(.row-warn) { background-color: #fdf6ec !important; }
</style>
