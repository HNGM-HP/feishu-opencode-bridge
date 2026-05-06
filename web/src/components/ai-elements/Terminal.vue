<template>
  <div
    class="terminal-output"
    v-html="terminalHtml"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import AnsiToHtml from 'ansi-to-html'

const props = defineProps<{
  output: string
}>()

const converter = new AnsiToHtml({
  escapeXML: true,
  newline: true,
  stream: false,
})

const terminalHtml = computed(() => converter.toHtml(props.output || ''))
</script>

<style scoped>
.terminal-output {
  padding: 14px;
  border-radius: 16px;
  background: linear-gradient(180deg, #020617, #111827);
  color: #dbeafe;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
}

.terminal-output :deep(span) {
  white-space: pre-wrap;
}
</style>
