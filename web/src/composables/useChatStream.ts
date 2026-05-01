import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { ChatEvent } from '../api'
import type { ChatStreamState } from './chat-model'
import { parseEventSeq, resolveReplaySince } from './chat-stream-utils'

const CHAT_EVENT_TYPES = [
  'message_start',
  'text_delta',
  'reasoning_delta',
  'tool_start',
  'tool_delta',
  'tool_end',
  'message_end',
  'permission_ask',
  'permission_resolved',
  'task_update',
  'session_idle',
  'session_status',
  'error',
  'keepalive',
] as const

/** Exponential backoff parameters */
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000
const RECONNECT_FACTOR = 2

export function useChatStream(
  sessionId: Ref<string | null>,
  options: {
    onEvent: (event: ChatEvent) => void
  }
) {
  const state = ref<ChatStreamState>('disconnected')
  const lastError = ref<string | null>(null)
  let source: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0
  let currentSessionId: string | null = null
  let lastEventSeq: number | null = null
  let intentionalClose = false

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function close(): void {
    intentionalClose = true
    clearReconnectTimer()
    if (!source) return
    source.close()
    source = null
    state.value = 'disconnected'
  }

  function scheduleReconnect(): void {
    if (intentionalClose || !currentSessionId) return
    clearReconnectTimer()

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(RECONNECT_FACTOR, reconnectAttempt),
      RECONNECT_MAX_MS
    )
    reconnectAttempt++

    console.log(`[ChatStream] 将在 ${delay}ms 后自动重连 (第 ${reconnectAttempt} 次)`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (currentSessionId && !intentionalClose) {
        connect(currentSessionId)
      }
    }, delay)
  }

  function connect(nextSessionId: string): void {
    const sinceSeq = resolveReplaySince(currentSessionId, nextSessionId, lastEventSeq)
    if (sinceSeq == null) {
      lastEventSeq = null
    }

    // Close previous without triggering reconnect
    intentionalClose = true
    clearReconnectTimer()
    if (source) {
      source.close()
      source = null
    }
    intentionalClose = false
    currentSessionId = nextSessionId

    const params = new URLSearchParams({
      session_id: nextSessionId,
    })
    if (sinceSeq != null) {
      params.set('since', String(sinceSeq))
    }

    state.value = 'connecting'
    lastError.value = null
    source = new EventSource(`/api/chat/events?${params.toString()}`)

    source.addEventListener('connected', () => {
      state.value = 'connected'
      reconnectAttempt = 0 // Reset backoff on successful connection
    })

    for (const eventType of CHAT_EVENT_TYPES) {
      source.addEventListener(eventType, payload => {
        try {
          const messageEvent = payload as MessageEvent<string>
          const eventSeq = parseEventSeq(messageEvent.lastEventId)
          if (eventSeq != null) {
            lastEventSeq = eventSeq
          }

          const event = JSON.parse(messageEvent.data) as ChatEvent
          if (event.type === 'keepalive') return
          if (event.type === 'session_idle') {
            state.value = 'idle'
          } else if (event.type === 'session_status' && event.status === 'idle') {
            state.value = 'idle'
          } else if (event.type === 'message_start' || event.type === 'text_delta') {
            state.value = 'connected'
          }
          options.onEvent(event)
        } catch (error) {
          lastError.value = error instanceof Error ? error.message : '解析流事件失败'
        }
      })
    }

    source.addEventListener('error', payload => {
      const messageEvent = payload as MessageEvent<string>
      if (typeof messageEvent.data === 'string' && messageEvent.data) {
        try {
          options.onEvent(JSON.parse(messageEvent.data) as ChatEvent)
        } catch {
          lastError.value = '解析错误事件失败'
        }
        return
      }

      // EventSource auto-reconnects on transient errors, but if readyState is CLOSED
      // the browser gave up — we need to manually reconnect with backoff.
      if (source && source.readyState === EventSource.CLOSED) {
        lastError.value = '流式连接已断开，正在自动重连…'
        state.value = 'disconnected'
        source.close()
        source = null
        scheduleReconnect()
      }
    })
  }

  watch(
    sessionId,
    nextSessionId => {
      reconnectAttempt = 0 // Reset backoff on session switch
      if (!nextSessionId) {
        close()
        currentSessionId = null
        lastEventSeq = null
        return
      }
      connect(nextSessionId)
    },
    { immediate: true }
  )

  onBeforeUnmount(close)

  return {
    state,
    lastError,
    reconnect: () => {
      reconnectAttempt = 0
      if (sessionId.value) connect(sessionId.value)
    },
    close,
  }
}
