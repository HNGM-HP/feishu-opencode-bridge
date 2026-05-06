<template>
  <div class="tab-container">
    <div class="tab-header">
      <div class="header-left">
        <el-input
          v-model="searchText"
          placeholder="搜索 Skills..."
          prefix-icon="Search"
          style="width: 300px"
          clearable
        />
        <ScopeSwitch v-model="currentScope" @change="handleScopeChange" />
      </div>
      <el-button type="primary" :icon="Plus" @click="handleCreate">
        新建 Skill
      </el-button>
    </div>

    <el-table :data="filteredSkills" stripe v-loading="loading" empty-text="暂无 Skills">
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

      <el-table-column label="描述" min-width="250">
        <template #default="{ row }">
          <el-text size="small" :title="row.description">
            {{ row.description || '-' }}
          </el-text>
        </template>
      </el-table-column>

      <el-table-column label="最后修改" width="160">
        <template #default="{ row }">
          <span v-if="row.lastModified">{{ formatTime(row.lastModified) }}</span>
          <el-text v-else type="info" size="small">-</el-text>
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

interface SkillItem {
  name: string
  description?: string
  enabled: boolean
  builtIn: boolean
  status: 'enabled' | 'disabled' | 'error' | 'not_configured'
  error?: string
  lastModified?: string
}

const emit = defineEmits<{
  edit: [type: 'skills', name: string]
  delete: [type: 'skills', name: string]
  toggle: [type: 'skills', name: string, enabled: boolean]
  refresh: []
}>()

const loading = ref(false)
const searchText = ref('')
const skills = ref<SkillItem[]>([])
const currentScope = ref<ResourceScope>('project')

const filteredSkills = computed(() => {
  if (!searchText.value) return skills.value
  const search = searchText.value.toLowerCase()
  return skills.value.filter(s =>
    s.name.toLowerCase().includes(search) ||
    (s.description && s.description.toLowerCase().includes(search))
  )
})

async function loadSkills() {
  loading.value = true
  try {
    const data = await resourcesApi.listResources('skills', currentScope.value)
    skills.value = data
  } catch (e: any) {
    ElMessage.error('加载失败: ' + (e.response?.data?.error || e.message))
  } finally {
    loading.value = false
  }
}

function handleScopeChange(scope: ResourceScope) {
  currentScope.value = scope
  loadSkills()
}

function handleCreate() {
  emit('edit', 'skills', '')
}

function handleEdit(name: string) {
  emit('edit', 'skills', name)
}

async function handleToggle(name: string, enabled: boolean) {
  emit('toggle', 'skills', name, enabled)
  await loadSkills()
  // Invalidate slash commands cache when a skill is toggled
  invalidateCommandsCache()
}

async function handleDelete(name: string) {
  try {
    await ElMessageBox.confirm(
      `确认删除 Skill「${name}」？此操作不可撤销。`,
      '确认删除',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
    emit('delete', 'skills', name)
    await loadSkills()
    // Invalidate slash commands cache when a skill is deleted
    invalidateCommandsCache()
  } catch {
    // User cancelled
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffMin = Math.round(Math.abs(diffMs) / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin}分钟前`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}小时前`
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(() => {
  loadSkills()
})

defineExpose({
  refresh: loadSkills
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
