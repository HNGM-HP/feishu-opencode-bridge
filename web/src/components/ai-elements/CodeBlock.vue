<template>
  <section class="code-block" data-i18n-skip>
    <header class="code-toolbar">
      <span class="code-language">{{ title || displayLanguage }}</span>
      <button type="button" class="copy-button" @click="handleCopy">
        {{ copied ? '已复制' : '复制' }}
      </button>
    </header>
    <div class="code-content" v-html="renderedHtml" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { escapeHtml } from './markdown-utils'
import {
  ensureShikiLanguage,
  getShikiHighlighter,
  getShikiTheme,
  normalizeCodeLanguage,
} from './shiki'

const props = defineProps<{
  code: string
  language?: string
  title?: string
}>()

const renderedHtml = ref(renderFallback(props.code))
const copied = ref(false)
let copyTimer: number | null = null
let renderVersion = 0

const normalizedLanguage = computed(() => normalizeCodeLanguage(props.language))
const displayLanguage = computed(() => normalizedLanguage.value === 'plaintext' ? 'text' : normalizedLanguage.value)

watch(
  () => [props.code, normalizedLanguage.value] as const,
  async () => {
    const currentVersion = ++renderVersion
    renderedHtml.value = renderFallback(props.code)

    try {
      const highlighter = await getShikiHighlighter()
      const language = await ensureShikiLanguage(normalizedLanguage.value)
      if (currentVersion !== renderVersion) return
      renderedHtml.value = highlighter.codeToHtml(props.code || '', {
        lang: language,
        theme: getShikiTheme(),
      })
    } catch {
      if (currentVersion !== renderVersion) return
      renderedHtml.value = renderFallback(props.code)
    }
  },
  { immediate: true }
)

async function handleCopy(): Promise<void> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(props.code)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = props.code
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      textarea.style.top = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      try { document.execCommand('copy') } finally { document.body.removeChild(textarea) }
    }
    copied.value = true
    if (copyTimer) {
      window.clearTimeout(copyTimer)
    }
    copyTimer = window.setTimeout(() => {
      copied.value = false
    }, 1600)
  } catch {
    copied.value = false
  }
}

function renderFallback(code: string): string {
  return `<pre class="shiki-fallback"><code>${escapeHtml(code || '')}</code></pre>`
}
</script>

<style scoped>
.code-block {
  margin: 12px 0;
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.12);
  background: #0f172a;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.code-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: rgba(2, 6, 23, 0.92);
  color: rgba(226, 232, 240, 0.78);
}

.code-language {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 700;
}

.copy-button {
  border: 0;
  border-radius: 999px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.08);
  color: #f8fafc;
  font-size: 12px;
  cursor: pointer;
}

.copy-button:hover {
  background: rgba(255, 255, 255, 0.14);
}

.code-content :deep(pre) {
  margin: 0;
  padding: 16px !important;
  overflow-x: auto;
  background: transparent !important;
}

.code-content :deep(code) {
  font-family: 'SFMono-Regular', 'Fira Code', Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.7;
}

.code-content :deep(.shiki-fallback) {
  margin: 0;
  padding: 16px;
  color: #dbeafe;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
