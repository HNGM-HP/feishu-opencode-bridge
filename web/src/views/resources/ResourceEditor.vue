<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="700px"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <el-form v-loading="loading" :model="formData" label-position="top">
      <!-- 名称输入 -->
      <el-form-item label="名称" required>
        <el-input
          v-model="formData.name"
          placeholder="输入资源名称"
          :disabled="isEdit && !!resourceName"
        />
        <div class="field-tip" v-if="resourceType === 'mcp'">
          MCP 服务器的唯一标识符（如：github, filesystem）
        </div>
        <div class="field-tip" v-else-if="resourceType === 'skills'">
          Skill 的命令名称（如：commit, review）
        </div>
        <div class="field-tip" v-else-if="resourceType === 'agents'">
          Agent 的标识符（如：claude, coder）
        </div>
        <div class="field-tip" v-else-if="resourceType === 'providers'">
          Provider 提供商名称（如：anthropic, openai）
        </div>
      </el-form-item>

      <!-- Skills: 描述和内容 -->
      <template v-if="resourceType === 'skills'">
        <el-form-item label="描述">
          <el-input v-model="formData.description" placeholder="简要描述此 Skill 的用途" />
        </el-form-item>
        <el-form-item label="Skill 内容（Markdown）" required>
          <el-input
            v-model="formData.content"
            type="textarea"
            :rows="12"
            placeholder="输入 Skill 的 Markdown 内容..."
          />
          <div class="field-tip">
            支持 Markdown 格式，可包含参数说明、使用示例等
          </div>
        </el-form-item>
      </template>

      <!-- MCP: 命令和参数 -->
      <template v-if="resourceType === 'mcp'">
        <el-form-item label="启动命令" required>
          <el-input
            v-model="formData.command"
            placeholder="例如：npx -y @modelcontextprotocol/server-filesystem"
          />
          <div class="field-tip">
            启动 MCP 服务器的完整命令
          </div>
        </el-form-item>
        <el-form-item label="命令参数（可选）">
          <el-input
            v-model="formData.args"
            type="textarea"
            :rows="3"
            placeholder="例如：/path/to/directory"
          />
          <div class="field-tip">
            传递给 MCP 服务器的参数，每行一个
          </div>
        </el-form-item>
        <el-form-item label="环境变量（可选）">
          <el-input
            v-model="formData.env"
            type="textarea"
            :rows="3"
            placeholder="KEY1=value1&#10;KEY2=value2"
          />
          <div class="field-tip">
            环境变量，格式：KEY=value，每行一个
          </div>
        </el-form-item>
      </template>

      <!-- Agents: 配置 -->
      <template v-if="resourceType === 'agents'">
        <el-form-item label="描述">
          <el-input v-model="formData.description" placeholder="简要描述此 Agent 的用途" />
        </el-form-item>
        <el-form-item label="模式">
          <el-select v-model="formData.mode" style="width: 100%">
            <el-option label="主 Agent (primary)" value="primary" />
            <el-option label="子 Agent (subagent)" value="subagent" />
            <el-option label="全部 (all)" value="all" />
          </el-select>
          <div class="field-tip">
            指定 Agent 的运行模式
          </div>
        </el-form-item>
        <el-form-item label="默认模型">
          <el-input v-model="formData.model" placeholder="例如：claude-sonnet-4" />
          <div class="field-tip">
            留空则使用系统默认模型
          </div>
        </el-form-item>
        <el-form-item label="Agent 配置（JSON）">
          <el-input
            v-model="formData.config"
            type="textarea"
            :rows="8"
            placeholder='{"temperature": 0.7, "maxTokens": 4096}'
          />
          <div class="field-tip">
            JSON 格式的 Agent 配置参数
          </div>
        </el-form-item>
      </template>

      <!-- Providers: 配置 -->
      <template v-if="resourceType === 'providers'">
        <el-form-item label="API Base URL">
          <el-input v-model="formData.apiBase" placeholder="例如：https://api.anthropic.com" />
          <div class="field-tip">
            API 的基础 URL 地址
          </div>
        </el-form-item>
        <el-form-item label="默认模型">
          <el-input v-model="formData.defaultModel" placeholder="例如：claude-sonnet-4-20250514" />
          <div class="field-tip">
            此 Provider 的默认模型
          </div>
        </el-form-item>
        <el-form-item label="API Key">
          <el-input
            v-model="formData.apiKey"
            type="password"
            show-password
            placeholder="输入 API Key"
          />
          <div class="field-tip">
            留空则从环境变量读取
          </div>
        </el-form-item>
        <el-form-item label="Provider 配置（JSON）">
          <el-input
            v-model="formData.config"
            type="textarea"
            :rows="6"
            placeholder='{"timeout": 60000, "maxRetries": 3}'
          />
          <div class="field-tip">
            JSON 格式的额外配置参数
          </div>
        </el-form-item>
      </template>
    </el-form>

    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">
        {{ isEdit ? '保存' : '创建' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { resourcesApi } from '../../api/resources'

type ResourceType = 'skills' | 'mcp' | 'agents' | 'providers'

const props = defineProps<{
  resourceType: ResourceType
  resourceName: string
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const visible = ref(true)
const loading = ref(false)
const saving = ref(false)

interface FormData {
  name: string
  description?: string
  content?: string
  command?: string
  args?: string
  env?: string
  mode?: string
  model?: string
  apiBase?: string
  apiKey?: string
  defaultModel?: string
  config?: string
}

const formData = ref<FormData>({
  name: '',
  description: '',
  content: '',
  command: '',
  args: '',
  env: '',
  mode: 'primary',
  model: '',
  apiBase: '',
  apiKey: '',
  defaultModel: '',
  config: '',
})

const isEdit = computed(() => !!props.resourceName)

const dialogTitle = computed(() => {
  const typeLabels = {
    skills: 'Skill',
    mcp: 'MCP 服务器',
    agents: 'Agent',
    providers: 'Provider',
  }
  const label = typeLabels[props.resourceType]
  return isEdit.value ? `编辑 ${label}` : `新建 ${label}`
})

async function loadResource() {
  if (!props.resourceName) return

  loading.value = true
  try {
    const data = await resourcesApi.getResource(props.resourceType, props.resourceName)

    // Map API response to form data
    formData.value.name = data.name || ''
    formData.value.description = data.description || ''

    if (props.resourceType === 'skills') {
      formData.value.content = data.content || ''
    } else if (props.resourceType === 'mcp') {
      formData.value.command = data.command || ''
      formData.value.args = data.args?.join('\n') || ''
      formData.value.env = Object.entries(data.env || {})
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')
    } else if (props.resourceType === 'agents') {
      formData.value.mode = data.mode || 'primary'
      formData.value.model = data.model || ''
      formData.value.config = JSON.stringify(data.config || {}, null, 2)
    } else if (props.resourceType === 'providers') {
      formData.value.apiBase = data.apiBase || ''
      formData.value.defaultModel = data.defaultModel || ''
      formData.value.apiKey = data.apiKey || ''
      formData.value.config = JSON.stringify(data.config || {}, null, 2)
    }
  } catch (e: any) {
    ElMessage.error('加载失败: ' + (e.response?.data?.error || e.message))
    handleClose()
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  if (!formData.value.name) {
    ElMessage.warning('请输入名称')
    return
  }

  // Validate required fields based on type
  if (props.resourceType === 'skills' && !formData.value.content) {
    ElMessage.warning('请输入 Skill 内容')
    return
  }
  if (props.resourceType === 'mcp' && !formData.value.command) {
    ElMessage.warning('请输入启动命令')
    return
  }

  saving.value = true
  try {
    const payload: Record<string, any> = {
      name: formData.value.name,
      description: formData.value.description,
    }

    if (props.resourceType === 'skills') {
      payload.content = formData.value.content
    } else if (props.resourceType === 'mcp') {
      payload.command = formData.value.command
      payload.args = formData.value.args?.split('\n').filter(Boolean) || []
      payload.env = formData.value.env?.split('\n').reduce((acc, line) => {
        const [key, ...valueParts] = line.split('=')
        if (key && valueParts.length > 0) {
          acc[key.trim()] = valueParts.join('=').trim()
        }
        return acc
      }, {} as Record<string, string>) || {}
    } else if (props.resourceType === 'agents') {
      payload.mode = formData.value.mode
      payload.model = formData.value.model
      if (formData.value.config) {
        try {
          payload.config = JSON.parse(formData.value.config)
        } catch {
          throw new Error('配置 JSON 格式不正确')
        }
      }
    } else if (props.resourceType === 'providers') {
      payload.apiBase = formData.value.apiBase
      payload.defaultModel = formData.value.defaultModel
      payload.apiKey = formData.value.apiKey
      if (formData.value.config) {
        try {
          payload.config = JSON.parse(formData.value.config)
        } catch {
          throw new Error('配置 JSON 格式不正确')
        }
      }
    }

    if (isEdit.value) {
      await resourcesApi.updateResource(props.resourceType, props.resourceName, payload)
    } else {
      await resourcesApi.createResource(props.resourceType, payload)
    }

    emit('saved')
  } catch (e: any) {
    ElMessage.error('保存失败: ' + (e.response?.data?.error || e.message))
  } finally {
    saving.value = false
  }
}

function handleClose() {
  visible.value = false
  emit('close')
}

watch(() => props.resourceName, () => {
  if (props.resourceName) {
    loadResource()
  } else {
    formData.value = {
      name: '',
      description: '',
      content: '',
      command: '',
      args: '',
      env: '',
      mode: 'primary',
      model: '',
      apiBase: '',
      apiKey: '',
      defaultModel: '',
      config: '',
    }
  }
}, { immediate: true })
</script>

<style scoped>
.field-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;
}
</style>
