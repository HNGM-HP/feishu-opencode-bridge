import { ref, watch, type Ref } from 'vue'
import { chatApi, type ChatEvent, type ChatModelRef } from '../api'
import {
  applyChatEvent,
  createErrorAssistantMessage,
  createOptimisticUserMessage,
  extractTasksFromHistory,
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
  const lastError = ref<string | null>(null)
  const streamState = ref<ChatStreamState>('disconnected')
  const total = ref(0)
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
      lastError.value = null
      total.value = 0
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
        }
        return

      case 'error':
        lastError.value = event.message
        sending.value = false
        messages.value = [...messages.value, createErrorAssistantMessage(event.message)]
        return

      case 'session_idle':
        sending.value = false
        return

      case 'message_end':
        sending.value = false
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
    providerId?: string
    modelId?: string
    agent?: string
    variant?: string
  }): Promise<void> {
    const trimmed = payload.text.trim()
    if (!trimmed) return

    const model: ChatModelRef | undefined = payload.providerId && payload.modelId
      ? {
          providerId: payload.providerId,
          modelId: payload.modelId,
        }
      : undefined

    messages.value = [...messages.value, createOptimisticUserMessage(trimmed, model)]
    sending.value = true
    lastError.value = null

    try {
      await chatApi.sendPrompt({
        sessionId: payload.sessionId,
        text: trimmed,
        providerId: payload.providerId,
        modelId: payload.modelId,
        agent: payload.agent,
        variant: payload.variant,
      })
    } catch (error) {
      sending.value = false
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
    sending.value = false
  }

  return {
    messages,
    tasks,
    loading,
    loadingMore,
    sending,
    lastError,
    streamState,
    total,
    hasMore,
    permissionQueue: permission.queue,
    activePermission: permission.activeRequest,
    resolvePermissionRequest: permission.resolve,
    reconnectStream: stream.reconnect,
    loadMoreHistory,
    sendText,
    reload,
    discardFromMessage,
  }
}
