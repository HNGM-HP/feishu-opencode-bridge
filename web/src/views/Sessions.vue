<template>
  <div class="page">
    <div class="page-header">
      <div class="header-row">
        <div>
          <h2>Session 管理</h2>
          <p class="desc">管理各平台会话与 OpenCode Session 之间的绑定关系</p>
        </div>
        <div class="header-actions">
          <el-button :icon="Plus" type="primary" @click="openBindDialog()">新增绑定</el-button>
          <el-popover placement="bottom-end" :width="220" trigger="click">
            <template #reference>
              <el-button :icon="Setting">显示列</el-button>
            </template>
            <div class="column-toggle-list">
              <label v-for="column in columnOptions" :key="column.key" class="column-toggle-item">
                <el-checkbox v-model="columnVisibility[column.key]">
                  {{ column.label }}
                </el-checkbox>
              </label>
            </div>
          </el-popover>
          <el-button :icon="Refresh" @click="loadData(true)" :loading="loading">刷新</el-button>
        </div>
      </div>
    </div>

    <!-- 统计卡片 -->
    <el-row :gutter="16" class="stat-row">
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-num">{{ stats.total }}</div>
          <div class="stat-label">OpenCode Sessions</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-num green">{{ stats.bound }}</div>
          <div class="stat-label">已绑定</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-num gray">{{ stats.unbound }}</div>
          <div class="stat-label">未绑定</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-num blue">{{ stats.bindingCount }}</div>
          <div class="stat-label">绑定关系数</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- OpenCode 状态提示 -->
    <el-alert
      v-if="!openCodeAvailable"
      title="OpenCode 服务不可用"
      type="warning"
      description="无法连接到 OpenCode 服务，仅显示本地绑定数据。部分功能可能受限。"
      show-icon
      closable
      class="status-alert"
    />

    <!-- 筛选区 -->
    <el-card class="filter-card">
      <el-row :gutter="16" align="middle">
        <el-col :span="4">
          <el-select v-model="filterBindStatus" placeholder="绑定状态" clearable style="width:100%">
            <el-option label="全部" value="" />
            <el-option label="已绑定" value="bound" />
            <el-option label="未绑定" value="unbound" />
          </el-select>
        </el-col>
        <el-col :span="4">
          <el-select v-model="filterPlatform" placeholder="平台" clearable style="width:100%">
            <el-option label="全部平台" value="" />
            <el-option v-for="p in platforms" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-col>
        <el-col :span="6">
          <el-input v-model="searchText" placeholder="搜索 Session ID / 标题..." clearable :prefix-icon="Search" @input="debouncedSearch" />
        </el-col>
      </el-row>
    </el-card>

    <!-- 批量操作栏 -->
    <div v-if="selectedRows.length > 0" class="batch-actions">
      <span>已选择 {{ selectedRows.length }} 项</span>
      <el-button size="small" @click="handleBatchUnbind">批量解绑</el-button>
      <el-button size="small" type="danger" @click="handleBatchDelete">批量删除</el-button>
      <el-button size="small" text @click="selectedRows = []">取消选择</el-button>
    </div>

    <!-- 数据表格 -->
    <el-card class="data-card">
      <el-table
        :data="pagedSessions"
        stripe
        border
        v-loading="loading"
        empty-text="暂无会话数据"
        row-key="id"
        @selection-change="handleSelectionChange"
        @sort-change="handleSortChange"
      >
        <el-table-column type="selection" width="50" />

        <el-table-column
          v-if="columnVisibility.id"
          prop="id"
          label="Session ID"
          min-width="180"
          resizable
          sortable="custom"
        >
          <template #default="{ row }">
            <div class="session-id" :title="row.id">
              {{ row.id }}
            </div>
          </template>
        </el-table-column>

        <el-table-column
          v-if="columnVisibility.title"
          prop="title"
          label="标题"
          min-width="150"
          resizable
          show-overflow-tooltip
          sortable="custom"
        >
          <template #default="{ row }">
            <span class="title-text">{{ row.title || '未命名会话' }}</span>
          </template>
        </el-table-column>

        <el-table-column
          v-if="columnVisibility.directory"
          prop="directory"
          label="工作目录"
          min-width="180"
          resizable
          show-overflow-tooltip
          sortable="custom"
        >
          <template #default="{ row }">
            <span class="dir-text">{{ row.directory || row.projectPath || '-' }}</span>
          </template>
        </el-table-column>

        <el-table-column
          v-if="columnVisibility.bindStatus"
          prop="isBound"
          label="绑定状态"
          width="120"
          min-width="90"
          align="center"
          resizable
          sortable="custom"
        >
          <template #default="{ row }">
            <el-tag v-if="row.localOnly" type="warning" size="small">仅本地</el-tag>
            <el-tag v-else :type="row.isBound ? 'success' : 'info'" size="small">
              {{ row.isBound ? '已绑定' : '未绑定' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column
          v-if="columnVisibility.bindings"
          prop="bindings"
          label="绑定详情"
          min-width="200"
          resizable
          sortable="custom"
        >
          <template #default="{ row }">
            <div v-if="row.bindings.length > 0" class="bindings-list">
              <div v-for="(b, idx) in row.bindings" :key="idx" class="binding-item">
                <el-tag size="small" effect="plain" class="platform-tag">{{ getPlatformName(b.platform) }}</el-tag>
                <span class="conv-id" :title="b.conversationId">{{ b.conversationId }}</span>
                <el-tag v-if="b.chatType" :type="b.chatType === 'p2p' ? 'success' : 'info'" size="small" class="chat-type">
                  {{ b.chatType === 'p2p' ? '私聊' : '群聊' }}
                </el-tag>
              </div>
            </div>
            <span v-else class="no-binding">-</span>
          </template>
        </el-table-column>

        <el-table-column
          v-if="columnVisibility.updatedAt"
          prop="updatedAt"
          label="最后修改时间"
          min-width="176"
          resizable
          sortable="custom"
        >
          <template #default="{ row }">
            <span class="time-text">{{ formatDateTime(row.updatedAt) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="200" min-width="160" fixed="right" resizable>
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openBindDialog(undefined, row.id)">
              {{ row.isBound ? '更改' : '绑定' }}
            </el-button>
            <el-button v-if="row.isBound" link type="warning" size="small" @click="handleUnbindAll(row)">解绑</el-button>
            <el-button link type="danger" size="small" @click="handleDeleteSession(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
        />
      </div>
    </el-card>

    <!-- 绑定对话框 -->
    <el-dialog
      v-model="bindDialogVisible"
      :title="'绑定平台会话'"
      width="600px"
      destroy-on-close
    >
      <el-form :model="bindForm" label-width="120px" :rules="bindRules" ref="bindFormRef">
        <el-form-item label="OpenCode Session" prop="sessionId">
          <el-select
            v-model="bindForm.sessionId"
            placeholder="选择 OpenCode Session"
            style="width:100%"
            filterable
            :loading="loadingSessions"
            @focus="handleSessionSelectFocus"
          >
            <el-option
              v-for="s in openCodeSessions"
              :key="s.id"
              :label="s.title ? `${s.title} (${s.id})` : s.id"
              :value="s.id"
            >
              <div class="session-option">
                <span>{{ s.title || '未命名会话' }}</span>
                <span class="session-option-id">{{ s.id }}</span>
                <el-tag v-if="s.isBound" type="success" size="small" class="bound-tag">已绑定</el-tag>
              </div>
            </el-option>
          </el-select>
        </el-form-item>

        <el-form-item label="平台" prop="platform">
          <el-select v-model="bindForm.platform" placeholder="选择平台" style="width:100%">
            <el-option v-for="p in platforms" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
          <div class="form-hint" v-if="bindForm.platform === 'feishu'">
            飞书 API 无法自动枚举私聊；群聊可直接选择，私聊请手动输入会话 ID 并指定类型。
          </div>
        </el-form-item>

        <el-form-item label="会话 ID" prop="conversationId">
          <el-select
            v-model="bindForm.conversationId"
            :placeholder="bindForm.platform ? '选择平台聊天' : '请先选择平台'"
            style="width:100%"
            filterable
            allow-create
            default-first-option
            :loading="loadingPlatformChats"
            :disabled="!bindForm.platform"
            @change="handleChatSelect"
          >
            <el-option
              v-for="chat in platformChats"
              :key="chat.id"
              :label="chat.name"
              :value="chat.id"
            >
              <div class="chat-option">
                <span class="chat-name">{{ chat.name }}</span>
                <el-tag :type="chat.type === 'p2p' ? 'success' : chat.type === 'channel' ? 'warning' : 'info'" size="small">
                  {{ chat.type === 'p2p' ? '私聊' : chat.type === 'channel' ? '频道' : '群聊' }}
                </el-tag>
                <el-tag v-if="chat.isBound" type="danger" size="small" class="bound-tag">已绑定</el-tag>
              </div>
            </el-option>
          </el-select>
          <div class="form-hint">
            <template v-if="!bindForm.platform">请先选择平台，系统将自动加载该平台的聊天列表</template>
            <template v-else-if="bindForm.platform === 'feishu'">飞书 API 无法自动枚举私聊；群聊可直接选择，私聊请手动输入会话 ID 并指定类型</template>
            <template v-else-if="platformChats.length === 0 && !loadingPlatformChats">该平台暂无可用聊天，请手动输入会话 ID</template>
            <template v-else>选择平台聊天或手动输入会话 ID</template>
          </div>
        </el-form-item>

        <el-form-item label="标题">
          <el-input v-model="bindForm.title" placeholder="会话标题（可选）" />
        </el-form-item>

        <el-form-item label="会话类型">
          <el-select v-model="bindForm.chatType" placeholder="选择会话类型" clearable style="width:100%">
            <el-option label="私聊" value="p2p" />
            <el-option label="群聊" value="group" />
          </el-select>
          <div class="form-hint">
            选择聊天时会自动带出类型；如果是手动输入会话 ID，尤其飞书私聊，请在这里手动指定。
          </div>
        </el-form-item>

        <el-form-item label="工作目录">
          <el-input v-model="bindForm.sessionDirectory" placeholder="工作目录路径（可选）" />
        </el-form-item>

        <el-form-item label="创建者 ID">
          <el-input v-model="bindForm.creatorId" placeholder="创建者 ID（可选）" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="bindDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmitBind" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch, reactive } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Plus, Refresh, Search, Setting } from '@element-plus/icons-vue'
import {
  sessionApi,
  type PlatformInfo,
  type OpenCodeSession,
  type PlatformChat,
} from '../api/index'

const loading = ref(false)
const loadingSessions = ref(false)
const loadingPlatformChats = ref(false)
const sessions = ref<OpenCodeSession[]>([])
const platforms = ref<PlatformInfo[]>([])
const openCodeSessions = ref<OpenCodeSession[]>([])
const openCodeAvailable = ref(true)
const platformChats = ref<PlatformChat[]>([])
const dataLoadedOnce = ref(false)
const lastLoadedTime = ref<number>(0)
const CACHE_MAX_AGE_MS = 5 * 60 * 1000 // 5 分钟缓存

const filterBindStatus = ref<'bound' | 'unbound' | ''>('')
const filterPlatform = ref('')
const searchText = ref('')
const currentPage = ref(1)
const pageSize = ref(20)
const sortState = ref<{ prop: SortableSessionColumn | ''; order: 'ascending' | 'descending' | null }>({
  prop: '',
  order: null,
})

const selectedRows = ref<OpenCodeSession[]>([])

type SortableSessionColumn = 'id' | 'title' | 'directory' | 'isBound' | 'bindings' | 'updatedAt'
type ColumnVisibilityKey = 'id' | 'title' | 'directory' | 'bindStatus' | 'bindings' | 'updatedAt'

const columnVisibility = reactive<Record<ColumnVisibilityKey, boolean>>({
  id: true,
  title: true,
  directory: true,
  bindStatus: true,
  bindings: true,
  updatedAt: false,
})

const columnOptions: Array<{ key: ColumnVisibilityKey; label: string }> = [
  { key: 'id', label: 'Session ID' },
  { key: 'title', label: '标题' },
  { key: 'directory', label: '工作目录' },
  { key: 'bindStatus', label: '绑定状态' },
  { key: 'bindings', label: '绑定详情' },
  { key: 'updatedAt', label: '最后修改时间' },
]

// 防抖
let searchTimer: ReturnType<typeof setTimeout> | null = null
const debouncedSearch = () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    currentPage.value = 1
  }, 300)
}

// 统计数据
const stats = computed(() => {
  const bound = sessions.value.filter(s => s.isBound).length
  const bindingCount = sessions.value.reduce((sum, s) => sum + s.bindings.length, 0)
  return {
    total: sessions.value.length,
    bound,
    unbound: sessions.value.length - bound,
    bindingCount,
  }
})

// 筛选后的数据
const filteredSessions = computed(() => {
  let result = sessions.value

  // 绑定状态筛选
  if (filterBindStatus.value === 'bound') {
    result = result.filter(s => s.isBound)
  } else if (filterBindStatus.value === 'unbound') {
    result = result.filter(s => !s.isBound)
  }

  // 平台筛选
  if (filterPlatform.value) {
    result = result.filter(s => s.bindings.some(b => b.platform === filterPlatform.value))
  }

  // 关键词搜索
  if (searchText.value) {
    const searchLower = searchText.value.toLowerCase()
    result = result.filter(s =>
      s.id.toLowerCase().includes(searchLower) ||
      (s.title?.toLowerCase().includes(searchLower)) ||
      (s.directory?.toLowerCase().includes(searchLower)) ||
      s.bindings.some(b =>
        b.conversationId.toLowerCase().includes(searchLower) ||
        b.title?.toLowerCase().includes(searchLower)
      )
    )
  }

  if (!sortState.value.prop || !sortState.value.order) {
    return result
  }

  const direction = sortState.value.order === 'ascending' ? 1 : -1
  const sorted = [...result]
  sorted.sort((left, right) => compareSessions(left, right, sortState.value.prop as SortableSessionColumn, direction))
  return sorted
})

const total = computed(() => filteredSessions.value.length)

// 分页后的数据
const pagedSessions = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredSessions.value.slice(start, start + pageSize.value)
})

// 对话框相关
const bindDialogVisible = ref(false)
const submitting = ref(false)
const bindFormRef = ref<FormInstance>()

const bindForm = ref({
  platform: '',
  conversationId: '',
  sessionId: '',
  title: '',
  chatType: '' as '' | 'p2p' | 'group',
  sessionDirectory: '',
  creatorId: '',
})

const bindRules: FormRules = {
  sessionId: [{ required: true, message: '请选择 Session', trigger: 'change' }],
  platform: [{ required: true, message: '请选择平台', trigger: 'change' }],
  conversationId: [{ required: true, message: '请选择或输入会话 ID', trigger: 'change' }],
}

onMounted(() => {
  loadData()
})

// 监听筛选条件重置分页
watch([filterBindStatus, filterPlatform], () => {
  currentPage.value = 1
})

// 监听平台选择，加载该平台的聊天列表
watch(() => bindForm.value.platform, async (newPlatform) => {
  if (newPlatform && bindDialogVisible.value) {
    // 重置会话类型和已选聊天
    bindForm.value.chatType = ''
    bindForm.value.conversationId = ''
    platformChats.value = []
    await loadPlatformChats(newPlatform)
  }
})

async function loadPlatformChats(platform: string) {
  loadingPlatformChats.value = true
  platformChats.value = []
  try {
    const result = await sessionApi.getPlatformChats(platform)
    platformChats.value = result.chats
  } catch (e: any) {
    console.error('获取平台聊天列表失败:', e)
    ElMessage.warning('获取平台聊天列表失败，请手动输入会话 ID')
  } finally {
    loadingPlatformChats.value = false
  }
}

async function loadData(forceRefresh = false) {
  loading.value = true

  // 检查缓存是否有效
  const now = Date.now()
  const cacheValid = !forceRefresh && dataLoadedOnce.value && (now - lastLoadedTime.value) < CACHE_MAX_AGE_MS

  if (cacheValid) {
    console.log('[Sessions] 使用缓存数据')
    loading.value = false
    return
  }

  try {
    const [sessionsResult, platformsResult] = await Promise.all([
      sessionApi.getOpenCodeSessions(),
      sessionApi.getPlatforms(),
    ])
    sessions.value = sessionsResult.sessions
    openCodeSessions.value = sessionsResult.sessions
    openCodeAvailable.value = sessionsResult.openCodeAvailable
    platforms.value = platformsResult

    if (!sessionsResult.openCodeAvailable) {
      ElMessage.warning('OpenCode 服务不可用，仅显示本地绑定数据')
    }

    dataLoadedOnce.value = true
    lastLoadedTime.value = now
    console.log(`[Sessions] 数据已加载，共 ${sessions.value.length} 个会话`)
  } catch (e: any) {
    ElMessage.error('加载数据失败: ' + e.message)
  } finally {
    loading.value = false
  }
}

async function handleSessionSelectFocus() {
  if (openCodeSessions.value.length === 0 || !openCodeAvailable.value) {
    loadingSessions.value = true
    try {
      const result = await sessionApi.getOpenCodeSessions()
      openCodeSessions.value = result.sessions
      openCodeAvailable.value = result.openCodeAvailable
    } catch {
      // ignore
    } finally {
      loadingSessions.value = false
    }
  }
}

function getPlatformName(platformId: string): string {
  return platforms.value.find(p => p.id === platformId)?.name || platformId
}

function handleSelectionChange(rows: OpenCodeSession[]) {
  selectedRows.value = rows
}

function handleSortChange(payload: { prop: string; order: 'ascending' | 'descending' | null }) {
  const prop = payload.prop as SortableSessionColumn | ''
  sortState.value = {
    prop,
    order: payload.order,
  }
  currentPage.value = 1
}

function compareSessions(
  left: OpenCodeSession,
  right: OpenCodeSession,
  prop: SortableSessionColumn,
  direction: 1 | -1,
) {
  const compareText = (a: string, b: string) => a.localeCompare(b, 'zh-Hans-CN')

  switch (prop) {
    case 'id':
      return compareText(left.id || '', right.id || '') * direction
    case 'title':
      return compareText(left.title || '', right.title || '') * direction
    case 'directory':
      return compareText(left.directory || left.projectPath || '', right.directory || right.projectPath || '') * direction
    case 'isBound': {
      const leftRank = left.localOnly ? 2 : left.isBound ? 1 : 0
      const rightRank = right.localOnly ? 2 : right.isBound ? 1 : 0
      if (leftRank !== rightRank) {
        return (leftRank - rightRank) * direction
      }
      return compareText(left.id || '', right.id || '') * direction
    }
    case 'bindings': {
      const bindingCountDiff = left.bindings.length - right.bindings.length
      if (bindingCountDiff !== 0) {
        return bindingCountDiff * direction
      }
      const leftBindings = left.bindings.map(item => `${item.platform}:${item.conversationId}`).join('|')
      const rightBindings = right.bindings.map(item => `${item.platform}:${item.conversationId}`).join('|')
      return compareText(leftBindings, rightBindings) * direction
    }
    case 'updatedAt': {
      const leftTime = left.updatedAt || 0
      const rightTime = right.updatedAt || 0
      if (leftTime !== rightTime) {
        return (leftTime - rightTime) * direction
      }
      return compareText(left.id || '', right.id || '') * direction
    }
    default:
      return 0
  }
}

function formatDateTime(timestamp?: number) {
  if (!timestamp) {
    return '-'
  }
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function openBindDialog(_binding?: undefined, sessionId?: string) {
  bindForm.value = {
    platform: '',
    conversationId: '',
    sessionId: sessionId || '',
    title: '',
    chatType: '',
    sessionDirectory: '',
    creatorId: '',
  }
  platformChats.value = []
  bindDialogVisible.value = true
}

function handleChatSelect(chatId: string) {
  const chat = platformChats.value.find(c => c.id === chatId)
  if (chat) {
    // 自动填充标题
    if (!bindForm.value.title) {
      bindForm.value.title = chat.name
    }
    // 自动填充会话类型
    if (!bindForm.value.chatType && chat.type !== 'channel') {
      bindForm.value.chatType = chat.type
    }
  }
}

async function handleSubmitBind() {
  if (!bindFormRef.value) return

  try {
    await bindFormRef.value.validate()
  } catch {
    return
  }

  submitting.value = true
  try {
    await sessionApi.createBinding({
      platform: bindForm.value.platform,
      conversationId: bindForm.value.conversationId.trim(),
      sessionId: bindForm.value.sessionId,
      title: bindForm.value.title || undefined,
      chatType: bindForm.value.chatType || undefined,
      sessionDirectory: bindForm.value.sessionDirectory || undefined,
      creatorId: bindForm.value.creatorId || undefined,
    })
    ElMessage.success('绑定已创建')
    bindDialogVisible.value = false
    loadData(true)
  } catch (e: any) {
    ElMessage.error('创建失败: ' + (e.response?.data?.error || e.message))
  } finally {
    submitting.value = false
  }
}

async function handleUnbindAll(row: OpenCodeSession) {
  if (!row.bindings.length) return

  const bindingText = row.bindings.map(b =>
    `${getPlatformName(b.platform)}: ${b.conversationId}`
  ).join('\n')

  await ElMessageBox.confirm(
    `确定要解除以下所有绑定吗？\n\n${bindingText}`,
    '确认解除绑定',
    { type: 'warning' }
  )

  try {
    const result = await sessionApi.batchOperation(
      'unbind',
      row.bindings.map(b => ({ platform: b.platform, conversationId: b.conversationId }))
    )
    ElMessage.success(`已解除 ${result.successCount} 个绑定`)
    loadData(true)
  } catch (e: any) {
    ElMessage.error('解除绑定失败: ' + e.message)
  }
}

async function handleDeleteSession(row: OpenCodeSession) {
  const hasBindings = row.bindings.length > 0
  const isLocalOnly = row.localOnly
  let message = ''

  if (isLocalOnly) {
    message = hasBindings
      ? `此 Session 仅存在于本地绑定，OpenCode 中已不存在。确定要清除 ${row.bindings.length} 个绑定关系吗？`
      : '此 Session 仅存在于本地，确定要清除吗？'
  } else {
    message = hasBindings
      ? `确定要删除此 Session 吗？这将同时解除 ${row.bindings.length} 个绑定关系。`
      : '确定要删除此 Session 吗？'
  }

  await ElMessageBox.confirm(message, '确认删除', { type: 'error' })

  try {
    // 先解绑
    if (hasBindings) {
      await sessionApi.batchOperation(
        'unbind',
        row.bindings.map(b => ({ platform: b.platform, conversationId: b.conversationId }))
      )
    }

    // 删除 OpenCode session（如果不是仅本地）
    if (!isLocalOnly && openCodeAvailable.value) {
      await sessionApi.deleteOpenCodeSession(row.id)
    }

    ElMessage.success('Session 已删除')
    loadData(true)
  } catch (e: any) {
    ElMessage.error('删除失败: ' + e.message)
  }
}

// 批量解绑
async function handleBatchUnbind() {
  const bindingsToDelete: Array<{ platform: string; conversationId: string }> = []
  for (const row of selectedRows.value) {
    for (const b of row.bindings) {
      bindingsToDelete.push({ platform: b.platform, conversationId: b.conversationId })
    }
  }

  if (bindingsToDelete.length === 0) {
    ElMessage.warning('选中的 Session 没有绑定关系')
    return
  }

  await ElMessageBox.confirm(
    `确定要解除选中的 ${selectedRows.value.length} 个 Session 的 ${bindingsToDelete.length} 个绑定吗？`,
    '批量解绑',
    { type: 'warning' }
  )

  try {
    const result = await sessionApi.batchOperation('unbind', bindingsToDelete)
    ElMessage.success(`已解除 ${result.successCount} 个绑定`)
    selectedRows.value = []
    loadData(true)
  } catch (e: any) {
    ElMessage.error('批量解绑失败: ' + e.message)
  }
}

// 批量删除
async function handleBatchDelete() {
  const selectedCount = selectedRows.value.length
  const totalBindings = selectedRows.value.reduce((sum, row) => sum + row.bindings.length, 0)

  await ElMessageBox.confirm(
    `确定要删除选中的 ${selectedCount} 个 Session 吗？${totalBindings > 0 ? `这将同时解除 ${totalBindings} 个绑定关系。` : ''}`,
    '批量删除',
    { type: 'error' }
  )

  try {
    // 收集所有绑定
    const allBindings: Array<{ platform: string; conversationId: string }> = []
    for (const row of selectedRows.value) {
      for (const b of row.bindings) {
        allBindings.push({ platform: b.platform, conversationId: b.conversationId })
      }
    }

    // 先解绑
    if (allBindings.length > 0) {
      await sessionApi.batchOperation('unbind', allBindings)
    }

    // 删除 OpenCode sessions
    for (const row of selectedRows.value) {
      if (!row.localOnly && openCodeAvailable.value) {
        await sessionApi.deleteOpenCodeSession(row.id)
      }
    }

    ElMessage.success(`已删除 ${selectedCount} 个 Session`)
    selectedRows.value = []
    loadData(true)
  } catch (e: any) {
    ElMessage.error('批量删除失败: ' + e.message)
  }
}
</script>

<style scoped>
.page { max-width: 1400px; }
.page-header { margin-bottom: 20px; }
.header-row { display: flex; align-items: flex-start; justify-content: space-between; }
.header-actions { display: flex; gap: 8px; }
.page-header h2 { font-size: 22px; font-weight: 600; color: #1a1a2e; }
.desc { color: #666; margin-top: 6px; }

.stat-row { margin-bottom: 20px; }
.status-alert { margin-bottom: 16px; }
.stat-card { text-align: center; }
.stat-card :deep(.el-card__body) { padding: 20px; }
.stat-num { font-size: 32px; font-weight: 700; color: #1a1a2e; }
.stat-num.blue { color: #409eff; }
.stat-num.green { color: #67c23a; }
.stat-num.gray { color: #909399; }
.stat-label { font-size: 13px; color: #909399; margin-top: 4px; }

.filter-card { margin-bottom: 16px; }
.data-card { margin-bottom: 20px; }

.column-toggle-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.column-toggle-item {
  display: flex;
  align-items: center;
}

.batch-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #f4f4f5;
  border-radius: 4px;
  margin-bottom: 16px;
  font-size: 14px;
  color: #606266;
}

.session-id {
  font-family: monospace;
  font-size: 12px;
  color: #606266;
}

.title-text { font-size: 13px; }

.dir-text {
  font-size: 12px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}

.time-text {
  font-size: 12px;
  color: #606266;
  white-space: nowrap;
}

.bindings-list { display: flex; flex-direction: column; gap: 4px; }
.binding-item { display: flex; align-items: center; gap: 6px; }
.platform-tag { flex-shrink: 0; }
.conv-id {
  font-family: monospace;
  font-size: 11px;
  color: #606266;
}
.chat-type { flex-shrink: 0; }
.no-binding { color: #c0c4cc; }

.session-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.session-option-id {
  font-family: monospace;
  font-size: 12px;
  color: #909399;
}
.bound-tag { margin-left: auto; }

.chat-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.chat-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.form-hint {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.pagination-wrap { margin-top: 16px; display: flex; justify-content: flex-end; }
</style>
