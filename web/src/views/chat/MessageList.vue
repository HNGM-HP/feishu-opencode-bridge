<template>
  <div class="message-list">
    <div v-if="loading" class="state-card">
      <el-skeleton :rows="4" animated />
    </div>
    <div v-else-if="!session" class="state-card empty-card">
      <div class="empty-title">选择会话或直接开始</div>
      <p>左侧切换历史会话，也可以直接发送一条消息自动创建新会话。</p>
    </div>
    <div v-else-if="messages.length === 0" class="state-card empty-card">
      <div class="empty-title">从一个问题开始</div>
      <p>当前会话还没有消息。可以直接提问，也可以先在左侧创建新的会话。</p>
    </div>
    <template v-else>
      <div v-if="hasMore || hiddenMessageCount > 0" class="history-toolbar">
        <span>已隐藏 {{ hiddenMessageCount }} 条更早消息</span>
        <el-button
          size="small"
          :loading="loadingMore"
          :disabled="loadingMore || !hasMore"
          @click="$emit('load-more')"
        >
          加载更早 30 条
        </el-button>
      </div>

      <Conversation class="message-stack">
        <template v-for="turn in turns" :key="turn.id">
          <!-- 有用户消息的轮次：用 TurnItem 合并展示 -->
          <TurnItem
            v-if="turn.userMessage"
            :user-message="turn.userMessage"
            :assistant-messages="turn.assistantMessages"
            :undo-disabled="undoDisabled"
            :auto-expand="turn.autoExpand"
            :running="running"
            @revert="$emit('revert', $event)"
          />
          <!-- 无配对用户消息的 assistant 消息（历史加载不完整等）：用原始 MessageItem -->
          <MessageItem
            v-else
            v-for="msg in turn.assistantMessages"
            :key="msg.id"
            :message="msg"
            :undo-disabled="undoDisabled"
            :auto-expand="turn.autoExpand"
            :running="running"
            @revert="$emit('revert', $event)"
          />
        </template>
      </Conversation>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Conversation from '../../components/ai-elements/Conversation.vue'
import MessageItem from './MessageItem.vue'
import TurnItem from './TurnItem.vue'
import type { ChatSessionSummary } from '../../api'
import { buildConversationTurns, type ChatMessageVm } from '../../composables/chat-model'

const props = defineProps<{
  session: ChatSessionSummary | null
  messages: ChatMessageVm[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  hiddenMessageCount: number
  undoDisabled?: boolean
  running?: boolean
}>()

defineEmits<{
  'load-more': []
  revert: [ChatMessageVm]
}>()

const turns = computed(() => buildConversationTurns(props.messages))
</script>

<style scoped>
.message-list {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #fafbfc;
}

.message-stack {
  flex: 1;
  min-height: 0;
}

.history-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 14px;
  border-bottom: 1px solid #eceff3;
  background: #f3f4f6;
  font-size: 12px;
  color: #9ca3af;
}

.state-card {
  margin: 24px;
  padding: 32px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.empty-card {
  min-height: 180px;
  display: grid;
  place-content: center;
  text-align: center;
  gap: 8px;
  color: #9ca3af;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: #374151;
}
</style>
