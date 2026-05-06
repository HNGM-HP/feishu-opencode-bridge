<template>
  <section class="panel">
    <div class="panel-head">
      <h3>看板</h3>
      <span class="count">{{ tasks.length }}</span>
    </div>

    <div v-if="tasks.length === 0" class="placeholder">
      当前还没有 TodoWrite 任务。触发相关工具后会在这里同步展示。
    </div>

    <div v-else class="task-list">
      <Task
        v-for="task in tasks"
        :key="task.id"
        :task="task"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import Task from '../../components/ai-elements/Task.vue'
import type { ChatTodoItem } from '../../composables/chat-model'

defineProps<{
  tasks: ChatTodoItem[]
}>()
</script>

<style scoped>
.panel {
  padding: 16px;
  background: #ffffff;
  min-height: 0;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 14px;
}

.panel-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #1a1a2e;
}

.count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  border-radius: 12px;
  background: #f0f1f5;
  color: #4a4e69;
  font-size: 12px;
  font-weight: 600;
}

.placeholder {
  padding: 12px 14px;
  border-radius: 6px;
  background: #f8f9fb;
  color: #8b8fa3;
  line-height: 1.6;
  font-size: 13px;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
