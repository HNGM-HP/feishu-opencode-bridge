<template>
  <article :class="['message-item', `message-item--${message.role}`]">
    <div class="message-shell">
      <header class="message-meta">
        <div class="meta-main">
          <span :class="['role', message.role === 'user' ? 'role--user' : 'role--assistant']">{{ roleLabel }}</span>
          <span class="time">{{ formatTime(message.createdAt) }}</span>
          <span v-if="message.model" class="tag-inline">{{ message.model.providerId }}/{{ message.model.modelId }}</span>
          <span v-if="message.agent" class="tag-inline">{{ message.agent }}</span>
          <span v-if="message.status === 'streaming'" class="status status--streaming">生成中</span>
          <span v-else-if="message.status === 'error'" class="status status--error">出错</span>
        </div>

        <div class="meta-actions">
          <el-button text size="small" @click="copyMessage">复制</el-button>
          <el-button text size="small" :disabled="undoDisabled" @click="$emit('revert', message)">回退</el-button>
        </div>
      </header>

      <div :class="['message-bubble', `message-bubble--${message.role}`, { 'message-bubble--error': message.status === 'error' }]">
        <AssistantTracePanel
          v-if="message.role === 'assistant' && (message.reasoning || message.tools.length > 0)"
          :reasoning="message.reasoning"
          :tools="message.tools"
        />

        <!-- 文件/图片附件 -->
        <div v-if="fileParts.length > 0" class="message-attachments">
          <div v-for="(part, index) in fileParts" :key="index" class="attachment-item">
            <img
              v-if="part.mime?.startsWith('image/')"
              :src="part.url"
              :alt="part.filename || '图片'"
              class="attachment-image"
              @click="previewImage(part.url)"
            />
            <a v-else :href="part.url" :download="part.filename" class="attachment-file">
              📎 {{ part.filename || '文件' }}
            </a>
          </div>
        </div>

        <div v-if="message.text" class="message-main">
          <StreamingMessage
            v-if="message.role === 'assistant' && message.status === 'streaming'"
            :text="message.text"
            :active="running"
          />
          <template v-else>
            <template v-for="segment in textSegments" :key="segment.id">
              <Markdown v-if="segment.type === 'markdown'" :source="segment.content" />
              <CodeBlock v-else :code="segment.code" :language="segment.language" />
            </template>
          </template>
        </div>

        <div v-else-if="message.role === 'assistant' && message.status === 'streaming'" class="message-placeholder">
          正在生成回复…
        </div>

        <div v-if="message.error" class="error-text">{{ message.error }}</div>
      </div>

      <footer v-if="message.usage && message.role === 'assistant'" class="usage">
        输入 {{ message.usage.input }} / 输出 {{ message.usage.output }} / 推理 {{ message.usage.reasoning }}
        <template v-if="message.usage.cost != null"> / 费用 ${{ message.usage.cost.toFixed(4) }}</template>
      </footer>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { ElMessage } from 'element-plus'
import { splitMarkdownSegments } from '../../components/ai-elements/markdown-utils'
import AssistantTracePanel from './AssistantTracePanel.vue'
import StreamingMessage from './StreamingMessage.vue'
import type { ChatMessageVm } from '../../composables/chat-model'
import { getActiveDateLocale } from '../../i18n/runtime'

const CodeBlock = defineAsyncComponent(() => import('../../components/ai-elements/CodeBlock.vue'))
const Markdown = defineAsyncComponent(() => import('../../components/ai-elements/Markdown.vue'))

const props = defineProps<{
  message: ChatMessageVm
  autoExpand?: boolean
  undoDisabled?: boolean
  running?: boolean
}>()

defineEmits<{
  revert: [ChatMessageVm]
}>()

const roleLabel = computed(() => props.message.role === 'user' ? '用户' : 'chat:opencode')
const textSegments = computed(() => splitMarkdownSegments(props.message.text))

// 提取文件/图片部分
const fileParts = computed(() => {
  if (!props.message.parts) return []

  return props.message.parts
    .filter(part => part.type === 'file')
    .map(part => {
      const filePart = part as Record<string, unknown>
      return {
        type: 'file' as const,
        url: String(filePart.url || ''),
        filename: filePart.filename ? String(filePart.filename) : undefined,
        mime: filePart.mime ? String(filePart.mime) : undefined,
      }
    })
    .filter(fp => fp.url.length > 0)
})

const copyText = computed(() => {
  const sections: string[] = []
  const text = compactText(props.message.text)
  if (text) sections.push(text)

  const reasoning = compactText(props.message.reasoning)
  if (reasoning) sections.push(`思维链\n${reasoning}`)

  for (const tool of props.message.tools) {
    const label = tool.title || tool.name
    const output = compactText(tool.output)
    sections.push(output ? `工具 ${label}\n${output}` : `工具 ${label}`)
  }

  if (props.message.error) {
    sections.push(`错误\n${compactText(props.message.error)}`)
  }

  return sections.join('\n\n').trim()
})

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(getActiveDateLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function copyMessage(): Promise<void> {
  const text = copyText.value
  if (!text) {
    ElMessage.warning('当前消息没有可复制内容')
    return
  }

  try {
    await copyToClipboard(text)
    ElMessage.success('已复制消息内容')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '复制失败')
  }
}

function previewImage(url: string): void {
  window.open(url, '_blank')
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}
</script>

<style scoped>
.message-item {
  display: flex;
  width: 100%;
}

.message-item--user {
  justify-content: flex-end;
}

.message-item--assistant {
  justify-content: flex-start;
}

.message-shell {
  max-width: min(100%, 54rem);
  display: grid;
  gap: 6px;
}

.message-item--user .message-shell {
  justify-items: end;
}

.message-item--assistant .message-shell {
  justify-items: start;
}

.message-meta {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 2px;
}

.meta-main,
.meta-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.role {
  font-size: 12px;
  font-weight: 700;
}

.role--user {
  color: #1d4ed8;
}

.role--assistant {
  color: #0f766e;
}

.time,
.tag-inline {
  font-size: 12px;
  color: #94a3b8;
}

.status {
  font-size: 12px;
  font-weight: 700;
}

.status--streaming {
  color: #b45309;
}

.status--error {
  color: #b91c1c;
}

.message-bubble {
  width: 100%;
  padding: 14px 16px;
  border-radius: 18px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
}

.message-bubble--user {
  background: linear-gradient(180deg, #2563eb, #1d4ed8);
  color: #eff6ff;
}

.message-bubble--user :deep(.markdown-body),
.message-bubble--user :deep(.markdown-body a) {
  color: inherit;
}

.message-bubble--user :deep(.markdown-body code) {
  background: rgba(255, 255, 255, 0.16);
  color: #eff6ff;
}

.message-bubble--assistant {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  color: #16304d;
}

.message-bubble--error {
  border-color: rgba(239, 68, 68, 0.24);
}

.message-main {
  display: grid;
  gap: 12px;
}

.message-placeholder {
  font-size: 13px;
  color: #64748b;
}

.error-text {
  margin-top: 10px;
  color: #b91c1c;
  font-size: 13px;
  line-height: 1.6;
}

.usage {
  font-size: 12px;
  color: #94a3b8;
  padding: 0 2px;
}

.message-attachments {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}

.attachment-item {
  display: flex;
  justify-content: center;
}

.attachment-image {
  max-width: 100%;
  max-height: 300px;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.2s;
}

.attachment-image:hover {
  transform: scale(1.02);
}

.attachment-file {
  display: inline-flex;
  align-items: center;
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  font-size: 14px;
  transition: background 0.2s;
}

.message-bubble--user .attachment-file {
  background: rgba(255, 255, 255, 0.2);
}

.attachment-file:hover {
  background: rgba(0, 0, 0, 0.1);
}

.message-bubble--user .attachment-file:hover {
  background: rgba(255, 255, 255, 0.3);
}

@media (max-width: 768px) {
  .message-shell {
    max-width: 100%;
  }

  .message-bubble {
    padding: 12px 14px;
  }
}
</style>
