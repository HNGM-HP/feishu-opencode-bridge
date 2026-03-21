<template>
  <el-card class="config-card">
    <template #header>
      <div class="card-header-row">
        <span class="card-title">🟢 WhatsApp 配置 <el-tag size="small" type="warning">实验性</el-tag></span>
        <div class="inline-switch">
          <span>启用 WhatsApp</span>
          <el-switch v-model="enabled"
            active-text="开启" inactive-text="关闭"
            @change="onEnableChange" />
        </div>
      </div>
    </template>

    <el-alert type="warning" :closable="false" style="margin-bottom: 16px">
      WhatsApp Web 协议存在风控风险，可能导致号码被封。建议使用专用测试号码。
    </el-alert>

    <el-row :gutter="24">
      <el-col :span="12">
        <el-form-item label="Session 存储路径">
          <el-input v-model="sessionPath" :disabled="!enabled" placeholder="~/.whatsapp-session" />
          <div class="field-tip">WhatsApp 会话数据存储目录</div>
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="状态">
          <div class="status-row">
            <el-tag :type="statusType">{{ statusText }}</el-tag>
            <el-button v-if="needQrCode" size="small" type="primary" @click="showQrCode">
              显示二维码
            </el-button>
          </div>
        </el-form-item>
      </el-col>
    </el-row>

    <!-- 二维码弹窗 -->
    <el-dialog v-model="qrCodeVisible" title="WhatsApp 登录二维码" width="400px">
      <div v-if="qrCodeUrl" class="qr-code-container">
        <img :src="qrCodeUrl" style="width: 100%" />
      </div>
      <div v-else class="qr-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>正在获取二维码...</span>
      </div>
      <p class="qr-tip">请使用 WhatsApp 扫描二维码登录</p>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Loading } from '@element-plus/icons-vue'

interface Props {
  enabled: boolean
  sessionPath: string
  status?: 'connected' | 'disconnected' | 'error' | 'pending' | 'need_scan'
  needQrCode?: boolean
  qrCodeUrl?: string
}

const props = withDefaults(defineProps<Props>(), {
  status: 'disconnected',
  needQrCode: false,
  qrCodeUrl: ''
})

const emit = defineEmits<{
  'update:enabled': [value: boolean]
  'update:sessionPath': [value: string]
  'requestQrCode': []
}>()

const qrCodeVisible = ref(false)

const statusType = computed(() => {
  switch (props.status) {
    case 'connected': return 'success'
    case 'disconnected': return 'info'
    case 'error': return 'danger'
    case 'pending': return 'warning'
    case 'need_scan': return 'warning'
    default: return 'info'
  }
})

const statusText = computed(() => {
  switch (props.status) {
    case 'connected': return '已连接'
    case 'disconnected': return '未连接'
    case 'error': return '连接错误'
    case 'pending': return '等待连接'
    case 'need_scan': return '待扫码'
    default: return '未知'
  }
})

function onEnableChange(val: boolean) {
  emit('update:enabled', val)
}

function showQrCode() {
  qrCodeVisible.value = true
  emit('requestQrCode')
}
</script>

<style scoped>
.config-card { margin-bottom: 20px; }
.card-title { font-weight: 600; font-size: 15px; }
.card-header-row { display: flex; align-items: center; justify-content: space-between; }
.inline-switch { display: flex; align-items: center; gap: 10px; }
.field-tip { font-size: 12px; color: #999; margin-top: 4px; line-height: 1.4; }
.status-row { display: flex; align-items: center; gap: 8px; }
.qr-code-container { text-align: center; }
.qr-loading { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px; color: #666; }
.qr-tip { text-align: center; color: #666; margin-top: 16px; }
</style>