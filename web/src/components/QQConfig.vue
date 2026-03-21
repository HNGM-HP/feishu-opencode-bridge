<template>
  <el-card class="config-card">
    <template #header>
      <div class="card-header-row">
        <span class="card-title">💬 QQ 配置 <el-tag size="small" type="warning">实验性</el-tag></span>
        <div class="inline-switch">
          <span>启用 QQ</span>
          <el-switch v-model="enabled"
            active-text="开启" inactive-text="关闭"
            @change="onEnableChange" />
        </div>
      </div>
    </template>

    <el-alert type="warning" :closable="false" style="margin-bottom: 16px">
      QQ 协议存在风控风险，建议仅用于个人测试。推荐使用 NapCat（NTQQ 官方协议）。
    </el-alert>

    <el-row :gutter="24">
      <el-col :span="8">
        <el-form-item label="协议类型">
          <el-select v-model="protocol" :disabled="!enabled" style="width: 100%">
            <el-option label="NapCat (推荐)" value="napcat" />
            <el-option label="go-cqhttp" value="go-cqhttp" />
          </el-select>
          <div class="field-tip">推荐使用 NapCat，更稳定</div>
        </el-form-item>
      </el-col>
      <el-col :span="8">
        <el-form-item label="WebSocket 地址">
          <el-input v-model="wsUrl" :disabled="!enabled" placeholder="ws://localhost:3001" />
          <div class="field-tip">NapCat/go-cqhttp 的 WebSocket 地址</div>
        </el-form-item>
      </el-col>
      <el-col :span="8">
        <el-form-item label="状态">
          <div class="status-row">
            <el-tag :type="statusType">{{ statusText }}</el-tag>
            <el-button v-if="needQrCode" size="small" type="primary" @click="$emit('showQrCode')">
              扫码登录
            </el-button>
          </div>
        </el-form-item>
      </el-col>
    </el-row>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  enabled: boolean
  protocol: 'napcat' | 'go-cqhttp'
  wsUrl: string
  status?: 'connected' | 'disconnected' | 'error' | 'pending' | 'need_scan'
  needQrCode?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  status: 'disconnected',
  needQrCode: false
})

const emit = defineEmits<{
  'update:enabled': [value: boolean]
  'update:protocol': [value: 'napcat' | 'go-cqhttp']
  'update:wsUrl': [value: string]
  'showQrCode': []
}>()

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
</script>

<style scoped>
.config-card { margin-bottom: 20px; }
.card-title { font-weight: 600; font-size: 15px; }
.card-header-row { display: flex; align-items: center; justify-content: space-between; }
.inline-switch { display: flex; align-items: center; gap: 10px; }
.field-tip { font-size: 12px; color: #999; margin-top: 4px; line-height: 1.4; }
.status-row { display: flex; align-items: center; gap: 8px; }
</style>