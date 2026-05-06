<template>
  <div
    ref="containerRef"
    class="conversation"
    @scroll="handleScroll"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const containerRef = ref<HTMLElement | null>(null)
const isStuck = ref(true)

const SCROLL_THRESHOLD = 48

function isNearBottom(): boolean {
  const el = containerRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD
}

function scrollToBottom(): void {
  const el = containerRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function handleScroll(): void {
  isStuck.value = isNearBottom()
}

/** Re-stick whenever slot content changes, throttled via rAF */
let observer: MutationObserver | null = null
let rafId: number | null = null

function onMutations(): void {
  if (!isStuck.value) return
  // Coalesce rapid mutations into one scroll per frame
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    scrollToBottom()
  })
}

onMounted(() => {
  const el = containerRef.value
  if (!el) return

  observer = new MutationObserver(onMutations)
  observer.observe(el, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  // Initial scroll
  nextTick(scrollToBottom)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
})

defineExpose({
  scrollToBottom,
  isStuck,
})
</script>

<style scoped>
.conversation {
  display: grid;
  align-content: start;
  gap: 14px;
  overflow-y: auto;
  scroll-behavior: smooth;
  padding: 18px 14px 24px;
}
</style>
