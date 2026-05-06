<template>
  <section v-if="hasTrace" class="assistant-trace">
    <button
      v-if="hasReasoning"
      type="button"
      class="trace-toggle"
      @click="reasoningExpanded = !reasoningExpanded"
    >
      <span class="trace-toggle__badge">思维链</span>
      <span class="trace-toggle__label">{{ reasoningPreview }}</span>
      <span class="trace-toggle__chevron">{{ reasoningExpanded ? '▾' : '▸' }}</span>
    </button>

    <transition name="trace-expand">
      <div v-if="reasoningExpanded" class="trace-body trace-body--reasoning">
        <template v-for="segment in reasoningSegments" :key="segment.id">
          <Markdown v-if="segment.type === 'markdown'" :source="segment.content" />
          <CodeBlock v-else :code="segment.code" :language="segment.language" />
        </template>
      </div>
    </transition>

    <button
      v-if="props.tools.length > 0"
      type="button"
      class="trace-toggle"
      @click="toolsExpanded = !toolsExpanded"
    >
      <span class="trace-toggle__badge">工具链</span>
      <span class="trace-toggle__label">{{ toolsSummary }}</span>
      <span class="trace-toggle__chevron">{{ toolsExpanded ? '▾' : '▸' }}</span>
    </button>

    <transition name="trace-expand">
      <div v-if="toolsExpanded" class="trace-body trace-body--tools">
        <div
          v-for="tool in props.tools"
          :key="tool.id"
          class="tool-item"
        >
          <button
            type="button"
            class="tool-summary"
            @click="toggleTool(tool.id)"
          >
            <span :class="['tool-status-dot', `tool-status-dot--${tool.status}`]" />
            <span class="tool-title">{{ tool.title || tool.name }}</span>
            <span class="tool-brief">{{ summarizeTool(tool) }}</span>
            <span class="tool-meta">
              <span :class="['tool-status', `tool-status--${tool.status}`]">{{ toolStatusLabel(tool.status) }}</span>
              <span v-if="tool.durationMs" class="tool-duration">{{ formatDuration(tool.durationMs) }}</span>
            </span>
            <span class="trace-toggle__chevron">{{ isToolExpanded(tool.id) ? '▾' : '▸' }}</span>
          </button>

          <transition name="trace-expand">
            <div v-if="isToolExpanded(tool.id)" class="tool-detail">
              <div v-if="toolInputText(tool)" class="tool-detail__section">
                <div class="tool-detail__label">Input</div>
                <CodeBlock :code="toolInputText(tool)" language="json" />
              </div>

              <div class="tool-detail__section">
                <div class="tool-detail__label">Output</div>
                <div v-if="!tool.output" class="tool-detail__placeholder">
                  {{ tool.status === 'running' ? '等待工具输出…' : '没有输出内容' }}
                </div>
                <Terminal v-else-if="toolOutputKind(tool) === 'terminal'" :output="tool.output" />
                <FileTree v-else-if="toolOutputKind(tool) === 'filetree'" :output="tool.output" />
                <div v-else class="tool-detail__markdown">
                  <template v-for="segment in toolOutputSegments(tool)" :key="segment.id">
                    <Markdown v-if="segment.type === 'markdown'" :source="segment.content" />
                    <CodeBlock v-else :code="segment.code" :language="segment.language" />
                  </template>
                </div>
              </div>
            </div>
          </transition>
        </div>
      </div>
    </transition>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChatToolCallVm } from '../../composables/chat-model'
import CodeBlock from '../../components/ai-elements/CodeBlock.vue'
import FileTree from '../../components/ai-elements/FileTree.vue'
import Markdown from '../../components/ai-elements/Markdown.vue'
import Terminal from '../../components/ai-elements/Terminal.vue'
import { splitMarkdownSegments } from '../../components/ai-elements/markdown-utils'

const props = defineProps<{
  reasoning: string
  tools: ChatToolCallVm[]
}>()

const reasoningExpanded = ref(false)
const toolsExpanded = ref(false)
const expandedToolIds = ref<string[]>([])

const hasReasoning = computed(() => compactText(props.reasoning).length > 0)
const hasTrace = computed(() => hasReasoning.value || props.tools.length > 0)

const reasoningSegments = computed(() => splitMarkdownSegments(props.reasoning))

const reasoningPreview = computed(() => {
  const content = compactText(props.reasoning)
  if (!content) return '没有可展示的推理内容'

  const headingMatch = props.reasoning.match(/^#{1,4}\s+(.+)$/m)
  if (headingMatch?.[1]) return trimText(headingMatch[1], 88)

  const boldMatch = props.reasoning.match(/\*\*(.+?)\*\*/)
  if (boldMatch?.[1]) return trimText(boldMatch[1], 88)

  return trimText(content, 88)
})

const toolsSummary = computed(() => {
  if (props.tools.length === 0) return '没有工具调用'

  const runningCount = props.tools.filter(tool => tool.status === 'running').length
  const errorCount = props.tools.filter(tool => tool.status === 'error').length
  const completedCount = props.tools.filter(tool => tool.status === 'completed').length
  const summaryParts: string[] = [`${props.tools.length} 项调用`]

  if (runningCount > 0) summaryParts.push(`${runningCount} 运行中`)
  if (completedCount > 0) summaryParts.push(`${completedCount} 已完成`)
  if (errorCount > 0) summaryParts.push(`${errorCount} 失败`)

  const lastTool = props.tools[props.tools.length - 1]
  const detail = summarizeTool(lastTool)
  if (detail && detail !== (lastTool.title || lastTool.name)) {
    summaryParts.push(detail)
  }

  return summaryParts.join(' · ')
})

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function trimText(value: string, max = 72): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function toggleTool(toolId: string): void {
  expandedToolIds.value = isToolExpanded(toolId)
    ? expandedToolIds.value.filter(id => id !== toolId)
    : [...expandedToolIds.value, toolId]
}

function isToolExpanded(toolId: string): boolean {
  return expandedToolIds.value.includes(toolId)
}

function summarizeTool(tool: ChatToolCallVm): string {
  const input = tool.input as Record<string, unknown> | undefined
  const command = typeof input?.command === 'string'
    ? input.command
    : typeof input?.cmd === 'string'
      ? input.cmd
      : ''
  if (command) return trimText(command, 64)

  const filePath = resolveText(input?.file_path)
    || resolveText(input?.path)
    || resolveText(input?.filePath)
  if (filePath) return trimText(filePath, 64)

  const query = resolveText(input?.pattern)
    || resolveText(input?.query)
    || resolveText(input?.glob)
    || resolveText(input?.name)
  if (query) return trimText(query, 64)

  return trimText(tool.title || tool.name, 64)
}

function toolInputText(tool: ChatToolCallVm): string {
  if (tool.input == null) return ''
  if (typeof tool.input === 'string') return tool.input
  try {
    return JSON.stringify(tool.input, null, 2)
  } catch {
    return String(tool.input)
  }
}

function toolOutputKind(tool: ChatToolCallVm): 'terminal' | 'filetree' | 'markdown' {
  const name = tool.name.toLowerCase()
  const output = tool.output || ''

  if (/bash|shell|command|terminal|exec/.test(name) || /\u001b\[[0-9;]*m/.test(output) || /^\$ /m.test(output)) {
    return 'terminal'
  }

  if (/glob|find|ls|tree|list/.test(name)) {
    return 'filetree'
  }

  return 'markdown'
}

function toolOutputSegments(tool: ChatToolCallVm) {
  return splitMarkdownSegments(tool.output || '')
}

function toolStatusLabel(status: ChatToolCallVm['status']): string {
  if (status === 'running') return '运行中'
  if (status === 'completed') return '已完成'
  return '失败'
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`
  return `${Math.round(durationMs / 1000)}s`
}

function resolveText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
</script>

<style scoped>
.assistant-trace {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
}

.trace-toggle {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 14px;
  background: rgba(248, 250, 252, 0.95);
  color: #475569;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.trace-toggle:hover {
  background: rgba(241, 245, 249, 0.98);
  border-color: rgba(100, 116, 139, 0.26);
}

.trace-toggle__badge {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  background: rgba(226, 232, 240, 0.9);
  color: #334155;
  font-size: 11px;
  font-weight: 700;
}

.trace-toggle__label {
  min-width: 0;
  font-size: 12px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trace-toggle__chevron {
  font-size: 14px;
  color: #94a3b8;
}

.trace-body {
  display: grid;
  gap: 10px;
  margin-top: -2px;
  padding: 0 4px 2px 4px;
}

.trace-body--reasoning {
  padding-left: 12px;
  border-left: 2px solid rgba(148, 163, 184, 0.2);
}

.trace-body--tools {
  gap: 8px;
}

.tool-item {
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.85);
  overflow: hidden;
}

.tool-summary {
  width: 100%;
  display: grid;
  grid-template-columns: auto auto 1fr auto auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.tool-summary:hover {
  background: rgba(248, 250, 252, 0.88);
}

.tool-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #94a3b8;
}

.tool-status-dot--running {
  background: #d97706;
  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.12);
}

.tool-status-dot--completed {
  background: #059669;
}

.tool-status-dot--error {
  background: #dc2626;
}

.tool-title {
  font-size: 12px;
  font-weight: 700;
  color: #1f2937;
}

.tool-brief {
  min-width: 0;
  font-size: 12px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #94a3b8;
}

.tool-status,
.tool-duration,
.tool-detail__label {
  font-size: 11px;
}

.tool-status {
  font-weight: 700;
}

.tool-status--running {
  color: #b45309;
}

.tool-status--completed {
  color: #047857;
}

.tool-status--error {
  color: #b91c1c;
}

.tool-duration {
  color: #94a3b8;
}

.tool-detail {
  display: grid;
  gap: 12px;
  padding: 0 12px 12px;
}

.tool-detail__section {
  display: grid;
  gap: 6px;
}

.tool-detail__label {
  color: #94a3b8;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 700;
}

.tool-detail__placeholder {
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(248, 250, 252, 0.92);
  color: #64748b;
  font-size: 12px;
}

.tool-detail__markdown {
  display: grid;
  gap: 8px;
}

.trace-expand-enter-active,
.trace-expand-leave-active {
  transition: all 0.18s ease;
}

.trace-expand-enter-from,
.trace-expand-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 640px) {
  .tool-summary {
    grid-template-columns: auto 1fr auto;
  }

  .tool-title {
    display: none;
  }

  .tool-meta {
    gap: 6px;
  }
}
</style>
