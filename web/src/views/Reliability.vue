<template>
  <div class="page">
    <div class="page-header">
      <h2>高可用配置</h2>
      <p class="desc">配置 Cron 调度、心跳探活与宕机救援策略</p>
    </div>

    <div class="page-layout">
      <div class="form-area">
        <el-form :model="form" label-position="top" @submit.prevent>

      <!-- Cron 调度 -->
      <el-card class="config-card">
        <template #header>
          <div class="card-header-row">
            <span class="card-title">⏱️ Cron 调度器</span>
            <el-switch v-model="cronEnabled" active-text="启用" inactive-text="关闭"
              @change="form.RELIABILITY_CRON_ENABLED = cronEnabled ? 'true' : 'false'" />
          </div>
        </template>

        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="Cron 任务持久化文件（RELIABILITY_CRON_JOBS_FILE）">
              <el-input v-model="form.RELIABILITY_CRON_JOBS_FILE" placeholder="~/cron/jobs.json" />
              <div class="field-tip">运行时动态 Cron 任务的持久化存储路径，默认 ~/cron/jobs.json</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="自动清理僵尸 Cron（RELIABILITY_CRON_ORPHAN_AUTO_CLEANUP）">
              <el-switch v-model="cronOrphanCleanup" active-text="启用" inactive-text="关闭"
                @change="form.RELIABILITY_CRON_ORPHAN_AUTO_CLEANUP = cronOrphanCleanup ? 'true' : 'false'" />
              <div class="field-tip">启用后，群解散/频道删除时自动清理关联的 Cron 任务</div>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="窗口失效时转发私聊（RELIABILITY_CRON_FORWARD_TO_PRIVATE）">
              <el-switch v-model="cronForwardPrivate" active-text="启用" inactive-text="关闭"
                @change="form.RELIABILITY_CRON_FORWARD_TO_PRIVATE = cronForwardPrivate ? 'true' : 'false'" />
              <div class="field-tip">原聊天窗口失效时，允许 Cron 结果转发到私聊或备用窗口</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="飞书备用 Chat ID（RELIABILITY_CRON_FALLBACK_FEISHU_CHAT_ID）">
              <el-input v-model="form.RELIABILITY_CRON_FALLBACK_FEISHU_CHAT_ID" placeholder="oc_xxx" />
              <div class="field-tip">原窗口失效时，Cron 消息转发的备用飞书 chat_id</div>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="Discord 备用会话 ID（RELIABILITY_CRON_FALLBACK_DISCORD_CONVERSATION_ID）">
              <el-input v-model="form.RELIABILITY_CRON_FALLBACK_DISCORD_CONVERSATION_ID" placeholder="频道ID或私聊ID" />
              <div class="field-tip">原窗口失效时，Cron 消息转发的备用 Discord 频道/私聊 ID</div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-card>

      <!-- Cron HTTP API -->
      <el-card class="config-card">
        <template #header>
          <div class="card-header-row">
            <span class="card-title">🌐 Cron HTTP API</span>
            <el-switch v-model="cronApiEnabled" active-text="启用" inactive-text="关闭"
              @change="form.RELIABILITY_CRON_API_ENABLED = cronApiEnabled ? 'true' : 'false'" />
          </div>
        </template>
        <el-alert type="info" :closable="false" show-icon style="margin-bottom:16px">
          启用后可通过 HTTP 接口动态增删改查 Cron 任务（/cron/add|remove|update|list）
        </el-alert>
        <el-row :gutter="24">
          <el-col :span="8">
            <el-form-item label="监听地址（RELIABILITY_CRON_API_HOST）">
              <el-input v-model="form.RELIABILITY_CRON_API_HOST" placeholder="127.0.0.1" :disabled="!cronApiEnabled" />
              <div class="field-tip">建议保持 127.0.0.1，仅本地访问</div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="端口（RELIABILITY_CRON_API_PORT）">
              <el-input-number v-model="cronApiPortNum" :min="1" :max="65535" style="width:100%"
                :disabled="!cronApiEnabled"
                @change="form.RELIABILITY_CRON_API_PORT = String(cronApiPortNum)" />
              <div class="field-tip">Cron API 监听端口，默认 4097</div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="Bearer Token（RELIABILITY_CRON_API_TOKEN）">
              <el-input v-model="form.RELIABILITY_CRON_API_TOKEN" placeholder="留空则不需要认证"
                type="password" show-password :disabled="!cronApiEnabled" />
              <div class="field-tip">API 请求需在 Authorization: Bearer 头中携带此 Token</div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-card>

      <!-- 心跳配置 -->
      <el-card class="config-card">
        <template #header><span class="card-title">💓 心跳探活</span></template>
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="主动心跳定时器（RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED）">
              <el-switch v-model="proactiveHeartbeat" active-text="启用" inactive-text="关闭"
                @change="form.RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED = proactiveHeartbeat ? 'true' : 'false'" />
              <div class="field-tip">Bridge 定期向 OpenCode 发送探活消息，监测服务健康状态</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="入站触发心跳（RELIABILITY_INBOUND_HEARTBEAT_ENABLED）">
              <el-switch v-model="inboundHeartbeat" active-text="启用" inactive-text="关闭"
                @change="form.RELIABILITY_INBOUND_HEARTBEAT_ENABLED = inboundHeartbeat ? 'true' : 'false'" />
              <div class="field-tip">收到用户消息时触发心跳（兼容模式，适合低流量场景）</div>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="24">
          <el-col :span="8">
            <el-form-item label="心跳间隔（RELIABILITY_HEARTBEAT_INTERVAL_MS）">
              <el-input v-model="form.RELIABILITY_HEARTBEAT_INTERVAL_MS" placeholder="1800000" />
              <div class="field-tip">主动心跳轮询间隔（毫秒），默认 1800000（30分钟）</div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="心跳 Agent（RELIABILITY_HEARTBEAT_AGENT）">
              <el-input v-model="form.RELIABILITY_HEARTBEAT_AGENT" placeholder="companion（可选）" />
              <div class="field-tip">心跳发送时使用的 OpenCode Agent 名称</div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="告警推送 Chat（RELIABILITY_HEARTBEAT_ALERT_CHATS）">
              <el-input v-model="form.RELIABILITY_HEARTBEAT_ALERT_CHATS" placeholder="oc_xxx,oc_yyy" />
              <div class="field-tip">心跳异常时推送告警的飞书 chat_id，逗号分隔</div>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="24">
          <el-col :span="24">
            <el-form-item label="心跳提示词（RELIABILITY_HEARTBEAT_PROMPT）">
              <el-input v-model="form.RELIABILITY_HEARTBEAT_PROMPT"
                placeholder="Read HEARTBEAT.md if it exists... reply HEARTBEAT_OK"
                type="textarea" :rows="2" />
              <div class="field-tip">发送给 OpenCode 的探活提示词，建议包含 HEARTBEAT_OK 约定以便识别成功响应</div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-card>

      <!-- 救援策略 -->
      <el-card class="config-card">
        <template #header><span class="card-title">🚑 宕机救援策略</span></template>
        <el-row :gutter="24">
          <el-col :span="8">
            <el-form-item label="可靠性模式（RELIABILITY_MODE）">
              <el-select v-model="form.RELIABILITY_MODE" style="width:100%">
                <el-option value="observe" label="observe — 观察模式（仅记录，不干预）" />
                <el-option value="shadow" label="shadow — 影子模式（记录+模拟决策）" />
                <el-option value="active" label="active — 主动救援模式" />
              </el-select>
              <div class="field-tip">控制救援系统的介入程度，生产建议从 observe 开始验证</div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="连续失败阈值（RELIABILITY_FAILURE_THRESHOLD）">
              <el-input-number v-model="failureThresholdNum" :min="1" :max="100" style="width:100%"
                @change="form.RELIABILITY_FAILURE_THRESHOLD = String(failureThresholdNum)" />
              <div class="field-tip">触发自动救援所需的连续失败次数，默认 3</div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="失败统计窗口（RELIABILITY_WINDOW_MS）">
              <el-input v-model="form.RELIABILITY_WINDOW_MS" placeholder="90000" />
              <div class="field-tip">失败计数的时间窗口（毫秒），默认 90000（90秒）</div>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="24">
          <el-col :span="8">
            <el-form-item label="救援冷却时间（RELIABILITY_COOLDOWN_MS）">
              <el-input v-model="form.RELIABILITY_COOLDOWN_MS" placeholder="300000" />
              <div class="field-tip">两次自动救援之间的最短间隔（毫秒），默认 300000（5分钟）</div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="救援预算（RELIABILITY_REPAIR_BUDGET）">
              <el-input-number v-model="repairBudgetNum" :min="0" :max="100" style="width:100%"
                @change="form.RELIABILITY_REPAIR_BUDGET = String(repairBudgetNum)" />
              <div class="field-tip">自动救援的最大尝试次数，耗尽后转为人工介入，默认 3</div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="仅本地救援（RELIABILITY_LOOPBACK_ONLY）">
              <el-switch v-model="loopbackOnly" active-text="仅 localhost" inactive-text="允许远程"
                @change="form.RELIABILITY_LOOPBACK_ONLY = loopbackOnly ? 'true' : 'false'" />
              <div class="field-tip">为 true 时，只对 localhost/127.0.0.1/::1 执行自动救援，更安全</div>
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
import type { BridgeSettings } from '../api'
import { useConfigStore } from '../stores/config'
import ConfigActionBar from '../components/ConfigActionBar.vue'

const store = useConfigStore()
const saving = ref(false)
const cronEnabled = ref(true)
const cronOrphanCleanup = ref(false)
const cronForwardPrivate = ref(false)
const cronApiEnabled = ref(false)
const cronApiPortNum = ref(4097)
const proactiveHeartbeat = ref(false)
const inboundHeartbeat = ref(false)
const failureThresholdNum = ref(3)
const repairBudgetNum = ref(3)
const loopbackOnly = ref(true)

const form = reactive({
  RELIABILITY_CRON_ENABLED: 'true',
  RELIABILITY_CRON_JOBS_FILE: '',
  RELIABILITY_CRON_ORPHAN_AUTO_CLEANUP: 'false',
  RELIABILITY_CRON_FORWARD_TO_PRIVATE: 'false',
  RELIABILITY_CRON_FALLBACK_FEISHU_CHAT_ID: '',
  RELIABILITY_CRON_FALLBACK_DISCORD_CONVERSATION_ID: '',
  RELIABILITY_CRON_API_ENABLED: 'false',
  RELIABILITY_CRON_API_HOST: '127.0.0.1',
  RELIABILITY_CRON_API_PORT: '4097',
  RELIABILITY_CRON_API_TOKEN: '',
  RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED: 'false',
  RELIABILITY_INBOUND_HEARTBEAT_ENABLED: 'false',
  RELIABILITY_HEARTBEAT_INTERVAL_MS: '1800000',
  RELIABILITY_HEARTBEAT_AGENT: '',
  RELIABILITY_HEARTBEAT_PROMPT: '',
  RELIABILITY_HEARTBEAT_ALERT_CHATS: '',
  RELIABILITY_MODE: 'observe',
  RELIABILITY_FAILURE_THRESHOLD: '3',
  RELIABILITY_WINDOW_MS: '90000',
  RELIABILITY_COOLDOWN_MS: '300000',
  RELIABILITY_REPAIR_BUDGET: '3',
  RELIABILITY_LOOPBACK_ONLY: 'true',
})

onMounted(() => syncFromStore())
watch(() => store.settings, () => syncFromStore(), { deep: true })

function syncFromStore() {
  const s = store.settings
  Object.assign(form, {
    RELIABILITY_CRON_ENABLED: s.RELIABILITY_CRON_ENABLED ?? 'true',
    RELIABILITY_CRON_JOBS_FILE: s.RELIABILITY_CRON_JOBS_FILE || '',
    RELIABILITY_CRON_ORPHAN_AUTO_CLEANUP: s.RELIABILITY_CRON_ORPHAN_AUTO_CLEANUP ?? 'false',
    RELIABILITY_CRON_FORWARD_TO_PRIVATE: s.RELIABILITY_CRON_FORWARD_TO_PRIVATE ?? 'false',
    RELIABILITY_CRON_FALLBACK_FEISHU_CHAT_ID: s.RELIABILITY_CRON_FALLBACK_FEISHU_CHAT_ID || '',
    RELIABILITY_CRON_FALLBACK_DISCORD_CONVERSATION_ID: s.RELIABILITY_CRON_FALLBACK_DISCORD_CONVERSATION_ID || '',
    RELIABILITY_CRON_API_ENABLED: s.RELIABILITY_CRON_API_ENABLED ?? 'false',
    RELIABILITY_CRON_API_HOST: s.RELIABILITY_CRON_API_HOST || '127.0.0.1',
    RELIABILITY_CRON_API_PORT: s.RELIABILITY_CRON_API_PORT || '4097',
    RELIABILITY_CRON_API_TOKEN: s.RELIABILITY_CRON_API_TOKEN || '',
    RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED: s.RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED ?? 'false',
    RELIABILITY_INBOUND_HEARTBEAT_ENABLED: s.RELIABILITY_INBOUND_HEARTBEAT_ENABLED ?? 'false',
    RELIABILITY_HEARTBEAT_INTERVAL_MS: s.RELIABILITY_HEARTBEAT_INTERVAL_MS || '1800000',
    RELIABILITY_HEARTBEAT_AGENT: s.RELIABILITY_HEARTBEAT_AGENT || '',
    RELIABILITY_HEARTBEAT_PROMPT: s.RELIABILITY_HEARTBEAT_PROMPT || '',
    RELIABILITY_HEARTBEAT_ALERT_CHATS: s.RELIABILITY_HEARTBEAT_ALERT_CHATS || '',
    RELIABILITY_MODE: s.RELIABILITY_MODE || 'observe',
    RELIABILITY_FAILURE_THRESHOLD: s.RELIABILITY_FAILURE_THRESHOLD || '3',
    RELIABILITY_WINDOW_MS: s.RELIABILITY_WINDOW_MS || '90000',
    RELIABILITY_COOLDOWN_MS: s.RELIABILITY_COOLDOWN_MS || '300000',
    RELIABILITY_REPAIR_BUDGET: s.RELIABILITY_REPAIR_BUDGET || '3',
    RELIABILITY_LOOPBACK_ONLY: s.RELIABILITY_LOOPBACK_ONLY ?? 'true',
  })
  cronEnabled.value = form.RELIABILITY_CRON_ENABLED === 'true'
  cronOrphanCleanup.value = form.RELIABILITY_CRON_ORPHAN_AUTO_CLEANUP === 'true'
  cronForwardPrivate.value = form.RELIABILITY_CRON_FORWARD_TO_PRIVATE === 'true'
  cronApiEnabled.value = form.RELIABILITY_CRON_API_ENABLED === 'true'
  cronApiPortNum.value = parseInt(form.RELIABILITY_CRON_API_PORT) || 4097
  proactiveHeartbeat.value = form.RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED === 'true'
  inboundHeartbeat.value = form.RELIABILITY_INBOUND_HEARTBEAT_ENABLED === 'true'
  failureThresholdNum.value = parseInt(form.RELIABILITY_FAILURE_THRESHOLD) || 3
  repairBudgetNum.value = parseInt(form.RELIABILITY_REPAIR_BUDGET) || 3
  loopbackOnly.value = form.RELIABILITY_LOOPBACK_ONLY !== 'false'
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

function handleImportConfig(config: BridgeSettings) {
  Object.assign(form, config)
  // 同步状态
  cronEnabled.value = form.RELIABILITY_CRON_ENABLED === 'true'
  cronOrphanCleanup.value = form.RELIABILITY_CRON_ORPHAN_AUTO_CLEANUP === 'true'
  cronForwardPrivate.value = form.RELIABILITY_CRON_FORWARD_TO_PRIVATE === 'true'
  cronApiEnabled.value = form.RELIABILITY_CRON_API_ENABLED === 'true'
  cronApiPortNum.value = parseInt(form.RELIABILITY_CRON_API_PORT) || 4097
  proactiveHeartbeat.value = form.RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED === 'true'
  inboundHeartbeat.value = form.RELIABILITY_INBOUND_HEARTBEAT_ENABLED === 'true'
  failureThresholdNum.value = parseInt(form.RELIABILITY_FAILURE_THRESHOLD) || 3
  repairBudgetNum.value = parseInt(form.RELIABILITY_REPAIR_BUDGET) || 3
  loopbackOnly.value = form.RELIABILITY_LOOPBACK_ONLY !== 'false'
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
.card-title { font-weight: 600; font-size: 16px; display: flex; align-items: center; gap: 8px; }
.card-title ::v-deep(.emoji) { font-size: 20px; }
.card-header-row { display: flex; align-items: center; justify-content: space-between; }
.field-tip { font-size: 12px; color: #999; margin-top: 4px; line-height: 1.4; }

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
