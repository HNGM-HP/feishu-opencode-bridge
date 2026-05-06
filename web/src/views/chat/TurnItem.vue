<template>
  <article class="turn-item">
    <section class="turn-row turn-row--user">
      <div class="turn-shell turn-shell--user">
        <header class="turn-meta turn-meta--user">
          <div class="meta-main">
            <span class="role role--user">用户</span>
            <span class="time">{{ formatTime(userMessage.createdAt) }}</span>
          </div>
          <div class="meta-actions">
            <el-button text size="small" :disabled="undoDisabled" @click="$emit('revert', userMessage)">回退</el-button>
          </div>
        </header>

        <div class="turn-bubble turn-bubble--user">
          <div v-if="userFileParts.length > 0" class="turn-attachments">
            <div v-for="(part, index) in userFileParts" :key="index" class="turn-attachment">
              <img
                v-if="part.mime?.startsWith('image/')"
                :src="part.url"
                :alt="part.filename || '图片'"
                class="turn-attachment__image"
              />
              <a v-else :href="part.url" :download="part.filename" class="turn-attachment__file">
                📎 {{ part.filename || '文件' }}
              </a>
            </div>
          </div>
          <template v-for="segment in userSegments" :key="segment.id">
            <Markdown v-if="segment.type === 'markdown'" :source="segment.content" />
            <CodeBlock v-else :code="segment.code" :language="segment.language" />
          </template>
        </div>
      </div>
    </section>

    <section v-if="showAssistantRow" class="turn-row turn-row--assistant">
      <div class="turn-shell turn-shell--assistant">
        <header class="turn-meta turn-meta--assistant">
          <div class="meta-main">
            <span class="role role--assistant">chat:opencode</span>
            <span class="time">{{ assistantTime }}</span>
            <span v-if="assistantModel" class="tag-inline">{{ assistantModel.providerId }}/{{ assistantModel.modelId }}</span>
            <span v-if="assistantAgent" class="tag-inline">{{ assistantAgent }}</span>
            <span v-if="isStreaming" class="status status--streaming">生成中</span>
            <span v-else-if="hasError" class="status status--error">出错</span>
          </div>
          <div class="meta-actions">
            <el-button text size="small" @click="copyTurn">复制</el-button>
          </div>
        </header>

        <div class="turn-bubble turn-bubble--assistant">
          <AssistantTracePanel
            v-if="assistantReasoning || assistantTools.length > 0"
            :reasoning="assistantReasoning"
            :tools="assistantTools"
          />

          <div v-if="assistantTextBlocks.length > 0" class="assistant-main">
            <div
              v-for="block in assistantTextBlocks"
              :key="block.id"
              class="assistant-text-block"
            >
              <StreamingMessage
                v-if="block.streaming"
                :text="block.text"
                :active="running"
              />
              <template v-else>
                <template v-for="segment in block.segments" :key="segment.id">
                  <Markdown v-if="segment.type === 'markdown'" :source="segment.content" />
                  <CodeBlock v-else :code="segment.code" :language="segment.language" />
                </template>
              </template>
            </div>
          </div>

          <div v-else-if="isStreaming" class="assistant-placeholder">正在生成回复…</div>

          <div
            v-for="errorItem in assistantErrors"
            :key="errorItem.id"
            class="error-text"
          >
            {{ errorItem.text }}
          </div>
        </div>

        <footer v-if="totalUsage" class="usage">
          输入 {{ totalUsage.input }} / 输出 {{ totalUsage.output }} / 推理 {{ totalUsage.reasoning }}
          <template v-if="totalUsage.cost != null"> / 费用 ${{ totalUsage.cost.toFixed(4) }}</template>
        </footer>
      </div>
    </section>
  </article>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { ElMessage } from 'element-plus'
import { splitMarkdownSegments } from '../../components/ai-elements/markdown-utils'
import AssistantTracePanel from './AssistantTracePanel.vue'
import StreamingMessage from './StreamingMessage.vue'
import type { ChatMessageVm, ChatToolCallVm } from '../../composables/chat-model'
import type { ChatTokenUsage } from '../../api'
import { getActiveDateLocale } from '../../i18n/runtime'

const CodeBlock = defineAsyncComponent(() => import('../../components/ai-elements/CodeBlock.vue'))
const Markdown = defineAsyncComponent(() => import('../../components/ai-elements/Markdown.vue'))

type AssistantTextBlock = {
  id: string
  text: string
  segments: ReturnType<typeof splitMarkdownSegments>
  streaming: boolean
}

const props = defineProps<{
  userMessage: ChatMessageVm
  assistantMessages: ChatMessageVm[]
  autoExpand?: boolean
  undoDisabled?: boolean
  running?: boolean
}>()

defineEmits<{
  revert: [ChatMessageVm]
}>()

const assistantModel = computed(() => {
  for (const msg of props.assistantMessages) {
    if (msg.model) return msg.model
  }
  return props.userMessage.model
})

const assistantAgent = computed(() => {
  for (const msg of props.assistantMessages) {
    if (msg.agent) return msg.agent
  }
  return props.userMessage.agent
})

const isStreaming = computed(() => props.assistantMessages.some(msg => msg.status === 'streaming'))
const hasError = computed(() => props.assistantMessages.some(msg => msg.status === 'error'))

const userSegments = computed(() => splitMarkdownSegments(props.userMessage.text))
const userFileParts = computed(() => {
  if (!props.userMessage.parts) return []

  return props.userMessage.parts
    .filter(part => part.type === 'file')
    .map(part => {
      const filePart = part as Record<string, unknown>
      return {
        url: typeof filePart.url === 'string' ? filePart.url : '',
        filename: typeof filePart.filename === 'string' ? filePart.filename : undefined,
        mime: typeof filePart.mime === 'string' ? filePart.mime : undefined,
      }
    })
    .filter(part => part.url)
})

const assistantReasoning = computed(() =>
  props.assistantMessages
    .map(msg => msg.reasoning.trim())
    .filter(Boolean)
    .join('\n\n')
)

const assistantTools = computed<ChatToolCallVm[]>(() =>
  props.assistantMessages.flatMap(msg => msg.tools)
)

const assistantTextBlocks = computed<AssistantTextBlock[]>(() => {
  const blocks: AssistantTextBlock[] = []

  for (const msg of props.assistantMessages) {
    if (!msg.text) continue
    blocks.push({
      id: `${msg.id}-text`,
      text: msg.text,
      segments: splitMarkdownSegments(msg.text),
      streaming: msg.status === 'streaming',
    })
  }

  return blocks
})

const assistantErrors = computed(() =>
  props.assistantMessages
    .map(msg => ({
      id: `${msg.id}-error`,
      text: msg.error?.trim() || '',
    }))
    .filter(item => Boolean(item.text))
)

const assistantTime = computed(() => {
  const firstAssistant = props.assistantMessages[0]
  return firstAssistant ? formatTime(firstAssistant.createdAt) : formatTime(props.userMessage.createdAt)
})

const showAssistantRow = computed(() => props.assistantMessages.length > 0)

const totalUsage = computed<ChatTokenUsage | undefined>(() => {
  const usages = props.assistantMessages.map(msg => msg.usage).filter((u): u is ChatTokenUsage => Boolean(u))
  if (usages.length === 0) return undefined

  return {
    input: usages.reduce((sum, u) => sum + u.input, 0),
    output: usages.reduce((sum, u) => sum + u.output, 0),
    reasoning: usages.reduce((sum, u) => sum + u.reasoning, 0),
    cacheRead: usages.reduce((sum, u) => sum + u.cacheRead, 0),
    cacheWrite: usages.reduce((sum, u) => sum + u.cacheWrite, 0),
    cost: usages.some(u => u.cost != null) ? usages.reduce((sum, u) => sum + (u.cost ?? 0), 0) : undefined,
  }
})

const copyText = computed(() => {
  const sections: string[] = []
  const userText = compactText(props.userMessage.text)
  if (userText) sections.push(`问题\n${userText}`)

  const reasoning = compactText(assistantReasoning.value)
  if (reasoning) sections.push(`思维链\n${reasoning}`)

  for (const tool of assistantTools.value) {
    const label = tool.title || tool.name
    const output = compactText(tool.output)
    sections.push(output ? `工具 ${label}\n${output}` : `工具 ${label}`)
  }

  for (const block of assistantTextBlocks.value) {
    const text = compactText(block.text)
    if (text) sections.push(text)
  }

  for (const errorItem of assistantErrors.value) {
    sections.push(`错误\n${compactText(errorItem.text)}`)
  }

  return sections.join('\n\n').trim()
})

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(getActiveDateLocale(), { hour: '2-digit', minute: '2-digit' })
}

async function copyTurn(): Promise<void> {
  const text = copyText.value
  if (!text) {
    ElMessage.warning('当前轮次没有可复制内容')
    return
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    ElMessage.success('已复制轮次内容')
  } catch {
    ElMessage.error('复制失败')
  }
}
</script>

<style scoped>
.turn-item {
  display: grid;
  gap: 12px;
}

.turn-row {
  display: flex;
  width: 100%;
}

.turn-row--user {
  justify-content: flex-end;
}

.turn-row--assistant {
  justify-content: flex-start;
}

.turn-shell {
  max-width: min(100%, 54rem);
  display: grid;
  gap: 6px;
}

.turn-shell--user {
  justify-items: end;
}

.turn-shell--assistant {
  justify-items: start;
}

.turn-meta {
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

.turn-bubble {
  width: 100%;
  padding: 14px 16px;
  border-radius: 18px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
}

.turn-bubble--user {
  background: linear-gradient(180deg, #2563eb, #1d4ed8);
  color: #eff6ff;
}

.turn-bubble--user :deep(.markdown-body),
.turn-bubble--user :deep(.markdown-body a) {
  color: inherit;
}

.turn-bubble--user :deep(.markdown-body code) {
  background: rgba(255, 255, 255, 0.16);
  color: #eff6ff;
}

.turn-bubble--user :deep(.markdown-body blockquote) {
  background: rgba(255, 255, 255, 0.12);
  border-left-color: rgba(255, 255, 255, 0.42);
  color: #dbeafe;
}

.turn-bubble--assistant {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  color: #16304d;
}

.turn-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.turn-attachment {
  display: inline-flex;
}

.turn-attachment__image {
  width: 160px;
  max-width: 100%;
  max-height: 160px;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
}

.turn-attachment__file {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: inherit;
  text-decoration: none;
  background: rgba(255, 255, 255, 0.08);
}

.assistant-main {
  display: grid;
  gap: 12px;
}

.assistant-placeholder {
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

@media (max-width: 768px) {
  .turn-shell {
    max-width: 100%;
  }

  .turn-bubble {
    padding: 12px 14px;
  }
}
</style>
