<template>
  <div class="streaming-message" data-i18n-skip>
    <template v-if="text">
      <template v-for="segment in debouncedSegments" :key="segment.id">
        <Markdown v-if="segment.type === 'markdown'" :source="segment.content" />
        <CodeBlock v-else :code="segment.code" :language="segment.language" />
      </template>
    </template>
    <span v-if="text" class="caret" />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { splitMarkdownSegments, type MarkdownSegment } from '../../components/ai-elements/markdown-utils'

const Markdown = defineAsyncComponent(() => import('../../components/ai-elements/Markdown.vue'))
const CodeBlock = defineAsyncComponent(() => import('../../components/ai-elements/CodeBlock.vue'))

const props = defineProps<{
  text: string
}>()

/**
 * Debounced segments: during rapid streaming deltas we skip expensive
 * regex parsing and just show a single markdown segment. Once deltas
 * pause for DEBOUNCE_MS we re-parse into proper segments.
 */
const DEBOUNCE_MS = 120

const debouncedSegments = ref<MarkdownSegment[]>([])
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function quickSegment(text: string): MarkdownSegment[] {
  return text ? [{ id: 'streaming-0', type: 'markdown', content: text }] : []
}

watch(
  () => props.text,
  (text) => {
    // Short text: always parse (cheap)
    if (text.length < 2000) {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
      debouncedSegments.value = splitMarkdownSegments(text)
      return
    }

    // Long text: show quick segment immediately, debounce full parse
    debouncedSegments.value = quickSegment(text)

    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      debouncedSegments.value = splitMarkdownSegments(props.text)
    }, DEBOUNCE_MS)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
})
</script>

<style scoped>
.streaming-message {
  word-break: break-word;
}

.caret {
  display: inline-block;
  width: 0.65ch;
  height: 1.1em;
  margin-left: 3px;
  border-radius: 999px;
  background: #d97706;
  transform: translateY(2px);
  animation: blink 1s steps(1) infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}
</style>
