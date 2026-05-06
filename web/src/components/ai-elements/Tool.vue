<template>
  <section :class="['tool-card', { 'tool-card--error': tool.isError }]">
    <div class="tool-head">
      <div class="tool-title">
        <strong>{{ tool.title || tool.name }}</strong>
        <span class="tool-name">{{ tool.name }}</span>
      </div>
      <div class="tool-meta">
        <span :class="['tool-status', `tool-status--${tool.status}`]">{{ statusLabel }}</span>
        <span v-if="tool.durationMs" class="tool-duration">{{ formatDuration(tool.durationMs) }}</span>
      </div>
    </div>

    <div v-if="inputText" class="tool-section">
      <div class="section-label">Input</div>
      <CodeBlock :code="inputText" language="json" />
    </div>

    <div class="tool-section">
      <div class="section-label">Output</div>
      <div v-if="!tool.output" class="tool-placeholder">
        {{ tool.status === 'running' ? '等待工具输出…' : '没有输出内容' }}
      </div>

      <Terminal v-else-if="outputKind === 'terminal'" :output="tool.output" />
      <FileTree v-else-if="outputKind === 'filetree'" :output="tool.output" />
      <div v-else class="tool-markdown">
        <template v-for="segment in outputSegments" :key="segment.id">
          <Markdown v-if="segment.type === 'markdown'" :source="segment.content" />
          <CodeBlock v-else :code="segment.code" :language="segment.language" />
        </template>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ChatToolCallVm } from '../../composables/chat-model'
import CodeBlock from './CodeBlock.vue'
import FileTree from './FileTree.vue'
import Markdown from './Markdown.vue'
import Terminal from './Terminal.vue'
import { splitMarkdownSegments } from './markdown-utils'

const props = defineProps<{
  tool: ChatToolCallVm
}>()

const inputText = computed(() => {
  if (props.tool.input == null) return ''
  if (typeof props.tool.input === 'string') return props.tool.input
  try {
    return JSON.stringify(props.tool.input, null, 2)
  } catch {
    return String(props.tool.input)
  }
})

const outputKind = computed(() => {
  const name = props.tool.name.toLowerCase()
  const output = props.tool.output || ''

  if (/bash|shell|command|terminal|exec/.test(name) || /\u001b\[[0-9;]*m/.test(output) || /^\$ /m.test(output)) {
    return 'terminal'
  }

  if (/glob|find|ls|tree|list/.test(name)) {
    return 'filetree'
  }

  return 'markdown'
})

const outputSegments = computed(() => splitMarkdownSegments(props.tool.output || ''))

const statusLabel = computed(() => {
  if (props.tool.status === 'running') return '运行中'
  if (props.tool.status === 'completed') return '已完成'
  return '失败'
})

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`
  return `${Math.round(durationMs / 1000)}s`
}
</script>

<style scoped>
.tool-card {
  margin-top: 14px;
  border-radius: 18px;
  padding: 14px;
  background: rgba(240, 247, 255, 0.92);
  border: 1px solid rgba(180, 202, 231, 0.78);
}

.tool-card--error {
  background: rgba(255, 240, 240, 0.96);
  border-color: rgba(248, 113, 113, 0.28);
}

.tool-head,
.tool-meta {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.tool-title {
  display: grid;
  gap: 4px;
}

.tool-title strong {
  color: #10223d;
}

.tool-name,
.tool-duration {
  font-size: 11px;
  color: #66758d;
}

.tool-status {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.tool-status--running {
  background: rgba(251, 191, 36, 0.16);
  color: #b45309;
}

.tool-status--completed {
  background: rgba(16, 185, 129, 0.14);
  color: #047857;
}

.tool-status--error {
  background: rgba(239, 68, 68, 0.14);
  color: #b91c1c;
}

.tool-section {
  margin-top: 12px;
}

.section-label {
  margin-bottom: 6px;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #66758d;
  font-weight: 700;
}

.tool-placeholder {
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  color: #61708a;
  font-size: 13px;
}

.tool-markdown {
  display: grid;
  gap: 10px;
}

@media (prefers-color-scheme: dark) {
  .tool-card {
    background: rgba(15, 23, 42, 0.82);
    border-color: rgba(148, 163, 184, 0.18);
  }

  .tool-card--error {
    background: rgba(69, 10, 10, 0.36);
    border-color: rgba(248, 113, 113, 0.24);
  }

  .tool-title strong { color: #e2ebf5; }
  .tool-name, .tool-duration { color: #93a5bc; }
  .section-label { color: #8da2bd; }

  .tool-placeholder {
    background: rgba(30, 41, 59, 0.6);
    color: #93a5bc;
  }
}
</style>
