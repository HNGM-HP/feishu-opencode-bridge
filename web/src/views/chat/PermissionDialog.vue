<template>
  <el-dialog
    :model-value="Boolean(request)"
    width="520px"
    :close-on-click-modal="false"
    :show-close="false"
  >
    <template #header>
      <div class="dialog-head">
        <div class="eyebrow">权限确认</div>
        <h3>{{ request?.tool || '等待确认' }}</h3>
      </div>
    </template>

    <div v-if="request" class="dialog-body">
      <p>{{ request.description }}</p>
      <div class="risk-line">
        <span>风险等级</span>
        <strong>{{ request.risk || 'unknown' }}</strong>
      </div>
    </div>

    <template #footer>
      <div class="dialog-actions">
        <el-button :disabled="loading" @click="$emit('reject')">拒绝</el-button>
        <el-button :disabled="loading" @click="$emit('allow')">允许一次</el-button>
        <el-button type="primary" :loading="loading" @click="$emit('always')">始终允许</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import type { ChatPermissionRequest } from '../../api'

defineProps<{
  request: ChatPermissionRequest | null
  loading: boolean
}>()

defineEmits<{
  allow: []
  reject: []
  always: []
}>()
</script>

<style scoped>
.dialog-head h3 {
  margin-top: 6px;
  color: #10223d;
}

.eyebrow {
  font-size: 11px;
  color: #66758d;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 700;
}

.dialog-body {
  display: grid;
  gap: 14px;
  color: #334155;
}

.risk-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255, 247, 237, 0.92);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
