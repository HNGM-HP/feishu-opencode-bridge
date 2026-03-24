<template>
  <div class="page">
    <div class="page-header">
      <h2>核心行为配置</h2>
      <p class="desc">配置路由模式、输出显示、工作目录、工具白名单等核心行为参数</p>
    </div>

    <div class="page-layout">
      <div class="form-area">
        <el-form :model="form" label-position="top" @submit.prevent>

      <!-- 路由与会话 -->
      <el-card class="config-card">
        <template #header><span class="card-title">🔀 路由模式与会话</span></template>
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="路由模式（ROUTER_MODE）">
              <el-select v-model="form.ROUTER_MODE" style="width:100%">
                <el-option value="legacy" label="legacy — 稳定模式（推荐生产使用）" />
                <el-option value="dual" label="dual — 双轨对比模式（记录新旧路由差异日志）" />
                <el-option value="router" label="router — 新路由模式（实验性）" />
              </el-select>
              <div class="field-tip">控制消息路由引擎，legacy 是默认稳定模式；dual 可用于灰度验证新路由</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="允许手动绑定已有会话（ENABLE_MANUAL_SESSION_BIND）">
              <el-switch v-model="enableManualBind" active-text="允许" inactive-text="禁止"
                @change="form.ENABLE_MANUAL_SESSION_BIND = enableManualBind ? 'true' : 'false'" />
              <div class="field-tip">
                开启后用户可以通过 <code>/session &lt;sessionId&gt;</code> 绑定已有 OpenCode 会话，
                关闭后建群卡片仅显示「新建会话」
              </div>
            </el-form-item>
          </el-col>
        </el-row>

        <el-alert type="info" :closable="false" show-icon style="margin-top: 12px">
          💡 提示：默认模型配置请在 <el-button type="primary" link size="small" @click="$router.push('/opencode')">OpenCode 对接配置</el-button> 页面中设置
        </el-alert>
      </el-card>

      <!-- 输出显示 -->
      <el-card class="config-card">
        <template #header><span class="card-title">🖥️ 输出显示控制</span></template>
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="全局：显示思维链（SHOW_THINKING_CHAIN）">
              <el-switch v-model="showThinking" active-text="显示" inactive-text="隐藏"
                @change="form.SHOW_THINKING_CHAIN = showThinking ? 'true' : 'false'" />
              <div class="field-tip">全局默认值，控制是否在消息中显示 AI 的思维链（thinking 内容块）</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="全局：显示工具调用链（SHOW_TOOL_CHAIN）">
              <el-switch v-model="showTool" active-text="显示" inactive-text="隐藏"
                @change="form.SHOW_TOOL_CHAIN = showTool ? 'true' : 'false'" />
              <div class="field-tip">全局默认值，控制是否显示工具调用过程（如 Read、Glob 等）</div>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left"><el-text type="info" size="small">平台独立配置（覆盖全局，未设置则继承全局）</el-text></el-divider>

        <div class="platform-output-config">
          <div class="platform-row">
            <span class="platform-label">飞书</span>
            <span class="config-item">
              思维链
              <el-radio-group v-model="form.FEISHU_SHOW_THINKING_CHAIN" size="small">
                <el-radio-button value="true">开</el-radio-button>
                <el-radio-button value="false">关</el-radio-button>
                <el-radio-button value="">继承</el-radio-button>
              </el-radio-group>
            </span>
            <span class="config-divider">/</span>
            <span class="config-item">
              工具链
              <el-radio-group v-model="form.FEISHU_SHOW_TOOL_CHAIN" size="small">
                <el-radio-button value="true">开</el-radio-button>
                <el-radio-button value="false">关</el-radio-button>
                <el-radio-button value="">继承</el-radio-button>
              </el-radio-group>
            </span>
          </div>

          <div class="platform-row">
            <span class="platform-label">Discord</span>
            <span class="config-item">
              思维链
              <el-radio-group v-model="form.DISCORD_SHOW_THINKING_CHAIN" size="small">
                <el-radio-button value="true">开</el-radio-button>
                <el-radio-button value="false">关</el-radio-button>
                <el-radio-button value="">继承</el-radio-button>
              </el-radio-group>
            </span>
            <span class="config-divider">/</span>
            <span class="config-item">
              工具链
              <el-radio-group v-model="form.DISCORD_SHOW_TOOL_CHAIN" size="small">
                <el-radio-button value="true">开</el-radio-button>
                <el-radio-button value="false">关</el-radio-button>
                <el-radio-button value="">继承</el-radio-button>
              </el-radio-group>
            </span>
          </div>

          <div class="platform-row">
            <span class="platform-label">企业微信</span>
            <span class="config-item">
              思维链
              <el-radio-group v-model="form.WECOM_SHOW_THINKING_CHAIN" size="small">
                <el-radio-button value="true">开</el-radio-button>
                <el-radio-button value="false">关</el-radio-button>
                <el-radio-button value="">继承</el-radio-button>
              </el-radio-group>
            </span>
            <span class="config-divider">/</span>
            <span class="config-item">
              工具链
              <el-radio-group v-model="form.WECOM_SHOW_TOOL_CHAIN" size="small">
                <el-radio-button value="true">开</el-radio-button>
                <el-radio-button value="false">关</el-radio-button>
                <el-radio-button value="">继承</el-radio-button>
              </el-radio-group>
            </span>
          </div>

          <div class="platform-row">
            <span class="platform-label">Telegram</span>
            <span class="config-item">
              思维链
              <el-radio-group v-model="form.TELEGRAM_SHOW_THINKING_CHAIN" size="small">
                <el-radio-button value="true">开</el-radio-button>
                <el-radio-button value="false">关</el-radio-button>
                <el-radio-button value="">继承</el-radio-button>
              </el-radio-group>
            </span>
            <span class="config-divider">/</span>
            <span class="config-item">
              工具链
              <el-radio-group v-model="form.TELEGRAM_SHOW_TOOL_CHAIN" size="small">
                <el-radio-button value="true">开</el-radio-button>
                <el-radio-button value="false">关</el-radio-button>
                <el-radio-button value="">继承</el-radio-button>
              </el-radio-group>
            </span>
          </div>

          <div class="platform-row">
            <span class="platform-label">QQ</span>
            <span class="config-item">
              思维链
              <el-radio-group v-model="form.QQ_SHOW_THINKING_CHAIN" size="small">
                <el-radio-button value="true">开</el-radio-button>
                <el-radio-button value="false">关</el-radio-button>
                <el-radio-button value="">继承</el-radio-button>
              </el-radio-group>
            </span>
            <span class="config-divider">/</span>
            <span class="config-item">
              工具链
              <el-radio-group v-model="form.QQ_SHOW_TOOL_CHAIN" size="small">
                <el-radio-button value="true">开</el-radio-button>
                <el-radio-button value="false">关</el-radio-button>
                <el-radio-button value="">继承</el-radio-button>
              </el-radio-group>
            </span>
          </div>

          <div class="platform-row">
            <span class="platform-label">WhatsApp</span>
            <span class="config-item">
              思维链
              <el-radio-group v-model="form.WHATSAPP_SHOW_THINKING_CHAIN" size="small">
                <el-radio-button value="true">开</el-radio-button>
                <el-radio-button value="false">关</el-radio-button>
                <el-radio-button value="">继承</el-radio-button>
              </el-radio-group>
            </span>
            <span class="config-divider">/</span>
            <span class="config-item">
              工具链
              <el-radio-group v-model="form.WHATSAPP_SHOW_TOOL_CHAIN" size="small">
                <el-radio-button value="true">开</el-radio-button>
                <el-radio-button value="false">关</el-radio-button>
                <el-radio-button value="">继承</el-radio-button>
              </el-radio-group>
            </span>
          </div>

          <div class="platform-row">
            <span class="platform-label">微信</span>
            <span class="config-item">
              思维链
              <el-radio-group v-model="form.WEIXIN_SHOW_THINKING_CHAIN" size="small">
                <el-radio-button value="true">开</el-radio-button>
                <el-radio-button value="false">关</el-radio-button>
                <el-radio-button value="">继承</el-radio-button>
              </el-radio-group>
            </span>
            <span class="config-divider">/</span>
            <span class="config-item">
              工具链
              <el-radio-group v-model="form.WEIXIN_SHOW_TOOL_CHAIN" size="small">
                <el-radio-button value="true">开</el-radio-button>
                <el-radio-button value="false">关</el-radio-button>
                <el-radio-button value="">继承</el-radio-button>
              </el-radio-group>
            </span>
          </div>

          <div class="platform-row">
            <span class="platform-label">钉钉</span>
            <span class="config-item">
              思维链
              <el-radio-group v-model="form.DINGTALK_SHOW_THINKING_CHAIN" size="small">
                <el-radio-button value="true">开</el-radio-button>
                <el-radio-button value="false">关</el-radio-button>
                <el-radio-button value="">继承</el-radio-button>
              </el-radio-group>
            </span>
            <span class="config-divider">/</span>
            <span class="config-item">
              工具链
              <el-radio-group v-model="form.DINGTALK_SHOW_TOOL_CHAIN" size="small">
                <el-radio-button value="true">开</el-radio-button>
                <el-radio-button value="false">关</el-radio-button>
                <el-radio-button value="">继承</el-radio-button>
              </el-radio-group>
            </span>
          </div>
        </div>
      </el-card>

      <!-- 工作目录 -->
      <el-card class="config-card">
        <template #header><span class="card-title">📁 工作目录与项目</span></template>
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="允许的目录白名单（ALLOWED_DIRECTORIES）">
              <el-input v-model="form.ALLOWED_DIRECTORIES" type="textarea" :rows="2"
                placeholder="/home/user/projects,/opt/repos" />
              <div class="field-tip">
                逗号分隔的绝对路径列表。<strong>未配置时禁止用户自定义路径</strong>，也无法使用 /send 发送任意路径文件
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="默认工作目录（DEFAULT_WORK_DIRECTORY）">
              <el-input v-model="form.DEFAULT_WORK_DIRECTORY" placeholder="/home/user/projects/main" />
              <div class="field-tip">最低优先级兜底目录，未配置则跟随 OpenCode 服务端默认目录</div>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="24">
          <el-col :span="16">
            <el-form-item label="项目别名映射（PROJECT_ALIASES）">
              <el-input v-model="form.PROJECT_ALIASES" type="textarea" :rows="2"
                placeholder='{"frontend":"/home/user/frontend","backend":"/home/user/backend"}' />
              <div class="field-tip">JSON 格式，短名 → 绝对路径。用户可通过 <code>/session new 短名</code> 快速创建会话</div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="Git Root 归一化（GIT_ROOT_NORMALIZATION）">
              <el-switch v-model="gitRoot" active-text="自动归一" inactive-text="关闭"
                @change="form.GIT_ROOT_NORMALIZATION = gitRoot ? 'true' : 'false'" />
              <div class="field-tip">开启后用户指定子目录时自动提升到 Git 仓库根目录</div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-card>

      <!-- 工具与权限 -->
      <el-card class="config-card">
        <template #header><span class="card-title">🛠️ 工具白名单与权限</span></template>
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="工具白名单（TOOL_WHITELIST）">
              <el-input v-model="form.TOOL_WHITELIST" placeholder="Read,Glob,Grep,Task,Write" />
              <div class="field-tip">逗号分隔的工具名称，列在此处的工具权限请求会被桥接层自动放行，无需用户确认</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="权限请求超时（PERMISSION_REQUEST_TIMEOUT_MS）">
              <el-input v-model="form.PERMISSION_REQUEST_TIMEOUT_MS" placeholder="0（不超时）" />
              <div class="field-tip">权限请求在桥接侧保留的最长时长（毫秒）。&lt;= 0 表示无限等待用户回复</div>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="24">
          <el-col :span="8">
            <el-form-item label="输出刷新间隔（OUTPUT_UPDATE_INTERVAL）">
              <el-input v-model="form.OUTPUT_UPDATE_INTERVAL" placeholder="3000" />
              <div class="field-tip">流式输出卡片刷新频率（毫秒），默认 3000ms</div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="延迟响应超时（MAX_DELAYED_RESPONSE_WAIT_MS）">
              <el-input v-model="form.MAX_DELAYED_RESPONSE_WAIT_MS" placeholder="120000" />
              <div class="field-tip">延迟响应模式下最长等待时间（毫秒），默认 120000（2分钟）</div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="附件大小上限（ATTACHMENT_MAX_SIZE）">
              <el-input v-model="form.ATTACHMENT_MAX_SIZE" placeholder="52428800" />
              <div class="field-tip">单个附件的最大字节数，默认 52428800（50MB）</div>
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
import { ref, reactive, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useConfigStore } from '../stores/config'
import ConfigActionBar from '../components/ConfigActionBar.vue'

const store = useConfigStore()
const saving = ref(false)
const enableManualBind = ref(true)
const showThinking = ref(true)
const showTool = ref(true)
const gitRoot = ref(true)

const form = reactive({
  ROUTER_MODE: 'legacy',
  ENABLE_MANUAL_SESSION_BIND: 'true',
  SHOW_THINKING_CHAIN: 'true',
  SHOW_TOOL_CHAIN: 'true',
  FEISHU_SHOW_THINKING_CHAIN: '',
  FEISHU_SHOW_TOOL_CHAIN: '',
  DISCORD_SHOW_THINKING_CHAIN: '',
  DISCORD_SHOW_TOOL_CHAIN: '',
  WECOM_SHOW_THINKING_CHAIN: '',
  WECOM_SHOW_TOOL_CHAIN: '',
  TELEGRAM_SHOW_THINKING_CHAIN: '',
  TELEGRAM_SHOW_TOOL_CHAIN: '',
  QQ_SHOW_THINKING_CHAIN: '',
  QQ_SHOW_TOOL_CHAIN: '',
  WHATSAPP_SHOW_THINKING_CHAIN: '',
  WHATSAPP_SHOW_TOOL_CHAIN: '',
  WEIXIN_SHOW_THINKING_CHAIN: '',
  WEIXIN_SHOW_TOOL_CHAIN: '',
  DINGTALK_SHOW_THINKING_CHAIN: '',
  DINGTALK_SHOW_TOOL_CHAIN: '',
  ALLOWED_DIRECTORIES: '',
  DEFAULT_WORK_DIRECTORY: '',
  PROJECT_ALIASES: '',
  GIT_ROOT_NORMALIZATION: 'true',
  TOOL_WHITELIST: 'Read,Glob,Grep,Task',
  PERMISSION_REQUEST_TIMEOUT_MS: '0',
  OUTPUT_UPDATE_INTERVAL: '3000',
  MAX_DELAYED_RESPONSE_WAIT_MS: '120000',
  ATTACHMENT_MAX_SIZE: '52428800',
})

onMounted(() => syncFromStore())
watch(() => store.settings, () => syncFromStore(), { deep: true })

function syncFromStore() {
  const s = store.settings
  Object.assign(form, {
    ROUTER_MODE: s.ROUTER_MODE || 'legacy',
    ENABLE_MANUAL_SESSION_BIND: s.ENABLE_MANUAL_SESSION_BIND ?? 'true',
    SHOW_THINKING_CHAIN: s.SHOW_THINKING_CHAIN ?? 'true',
    SHOW_TOOL_CHAIN: s.SHOW_TOOL_CHAIN ?? 'true',
    FEISHU_SHOW_THINKING_CHAIN: s.FEISHU_SHOW_THINKING_CHAIN || '',
    FEISHU_SHOW_TOOL_CHAIN: s.FEISHU_SHOW_TOOL_CHAIN || '',
    DISCORD_SHOW_THINKING_CHAIN: s.DISCORD_SHOW_THINKING_CHAIN || '',
    DISCORD_SHOW_TOOL_CHAIN: s.DISCORD_SHOW_TOOL_CHAIN || '',
    WECOM_SHOW_THINKING_CHAIN: s.WECOM_SHOW_THINKING_CHAIN || '',
    WECOM_SHOW_TOOL_CHAIN: s.WECOM_SHOW_TOOL_CHAIN || '',
    TELEGRAM_SHOW_THINKING_CHAIN: s.TELEGRAM_SHOW_THINKING_CHAIN || '',
    TELEGRAM_SHOW_TOOL_CHAIN: s.TELEGRAM_SHOW_TOOL_CHAIN || '',
    QQ_SHOW_THINKING_CHAIN: s.QQ_SHOW_THINKING_CHAIN || '',
    QQ_SHOW_TOOL_CHAIN: s.QQ_SHOW_TOOL_CHAIN || '',
    WHATSAPP_SHOW_THINKING_CHAIN: s.WHATSAPP_SHOW_THINKING_CHAIN || '',
    WHATSAPP_SHOW_TOOL_CHAIN: s.WHATSAPP_SHOW_TOOL_CHAIN || '',
    WEIXIN_SHOW_THINKING_CHAIN: s.WEIXIN_SHOW_THINKING_CHAIN || '',
    WEIXIN_SHOW_TOOL_CHAIN: s.WEIXIN_SHOW_TOOL_CHAIN || '',
    DINGTALK_SHOW_THINKING_CHAIN: s.DINGTALK_SHOW_THINKING_CHAIN || '',
    DINGTALK_SHOW_TOOL_CHAIN: s.DINGTALK_SHOW_TOOL_CHAIN || '',
    ALLOWED_DIRECTORIES: s.ALLOWED_DIRECTORIES || '',
    DEFAULT_WORK_DIRECTORY: s.DEFAULT_WORK_DIRECTORY || '',
    PROJECT_ALIASES: s.PROJECT_ALIASES || '',
    GIT_ROOT_NORMALIZATION: s.GIT_ROOT_NORMALIZATION ?? 'true',
    TOOL_WHITELIST: s.TOOL_WHITELIST || 'Read,Glob,Grep,Task',
    PERMISSION_REQUEST_TIMEOUT_MS: s.PERMISSION_REQUEST_TIMEOUT_MS || '0',
    OUTPUT_UPDATE_INTERVAL: s.OUTPUT_UPDATE_INTERVAL || '3000',
    MAX_DELAYED_RESPONSE_WAIT_MS: s.MAX_DELAYED_RESPONSE_WAIT_MS || '120000',
    ATTACHMENT_MAX_SIZE: s.ATTACHMENT_MAX_SIZE || '52428800',
  })
  enableManualBind.value = form.ENABLE_MANUAL_SESSION_BIND !== 'false'
  showThinking.value = form.SHOW_THINKING_CHAIN !== 'false'
  showTool.value = form.SHOW_TOOL_CHAIN !== 'false'
  gitRoot.value = form.GIT_ROOT_NORMALIZATION !== 'false'
}

async function handleSave() {
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

function handleImportConfig(config: typeof form) {
  Object.assign(form, config)
  // 同步开关状态
  enableManualBind.value = form.ENABLE_MANUAL_SESSION_BIND !== 'false'
  showThinking.value = form.SHOW_THINKING_CHAIN !== 'false'
  showTool.value = form.SHOW_TOOL_CHAIN !== 'false'
  gitRoot.value = form.GIT_ROOT_NORMALIZATION !== 'false'
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
.field-tip { font-size: 12px; color: #999; margin-top: 4px; line-height: 1.4; }
code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 11px; }

/* 平台输出配置紧凑布局 */
.platform-output-config {
  padding: 0 4px;
}
.platform-row {
  display: flex;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
}
.platform-row:last-child {
  border-bottom: none;
}
.platform-label {
  min-width: 80px;
  font-weight: 500;
  color: #303133;
}
.config-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #606266;
}
.config-divider {
  margin: 0 12px;
  color: #c0c4cc;
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
