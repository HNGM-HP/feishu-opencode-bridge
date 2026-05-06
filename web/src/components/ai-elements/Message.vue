<template>
  <div :class="classes">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  role: 'user' | 'assistant'
  error?: boolean
}>(), {
  error: false,
})

const classes = computed(() => [
  'message-bubble',
  `message-bubble--${props.role}`,
  { 'message-bubble--error': props.error },
])
</script>

<style scoped>
.message-bubble {
  padding: 12px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  color: #15253e;
}

.message-bubble--user {
  background: #fafafa;
}

.message-bubble--error {
  border-color: rgba(239, 68, 68, 0.28);
  background: #fff7f7;
}
</style>
