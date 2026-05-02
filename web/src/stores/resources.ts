import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { resourcesApi, type ResourceStats } from '../api/resources'

export interface ResourceEvent {
  kind: string
  type?: string
  name?: string
  action?: string
}

export const useResourcesStore = defineStore('resources', () => {
  const resources = ref<Record<string, any>>({})
  const stats = ref<ResourceStats>({
    skills: 0,
    mcp: 0,
    agents: 0,
    providers: 0,
  })
  const loading = ref(false)
  const initialized = ref(false)
  const subscribed = ref(false)

  let eventSource: EventSource | null = null
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null

  async function loadStats() {
    loading.value = true
    try {
      const data = await resourcesApi.getStats()
      stats.value = data
    } catch (e) {
      console.error('Failed to load stats:', e)
    } finally {
      loading.value = false
    }
  }

  function handleSSEMessage(event: MessageEvent) {
    try {
      const data: ResourceEvent = JSON.parse(event.data)
      // Update stats when resource changes occur
      if (['skill', 'mcp', 'agents', 'agent', 'provider'].includes(data.kind)) {
        loadStats()
        // Invalidate slash command cache when resources change
        import('../views/chat/slash-command-cache.js').then(({ invalidateCommandsCache }) => {
          invalidateCommandsCache()
        }).catch(err => {
          console.warn('Failed to invalidate slash command cache:', err)
        })
      }
    } catch (err) {
      console.error('Failed to parse SSE event:', err)
    }
  }

  function handleSSEError() {
    console.error('SSE error, reconnecting...')
    // Reconnect after delay
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
    }
    reconnectTimeout = setTimeout(() => {
      if (subscribed.value) {
        setupEventSource()
      }
    }, 5000)
  }

  function setupEventSource() {
    if (eventSource) {
      eventSource.close()
    }

    try {
      eventSource = new EventSource('/api/resources/events')
      eventSource.addEventListener('message', handleSSEMessage)
      eventSource.onerror = handleSSEError
      subscribed.value = true
    } catch (err) {
      console.error('Failed to setup SSE:', err)
      handleSSEError()
    }
  }

  function unsubscribe() {
    subscribed.value = false
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
  }

  async function initialize() {
    if (initialized.value) return
    loading.value = true
    try {
      await loadStats()
      setupEventSource()
      initialized.value = true
    } finally {
      loading.value = false
    }
  }

  return {
    resources,
    stats,
    loading,
    initialized,
    subscribed,
    loadStats,
    setupEventSource,
    unsubscribe,
    initialize,
  }
})
