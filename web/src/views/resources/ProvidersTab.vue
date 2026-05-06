<template>
  <div class="tab-container">
    <div class="tab-header">
      <div class="header-left">
        <el-input
          v-model="searchText"
          placeholder="搜索 Providers..."
          prefix-icon="Search"
          style="width: 300px"
          clearable
        />
        <ScopeSwitch v-model="currentScope" @change="handleScopeChange" />
      </div>
      <div class="header-actions">
        <el-button :icon="Monitor" @click="openTerminal">
          OAuth 终端
        </el-button>
        <el-button type="primary" :icon="Plus" @click="handleCreate">
          添加 Provider
        </el-button>
      </div>
    </div>

    <el-table :data="filteredProviders" stripe v-loading="loading" empty-text="暂无 Providers">
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

      <el-table-column label="默认模型" min-width="200">
        <template #default="{ row }">
          <el-text size="small" truncated>{{ row.defaultModel || '-' }}</el-text>
        </template>
      </el-table-column>

      <el-table-column label="模型数量" width="100" align="center">
        <template #default="{ row }">
          <el-tag size="small" type="info">{{ row.modelCount || 0 }}</el-tag>
        </template>
      </el-table-column>

      <el-table-column label="API Base" min-width="200">
        <template #default="{ row }">
          <el-text size="small" truncated>{{ row.apiBase || '-' }}</el-text>
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

    <!-- OAuth 终端对话框 -->
    <OAuthTerminal
      v-model="terminalVisible"
      :provider="selectedProvider"
      @success="handleTerminalSuccess"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Plus, Monitor } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import StatusBadge from './StatusBadge.vue'
import OAuthTerminal from './OAuthTerminal.vue'
import ScopeSwitch from './ScopeSwitch.vue'
import { resourcesApi, type ResourceScope } from '../../api/resources'

interface ProviderItem {
  name: string
  defaultModel?: string
  apiBase?: string
  enabled: boolean
  builtIn: boolean
  status: 'enabled' | 'disabled' | 'error' | 'not_configured'
  error?: string
  modelCount?: number
}

const emit = defineEmits<{
  edit: [type: 'providers', name: string]
  delete: [type: 'providers', name: string]
  toggle: [type: 'providers', name: string, enabled: boolean]
  refresh: []
}>()

const loading = ref(false)
const searchText = ref('')
const providers = ref<ProviderItem[]>([])
const terminalVisible = ref(false)
const selectedProvider = ref<string>()
const currentScope = ref<ResourceScope>('project')

const filteredProviders = computed(() => {
  if (!searchText.value) return providers.value
  const search = searchText.value.toLowerCase()
  return providers.value.filter(p =>
    p.name.toLowerCase().includes(search) ||
    (p.apiBase && p.apiBase.toLowerCase().includes(search))
  )
})

async function loadProviders() {
  loading.value = true
  try {
    const data = await resourcesApi.listResources('providers', currentScope.value)
    providers.value = data
  } catch (e: any) {
    ElMessage.error('加载失败: ' + (e.response?.data?.error || e.message))
  } finally {
    loading.value = false
  }
}

function handleScopeChange(scope: ResourceScope) {
  currentScope.value = scope
  loadProviders()
}

function handleCreate() {
  emit('edit', 'providers', '')
}

function handleEdit(name: string) {
  emit('edit', 'providers', name)
}

async function handleToggle(name: string, enabled: boolean) {
  emit('toggle', 'providers', name, enabled)
  await loadProviders()
}

async function handleDelete(name: string) {
  try {
    await ElMessageBox.confirm(
      `确认删除 Provider「${name}」？此操作不可撤销。`,
      '确认删除',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
    emit('delete', 'providers', name)
    await loadProviders()
  } catch {
    // User cancelled
  }
}

onMounted(() => {
  loadProviders()
})

function openTerminal(provider?: string) {
  selectedProvider.value = provider
  terminalVisible.value = true
}

function handleTerminalSuccess() {
  ElMessage.success('OAuth 登录成功')
  loadProviders()
}

defineExpose({
  refresh: loadProviders,
  openTerminal
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
.header-actions { display: flex; gap: 8px; }
.name-cell { display: flex; align-items: center; gap: 8px; }
.name { font-weight: 500; }
</style>
