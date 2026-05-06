<template>
  <header class="session-header">
    <div class="session-meta">
      <div class="header-top">
        <h1>{{ session?.title || '新对话' }}</h1>
        <span class="state-badge" :class="stateBadgeClass">{{ stateLabel }}</span>
      </div>
      <p class="session-dir">{{ session?.directory || '未绑定目录' }}</p>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ChatSessionSummary } from '../../api'
import type { ChatStreamState } from '../../composables/chat-model'

const props = defineProps<{
  session: ChatSessionSummary | null
  messageCount: number
  streamState: ChatStreamState
  sending: boolean
  running: boolean
  aborting: boolean
  modelLabel: string
  effortLabel: string
  agentLabel: string
}>()

const stateLabel = computed(() => {
  if (props.aborting) return '中断中'
  if (props.running || props.sending) return '响应中'
  if (props.streamState === 'idle') return '空闲'
  if (props.streamState === 'connected') return '已连接'
  if (props.streamState === 'connecting') return '连接中'
  return '就绪'
})

const stateBadgeClass = computed(() => {
  if (props.aborting) return 'state-badge--warn'
  if (props.running || props.sending) return 'state-badge--active'
  return 'state-badge--idle'
})
</script>

<style scoped>
.session-header {
  padding: 10px 14px;
  border-bottom: 1px solid #e5e7eb;
  background: #ffffff;
}

.header-top {
  display: flex;
  align-items: center;
  gap: 10px;
}

.session-meta h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.3;
  color: #111827;
}

.session-dir {
  margin: 2px 0 0;
  font-size: 12px;
  color: #9ca3af;
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.state-badge {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 8px;
}

.state-badge--active {
  color: #d97706;
  background: #fffbeb;
}

.state-badge--warn {
  color: #dc2626;
  background: #fef2f2;
}

.state-badge--idle {
  color: #6b7280;
  background: #f3f4f6;
}
</style>
