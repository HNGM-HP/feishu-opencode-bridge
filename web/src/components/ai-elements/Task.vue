<template>
  <div class="task-item">
    <span :class="['status', `status--${task.status}`]" />
    <div class="task-body">
      <strong>{{ task.content }}</strong>
      <small>{{ task.status }}</small>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ChatTodoItem } from '../../composables/chat-model'

defineProps<{
  task: ChatTodoItem
}>()
</script>

<style scoped>
.task-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  border: 1px solid #e5e7eb;
  background: #ffffff;
}

.status {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  margin-top: 6px;
  background: #cbd5e1;
}

.status--done,
.status--completed {
  background: #10b981;
}

.status--in_progress,
.status--running {
  background: #f59e0b;
}

.status--pending {
  background: #94a3b8;
}

.task-body {
  display: grid;
  gap: 4px;
}

.task-body strong {
  font-size: 13px;
  color: #111827;
}

.task-body small {
  color: #6b7280;
  text-transform: uppercase;
}
</style>
