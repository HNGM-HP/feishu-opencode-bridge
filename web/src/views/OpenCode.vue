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
                <el-option v-for="p in providers" :key="p.name" :label="p.name" :value="p.name" />
              </el-select>
              <div class="field-tip">选择模型供应商</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="模型名称（DEFAULT_MODEL）">
              <el-select v-model="form.DEFAULT_MODEL" placeholder="请选择模型" filterable style="width:100%"
                :disabled="!selectedProvider">
                <el-option v-for="m in currentModels" :key="m" :label="m" :value="m" />
              </el-select>
              <div class="field-tip">选择要使用的具体模型</div>
            </el-form-item>
          </el-col>
        </el-row>
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
import type { BridgeSettings } from '../api'
import { useConfigStore } from '../stores/config'
import ConfigActionBar from '../components/ConfigActionBar.vue'

const store = useConfigStore()
const saving = ref(false)
const autoStart = ref(true)
const autoStartForeground = ref(false)
const portNum = ref(4096)
const selectedProvider = ref('')
const currentModels = ref<string[]>([])

// 从 store 获取模型列表（启动时已加载）
const providers = computed(() => store.modelProviders)

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
})

onMounted(() => {
  syncFromStore()
  initModelSelection()
})

watch(() => store.settings, () => syncFromStore(), { deep: true })

function initModelSelection() {
  // 如果已有配置的供应商，选中它
  if (form.DEFAULT_PROVIDER && providers.value.some(p => p.name === form.DEFAULT_PROVIDER)) {
    selectedProvider.value = form.DEFAULT_PROVIDER
    currentModels.value = providers.value.find(p => p.name === form.DEFAULT_PROVIDER)?.models || []
  }
}

function handleProviderChange() {
  const provider = providers.value.find(p => p.name === selectedProvider.value)
  if (provider) {
    currentModels.value = provider.models
    form.DEFAULT_PROVIDER = selectedProvider.value
    form.DEFAULT_MODEL = '' // 清空模型选择
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
  })
  portNum.value = parseInt(form.OPENCODE_PORT) || 4096
  autoStart.value = form.OPENCODE_AUTO_START === 'true'
  autoStartForeground.value = form.OPENCODE_AUTO_START_FOREGROUND === 'true'
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

@media (max-width: 900px) {
  .page-layout {
    flex-direction: column;
  }
  .sidebar {
    width: 100%;
    position: static;
    order: -1;
  }
}
</style>
