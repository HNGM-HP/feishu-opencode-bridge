import { ref, watch, type Ref } from 'vue'
import { chatApi, type ChatEvent, type ChatModelRef } from '../api'
import {
  applyChatEvent,
  buildConversationTurns,
  createErrorAssistantMessage,
  createOptimisticUserMessage,
  extractTasksFromHistory,
  finalizeStreamingMessages,
  mergeChatMessages,
  normalizeHistoryMessage,
  type ChatMessageVm,
  type ChatStreamState,
  type ChatTodoItem,
} from './chat-model'
import { useChatStream } from './useChatStream'
import { usePermission } from './usePermission'

const HISTORY_PAGE_SIZE = 30

export function useChatMessages(sessionId: Ref<string | null>) {
  const messages = ref<ChatMessageVm[]>([])
  const tasks = ref<ChatTodoItem[]>([])
  const loading = ref(false)
  const loadingMore = ref(false)
  const sending = ref(false)
  const running = ref(false)
  const lastError = ref<string | null>(null)
  const streamState = ref<ChatStreamState>('disconnected')
  const total = ref(0)
  const totalTurns = ref(0)
  const hasMore = ref(false)
  const nextCursor = ref<string | null>(null)
  const permission = usePermission()
  let requestVersion = 0

  const stream = useChatStream(sessionId, {
    onEvent(event: ChatEvent) {
      applyIncomingEvent(event)
    },
  })

  async function fetchLatestMessages(currentVersion: number, targetSessionId: string): Promise<void> {
    const page = await chatApi.getMessages(targetSessionId, { limit: HISTORY_PAGE_SIZE })
    if (currentVersion !== requestVersion || targetSessionId !== sessionId.value) return

    const latestTasks = Array.isArray(page.tasks) ? page.tasks : []
    tasks.value = latestTasks.length > 0 ? latestTasks : extractTasksFromHistory(page.messages)
    total.value = page.total
    totalTurns.value = page.totalTurns ?? buildConversationTurns(page.messages.map(normalizeHistoryMessage)).length
    hasMore.value = page.hasMore
    nextCursor.value = page.nextCursor
    messages.value = mergeChatMessages(page.messages.map(normalizeHistoryMessage), [])
  }

  watch(
    () => stream.state.value,
    value => {
      streamState.value = value
    },
    { immediate: true }
  )

  watch(
    () => stream.lastError.value,
    value => {
      if (value) lastError.value = value
    }
  )

  watch(
    sessionId,
    async nextSessionId => {
      requestVersion += 1
      const currentVersion = requestVersion
      messages.value = []
      tasks.value = []
      // 切换会话时必须把所有"工作中"信号一并复位，否则上一会话残留的
      // sending=true 会让新会话误显示「中断」按钮（issue: 切换至其它会话有概率显示中断）
      sending.value = false
      running.value = false
      lastError.value = null
      total.value = 0
      totalTurns.value = 0
      hasMore.value = false
      nextCursor.value = null
      permission.reset()

      if (!nextSessionId) {
        return
      }

      loading.value = true
      try {
        await fetchLatestMessages(currentVersion, nextSessionId)
      } catch (error) {
        if (currentVersion !== requestVersion) return
        lastError.value = error instanceof Error ? error.message : '加载会话消息失败'
      } finally {
        if (currentVersion === requestVersion) {
          loading.value = false
        }
      }
    },
    { immediate: true }
  )

  function applyIncomingEvent(event: ChatEvent): void {
    switch (event.type) {
      case 'task_update':
        tasks.value = event.todos
        return

      case 'permission_ask':
        permission.enqueue(event.req)
        return

      case 'permission_resolved':
        permission.resolve(event.reqId)
        return

      case 'session_status':
        if (event.status === 'idle') {
          sending.value = false
          running.value = false
          finalizeStreamingMessages(messages.value)
        } else {
          running.value = true
        }
        return

      case 'error':
        lastError.value = event.message
        sending.value = false
        running.value = false
        messages.value = [...messages.value, createErrorAssistantMessage(event.message)]
        return

      case 'session_idle':
        sending.value = false
        running.value = false
        finalizeStreamingMessages(messages.value)
        return

      case 'message_end':
        sending.value = false
        running.value = false
        applyChatEvent(messages.value, event)
        return

      case 'message_start':
      case 'text_delta':
      case 'reasoning_delta':
      case 'tool_start':
      case 'tool_delta':
        running.value = true
        applyChatEvent(messages.value, event)
        return

      default:
        applyChatEvent(messages.value, event)
    }
  }

  async function loadMoreHistory(): Promise<void> {
    if (!sessionId.value || !nextCursor.value || loading.value || loadingMore.value) {
      return
    }

    const currentVersion = requestVersion
    const currentSessionId = sessionId.value
    loadingMore.value = true
    try {
      const page = await chatApi.getMessages(currentSessionId, {
        limit: HISTORY_PAGE_SIZE,
        cursor: nextCursor.value,
      })
      if (currentVersion !== requestVersion || currentSessionId !== sessionId.value) return
      const latestTasks = Array.isArray(page.tasks) ? page.tasks : []
      tasks.value = latestTasks.length > 0 ? latestTasks : tasks.value
      total.value = page.total
      totalTurns.value = page.totalTurns ?? totalTurns.value
      hasMore.value = page.hasMore
      nextCursor.value = page.nextCursor
      messages.value = mergeChatMessages(page.messages.map(normalizeHistoryMessage), messages.value)
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : '加载更多历史失败'
    } finally {
      loadingMore.value = false
    }
  }

  async function sendText(payload: {
    sessionId: string
    text: string
    parts?: Array<{ type: 'text'; text: string } | { type: 'file'; mime: string; url: string; filename?: string }>
    providerId?: string
    modelId?: string
    agent?: string
    variant?: string
  }): Promise<void> {
    const trimmed = payload.text.trim()
    if (!trimmed && !payload.parts) return

    const model: ChatModelRef | undefined = payload.providerId && payload.modelId
      ? {
          providerId: payload.providerId,
          modelId: payload.modelId,
        }
      : undefined

    messages.value = [...messages.value, createOptimisticUserMessage(trimmed, model, payload.parts)]
    sending.value = true
    running.value = true
    lastError.value = null

    try {
      await chatApi.sendPrompt({
        sessionId: payload.sessionId,
        text: trimmed,
        parts: payload.parts,
        providerId: payload.providerId,
        modelId: payload.modelId,
        agent: payload.agent,
        variant: payload.variant,
      })
    } catch (error) {
      sending.value = false
      running.value = false
      const message = error instanceof Error ? error.message : '发送消息失败'
      lastError.value = message
      messages.value = [...messages.value, createErrorAssistantMessage(message)]
    }
  }

  async function reload(): Promise<void> {
    if (!sessionId.value) {
      messages.value = []
      tasks.value = []
      total.value = 0
      totalTurns.value = 0
      hasMore.value = false
      nextCursor.value = null
      return
    }

    requestVersion += 1
    const currentVersion = requestVersion
    loading.value = true
    lastError.value = null

    try {
      await fetchLatestMessages(currentVersion, sessionId.value)
    } catch (error) {
      if (currentVersion !== requestVersion) return
      lastError.value = error instanceof Error ? error.message : '刷新会话消息失败'
    } finally {
      if (currentVersion === requestVersion) {
        loading.value = false
      }
    }
  }

  function discardFromMessage(messageId: string): void {
    const index = messages.value.findIndex(message => message.id === messageId)
    if (index < 0) return

    const removedCount = messages.value.length - index
    messages.value = messages.value.slice(0, index)
    total.value = Math.max(messages.value.length, total.value - removedCount)
    totalTurns.value = Math.min(totalTurns.value, buildConversationTurns(messages.value).length)
    sending.value = false
    running.value = false
  }

  function discardConversationFromMessage(messageId: string): void {
    const turns = buildConversationTurns(messages.value)
    const turnIndex = turns.findIndex(turn => {
      if (turn.userMessage?.id === messageId) return true
      return turn.assistantMessages.some(message => message.id === messageId)
    })

    if (turnIndex < 0) {
      discardFromMessage(messageId)
      return
    }

    const retainedTurns = turns.slice(0, turnIndex)
    const retainedIds = new Set<string>()
    for (const turn of retainedTurns) {
      if (turn.userMessage?.id) retainedIds.add(turn.userMessage.id)
      for (const assistantMessage of turn.assistantMessages) {
        retainedIds.add(assistantMessage.id)
      }
    }

    messages.value = messages.value.filter(message => retainedIds.has(message.id))
    total.value = Math.min(total.value, messages.value.length)
    totalTurns.value = Math.min(totalTurns.value, retainedTurns.length)
    sending.value = false
    running.value = false
  }

  function retainMessages(messageIds: string[]): void {
    const allowed = new Set(messageIds.filter(Boolean))
    messages.value = messages.value.filter(message => allowed.has(message.id))
    total.value = Math.min(total.value, messages.value.length)
    totalTurns.value = Math.min(totalTurns.value, buildConversationTurns(messages.value).length)
    sending.value = false
    running.value = false
  }

  return {
    messages,
    tasks,
    loading,
    loadingMore,
    sending,
    running,
    lastError,
    streamState,
    total,
    totalTurns,
    hasMore,
    permissionQueue: permission.queue,
    activePermission: permission.activeRequest,
    resolvePermissionRequest: permission.resolve,
    reconnectStream: stream.reconnect,
    loadMoreHistory,
    sendText,
    reload,
    discardFromMessage,
    discardConversationFromMessage,
    retainMessages,
  }
}
