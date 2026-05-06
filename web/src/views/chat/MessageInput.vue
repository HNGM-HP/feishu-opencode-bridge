<template>
  <div class="message-input">
    <div class="toolbar">
      <div class="selector-row">
        <el-select
          :model-value="selectedModelKey"
          placeholder="模型"
          clearable
          filterable
          size="small"
          class="selector-compact"
          @update:model-value="handleModelChange"
        >
          <el-option label="默认模型" value="" />
          <el-option-group
            v-for="group in modelOptionGroups"
            :key="group.providerId"
            :label="group.providerName"
          >
            <el-option
              v-for="option in group.options"
              :key="option.key"
              :label="option.label"
              :value="option.key"
            />
          </el-option-group>
        </el-select>

        <el-select
          :model-value="variant || ''"
          :placeholder="variantSelectorDisabled ? '当前模型不支持思考强度' : '思考强度'"
          clearable
          size="small"
          class="selector-compact"
          :disabled="variantSelectorDisabled"
          @update:model-value="handleVariantChange"
        >
          <el-option label="默认强度" value="" />
          <el-option
            v-for="item in normalizedVariants"
            :key="item"
            :label="formatVariantLabel(item)"
            :value="item"
          />
        </el-select>

        <el-select
          :model-value="agentName || ''"
          placeholder="代理人"
          clearable
          filterable
          size="small"
          class="selector-compact"
          @update:model-value="handleAgentChange"
        >
          <el-option label="默认代理人" value="" />
          <el-option
            v-for="agent in normalizedAgents"
            :key="agent.name"
            :label="buildAgentLabel(agent)"
            :value="agent.name"
          />
        </el-select>
      </div>
    </div>

    <div class="composer">
      <!-- 附件预览列表 -->
      <div v-if="attachments.length > 0" class="attachments-list">
        <div
          v-for="attachment in attachments"
          :key="attachment.id"
          :class="['attachment-item', { 'attachment-item--uploading': attachment.uploading, 'attachment-item--error': attachment.error }]"
        >
          <div v-if="attachment.previewUrl && attachment.mime.startsWith('image/')" class="attachment-item__thumb-wrap">
            <img :src="attachment.previewUrl" :alt="attachment.filename" class="attachment-item__thumb" />
          </div>
          <div v-else class="attachment-item__icon">
            <span v-if="attachment.uploading" class="uploading-spinner">⏳</span>
            <span v-else-if="attachment.error">❌</span>
            <span v-else>{{ getFileIcon(attachment.mime) }}</span>
          </div>
          <div class="attachment-item__info">
            <div class="attachment-item__name">{{ attachment.filename }}</div>
            <div class="attachment-item__meta">
              <span v-if="attachment.uploading">上传中...</span>
              <span v-else-if="attachment.error">{{ attachment.error }}</span>
              <span v-else-if="attachment.size != null">{{ formatFileSize(attachment.size) }}</span>
              <span v-else>已恢复附件</span>
            </div>
          </div>
          <button
            type="button"
            class="attachment-item__remove"
            @click="removeAttachment(attachment.id)"
            :disabled="attachment.uploading"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- 隐藏的文件输入 -->
      <input
        ref="fileInputRef"
        type="file"
        style="display: none"
        multiple
        @change="handleFileSelect"
      />

      <el-input
        v-model="draftModel"
        type="textarea"
        resize="none"
        :rows="4"
        :disabled="disabled"
        placeholder="输入你的问题。输入 / 可查看 OpenCode 或 Bridge 内置命令，支持粘贴图片和文件，Enter 发送，Ctrl + Enter 或 Shift + Enter 换行。"
        @keydown="handleKeydown"
        @paste="handlePaste"
        @drop="handleDrop"
        @dragover="handleDragOver"
      />

      <div v-if="showSlashPalette" class="slash-panel">
        <div class="slash-panel__head">
          <strong>/ 命令</strong>
          <span>{{ filteredCommands.length }} 条</span>
        </div>

        <div v-if="commandsLoading" class="slash-panel__state">正在读取命令...</div>
        <div v-else-if="commandsError" class="slash-panel__state slash-panel__state--error">{{ commandsError }}</div>
        <div v-else-if="filteredCommands.length === 0" class="slash-panel__state">
          未找到命令。可继续输入筛选，或检查 OpenCode command.list API。
        </div>
        <template v-else>
          <button
            v-for="(command, index) in filteredCommands"
            :key="`${command.source || 'command'}-${command.name}`"
            type="button"
            :class="['slash-item', { 'slash-item--active': index === highlightedCommandIndex }]"
            @mousedown.prevent="applySlashCommand(command)"
          >
            <div class="slash-item__title">
              <span>/{{ command.name }}</span>
              <span class="slash-item__source">{{ formatCommandSource(command.source) }}</span>
            </div>
            <div class="slash-item__desc">{{ command.description || command.template }}</div>
          </button>
        </template>
      </div>

      <div class="actions">
        <div class="actions-left">
          <el-button
            type="default"
            size="small"
            :disabled="disabled"
            @click="selectFiles"
          >
            📎 添加附件
          </el-button>
          <span class="char-count">{{ draftModel.trim().length }} 字</span>
        </div>
        <div class="action-buttons">
          <el-button
            :type="primaryActionType"
            :disabled="primaryActionDisabled"
            :class="['primary-action-btn', { 'primary-action-btn--running': showRunningState }]"
            @click="handlePrimaryAction"
          >
            <span class="primary-action-content">
              <span v-if="showRunningState" class="primary-action-indicator" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span>{{ primaryActionLabel }}</span>
            </span>
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { ChatAgentInfo, ChatCommandInfo, ChatModelProviderInfo } from '../../api'
import { chatApi } from '../../api'
import { formatVariantLabel } from '../../composables/chat-model'
import { getSlashCommands } from './slash-command-cache'

interface ModelOption {
  key: string
  label: string
}

interface Attachment {
  id: string
  file?: File
  url?: string
  previewUrl?: string
  mime: string
  filename: string
  size?: number
  uploading: boolean
  error?: string
}

interface DraftAttachment {
  url: string
  mime: string
  filename?: string
}

const props = defineProps<{
  providers?: ChatModelProviderInfo[]
  draft: string
  providerId?: string
  modelId?: string
  variant?: string
  variants?: string[]
  agentName?: string
  agents?: ChatAgentInfo[]
  disabled: boolean
  sending: boolean
  canAbort: boolean
  aborting: boolean
  draftAttachments?: DraftAttachment[]
  draftAttachmentsKey?: number
}>()

const emit = defineEmits<{
  submit: [{ text: string; parts?: Array<{ type: 'text'; text: string } | { type: 'file'; mime: string; url: string; filename?: string }>; providerId?: string; modelId?: string; variant?: string; agent?: string }]
  abort: []
  'update:draft': [string]
  'update:model-selection': [{ providerId?: string; modelId?: string }]
  'update:providerId': [string?]
  'update:modelId': [string?]
  'update:variant': [string?]
  'update:agentName': [string?]
}>()

// 隐藏的文件输入元素
const fileInputRef = ref<HTMLInputElement | null>(null)

// 附件列表
const attachments = ref<Attachment[]>([])
const uploadingCount = ref(0)

const commands = ref<ChatCommandInfo[]>([])
const commandsLoading = ref(false)
const commandsError = ref('')
const highlightedCommandIndex = ref(0)

// 文件类型图标映射
const getFileIcon = (mime: string): string => {
  if (mime.startsWith('image/')) return '🖼️'
  if (mime.startsWith('video/')) return '🎬'
  if (mime.startsWith('audio/')) return '🎵'
  if (mime.includes('pdf')) return '📄'
  if (mime.includes('word') || mime.includes('document')) return '📝'
  if (mime.includes('excel') || mime.includes('sheet')) return '📊'
  if (mime.includes('powerpoint') || mime.includes('presentation')) return '📽️'
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('tar') || mime.includes('7z')) return '📦'
  if (mime.includes('text') || mime.includes('json') || mime.includes('xml')) return '📃'
  return '📎'
}

// 格式化文件大小
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// 选择文件
const selectFiles = () => {
  fileInputRef.value?.click()
}

// 处理文件选择
const handleFileSelect = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return

  await addFiles(Array.from(files))
  target.value = '' // 重置 input 以允许选择相同文件
}

// 添加文件到附件列表
const addFiles = async (files: File[]) => {
  for (const file of files) {
    // 生成唯一 ID
    const id = `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const attachment: Attachment = {
      id,
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      mime: file.type || 'application/octet-stream',
      filename: file.name,
      size: file.size,
      uploading: true,
    }
    attachments.value.push(attachment)

    // 上传文件
    uploadFile(attachment)
  }
}

// 上传单个文件
const uploadFile = async (attachment: Attachment) => {
  if (!attachment.file) return

  uploadingCount.value++
  try {
    const result = await chatApi.uploadFile(attachment.file)
    // 保持相对路径，避免把内网地址暴露给上游下载链路
    attachment.url = result.file.url
    attachment.uploading = false
  } catch (error) {
    attachment.uploading = false
    attachment.error = error instanceof Error ? error.message : '上传失败'
    ElMessage.error(`上传失败: ${attachment.filename}`)
  } finally {
    uploadingCount.value--
  }
}

// 删除附件
const removeAttachment = (id: string) => {
  const index = attachments.value.findIndex(a => a.id === id)
  if (index > -1) {
    attachments.value.splice(index, 1)
  }
}

// 处理粘贴
const handlePaste = async (event: ClipboardEvent) => {
  const items = event.clipboardData?.items
  if (!items) return

  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type) {
      const file = item.getAsFile()
      if (file) {
        files.push(file)
      }
    }
  }

  if (files.length > 0) {
    event.preventDefault()
    await addFiles(files)
  }
}

// 处理拖拽
const handleDrop = async (event: DragEvent) => {
  event.preventDefault()
  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return

  await addFiles(Array.from(files))
}

const handleDragOver = (event: DragEvent) => {
  event.preventDefault()
}

// 获取所有 parts（文本 + 附件）
const getAllParts = computed(() => {
  const parts: Array<{ type: 'text'; text: string } | { type: 'file'; mime: string; url: string; filename?: string }> = []

  // 添加附件
  for (const attachment of attachments.value) {
    if (attachment.url && !attachment.uploading && !attachment.error) {
      parts.push({
        type: 'file',
        mime: attachment.mime,
        url: attachment.url,
        filename: attachment.filename,
      })
    }
  }

  // 添加文本（如果有）
  const text = draftModel.value.trim()
  if (text) {
    parts.push({ type: 'text', text })
  }

  return parts
})

const normalizedProviders = computed(() => Array.isArray(props.providers) ? props.providers : [])
const normalizedAgents = computed(() => Array.isArray(props.agents) ? props.agents : [])
const normalizedVariants = computed(() => Array.isArray(props.variants) ? props.variants : [])
const variantSelectorDisabled = computed(() => normalizedVariants.value.length === 0)
const draftModel = computed({
  get: () => props.draft,
  set: value => emit('update:draft', value),
})

const modelOptionGroups = computed(() => {
  return normalizedProviders.value.map(provider => ({
    providerId: provider.id,
    providerName: provider.name,
    options: (provider.models || []).map<ModelOption>(model => ({
      key: `${provider.id}::${model.id}`,
      label: model.name === model.id ? model.id : `${model.name} · ${model.id}`,
    })),
  })).filter(group => group.options.length > 0)
})

const selectedModelKey = computed(() => {
  if (!props.providerId || !props.modelId) {
    return ''
  }
  return `${props.providerId}::${props.modelId}`
})

const immediateCommand = computed<'undo' | 'abort' | null>(() => {
  const normalized = draftModel.value.trim().toLowerCase()
  if (normalized === '/undo' || normalized === '/revert') {
    return 'undo'
  }

  if (normalized === '/stop' || normalized === '/abort' || normalized === '/cancel') {
    return 'abort'
  }

  return null
})

const submitDisabled = computed(() => {
  if (props.disabled) return true

  // 检查是否有内容（文本或附件）
  const hasText = draftModel.value.trim().length > 0
  const hasAttachments = attachments.value.length > 0
  const hasContent = hasText || hasAttachments

  if (!hasContent) return true

  // 检查是否有上传中的附件
  if (uploadingCount.value > 0) return true

  // 检查是否有上传失败的附件
  const hasFailedAttachments = attachments.value.some(a => a.error)
  if (hasFailedAttachments) return true

  if (immediateCommand.value === 'abort') {
    return props.aborting
  }

  if (immediateCommand.value === 'undo') {
    return props.sending || props.aborting
  }

  return props.sending
})

const primaryActionLabel = computed(() => {
  if (props.aborting) return '终止中'
  return props.canAbort ? '终止' : '发送'
})

const primaryActionType = computed<'primary' | 'danger'>(() => {
  return props.canAbort ? 'danger' : 'primary'
})

const primaryActionDisabled = computed(() => {
  return props.canAbort ? props.aborting : submitDisabled.value
})

const showRunningState = computed(() => props.canAbort || props.aborting)

const slashMatch = computed(() => {
  const match = draftModel.value.match(/(^|\s)(\/[^\s]*)$/)
  if (!match) return null

  return {
    token: match[2],
    query: match[2].slice(1).trim().toLowerCase(),
  }
})

const filteredCommands = computed(() => {
  const source = Array.isArray(commands.value) ? commands.value : []
  const query = slashMatch.value?.query || ''
  if (!query) return source.slice(0, 12)

  return source
    .filter(command => {
      const haystack = [
        command.name,
        command.description || '',
        command.template || '',
      ].join(' ').toLowerCase()
      return haystack.includes(query)
    })
    .slice(0, 12)
})

const showSlashPalette = computed(() => Boolean(slashMatch.value) && !props.disabled)

watch(showSlashPalette, visible => {
  if (!visible) {
    highlightedCommandIndex.value = 0
    return
  }
  void ensureCommands()
})

watch(filteredCommands, commandsList => {
  if (commandsList.length === 0) {
    highlightedCommandIndex.value = 0
    return
  }

  if (highlightedCommandIndex.value >= commandsList.length) {
    highlightedCommandIndex.value = commandsList.length - 1
  }
})

function buildAgentLabel(agent: ChatAgentInfo): string {
  const prefix = agent.mode === 'subagent' ? '子' : '主'
  const title = agent.description?.trim() || agent.name
  return `(${prefix}) ${title}`
}

function handleModelChange(value?: string): void {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  if (!nextValue) {
    emit('update:model-selection', { providerId: undefined, modelId: undefined })
    emit('update:providerId', undefined)
    emit('update:modelId', undefined)
    return
  }

  const [provider, model] = nextValue.split('::')
  emit('update:model-selection', {
    providerId: provider || undefined,
    modelId: model || undefined,
  })
  emit('update:providerId', provider || undefined)
  emit('update:modelId', model || undefined)
}

function handleVariantChange(value?: string): void {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  emit('update:variant', nextValue || undefined)
}

function handleAgentChange(value?: string): void {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  emit('update:agentName', nextValue || undefined)
}

async function ensureCommands(): Promise<void> {
  commandsLoading.value = true
  commandsError.value = ''
  try {
    commands.value = await getSlashCommands()
  } catch (error) {
    commands.value = []
    commandsError.value = error instanceof Error ? error.message : '命令加载失败'
  } finally {
    commandsLoading.value = false
  }
}

function formatCommandSource(source?: string): string {
  if (source === 'mcp') return 'MCP'
  if (source === 'skill') return '技能'
  if (source === 'bridge-doc') return '内置'
  if (source === 'agent') return '代理'
  return 'OpenCode'
}

function applySlashCommand(command: ChatCommandInfo): void {
  const token = slashMatch.value?.token
  if (!token) return

  const template = command.template?.trim() || `/${command.name}`
  const replacement = template.endsWith(' ') ? template : `${template} `
  draftModel.value = draftModel.value.replace(/(^|\s)(\/[^\s]*)$/, (_full, prefix) => `${prefix}${replacement}`)
  highlightedCommandIndex.value = 0
}

function submit(): void {
  if (submitDisabled.value) return

  const parts = getAllParts.value
  const text = draftModel.value.trim()

  emit('submit', {
    text,
    parts,
    providerId: props.providerId,
    modelId: props.modelId,
    variant: props.variant,
    agent: props.agentName,
  })

  // 清空输入
  emit('update:draft', '')
  attachments.value = []
}

function handlePrimaryAction(): void {
  if (props.canAbort) {
    if (!props.aborting) {
      emit('abort')
    }
    return
  }

  submit()
}

watch(
  () => props.draftAttachmentsKey,
  () => {
    if (!Array.isArray(props.draftAttachments)) {
      attachments.value = []
      return
    }

    attachments.value = props.draftAttachments.map((attachment, index) => ({
      id: `restored-${props.draftAttachmentsKey ?? 0}-${index}`,
      url: attachment.url,
      previewUrl: attachment.mime.startsWith('image/') ? attachment.url : undefined,
      mime: attachment.mime || 'application/octet-stream',
      filename: attachment.filename || '附件',
      uploading: false,
    }))
  },
  { immediate: true }
)

function handleKeydown(event: KeyboardEvent): void {
  if (showSlashPalette.value && filteredCommands.value.length > 0) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      highlightedCommandIndex.value = (highlightedCommandIndex.value + 1) % filteredCommands.value.length
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      highlightedCommandIndex.value = (highlightedCommandIndex.value - 1 + filteredCommands.value.length) % filteredCommands.value.length
      return
    }

    if ((event.key === 'Enter' || event.key === 'Tab') && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault()
      applySlashCommand(filteredCommands.value[highlightedCommandIndex.value])
      return
    }

    if (event.key === 'Escape') {
      highlightedCommandIndex.value = 0
      return
    }
  }

  if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    event.preventDefault()
    submit()
  }
}
</script>

<style scoped>
.message-input {
  border-top: 1px solid #e5e7eb;
  background: #ffffff;
}

.toolbar {
  padding: 8px 12px;
  border-bottom: 1px solid #e5e7eb;
}

.selector-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.selector-compact {
  width: 150px;
  flex-shrink: 0;
}

.char-count {
  font-size: 11px;
  color: #9ca3af;
}

.composer {
  padding: 12px;
  display: grid;
  gap: 12px;
}

.composer :deep(.el-textarea__inner) {
  min-height: 112px !important;
  border-radius: 0;
  box-shadow: inset 0 0 0 1px #d1d5db;
  padding: 12px;
}

/* 附件列表样式 */
.attachments-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  transition: all 0.2s;
}

.attachment-item--uploading {
  background: #eff6ff;
  border-color: #3b82f6;
}

.attachment-item--error {
  background: #fef2f2;
  border-color: #ef4444;
}

.attachment-item__icon {
  font-size: 24px;
  line-height: 1;
  flex-shrink: 0;
}

.attachment-item__thumb-wrap {
  width: 44px;
  height: 44px;
  border: 1px solid #d1d5db;
  background: #f9fafb;
  overflow: hidden;
  flex-shrink: 0;
}

.attachment-item__thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.uploading-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.attachment-item__info {
  flex: 1;
  min-width: 0;
}

.attachment-item__name {
  font-size: 13px;
  font-weight: 500;
  color: #1f2937;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.attachment-item__meta {
  font-size: 11px;
  color: #6b7280;
  margin-top: 2px;
}

.attachment-item__remove {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: all 0.2s;
}

.attachment-item__remove:hover:not(:disabled) {
  background: #e5e7eb;
  color: #374151;
}

.attachment-item__remove:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.slash-panel {
  display: grid;
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid #d1d5db;
  background: #ffffff;
}

.slash-panel__head,
.slash-panel__state,
.slash-item {
  padding: 10px 12px;
  border-bottom: 1px solid #eceff3;
}

.slash-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}

.slash-panel__state {
  font-size: 12px;
  color: #6b7280;
}

.slash-panel__state--error {
  color: #b91c1c;
}

.slash-item {
  display: grid;
  gap: 4px;
  border-left: 0;
  border-right: 0;
  border-top: 0;
  background: #ffffff;
  text-align: left;
  cursor: pointer;
}

.slash-item--active,
.slash-item:hover {
  background: #f7f9fc;
}

.slash-item__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  font-weight: 600;
  color: #111827;
}

.slash-item__source,
.slash-item__desc {
  font-size: 11px;
  color: #6b7280;
}

.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.actions-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.action-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

.primary-action-btn {
  min-width: 110px;
}

.primary-action-content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.primary-action-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.primary-action-indicator span {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.3;
  animation: primary-action-pulse 1.1s infinite ease-in-out;
}

.primary-action-indicator span:nth-child(2) {
  animation-delay: 0.16s;
}

.primary-action-indicator span:nth-child(3) {
  animation-delay: 0.32s;
}

.primary-action-btn--running:not(.is-disabled) {
  box-shadow: 0 0 0 1px rgba(220, 38, 38, 0.08), 0 0 0 6px rgba(248, 113, 113, 0.12);
}

@keyframes primary-action-pulse {
  0%,
  80%,
  100% {
    transform: scale(0.72);
    opacity: 0.3;
  }

  40% {
    transform: scale(1);
    opacity: 1;
  }
}

@media (max-width: 720px) {
  .actions {
    flex-direction: column;
    align-items: stretch;
  }

  .action-buttons {
    justify-content: flex-end;
  }
}
</style>
