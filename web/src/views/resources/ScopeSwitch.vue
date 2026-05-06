<template>
  <div class="scope-switch">
    <span class="label">作用域:</span>
    <el-segmented v-model="currentScope" :options="scopeOptions" @change="handleScopeChange" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

type ResourceScope = 'project' | 'user'

interface ScopeOption {
  label: string
  value: ResourceScope
  icon?: string
}

const props = defineProps<{
  modelValue: ResourceScope
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ResourceScope]
  change: [value: ResourceScope]
}>()

const scopeOptions: ScopeOption[] = [
  { label: '项目级', value: 'project' },
  { label: '用户级', value: 'user' },
]

const currentScope = ref<ResourceScope>(props.modelValue)

watch(() => props.modelValue, (newValue) => {
  currentScope.value = newValue
})

function handleScopeChange(value: ResourceScope) {
  emit('update:modelValue', value)
  emit('change', value)
}
</script>

<style scoped>
.scope-switch {
  display: flex;
  align-items: center;
  gap: 12px;
}

.label {
  font-size: 14px;
  color: #606266;
  font-weight: 500;
}

.el-segmented {
  --el-segmented-bg-color: #f5f7fa;
  --el-border-radius-base: 6px;
}
</style>
