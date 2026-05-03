<template>
  <div class="page">
    <div class="page-header">
      <h2>OpenCode 对接配置</h2>
      <p class="desc">配置 OpenCode 服务连接地址、认证凭证与自动启动行为</p>
    </div>

    <div class="page-layout">
      <div class="form-area">
        <el-form :model="form" label-position="top" @submit.prevent>

      <el-card class="config-card">
        <template #header><span class="card-title">🔌 服务连接</span></template>
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="OpenCode 服务地址（OPENCODE_HOST）">
              <el-input v-model="form.OPENCODE_HOST" placeholder="localhost" />
              <div class="field-tip">OpenCode 服务监听的主机名或 IP，默认 localhost</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="OpenCode 端口（OPENCODE_PORT）">
              <el-input-number v-model="portNum" :min="1" :max="65535" style="width:100%" @change="form.OPENCODE_PORT = String(portNum)" />
              <div class="field-tip">OpenCode 服务监听的端口，默认 4096</div>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="OpenCode 配置文件路径（OPENCODE_CONFIG_FILE）">
              <el-input v-model="form.OPENCODE_CONFIG_FILE" placeholder="./opencode.json" />
              <div class="field-tip">宕机救援时用于备份/回退的 OpenCode 配置文件路径</div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-card>

      <el-card class="config-card">
        <template #header><span class="card-title">🔑 Basic Auth 认证</span></template>
        <el-alert type="info" :closable="false" show-icon style="margin-bottom:16px">
          当 OpenCode 服务端开启了 OPENCODE_SERVER_PASSWORD，此处必须配置相同凭据，否则将出现 401 认证失败
        </el-alert>
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="用户名（OPENCODE_SERVER_USERNAME）">
              <el-input v-model="form.OPENCODE_SERVER_USERNAME" placeholder="opencode" />
              <div class="field-tip">Basic Auth 用户名，默认值为 opencode</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="密码（OPENCODE_SERVER_PASSWORD）">
              <el-input v-model="form.OPENCODE_SERVER_PASSWORD" placeholder="留空则不启用认证"
                type="password" show-password />
              <div class="field-tip">Basic Auth 密码，需与 OpenCode 服务端配置一致</div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-card>

      <el-card class="config-card">
        <template #header>
          <div class="card-header-row">
            <span class="card-title">🚀 自动启动 OpenCode</span>
            <el-switch v-model="autoStart"
              active-text="启用" inactive-text="关闭"
              @change="form.OPENCODE_AUTO_START = autoStart ? 'true' : 'false'" />
          </div>
        </template>
        <el-alert type="info" :closable="false" show-icon style="margin-bottom:16px">
          开启后，Bridge 启动时会自动以<strong>后台无窗口模式</strong>拉起 <code>opencode serve</code>
          （幂等：已运行则跳过）
        </el-alert>

        <!-- 前台模式开关 -->
        <div class="switch-row" :class="{ disabled: !autoStart }">
          <div class="switch-label">
            <span class="switch-title">同时打开前台窗口</span>
            <span class="switch-desc">后台启动成功后额外弹出 CMD 窗口执行 <code>opencode attach http://localhost:{{ portNum }}</code>（仅 Windows）</span>
          </div>
          <el-switch
            v-model="autoStartForeground"
            :disabled="!autoStart"
            active-text="启用" inactive-text="关闭"
            @change="form.OPENCODE_AUTO_START_FOREGROUND = autoStartForeground ? 'true' : 'false'"
          />
        </div>
      </el-card>

      <el-card class="config-card">
        <template #header><span class="card-title">🤖 默认模型配置</span></template>
        <el-alert type="info" :closable="false" show-icon style="margin-bottom:16px">
          配置默认使用的 AI 模型供应商和模型名称（不启用路由模式时生效）
        </el-alert>
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="供应商（DEFAULT_PROVIDER）">
              <el-select v-model="selectedProvider" placeholder="请选择供应商" filterable style="width:100%"
                @change="handleProviderChange">
                <el-option v-for="p in providers" :key="p.id" :label="p.name" :value="p.id" />
              </el-select>
              <div class="field-tip">选择模型供应商</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="模型名称（DEFAULT_MODEL）">
              <el-select v-model="form.DEFAULT_MODEL" placeholder="请选择模型" filterable style="width:100%"
                :disabled="!selectedProvider">
                <el-option v-for="m in currentModels" :key="m.id" :label="m.name" :value="m.id" />
              </el-select>
              <div class="field-tip">选择要使用的具体模型</div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-card>

      <el-card class="config-card">
        <template #header>
          <div class="card-header-row">
            <span class="card-title">🖼️ 非多模态模型图片预处理</span>
            <el-switch v-model="visionPreprocess"
              active-text="启用" inactive-text="关闭"
              @change="form.IMAGE_VISION_PREPROCESS = visionPreprocess ? 'true' : 'false'" />
          </div>
        </template>
        <el-alert type="info" :closable="false" show-icon style="margin-bottom:16px">
          当主模型不支持图片输入时，Bridge 自动借用下方指定的<strong>多模态 model</strong> 做 OCR / 图片描述，
          把识别结果作为文本注入后转发给主模型；主模型本身支持图片则直接透传，不走此路径。
          OCR 失败会自动降级为"直发原图"保持原有行为。
        </el-alert>

        <el-form-item label="OCR 模型（VISION_OCR_MODEL）">
          <el-select v-model="form.VISION_OCR_MODEL"
            placeholder="请选择支持图片输入的模型"
            filterable clearable
            :disabled="!visionPreprocess"
            style="width:100%"
            @visible-change="handleVisionSelectVisible">
            <el-option
              v-for="m in visionModels"
              :key="`${m.providerID}/${m.modelID}`"
              :label="`${m.providerName} · ${m.modelName}`"
              :value="`${m.providerID}/${m.modelID}`"
            />
          </el-select>
          <div class="field-tip">
            下拉选项来自 opencode 已配置的、capabilities.input.image 为 true 的 model。
            如列表为空，请先在 opencode 的 provider 配置中启用任一多模态模型。
          </div>
        </el-form-item>

        <el-form-item label="OCR 引导提示词（VISION_OCR_PROMPT）">
          <el-input
            v-model="form.VISION_OCR_PROMPT"
            type="textarea"
            :rows="4"
            :disabled="!visionPreprocess"
            :placeholder="defaultVisionOcrPrompt"
          />
          <div class="field-tip">留空将使用默认提示词。建议要求模型输出中文、尽量完整转录文字与图表结构。</div>
        </el-form-item>
      </el-card>

      <el-card class="config-card">
        <template #header>
          <div class="card-header-row">
            <div>
              <span class="card-title">🧩 对话可选模型</span>
              <div class="field-tip" style="margin-top:6px">
                这里控制 Bridge 聊天界面里可供选择的模型范围，不影响 OpenCode 已安装/已配置的 provider 本身。
              </div>
            </div>
            <el-button type="primary" plain :loading="syncingEnabledModels" @click="handleSyncEnabledModels">
              刷新 OpenCode 配置
            </el-button>
          </div>
        </template>

        <el-alert type="info" :closable="false" show-icon style="margin-bottom:16px">
          支持按提供商折叠/展开，也支持按当前筛选结果全选。刷新按钮会重新读取 OpenCode 当前运行时配置与最新 provider/model 目录，并补齐配置中已声明的模型。
        </el-alert>

        <div class="model-selection-toolbar">
          <el-input
            v-model="modelSearch"
            placeholder="搜索 provider / 模型名 / 模型 ID"
            clearable
            class="model-search-input"
          />
          <div class="model-selection-actions">
            <el-checkbox
              :model-value="allModelsSelected"
              :indeterminate="allModelsIndeterminate"
              @change="toggleAllModels"
            >
              全选当前筛选结果
            </el-checkbox>
            <el-button text @click="clearSelectedModels">清空</el-button>
          </div>
        </div>

        <div class="model-selection-summary">
          已选 {{ selectedModelKeys.length }} / {{ totalSelectableModelCount }} 个模型
          <template v-if="visibleSelectableModelCount !== totalSelectableModelCount">
            ，当前筛选 {{ visibleSelectableModelCount }} 个
          </template>
        </div>

        <div v-if="filteredSelectableProviders.length === 0" class="empty-model-state">
          未找到匹配的 provider / 模型。
        </div>

        <div v-else class="provider-sections">
          <section
            v-for="provider in filteredSelectableProviders"
            :key="provider.id"
            class="provider-section"
          >
            <div class="provider-header">
              <el-checkbox
                :model-value="isProviderFullySelected(provider)"
                :indeterminate="isProviderPartiallySelected(provider)"
                @change="toggleProviderModels(provider, $event)"
              >
                {{ provider.name }}
              </el-checkbox>
              <div class="provider-header-actions">
                <span class="provider-count">
                  <template v-if="provider.totalModelCount !== provider.models.length">
                    {{ provider.models.length }} / {{ provider.totalModelCount }} 个模型
                  </template>
                  <template v-else>
                    {{ provider.totalModelCount }} 个模型
                  </template>
                </span>
                <el-button text size="small" @click="toggleProviderCollapsed(provider.id)">
                  {{ isProviderCollapsed(provider.id) ? '展开' : '收起' }}
                </el-button>
              </div>
            </div>

            <div v-show="!isProviderCollapsed(provider.id)" class="provider-model-list">
              <el-checkbox
                v-for="model in provider.models"
                :key="buildModelKey(provider.id, model.id)"
                :model-value="selectedModelKeys.includes(buildModelKey(provider.id, model.id))"
                @change="toggleSingleModel(buildModelKey(provider.id, model.id), $event)"
              >
                <div class="model-option-content">
                  <span class="model-option-name">{{ model.name }}</span>
                  <span class="model-option-id">{{ model.id }}</span>
                </div>
              </el-checkbox>
            </div>
          </section>
        </div>
      </el-card>
    </el-form>
      </div>

      <div class="sidebar">
        <ConfigActionBar
          :saving="saving"
          :config-data="form"
          @save="handleSave"
          @import-config="handleImportConfig"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { BridgeSettings, ChatModelProviderInfo, ChatVisionModelInfo } from '../api'
import { chatApi, configApi } from '../api'
import { useConfigStore } from '../stores/config'
import ConfigActionBar from '../components/ConfigActionBar.vue'

const store = useConfigStore()
const saving = ref(false)
const autoStart = ref(true)
const autoStartForeground = ref(false)
const portNum = ref(4096)
const selectedProvider = ref('')
const modelCatalog = ref<ChatModelProviderInfo[]>([])
const modelSearch = ref('')
const selectedModelKeys = ref<string[]>([])
const syncingEnabledModels = ref(false)
const collapsedProviderIds = ref<string[]>([])

// Vision OCR 预处理相关
const visionPreprocess = ref(false)
const visionModels = ref<ChatVisionModelInfo[]>([])
const visionModelsLoaded = ref(false)
const defaultVisionOcrPrompt = '请详细描述这张图片的内容，包括所有可见的文字、表格、结构、人物和关键视觉信息。输出中文描述。'

const providers = computed(() => modelCatalog.value.map(provider => ({
  id: provider.id,
  name: provider.name,
})))

const currentModels = computed(() =>
  modelCatalog.value.find(provider => provider.id === selectedProvider.value)?.models || []
)

const allSelectableModelKeys = computed(() =>
  modelCatalog.value.flatMap(provider =>
    provider.models.map(model => buildModelKey(provider.id, model.id))
  )
)

const totalSelectableModelCount = computed(() => allSelectableModelKeys.value.length)

interface SelectableProviderGroup extends ChatModelProviderInfo {
  totalModelCount: number
}

const filteredSelectableProviders = computed<SelectableProviderGroup[]>(() => {
  const keyword = modelSearch.value.trim().toLowerCase()
  if (!keyword) {
    return modelCatalog.value.map(provider => ({
      ...provider,
      totalModelCount: provider.models.length,
    }))
  }

  return modelCatalog.value
    .map(provider => {
      const totalModelCount = provider.models.length
      const providerMatched = provider.name.toLowerCase().includes(keyword) || provider.id.toLowerCase().includes(keyword)
      const models = providerMatched
        ? provider.models
        : provider.models.filter(model =>
            model.name.toLowerCase().includes(keyword) || model.id.toLowerCase().includes(keyword)
          )
      return { ...provider, models, totalModelCount }
    })
    .filter(provider => provider.models.length > 0)
})

const filteredSelectableModelKeys = computed(() =>
  filteredSelectableProviders.value.flatMap(provider =>
    provider.models.map(model => buildModelKey(provider.id, model.id))
  )
)

const visibleSelectableModelCount = computed(() => filteredSelectableModelKeys.value.length)

const allModelsSelected = computed(() =>
  visibleSelectableModelCount.value > 0
  && filteredSelectableModelKeys.value.every(key => selectedModelKeys.value.includes(key))
)

const allModelsIndeterminate = computed(() => {
  if (visibleSelectableModelCount.value === 0) return false
  const selectedVisibleCount = filteredSelectableModelKeys.value.filter(key => selectedModelKeys.value.includes(key)).length
  return selectedVisibleCount > 0 && selectedVisibleCount < visibleSelectableModelCount.value
})

const form = reactive({
  OPENCODE_HOST: 'localhost',
  OPENCODE_PORT: '4096',
  OPENCODE_AUTO_START: 'true',
  OPENCODE_AUTO_START_FOREGROUND: 'false',
  OPENCODE_SERVER_USERNAME: 'opencode',
  OPENCODE_SERVER_PASSWORD: '',
  OPENCODE_CONFIG_FILE: '',
  DEFAULT_PROVIDER: '',
  DEFAULT_MODEL: '',
  CHAT_MODEL_WHITELIST: '',
  IMAGE_VISION_PREPROCESS: 'false',
  VISION_OCR_MODEL: '',
  VISION_OCR_PROMPT: '',
})

onMounted(async () => {
  syncFromStore()
  await Promise.all([
    loadModelCatalog(),
    loadVisionModels(),
  ])
})

async function loadVisionModels(force = false) {
  if (visionModelsLoaded.value && !force) return
  try {
    visionModels.value = await chatApi.listVisionModels()
    visionModelsLoaded.value = true
  } catch (error) {
    console.warn('[OpenCode.vue] 获取多模态模型列表失败', error)
    visionModels.value = []
  }
}

function handleVisionSelectVisible(visible: boolean) {
  if (visible) loadVisionModels(true)
}

watch(() => store.settings, () => syncFromStore(), { deep: true })

watch(modelSearch, (value) => {
  if (value.trim()) {
    collapsedProviderIds.value = []
  }
})

watch(selectedModelKeys, (value) => {
  form.CHAT_MODEL_WHITELIST = JSON.stringify(value)
}, { deep: true })

function buildModelKey(providerId: string, modelId: string) {
  return `${providerId}/${modelId}`
}

function parseWhitelist(raw?: string) {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean)
  } catch {
    return raw
      .split(/[\r\n,;]+/)
      .map(item => item.trim())
      .filter(Boolean)
  }
}

async function loadModelCatalog() {
  try {
    modelCatalog.value = await configApi.getModelCatalog()
  } catch (error) {
    console.warn('[OpenCode.vue] 获取完整模型目录失败', error)
    modelCatalog.value = []
  } finally {
    initModelSelection()
  }
}

function initModelSelection() {
  if (form.DEFAULT_PROVIDER && providers.value.some(p => p.id === form.DEFAULT_PROVIDER)) {
    selectedProvider.value = form.DEFAULT_PROVIDER
  } else if (!form.DEFAULT_PROVIDER) {
    selectedProvider.value = ''
  }
}

function handleProviderChange() {
  const provider = providers.value.find(p => p.id === selectedProvider.value)
  if (provider) {
    form.DEFAULT_PROVIDER = selectedProvider.value
    form.DEFAULT_MODEL = '' // 清空模型选择
  }
}

function setSelectedModelKeys(keys: string[]) {
  selectedModelKeys.value = Array.from(new Set(keys)).sort((left, right) => left.localeCompare(right, 'en'))
}

function toggleSingleModel(key: string, checked: boolean | string | number) {
  const next = new Set(selectedModelKeys.value)
  if (Boolean(checked)) {
    next.add(key)
  } else {
    next.delete(key)
  }
  setSelectedModelKeys(Array.from(next))
}

function toggleAllModels(checked: boolean | string | number) {
  const visibleKeys = filteredSelectableModelKeys.value
  if (Boolean(checked)) {
    setSelectedModelKeys([...selectedModelKeys.value, ...visibleKeys])
    return
  }

  const visibleKeySet = new Set(visibleKeys)
  setSelectedModelKeys(selectedModelKeys.value.filter(key => !visibleKeySet.has(key)))
}

function clearSelectedModels() {
  if (!modelSearch.value.trim()) {
    selectedModelKeys.value = []
    return
  }

  const visibleKeySet = new Set(filteredSelectableModelKeys.value)
  setSelectedModelKeys(selectedModelKeys.value.filter(key => !visibleKeySet.has(key)))
}

function isProviderFullySelected(provider: ChatModelProviderInfo) {
  return provider.models.length > 0
    && provider.models.every(model => selectedModelKeys.value.includes(buildModelKey(provider.id, model.id)))
}

function isProviderPartiallySelected(provider: ChatModelProviderInfo) {
  const selectedCount = provider.models.filter(model =>
    selectedModelKeys.value.includes(buildModelKey(provider.id, model.id))
  ).length
  return selectedCount > 0 && selectedCount < provider.models.length
}

function toggleProviderModels(provider: ChatModelProviderInfo, checked: boolean | string | number) {
  const next = new Set(selectedModelKeys.value)
  for (const model of provider.models) {
    const key = buildModelKey(provider.id, model.id)
    if (Boolean(checked)) {
      next.add(key)
    } else {
      next.delete(key)
    }
  }
  setSelectedModelKeys(Array.from(next))
}

function isProviderCollapsed(providerId: string) {
  return collapsedProviderIds.value.includes(providerId)
}

function toggleProviderCollapsed(providerId: string) {
  if (isProviderCollapsed(providerId)) {
    collapsedProviderIds.value = collapsedProviderIds.value.filter(id => id !== providerId)
    return
  }

  collapsedProviderIds.value = [...collapsedProviderIds.value, providerId]
}

async function handleSyncEnabledModels() {
  syncingEnabledModels.value = true
  try {
    await Promise.all([
      loadModelCatalog(),
      loadVisionModels(true),
    ])
    const result = await configApi.syncEnabledModelsFromOpenCode()
    const availableKeys = new Set(allSelectableModelKeys.value)
    const next = new Set(selectedModelKeys.value)
    let added = 0

    for (const rawKey of result.models) {
      const key = rawKey.trim()
      if (!key || !availableKeys.has(key) || next.has(key)) {
        continue
      }
      next.add(key)
      added += 1
    }

    setSelectedModelKeys(Array.from(next))
    ElMessage.success(
      added > 0
        ? `已刷新 OpenCode 配置，并补充 ${added} 个配置模型`
        : '已刷新 OpenCode 配置，当前没有新增可勾选模型'
    )
  } catch (error: any) {
    ElMessage.error(error?.message || '刷新 OpenCode 配置失败')
  } finally {
    syncingEnabledModels.value = false
  }
}

function syncFromStore() {
  const s = store.settings
  Object.assign(form, {
    OPENCODE_HOST: s.OPENCODE_HOST || 'localhost',
    OPENCODE_PORT: s.OPENCODE_PORT || '4096',
    OPENCODE_AUTO_START: s.OPENCODE_AUTO_START || 'true',
    OPENCODE_AUTO_START_FOREGROUND: s.OPENCODE_AUTO_START_FOREGROUND || 'false',
    OPENCODE_SERVER_USERNAME: s.OPENCODE_SERVER_USERNAME || 'opencode',
    OPENCODE_SERVER_PASSWORD: s.OPENCODE_SERVER_PASSWORD || '',
    OPENCODE_CONFIG_FILE: s.OPENCODE_CONFIG_FILE || '',
    DEFAULT_PROVIDER: s.DEFAULT_PROVIDER || '',
    DEFAULT_MODEL: s.DEFAULT_MODEL || '',
    CHAT_MODEL_WHITELIST: s.CHAT_MODEL_WHITELIST || '',
    IMAGE_VISION_PREPROCESS: s.IMAGE_VISION_PREPROCESS || 'false',
    VISION_OCR_MODEL: s.VISION_OCR_MODEL || '',
    VISION_OCR_PROMPT: s.VISION_OCR_PROMPT || '',
  })
  portNum.value = parseInt(form.OPENCODE_PORT) || 4096
  autoStart.value = form.OPENCODE_AUTO_START === 'true'
  autoStartForeground.value = form.OPENCODE_AUTO_START_FOREGROUND === 'true'
  visionPreprocess.value = form.IMAGE_VISION_PREPROCESS === 'true'
  setSelectedModelKeys(parseWhitelist(form.CHAT_MODEL_WHITELIST))
  initModelSelection()
}

async function handleSave() {
  form.OPENCODE_PORT = String(portNum.value)
  form.DEFAULT_PROVIDER = selectedProvider.value
  saving.value = true
  try {
    const result = await store.saveConfig({ ...form })
    if (result.needRestart) {
      ElMessageBox.confirm(`以下配置需要重启才能生效：${result.changedKeys.join('、')}`, '配置已保存', {
        confirmButtonText: '立即重启', cancelButtonText: '稍后手动重启', type: 'warning'
      }).then(() => store.restart()).catch(() => {})
    } else {
      ElMessage.success('配置已保存')
    }
  } finally {
    saving.value = false
  }
}

function handleImportConfig(config: BridgeSettings) {
  Object.assign(form, config)
  // 同步状态
  portNum.value = parseInt(form.OPENCODE_PORT) || 4096
  autoStart.value = form.OPENCODE_AUTO_START === 'true'
  autoStartForeground.value = form.OPENCODE_AUTO_START_FOREGROUND === 'true'
  visionPreprocess.value = form.IMAGE_VISION_PREPROCESS === 'true'
  setSelectedModelKeys(parseWhitelist(form.CHAT_MODEL_WHITELIST))
  initModelSelection()
}
</script>

<style scoped>
.page { max-width: 1100px; }
.page-header { margin-bottom: 24px; }
.page-header h2 { font-size: 22px; font-weight: 600; color: #1a1a2e; }
.desc { color: #666; margin-top: 6px; }

.page-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.form-area {
  flex: 1;
  min-width: 0;
}

.sidebar {
  width: 160px;
  flex-shrink: 0;
  position: sticky;
  top: 20px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid #e4e7ed;
  padding: 16px;
}

.config-card { margin-bottom: 20px; }
.card-title { font-weight: 600; font-size: 15px; }
.card-header-row { display: flex; align-items: center; justify-content: space-between; }
.field-tip { font-size: 12px; color: #999; margin-top: 4px; line-height: 1.4; }
code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 11px; }

.switch-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0 4px;
  border-top: 1px solid #f0f0f0;
  margin-top: 4px;
}
.switch-row.disabled {
  opacity: 0.45;
  pointer-events: none;
}
.switch-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.switch-title {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}
.switch-desc {
  font-size: 12px;
  color: #999;
  line-height: 1.5;
}

.model-selection-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.model-search-input {
  flex: 1;
}

.model-selection-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.model-selection-summary {
  font-size: 12px;
  color: #666;
  margin-bottom: 14px;
}

.provider-sections {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.provider-section {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.provider-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  background: #fafafa;
  border-bottom: 1px solid #edf0f3;
}

.provider-count {
  font-size: 12px;
  color: #8a8f98;
}

.provider-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.provider-model-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
}

.provider-model-list :deep(.el-checkbox) {
  margin-right: 0;
  padding: 10px 14px;
  border-top: 1px solid #f3f4f6;
}

.provider-model-list :deep(.el-checkbox:first-child),
.provider-model-list :deep(.el-checkbox:nth-child(2)) {
  border-top: none;
}

.model-option-content {
  display: flex;
  flex-direction: column;
  gap: 3px;
  line-height: 1.35;
}

.model-option-name {
  font-size: 13px;
  color: #1f2937;
}

.model-option-id {
  font-size: 11px;
  color: #8a8f98;
}

.empty-model-state {
  padding: 18px 0;
  color: #8a8f98;
  text-align: center;
  border: 1px dashed #dcdfe6;
  border-radius: 8px;
}

@media (max-width: 900px) {
  .page-layout {
    flex-direction: column;
  }
  .sidebar {
    width: 100%;
    position: static;
    order: -1;
  }
  .model-selection-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .model-selection-actions {
    justify-content: space-between;
  }
  .provider-model-list {
    grid-template-columns: 1fr;
  }
  .provider-model-list :deep(.el-checkbox:nth-child(2)) {
    border-top: 1px solid #f3f4f6;
  }
}
</style>
