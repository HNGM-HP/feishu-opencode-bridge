<template>
  <el-tooltip v-if="error" :content="error" placement="top">
    <el-tag :type="statusType" size="small">
      {{ statusText }}
    </el-tag>
  </el-tooltip>
  <el-tag v-else :type="statusType" size="small">
    {{ statusText }}
  </el-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  status: 'enabled' | 'disabled' | 'error' | 'not_configured'
  error?: string
}>()

const statusType = computed(() => {
  switch (props.status) {
    case 'enabled': return 'success'
    case 'disabled': return 'info'
    case 'error': return 'danger'
    case 'not_configured': return 'warning'
    default: return 'info'
  }
})

const statusText = computed(() => {
  switch (props.status) {
    case 'enabled': return '🟢 已启用'
    case 'disabled': return '🔴 已禁用'
    case 'error': return '🟡 错误'
    case 'not_configured': return '⚪ 未配置'
    default: return props.status
  }
})
</script>
