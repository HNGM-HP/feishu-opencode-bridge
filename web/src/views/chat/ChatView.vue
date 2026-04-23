<template>
  <section class="chat-view">
    <SessionHeader
      :session="session"
      :message-count="messages.length + hiddenMessageCount"
      :stream-state="streamState"
      :sending="sending"
      :running="running"
      :aborting="aborting"
      :model-label="modelLabel"
      :effort-label="effortLabel"
      :agent-label="agentLabel"
    />

    <el-alert
      v-if="lastError"
      type="error"
      :closable="false"
      show-icon
      class="chat-alert"
      :title="lastError"
    />

    <el-alert
      v-else-if="session && streamState === 'disconnected' && !loading"
      type="warning"
      :closable="false"
      show-icon
      class="chat-alert"
    >
      <template #title>流式连接已断开</template>
      <template #default>
        <div class="stream-alert">
          <span>历史消息仍可查看，但新回复可能无法实时推送。</span>
          <el-button size="small" @click="$emit('reconnect')">重新连接</el-button>
        </div>
      </template>
    </el-alert>

    <MessageList
      :session="session"
      :messages="messages"
      :loading="loading"
      :loading-more="loadingMore"
      :has-more="hasMoreMessages"
      :hidden-message-count="hiddenMessageCount"
      :undo-disabled="sending || aborting"
      :running="running"
      @load-more="$emit('loadMore')"
      @revert="$emit('revert', $event)"
    />

    <TaskPlanPreview
      :tasks="tasks"
      :active="running || aborting"
    />

    <MessageInput
      :providers="providers"
      :draft="draft"
      :provider-id="providerId"
      :model-id="modelId"
      :variant="variant"
      :variants="variants"
      :agent-name="agentName"
      :agents="agents"
      :draft-attachments="draftAttachments"
      :draft-attachments-key="draftAttachmentsKey"
      :disabled="false"
      :sending="sending"
      :can-abort="running"
      :aborting="aborting"
      @submit="$emit('submit', $event)"
      @abort="$emit('abort')"
      @update:draft="$emit('update:draft', $event)"
      @update:model-selection="$emit('update:model-selection', $event)"
      @update:provider-id="$emit('update:providerId', $event)"
      @update:model-id="$emit('update:modelId', $event)"
      @update:variant="$emit('update:variant', $event)"
      @update:agent-name="$emit('update:agentName', $event)"
    />

    <TerminalPanel
      v-if="terminalVisible"
      :directory="workspaceDirectory"
      @close="$emit('close-terminal')"
    />
  </section>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import MessageInput from './MessageInput.vue'
import MessageList from './MessageList.vue'
import SessionHeader from './SessionHeader.vue'
import TaskPlanPreview from './TaskPlanPreview.vue'
import type { ChatAgentInfo, ChatModelProviderInfo, ChatSessionSummary, ChatTodoItem } from '../../api'
import type { ChatMessageVm, ChatStreamState } from '../../composables/chat-model'

const TerminalPanel = defineAsyncComponent(() => import('./side-panels/TerminalPanel.vue'))

defineProps<{
  session: ChatSessionSummary | null
  messages: ChatMessageVm[]
  loading: boolean
  loadingMore: boolean
  hasMoreMessages: boolean
  hiddenMessageCount: number
  tasks: ChatTodoItem[]
  sending: boolean
  running: boolean
  aborting: boolean
  streamState: ChatStreamState
  lastError: string | null
  providers: ChatModelProviderInfo[]
  draft: string
  providerId?: string
  modelId?: string
  variant?: string
  variants: string[]
  agentName?: string
  agents: ChatAgentInfo[]
  draftAttachments?: Array<{ url: string; mime: string; filename?: string }>
  draftAttachmentsKey?: number
  modelLabel: string
  effortLabel: string
  agentLabel: string
  terminalVisible: boolean
  workspaceDirectory?: string
}>()

defineEmits<{
  submit: [{ text: string; parts?: Array<{ type: 'text'; text: string } | { type: 'file'; mime: string; url: string; filename?: string }>; providerId?: string; modelId?: string; variant?: string; agent?: string }]
  abort: []
  reconnect: []
  loadMore: []
  revert: [ChatMessageVm]
  'close-terminal': []
  'update:draft': [string]
  'update:model-selection': [{ providerId?: string; modelId?: string }]
  'update:providerId': [string?]
  'update:modelId': [string?]
  'update:variant': [string?]
  'update:agentName': [string?]
}>()
</script>

<style scoped>
.chat-view {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-right: 1px solid #e5e7eb;
}

.chat-alert {
  margin: 12px;
}

.stream-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
</style>
