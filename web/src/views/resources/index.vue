<template>
  <div class="page">
    <div class="page-header">
      <div class="header-row">
        <div>
          <h2>资源管理</h2>
          <p class="desc">管理 Skills、MCP 服务器、Agents 和 Providers</p>
        </div>
      </div>
    </div>

    <!-- 统计卡片 -->
    <el-row :gutter="16" class="stat-row">
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-num">{{ stats.skills || 0 }}</div>
          <div class="stat-label">Skills</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-num">{{ stats.mcp || 0 }}</div>
          <div class="stat-label">MCP 服务器</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-num">{{ stats.agents || 0 }}</div>
          <div class="stat-label">Agents</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-num">{{ stats.providers || 0 }}</div>
          <div class="stat-label">Providers</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 标签页 -->
    <el-card class="config-card">
      <el-tabs v-model="activeTab" @tab-change="handleTabChange">
        <el-tab-pane label="Skills" name="skills">
          <SkillsTab
            @edit="handleEdit"
            @delete="handleDelete"
            @toggle="handleToggle"
            @refresh="loadStats"
          />
        </el-tab-pane>
        <el-tab-pane label="MCP 服务器" name="mcp">
          <McpTab
            @edit="handleEdit"
            @delete="handleDelete"
            @toggle="handleToggle"
            @refresh="loadStats"
          />
        </el-tab-pane>
        <el-tab-pane label="Agents" name="agents">
          <AgentsTab
            @edit="handleEdit"
            @delete="handleDelete"
            @toggle="handleToggle"
            @refresh="loadStats"
          />
        </el-tab-pane>
        <el-tab-pane label="Providers" name="providers">
          <ProvidersTab
            @edit="handleEdit"
            @delete="handleDelete"
            @toggle="handleToggle"
            @refresh="loadStats"
          />
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 资源编辑器弹窗 -->
    <ResourceEditor
      v-if="showEditor"
      :resource-type="editingType"
      :resource-name="editingName"
      @close="handleEditorClose"
      @saved="handleEditorSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import SkillsTab from './SkillsTab.vue'
import McpTab from './McpTab.vue'
import AgentsTab from './AgentsTab.vue'
import ProvidersTab from './ProvidersTab.vue'
import ResourceEditor from './ResourceEditor.vue'
import { resourcesApi } from '../../api/resources'
import { useResourcesStore } from '../../stores/resources'

type ResourceType = 'skills' | 'mcp' | 'agents' | 'providers'

const resourcesStore = useResourcesStore()
const { stats, loadStats } = resourcesStore

const activeTab = ref<ResourceType>('skills')
const showEditor = ref(false)
const editingType = ref<ResourceType>('skills')
const editingName = ref<string>('')

function handleTabChange(tabName: string) {
  activeTab.value = tabName as ResourceType
}

function handleEdit(type: ResourceType, name: string) {
  editingType.value = type
  editingName.value = name
  showEditor.value = true
}

async function handleDelete(type: ResourceType, name: string) {
  try {
    await resourcesApi.deleteResource(type, name)
    ElMessage.success('删除成功')
    await loadStats()
  } catch (e: any) {
    ElMessage.error('删除失败: ' + (e.response?.data?.error || e.message))
  }
}

async function handleToggle(type: ResourceType, name: string, enabled: boolean) {
  try {
    await resourcesApi.toggleResource(type, name, enabled)
    ElMessage.success(enabled ? '已启用' : '已禁用')
  } catch (e: any) {
    ElMessage.error('操作失败: ' + (e.response?.data?.error || e.message))
  }
}

function handleEditorClose() {
  showEditor.value = false
  editingName.value = ''
}

async function handleEditorSaved() {
  showEditor.value = false
  editingName.value = ''
  await loadStats()
  ElMessage.success('保存成功')
}

onMounted(() => {
  loadStats()
  resourcesStore.setupEventSource()
})

onUnmounted(() => {
  resourcesStore.unsubscribe()
})
</script>

<style scoped>
.page { max-width: 1200px; }
.page-header { margin-bottom: 20px; }
.header-row { display: flex; align-items: flex-start; justify-content: space-between; }
.page-header h2 { font-size: 22px; font-weight: 600; color: #1a1a2e; }
.desc { color: #666; margin-top: 6px; }

.stat-row { margin-bottom: 20px; }
.stat-card { text-align: center; padding: 8px 0; }
.stat-num { font-size: 32px; font-weight: 700; color: #1a1a2e; }
.stat-label { font-size: 13px; color: #909399; margin-top: 4px; }

.config-card { margin-bottom: 20px; }
</style>
