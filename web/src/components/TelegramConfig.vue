<template>
  <el-card class="config-card">
    <template #header>
      <div class="card-header-row">
        <span class="card-title">📱 Telegram 配置 <el-tag size="small" type="info">可选</el-tag></span>
        <div class="inline-switch">
          <span>启用 Telegram</span>
          <el-switch v-model="enabled"
            active-text="开启" inactive-text="关闭"
            @change="onEnableChange" />
        </div>
      </div>
    </template>

    <el-row :gutter="24">
      <el-col :span="12">
        <el-form-item label="Bot Token">
          <el-input v-model="token" type="password" show-password :disabled="!enabled"
            placeholder="从 @BotFather 获取" />
          <div class="field-tip">Telegram Bot Token，格式：123456789:ABCdefGHI...</div>
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="状态">
          <el-tag :type="statusType">{{ statusText }}</el-tag>
        </el-form-item>
      </el-col>
    </el-row>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  enabled: boolean
  token: string
  status?: 'connected' | 'disconnected' | 'error' | 'pending'
}

const props = withDefaults(defineProps<Props>(), {
  status: 'disconnected'
})

const emit = defineEmits<{
  'update:enabled': [value: boolean]
  'update:token': [value: string]
}>()

const statusType = computed(() => {
  switch (props.status) {
    case 'connected': return 'success'
    case 'disconnected': return 'info'
    case 'error': return 'danger'
    case 'pending': return 'warning'
    default: return 'info'
  }
})

const statusText = computed(() => {
  switch (props.status) {
    case 'connected': return '已连接'
    case 'disconnected': return '未连接'
    case 'error': return '连接错误'
    case 'pending': return '等待连接'
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
</style>