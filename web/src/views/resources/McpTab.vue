<template>
  <div class="tab-container">
    <div class="tab-header">
      <div class="header-left">
        <el-input
          v-model="searchText"
          placeholder="搜索 MCP 服务器..."
          prefix-icon="Search"
          style="width: 300px"
          clearable
        />
        <ScopeSwitch v-model="currentScope" @change="handleScopeChange" />
      </div>
      <el-button type="primary" :icon="Plus" @click="handleCreate">
        添加服务器
      </el-button>
    </div>

    <el-table :data="filteredMcpServers" stripe v-loading="loading" empty-text="暂无 MCP 服务器">
      <el-table-column label="状态" width="100" align="center">
        <template #default="{ row }">
          <StatusBadge :status="row.status" :error="row.error" />
        </template>
      </el-table-column>

      <el-table-column label="名称" min-width="180">
        <template #default="{ row }">
          <div class="name-cell">
            <span class="name">{{ row.name }}</span>
            <el-tag v-if="row.builtIn" size="small" type="info">内置</el-tag>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="命令" min-width="250">
        <template #default="{ row }">
          <el-text size="small" truncated>{{ row.command || '-' }}</el-text>
        </template>
      </el-table-column>

      <el-table-column label="工具数" width="100" align="center">
        <template #default="{ row }">
          <el-tag size="small" type="info">{{ row.toolCount || 0 }}</el-tag>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button
            size="small"
            type="primary"
            text
            @click="handleEdit(row.name)"
            :disabled="row.builtIn"
          >
            编辑
          </el-button>
          <el-button
            size="small"
            :type="row.enabled ? 'warning' : 'success'"
            text
            @click="handleToggle(row.name, !row.enabled)"
            :disabled="row.builtIn"
          >
            {{ row.enabled ? '禁用' : '启用' }}
          </el-button>
          <el-button
            size="small"
            type="danger"
            text
            @click="handleDelete(row.name)"
            :disabled="row.builtIn"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import StatusBadge from './StatusBadge.vue'
import ScopeSwitch from './ScopeSwitch.vue'
import { resourcesApi, type ResourceScope } from '../../api/resources'
import { invalidateCommandsCache } from '../chat/slash-command-cache'

interface McpServerItem {
  name: string
  command?: string
  enabled: boolean
  builtIn: boolean
  status: 'enabled' | 'disabled' | 'error' | 'not_configured'
  error?: string
  toolCount?: number
}

const emit = defineEmits<{
  edit: [type: 'mcp', name: string]
  delete: [type: 'mcp', name: string]
  toggle: [type: 'mcp', name: string, enabled: boolean]
  refresh: []
}>()

const loading = ref(false)
const searchText = ref('')
const mcpServers = ref<McpServerItem[]>([])
const currentScope = ref<ResourceScope>('project')

const filteredMcpServers = computed(() => {
  if (!searchText.value) return mcpServers.value
  const search = searchText.value.toLowerCase()
  return mcpServers.value.filter(s =>
    s.name.toLowerCase().includes(search) ||
    (s.command && s.command.toLowerCase().includes(search))
  )
})

async function loadMcpServers() {
  loading.value = true
  try {
    const data = await resourcesApi.listResources('mcp', currentScope.value)
    mcpServers.value = data
  } catch (e: any) {
    ElMessage.error('加载失败: ' + (e.response?.data?.error || e.message))
  } finally {
    loading.value = false
  }
}

function handleScopeChange(scope: ResourceScope) {
  currentScope.value = scope
  loadMcpServers()
}

function handleCreate() {
  emit('edit', 'mcp', '')
}

function handleEdit(name: string) {
  emit('edit', 'mcp', name)
}

async function handleToggle(name: string, enabled: boolean) {
  emit('toggle', 'mcp', name, enabled)
  await loadMcpServers()
  // Invalidate slash commands cache when an MCP server is toggled
  invalidateCommandsCache()
}

async function handleDelete(name: string) {
  try {
    await ElMessageBox.confirm(
      `确认删除 MCP 服务器「${name}」？此操作不可撤销。`,
      '确认删除',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
    emit('delete', 'mcp', name)
    await loadMcpServers()
    // Invalidate slash commands cache when an MCP server is deleted
    invalidateCommandsCache()
  } catch {
    // User cancelled
  }
}

onMounted(() => {
  loadMcpServers()
})

defineExpose({
  refresh: loadMcpServers
})
</script>

<style scoped>
.tab-container { padding: 8px 0; }
.tab-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}
.name-cell { display: flex; align-items: center; gap: 8px; }
.name { font-weight: 500; }
</style>
