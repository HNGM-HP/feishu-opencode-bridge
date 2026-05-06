import { ref } from 'vue'
import { chatApi, type ChatSessionSummary } from '../api'

export function useChatSessions() {
  const sessions = ref<ChatSessionSummary[]>([])
  const loading = ref(false)

  async function refresh(): Promise<ChatSessionSummary[]> {
    loading.value = true
    try {
      sessions.value = await chatApi.listSessions()
      return sessions.value
    } finally {
      loading.value = false
    }
  }

  async function createSession(payload?: { title?: string; directory?: string }): Promise<ChatSessionSummary> {
    const session = await chatApi.createSession(payload)
    sessions.value = [session, ...sessions.value.filter(item => item.id !== session.id)]
    return session
  }

  async function renameSession(sessionId: string, title: string): Promise<void> {
    await chatApi.renameSession(sessionId, title)
    const target = sessions.value.find(item => item.id === sessionId)
    if (target) {
      target.title = title
      target.updatedAt = Date.now()
    }
  }

  async function deleteSession(sessionId: string): Promise<void> {
    await chatApi.deleteSession(sessionId)
    sessions.value = sessions.value.filter(item => item.id !== sessionId)
  }

  function touchSession(sessionId: string): void {
    const target = sessions.value.find(item => item.id === sessionId)
    if (!target) return
    target.updatedAt = Date.now()
    sessions.value = [target, ...sessions.value.filter(item => item.id !== sessionId)]
  }

  return {
    sessions,
    loading,
    refresh,
    createSession,
    renameSession,
    deleteSession,
    touchSession,
  }
}
