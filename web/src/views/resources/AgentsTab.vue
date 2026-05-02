<template>
  <div class="tab-container">
    <div class="tab-header">
      <div class="header-left">
        <el-input
          v-model="searchText"
          placeholder="搜索 Agents..."
          prefix-icon="Search"
          style="width: 300px"
          clearable
        />
        <ScopeSwitch v-model="currentScope" @change="handleScopeChange" />
      </div>
      <el-button type="primary" :icon="Plus" @click="handleCreate">
        新建 Agent
      </el-button>
    </div>

    <el-table :data="filteredAgents" stripe v-loading="loading" empty-text="暂无 Agents">
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
            <el-tag v-if="row.mode" size="small" :type="getModeType(row.mode)">
              {{ getModeLabel(row.mode) }}
            </el-tag>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="描述" min-width="250">
        <template #default="{ row }">
          <el-text size="small" :title="row.description">
            {{ row.description || '-' }}
          </el-text>
        </template>
      </el-table-column>

      <el-table-column label="模型" width="150">
        <template #default="{ row }">
          <el-text size="small" truncated>{{ row.model || '-' }}</el-text>
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

interface AgentItem {
  name: string
  description?: string
  model?: string
  enabled: boolean
  builtIn: boolean
  mode?: 'primary' | 'subagent' | 'all'
  status: 'enabled' | 'disabled' | 'error' | 'not_configured'
  error?: string
}

const emit = defineEmits<{
  edit: [type: 'agents', name: string]
  delete: [type: 'agents', name: string]
  toggle: [type: 'agents', name: string, enabled: boolean]
  refresh: []
}>()

const loading = ref(false)
const searchText = ref('')
const agents = ref<AgentItem[]>([])
const currentScope = ref<ResourceScope>('project')

const filteredAgents = computed(() => {
  if (!searchText.value) return agents.value
  const search = searchText.value.toLowerCase()
  return agents.value.filter(a =>
    a.name.toLowerCase().includes(search) ||
    (a.description && a.description.toLowerCase().includes(search))
  )
})

async function loadAgents() {
  loading.value = true
  try {
    const data = await resourcesApi.listResources('agents', currentScope.value)
    agents.value = data
  } catch (e: any) {
    ElMessage.error('加载失败: ' + (e.response?.data?.error || e.message))
  } finally {
    loading.value = false
  }
}

function handleScopeChange(scope: ResourceScope) {
  currentScope.value = scope
  loadAgents()
}

function getModeType(mode: string) {
  switch (mode) {
    case 'primary': return 'success'
    case 'subagent': return 'warning'
    case 'all': return 'info'
    default: return 'info'
  }
}

function getModeLabel(mode: string) {
  switch (mode) {
    case 'primary': return '主'
    case 'subagent': return '子'
    case 'all': return '全部'
    default: return mode
  }
}

function handleCreate() {
  emit('edit', 'agents', '')
}

function handleEdit(name: string) {
  emit('edit', 'agents', name)
}

async function handleToggle(name: string, enabled: boolean) {
  emit('toggle', 'agents', name, enabled)
  await loadAgents()
  // Invalidate slash commands cache when an agent is toggled
  invalidateCommandsCache()
}

async function handleDelete(name: string) {
  try {
    await ElMessageBox.confirm(
      `确认删除 Agent「${name}」？此操作不可撤销。`,
      '确认删除',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
    emit('delete', 'agents', name)
    await loadAgents()
    // Invalidate slash commands cache when an agent is deleted
    invalidateCommandsCache()
  } catch {
    // User cancelled
  }
}

onMounted(() => {
  loadAgents()
})

defineExpose({
  refresh: loadAgents
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
