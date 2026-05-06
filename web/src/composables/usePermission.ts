import { computed, ref } from 'vue'
import type { ChatPermissionRequest } from '../api'

export function usePermission() {
  const queue = ref<ChatPermissionRequest[]>([])

  const activeRequest = computed(() => queue.value[0] ?? null)

  function enqueue(request: ChatPermissionRequest): void {
    if (queue.value.some(item => item.id === request.id)) return
    queue.value = [...queue.value, request]
  }

  function resolve(requestId: string): void {
    queue.value = queue.value.filter(item => item.id !== requestId)
  }

  function reset(): void {
    queue.value = []
  }

  return {
    queue,
    activeRequest,
    enqueue,
    resolve,
    reset,
  }
}
