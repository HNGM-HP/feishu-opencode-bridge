<template>
  <transition name="plan-preview-fade">
    <section v-if="visible" class="plan-preview" :class="{ 'plan-preview--active': active }">
      <button type="button" class="plan-preview__summary" @click="toggleExpanded">
        <div class="plan-preview__meta">
          <span class="plan-preview__eyebrow">执行计划</span>
          <strong>{{ summaryText }}</strong>
        </div>
        <div class="plan-preview__status">
          <span v-if="active" class="plan-preview__pulse" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>{{ expanded ? '收起' : '展开' }}</span>
        </div>
      </button>

      <div v-if="expanded" class="plan-preview__body">
        <Task v-for="task in tasks" :key="task.id" :task="task" />
      </div>
    </section>
  </transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ChatTodoItem } from '../../api'
import Task from '../../components/ai-elements/Task.vue'

const AUTO_COLLAPSE_MS = 4800

const props = defineProps<{
  tasks: ChatTodoItem[]
  active: boolean
}>()

const expanded = ref(false)
const visible = ref(false)
let collapseTimer: number | null = null

const summaryText = computed(() => {
  const total = props.tasks.length
  const completed = props.tasks.filter(task => task.status === 'completed' || task.status === 'done').length
  const running = props.tasks.filter(task => task.status === 'in_progress' || task.status === 'running').length

  if (running > 0) return `正在执行 ${running}/${total} 个步骤`
  if (completed === total && total > 0) return `已完成 ${total} 个步骤`
  return `已规划 ${total} 个步骤`
})

watch(
  () => props.tasks.map(task => `${task.id}:${task.status}:${task.content}`).join('|'),
  signature => {
    clearCollapseTimer()
    if (!signature) {
      visible.value = false
      expanded.value = false
      return
    }

    visible.value = true
    expanded.value = true
    collapseTimer = window.setTimeout(() => {
      expanded.value = false
    }, AUTO_COLLAPSE_MS)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  clearCollapseTimer()
})

function toggleExpanded(): void {
  expanded.value = !expanded.value
  if (expanded.value) {
    clearCollapseTimer()
    collapseTimer = window.setTimeout(() => {
      expanded.value = false
    }, AUTO_COLLAPSE_MS)
    return
  }

  clearCollapseTimer()
}

function clearCollapseTimer(): void {
  if (collapseTimer != null) {
    window.clearTimeout(collapseTimer)
    collapseTimer = null
  }
}
</script>

<style scoped>
.plan-preview {
  margin: 0 12px 12px;
  border: 1px solid #dbe5f3;
  background: linear-gradient(135deg, #f8fbff 0%, #ffffff 100%);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.05);
}

.plan-preview--active {
  border-color: #bfdbfe;
  box-shadow: 0 14px 32px rgba(59, 130, 246, 0.12);
}

.plan-preview__summary {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.plan-preview__meta {
  display: grid;
  gap: 3px;
}

.plan-preview__eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #64748b;
}

.plan-preview__meta strong {
  font-size: 14px;
  color: #0f172a;
}

.plan-preview__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #475569;
}

.plan-preview__pulse {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.plan-preview__pulse span {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #2563eb;
  opacity: 0.3;
  animation: plan-preview-pulse 1.1s infinite ease-in-out;
}

.plan-preview__pulse span:nth-child(2) {
  animation-delay: 0.16s;
}

.plan-preview__pulse span:nth-child(3) {
  animation-delay: 0.32s;
}

.plan-preview__body {
  display: grid;
  gap: 8px;
  padding: 0 14px 14px;
}

.plan-preview-fade-enter-active,
.plan-preview-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.plan-preview-fade-enter-from,
.plan-preview-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@keyframes plan-preview-pulse {
  0%,
  80%,
  100% {
    transform: scale(0.72);
    opacity: 0.3;
  }

  40% {
    transform: scale(1);
    opacity: 1;
  }
}

@media (max-width: 720px) {
  .plan-preview__summary {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
