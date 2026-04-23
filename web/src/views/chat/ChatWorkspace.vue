<template>
  <div class="workspace-shell">
    <section class="workspace-topbar">
      <div class="topbar-left">
        <el-button type="primary" @click="openCreateDialog()">新建项目</el-button>
      </div>

      <div class="topbar-right">
        <button
          v-for="panel in panelDefinitions"
          :key="panel.key"
          type="button"
          :class="['panel-toggle', { 'panel-toggle--active': isPanelVisible(panel.key) }]"
          :title="panel.title"
          @click="togglePanel(panel.key)"
        >
          <el-icon><component :is="panel.icon" /></el-icon>
          <span>{{ panel.title }}</span>
        </button>
      </div>
    </section>

    <div class="chat-workspace">
      <SessionSidebar
        ref="sessionSidebarRef"
        class="workspace-column workspace-column--sidebar"
        :style="sidebarStyle"
        :sessions="sessions"
        :active-session-id="activeSessionId"
        :loading="sessionsLoading"
        @create="openCreateDialog()"
        @create-in-directory="handleCreateSessionInDirectory"
        @select="handleSelectSession"
        @rename="handleRenameSession"
        @remove="handleDeleteSession"
      />

      <div class="resize-handle" @mousedown.prevent="startResize('sidebar', $event)" />

      <ChatView
        class="workspace-column workspace-column--chat"
        :session="currentSession"
        :messages="messages"
        :loading="messagesLoading"
        :loading-more="messagesLoadingMore"
        :has-more-messages="hasMoreMessages"
        :hidden-message-count="hiddenMessageCount"
        :tasks="tasks"
        :sending="sending"
        :running="running"
        :aborting="aborting"
        :stream-state="streamState"
        :last-error="lastError"
        :providers="availableModelProviders"
        :draft="composerDraft"
        :provider-id="activePreference.providerId"
        :model-id="activePreference.modelId"
        :variant="activePreference.variant"
        :variants="currentEffortOptions"
        :agent-name="activePreference.agentName"
        :agents="primaryAgents"
        :draft-attachments="composerDraftAttachments"
        :draft-attachments-key="composerDraftAttachmentsKey"
        :model-label="selectedModelLabel"
        :effort-label="selectedEffortLabel"
        :agent-label="selectedAgentLabel"
        :terminal-visible="isPanelVisible('terminal')"
        :workspace-directory="workspaceDirectory || undefined"
        @submit="handleSubmit"
        @abort="handleAbort"
        @reconnect="handleReconnect"
        @load-more="handleLoadMoreHistory"
        @revert="handleRevert"
        @close-terminal="closeTerminalPanel"
        @update:draft="composerDraft = $event"
        @update:model-selection="updateActiveModel($event.providerId, $event.modelId)"
        @update:variant="updateActiveVariant($event)"
        @update:agent-name="updateActiveAgentName($event)"
      />

      <template v-for="panel in visiblePanels" :key="panel.key">
        <div class="resize-handle" @mousedown.prevent="startResize(panel.key, $event)" />

        <aside
          class="workspace-column workspace-column--panel"
          :style="panelColumnStyle(panel.key)"
        >
          <GitPanel
            v-if="panel.key === 'git'"
            :directory="workspaceDirectory || undefined"
          />
          <FileExplorer
            v-else-if="panel.key === 'files'"
            :directory="workspaceDirectory || undefined"
          />
          <TaskPanel
            v-else-if="panel.key === 'board'"
            :tasks="tasks"
          />
        </aside>
      </template>
    </div>

    <PermissionDialog
      :request="activePermission"
      :loading="permissionLoading"
      @allow="handlePermissionDecision('allow')"
      @reject="handlePermissionDecision('reject')"
      @always="handlePermissionDecision('always')"
    />

    <el-dialog
      v-model="createDialogVisible"
      title="新建项目会话"
      width="640px"
      destroy-on-close
      class="create-project-dialog"
    >
      <div class="create-dialog">
        <div class="dialog-field">
          <label>会话标题</label>
          <el-input
            v-model="createForm.title"
            placeholder="不填写则使用新对话"
          />
        </div>

        <div class="dialog-field">
          <label>选择项目文件夹</label>
          <div class="create-path-input">
            <el-input
              v-model="createPathInput"
              placeholder="输入路径后按回车或点击 GO 浏览"
              @keyup.enter="handleCreatePathGo"
            >
              <template #prefix>
                <span style="color:#9ca3af;font-size:12px">📂</span>
              </template>
            </el-input>
            <el-button type="primary" @click="handleCreatePathGo">GO</el-button>
          </div>
        </div>

        <div class="dialog-field">
          <div v-if="createBrowserError" class="create-browser-state create-browser-state--error">
            {{ createBrowserError }}
          </div>
          <div v-else-if="createBrowserLoading" class="create-browser-state create-browser-state--loading">
            <el-icon class="is-loading"><Loading /></el-icon>
            正在读取目录...
          </div>
          <div v-else-if="createBrowserListing" class="create-browser">
            <div
              v-for="entry in createDirectoryEntries"
              :key="entry.path"
              class="create-entry"
              @click="enterCreateDirectory(entry.path)"
            >
              <span class="create-entry-icon">📁</span>
              <span class="create-entry-name">{{ entry.name }}</span>
              <span class="create-entry-arrow">›</span>
            </div>

            <div v-if="createDirectoryEntries.length === 0" class="create-browser-empty">
              当前目录没有子文件夹
            </div>
          </div>
          <div v-else class="create-browser-state">
            输入路径后按回车或点击 GO 开始浏览
          </div>
        </div>
      </div>

      <template #footer>
        <div class="create-dialog-footer">
          <span class="create-dialog-path">{{ createCurrentDirectory || '未选择目录' }}</span>
          <div class="create-dialog-actions">
            <el-button @click="createDialogVisible = false">取消</el-button>
            <el-button type="primary" :loading="creatingSession" :disabled="!createCurrentDirectory" @click="confirmCreateSession">选择此文件夹</el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { Connection, Document, FolderOpened, Loading, Monitor } from '@element-plus/icons-vue'
import {
  chatApi,
  workspaceApi,
  type ChatAgentInfo,
  type ChatMessageVm,
  type ChatModelProviderInfo,
  type ChatPermissionRequest,
  type ChatWorkspaceOption,
  type WorkspaceFileEntry,
  type WorkspaceFileTree,
} from '../../api'
import ChatView from './ChatView.vue'
import PermissionDialog from './PermissionDialog.vue'
import SessionSidebar from './SessionSidebar.vue'
import { buildConversationTurns, formatVariantLabel, resolveSupportedVariant } from '../../composables/chat-model'
import { useChatMessages } from '../../composables/useChatMessages'
import { useChatSessions } from '../../composables/useChatSessions'
import { useConfigStore } from '../../stores/config'

type PanelKey = 'git' | 'files' | 'board' | 'terminal'
type ResizeTarget = PanelKey | 'sidebar'

interface SessionPreference {
  providerId?: string
  modelId?: string
  variant?: string
  agentName?: string
}

const DEFAULT_EFFORT_OPTIONS = ['none', 'minimal', 'low', 'medium', 'high', 'max', 'xhigh']
const DRAFT_PREFERENCE_KEY = '__draft__'
const TaskPanel = defineAsyncComponent(() => import('./TaskPanel.vue'))
const FileExplorer = defineAsyncComponent(() => import('./side-panels/FileExplorer.vue'))
const GitPanel = defineAsyncComponent(() => import('./side-panels/GitPanel.vue'))

const route = useRoute()
const router = useRouter()
const configStore = useConfigStore()
const sessionSidebarRef = ref<{ focusSearch: () => void } | null>(null)

const { sessions, loading: sessionsLoading, refresh, createSession, renameSession, deleteSession, touchSession } = useChatSessions()

const activeSessionId = computed(() => typeof route.params.sessionId === 'string' ? route.params.sessionId : null)
const currentSession = computed(() => sessions.value.find(item => item.id === activeSessionId.value) ?? null)

const {
  messages,
  tasks,
  loading: messagesLoading,
  loadingMore: messagesLoadingMore,
  sending,
  running,
  lastError,
  streamState,
  total: messageTotal,
  totalTurns,
  hasMore: hasMoreMessages,
  activePermission,
  resolvePermissionRequest,
  reconnectStream,
  loadMoreHistory,
  sendText,
  reload: reloadMessages,
  discardConversationFromMessage,
  retainMessages,
} = useChatMessages(activeSessionId)

const sidebarWidth = ref(300)
const composerDraftAttachments = ref<Array<{ url: string; mime: string; filename?: string }>>([])
const composerDraftAttachmentsKey = ref(0)
const panelWidths = ref<Record<PanelKey, number>>({
  git: 360,
  files: 360,
  board: 340,
  terminal: 360,
})
const openPanels = ref<PanelKey[]>([])
const aborting = ref(false)
const permissionLoading = ref(false)
const createDialogVisible = ref(false)
const creatingSession = ref(false)
const workspaceCatalog = ref<ChatWorkspaceOption[]>([])
const workspaceCatalogLoading = ref(false)
const availableAgents = ref<ChatAgentInfo[]>([])
const modelCatalog = ref<ChatModelProviderInfo[]>([])
const createBrowserRoot = ref('')
const createBrowserListing = ref<WorkspaceFileTree | null>(null)
const createBrowserLoading = ref(false)
const createBrowserError = ref('')
const createPathInput = ref('')
const composerDraft = ref('')
const sessionPreferences = ref<Record<string, SessionPreference>>({})
let workspaceCatalogPromise: Promise<void> | null = null

const createForm = ref({
  title: '',
})

const panelDefinitions = [
  { key: 'git', title: 'Git', icon: Connection },
  { key: 'files', title: '文件', icon: FolderOpened },
  { key: 'board', title: '看板', icon: Document },
  { key: 'terminal', title: '终端', icon: Monitor },
] as const

const workspaceDirectory = computed(() => currentSession.value?.directory || configStore.settings.DEFAULT_WORK_DIRECTORY || '')
const messageCount = computed(() => Math.max(messageTotal.value, messages.value.length))
const hiddenMessageCount = computed(() => Math.max(totalTurns.value - buildConversationTurns(messages.value).length, 0))
const primaryAgents = computed(() => availableAgents.value.filter(agent => agent.hidden !== true && agent.mode !== 'subagent'))
const fallbackModelProviders = computed<ChatModelProviderInfo[]>(() => {
  return configStore.modelProviders.map(provider => ({
    id: provider.name,
    name: provider.name,
    models: provider.models.map(model => ({
      id: model,
      name: model,
      variants: [],
    })),
  }))
})
const availableModelProviders = computed(() => modelCatalog.value.length > 0 ? modelCatalog.value : fallbackModelProviders.value)
const workspaceOptions = computed(() => {
  const merged = new Map<string, ChatWorkspaceOption>()

  const pushOption = (option: ChatWorkspaceOption): void => {
    const directory = option.directory.trim()
    if (!directory || merged.has(directory)) {
      return
    }
    merged.set(directory, option)
  }

  for (const option of workspaceCatalog.value) {
    pushOption(option)
  }

  const defaultDirectory = configStore.settings.DEFAULT_WORK_DIRECTORY?.trim()
  if (defaultDirectory) {
    pushOption({
      id: defaultDirectory,
      label: `默认工作区 · ${defaultDirectory}`,
      directory: defaultDirectory,
      source: 'default',
    })
  }

  for (const session of sessions.value) {
    const directory = session.directory?.trim()
    if (!directory) continue
    pushOption({
      id: directory,
      label: `${session.title} · ${directory}`,
      directory,
      source: 'project',
    })
  }

  return Array.from(merged.values()).sort((left, right) => left.directory.localeCompare(right.directory, 'zh-Hans-CN'))
})
const visiblePanels = computed(() => panelDefinitions.filter(panel => panel.key !== 'terminal' && openPanels.value.includes(panel.key)))
const activePreferenceKey = computed(() => activeSessionId.value || DRAFT_PREFERENCE_KEY)
const activePreference = computed<SessionPreference>(() => {
  return sessionPreferences.value[activePreferenceKey.value] || {
    providerId: configStore.settings.DEFAULT_PROVIDER || undefined,
    modelId: configStore.settings.DEFAULT_MODEL || undefined,
    variant: undefined,
    agentName: undefined,
  }
})
const currentEffortOptions = computed(() => {
  const model = findModel(activePreference.value.providerId, activePreference.value.modelId)
  if (model) {
    return [...model.variants]
  }

  return activePreference.value.providerId || activePreference.value.modelId
    ? []
    : [...DEFAULT_EFFORT_OPTIONS]
})
const selectedModelLabel = computed(() => {
  const { providerId, modelId } = activePreference.value
  return providerId && modelId ? `${providerId}/${modelId}` : '默认'
})
const selectedEffortLabel = computed(() => formatVariantLabel(activePreference.value.variant))
const selectedAgentLabel = computed(() => activePreference.value.agentName || '默认')
const createDirectoryEntries = computed(() => {
  // 过滤掉无权访问的系统目录（如 Windows 下 C:\PerfLogs、
  // C:\System Volume Information、C:\$Recycle.Bin），避免用户点进去再 502。
  return (createBrowserListing.value?.entries || []).filter(
    (entry: WorkspaceFileEntry) => entry.type === 'directory' && !entry.inaccessible
  )
})
const createCurrentDirectory = computed(() => {
  const root = normalizePath(createBrowserRoot.value)
  if (!root) return ''
  return buildAbsolutePath(root, createBrowserListing.value?.path || '')
})
const sidebarStyle = computed(() => ({
  width: `${sidebarWidth.value}px`,
  flexBasis: `${sidebarWidth.value}px`,
}))

let activeResize: { target: ResizeTarget; startX: number; initialWidth: number } | null = null

// 当模型目录加载/更新后，重新验证当前选中的 variant 是否仍被新模型支持
watch(currentEffortOptions, (nextOptions) => {
  const currentVariant = activePreference.value.variant
  if (!currentVariant) return

  const resolved = resolveSupportedVariant(currentVariant, nextOptions)
  if (resolved !== currentVariant) {
    writePreference(activePreferenceKey.value, {
      ...activePreference.value,
      variant: resolved,
    })
  }
})

onMounted(async () => {
  document.addEventListener('keydown', handleWorkspaceKeydown)
  void bootstrapWorkspace()
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleWorkspaceKeydown)
  stopResize()
})

function normalizePath(value?: string): string {
  const normalized = (value || '').trim().replace(/\\/g, '/')
  if (!normalized) return ''
  if (normalized === '/') return normalized

  // Windows drive letter paths: normalize "C:" to "C:/"
  if (/^[A-Za-z]:$/.test(normalized)) {
    return `${normalized}/`
  }

  return normalized.replace(/\/+$/, '')
}

function isAbsolutePath(value: string): boolean {
  // Unix-style absolute paths
  if (value.startsWith('/')) return true

  // Windows-style absolute paths (both "C:/" and "C:")
  return /^[A-Za-z]:(?:\/|$)/.test(value)
}

function buildAbsolutePath(root: string, relativePath: string): string {
  const normalizedRoot = normalizePath(root)
  const normalizedRelative = normalizePath(relativePath).replace(/^\/+/, '')
  if (!normalizedRelative) {
    return normalizedRoot
  }

  if (!normalizedRoot) {
    return normalizedRelative
  }

  return `${normalizedRoot}/${normalizedRelative}`
}

function sanitizePreference(preference: SessionPreference): SessionPreference {
  return {
    ...(preference.providerId ? { providerId: preference.providerId } : {}),
    ...(preference.modelId ? { modelId: preference.modelId } : {}),
    ...(preference.variant ? { variant: preference.variant } : {}),
    ...(preference.agentName ? { agentName: preference.agentName } : {}),
  }
}

function snapshotActivePreference(): SessionPreference {
  return sanitizePreference({ ...activePreference.value })
}

function writePreference(key: string, preference: SessionPreference): void {
  const next = { ...sessionPreferences.value }
  const cleaned = sanitizePreference(preference)
  if (Object.keys(cleaned).length === 0) {
    delete next[key]
  } else {
    next[key] = cleaned
  }
  sessionPreferences.value = next
}

function findModel(providerId?: string, modelId?: string): { variants: string[] } | undefined {
  if (!providerId || !modelId) {
    return undefined
  }

  return availableModelProviders.value
    .find(provider => provider.id === providerId)
    ?.models.find(model => model.id === modelId)
}

function updateActiveModel(providerId?: string, modelId?: string): void {
  const nextPreference: SessionPreference = {
    ...activePreference.value,
    providerId: providerId || undefined,
    modelId: modelId || undefined,
  }

  if (!providerId || !modelId) {
    nextPreference.variant = resolveSupportedVariant(nextPreference.variant, DEFAULT_EFFORT_OPTIONS)
  } else {
    const supported = findModel(providerId, modelId)?.variants || []
    nextPreference.variant = resolveSupportedVariant(nextPreference.variant, supported)
  }

  writePreference(activePreferenceKey.value, nextPreference)
}

function updateActiveVariant(variant?: string): void {
  const nextVariant = resolveSupportedVariant(variant, currentEffortOptions.value)

  writePreference(activePreferenceKey.value, {
    ...activePreference.value,
    variant: nextVariant,
  })
}

function updateActiveAgentName(agentName?: string): void {
  writePreference(activePreferenceKey.value, {
    ...activePreference.value,
    agentName: typeof agentName === 'string' && agentName.trim() ? agentName.trim() : undefined,
  })
}

function applyPreferenceToSession(sessionId: string, preference: SessionPreference): void {
  writePreference(sessionId, preference)
}

function findPreferredWorkspaceRoot(directory?: string): string {
  const normalizedDirectory = normalizePath(directory)
  if (!normalizedDirectory) {
    return normalizePath(workspaceDirectory.value) || normalizePath(workspaceOptions.value[0]?.directory)
  }

  const exact = workspaceOptions.value.find(option => normalizePath(option.directory) === normalizedDirectory)
  if (exact) {
    return exact.directory
  }

  const candidates = workspaceOptions.value
    .filter(option => {
      const candidate = normalizePath(option.directory)
      return normalizedDirectory === candidate || normalizedDirectory.startsWith(`${candidate}/`)
    })
    .sort((left, right) => normalizePath(right.directory).length - normalizePath(left.directory).length)

  return candidates[0]?.directory || normalizedDirectory
}

function resolveCreateRelativePath(): { ok: true; path: string } | { ok: false; error: string } {
  const root = normalizePath(createBrowserRoot.value)
  if (!root) {
    return { ok: false, error: '请先选择项目文件夹' }
  }

  const input = normalizePath(createPathInput.value)
  if (!input || input === root) {
    return { ok: true, path: '' }
  }

  if (isAbsolutePath(input)) {
    if (input === root) {
      return { ok: true, path: '' }
    }

    if (input.startsWith(`${root}/`)) {
      return { ok: true, path: input.slice(root.length + 1) }
    }

    return { ok: false, error: '输入路径必须位于所选项目文件夹内' }
  }

  return { ok: true, path: input.replace(/^\/+/, '') }
}

function panelColumnStyle(panelKey: PanelKey): Record<string, string> {
  const width = panelWidths.value[panelKey]
  return {
    width: `${width}px`,
    flexBasis: `${width}px`,
  }
}

function isPanelVisible(panelKey: PanelKey): boolean {
  return openPanels.value.includes(panelKey)
}

function togglePanel(panelKey: PanelKey): void {
  if (openPanels.value.includes(panelKey)) {
    openPanels.value = openPanels.value.filter(item => item !== panelKey)
    return
  }

  openPanels.value = [...openPanels.value, panelKey]
}

function closeTerminalPanel(): void {
  openPanels.value = openPanels.value.filter(item => item !== 'terminal')
}

function startResize(target: ResizeTarget, event: MouseEvent): void {
  const initialWidth = target === 'sidebar' ? sidebarWidth.value : panelWidths.value[target]
  activeResize = {
    target,
    startX: event.clientX,
    initialWidth,
  }
  window.addEventListener('mousemove', handleResizeMove)
  window.addEventListener('mouseup', stopResize)
}

function handleResizeMove(event: MouseEvent): void {
  if (!activeResize) return
  const delta = event.clientX - activeResize.startX

  if (activeResize.target === 'sidebar') {
    const nextWidth = activeResize.initialWidth + delta
    sidebarWidth.value = clamp(nextWidth, 240, 460)
    return
  }

  // Panels are on right side, dragging left increases width
  const nextWidth = activeResize.initialWidth - delta
  panelWidths.value = {
    ...panelWidths.value,
    [activeResize.target]: clamp(nextWidth, 280, 640),
  }
}

function stopResize(): void {
  activeResize = null
  window.removeEventListener('mousemove', handleResizeMove)
  window.removeEventListener('mouseup', stopResize)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

async function bootstrapWorkspace(): Promise<void> {
  try {
    const loaded = await refresh()
    if (!activeSessionId.value && loaded.length > 0) {
      await router.replace(`/chat/${loaded[0].id}`)
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '会话列表加载失败')
  } finally {
    scheduleDeferredMetadataLoad()
  }
}

function scheduleDeferredMetadataLoad(): void {
  const run = () => {
    void loadAgents()
    void loadModelCatalog()
  }

  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
  }

  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleWindow.requestIdleCallback(() => run(), { timeout: 1200 })
    return
  }

  window.setTimeout(run, 180)
}

async function ensureSession(): Promise<string> {
  if (activeSessionId.value) return activeSessionId.value
  const session = await createSession()
  applyPreferenceToSession(session.id, snapshotActivePreference())
  await router.replace(`/chat/${session.id}`)
  return session.id
}

async function loadWorkspaceCatalog(): Promise<void> {
  workspaceCatalogLoading.value = true
  try {
    workspaceCatalog.value = await chatApi.listWorkspaces()
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : '工作区列表加载失败')
  } finally {
    workspaceCatalogLoading.value = false
  }
}

async function ensureWorkspaceCatalogLoaded(): Promise<void> {
  if (workspaceCatalog.value.length > 0) {
    return
  }

  if (workspaceCatalogPromise) {
    await workspaceCatalogPromise
    return
  }

  workspaceCatalogPromise = loadWorkspaceCatalog().finally(() => {
    workspaceCatalogPromise = null
  })

  await workspaceCatalogPromise
}

async function loadAgents(): Promise<void> {
  try {
    availableAgents.value = await chatApi.listAgents()
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : 'Agent 列表加载失败')
  }
}

async function loadModelCatalog(): Promise<void> {
  try {
    modelCatalog.value = await chatApi.listModels()
  } catch (error) {
    modelCatalog.value = []
    ElMessage.warning(error instanceof Error ? error.message : '模型列表加载失败')
  }
}

function openCreateDialog(initialDirectory?: string): void {
  void ensureWorkspaceCatalogLoaded().then(() => {
    if (!createDialogVisible.value || createBrowserRoot.value) {
      return
    }

    const fallbackRoot = normalizePath(workspaceOptions.value[0]?.directory)
    if (!fallbackRoot) {
      return
    }

    createBrowserRoot.value = fallbackRoot
    createPathInput.value = fallbackRoot
    void handleCreatePathGo()
  })

  createForm.value = {
    title: '',
  }
  const preferredRoot = findPreferredWorkspaceRoot(initialDirectory || currentSession.value?.directory || workspaceDirectory.value)
  createBrowserRoot.value = preferredRoot
  createPathInput.value = normalizePath(initialDirectory || preferredRoot)
  createBrowserListing.value = null
  createBrowserError.value = ''
  createDialogVisible.value = true
  if (createPathInput.value) {
    void handleCreatePathGo()
  }
}

async function handleCreateRootChange(): Promise<void> {
  createBrowserListing.value = null
  createBrowserError.value = ''
  createPathInput.value = normalizePath(createBrowserRoot.value)
  if (!createBrowserRoot.value) {
    return
  }
  await handleCreatePathGo()
}

async function loadCreateDirectories(relativePath = ''): Promise<void> {
  const root = normalizePath(createBrowserRoot.value)
  if (!root) {
    createBrowserListing.value = null
    return
  }

  createBrowserLoading.value = true
  createBrowserError.value = ''
  try {
    const listing = await workspaceApi.listFiles({
      directory: root,
      path: relativePath,
      limit: 250,
    })
    createBrowserListing.value = listing

    // Update the root to the backend-resolved path (e.g., "/" -> "C:/")
    const resolvedRoot = normalizePath(listing.directory)
    if (resolvedRoot && resolvedRoot !== root) {
      createBrowserRoot.value = resolvedRoot
    }

    createPathInput.value = buildAbsolutePath(resolvedRoot, listing.path || relativePath)
  } catch (error) {
    createBrowserError.value = error instanceof Error ? error.message : '读取目录失败'
  } finally {
    createBrowserLoading.value = false
  }
}

async function handleCreatePathGo(): Promise<void> {
  const input = normalizePath(createPathInput.value)
  if (!input) {
    createBrowserError.value = '请输入一个有效路径'
    createBrowserListing.value = null
    return
  }

  // If it's an absolute path, use it as the root and browse
  if (isAbsolutePath(input)) {
    createBrowserRoot.value = input
    await loadCreateDirectories('')
    return
  }

  // Otherwise treat as relative to current root
  const resolved = resolveCreateRelativePath()
  if (!resolved.ok) {
    createBrowserListing.value = null
    createBrowserError.value = resolved.error
    return
  }

  await loadCreateDirectories(resolved.path)
}

async function enterCreateDirectory(nextPath: string): Promise<void> {
  await loadCreateDirectories(nextPath)
  // Sync the path input to show current browsing location
  const root = normalizePath(createBrowserRoot.value)
  createPathInput.value = buildAbsolutePath(root, nextPath)
}

async function confirmCreateSession(): Promise<void> {
  const directory = createCurrentDirectory.value
  if (!directory) {
    ElMessage.warning('请先选择项目目录')
    return
  }

  creatingSession.value = true
  try {
    const session = await createSession({
      title: createForm.value.title.trim() || undefined,
      directory,
    })
    applyPreferenceToSession(session.id, snapshotActivePreference())
    createDialogVisible.value = false
    await router.push(`/chat/${session.id}`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '创建会话失败')
  } finally {
    creatingSession.value = false
  }
}

async function handleCreateSessionInDirectory(directory?: string): Promise<void> {
  try {
    const session = await createSession({ directory: directory || undefined })
    applyPreferenceToSession(session.id, snapshotActivePreference())
    await router.push(`/chat/${session.id}`)
    ElMessage.success('已创建新会话')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '创建会话失败')
  }
}

async function handleSelectSession(sessionId: string): Promise<void> {
  if (sessionId === activeSessionId.value) return
  await router.push(`/chat/${sessionId}`)
}

async function handleRenameSession(payload: { sessionId: string; title: string }): Promise<void> {
  try {
    await renameSession(payload.sessionId, payload.title)
    ElMessage.success('会话标题已更新')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '重命名失败')
  }
}

async function handleDeleteSession(sessionId: string): Promise<void> {
  try {
    await deleteSession(sessionId)
    ElMessage.success('会话已删除')

    if (sessionId === activeSessionId.value) {
      const nextSession = sessions.value[0]
      if (nextSession) {
        await router.replace(`/chat/${nextSession.id}`)
      } else {
        await router.replace('/chat')
      }
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

async function handleSubmit(payload: {
  text: string
  parts?: Array<{ type: 'text'; text: string } | { type: 'file'; mime: string; url: string; filename?: string }>
  providerId?: string
  modelId?: string
  variant?: string
  agent?: string
}): Promise<void> {
  const immediateCommand = resolveImmediateCommand(payload.text)
  if (immediateCommand === 'undo') {
    await handleUndoCommand()
    return
  }

  if (immediateCommand === 'abort') {
    await handleAbort()
    return
  }

  const sessionId = await ensureSession()
  touchSession(sessionId)
  void autoRenameSessionFromFirstPrompt(sessionId, payload.text)
  composerDraftAttachments.value = []
  composerDraftAttachmentsKey.value += 1
  await sendText({
    sessionId,
    text: payload.text,
    parts: payload.parts,
    providerId: payload.providerId,
    modelId: payload.modelId,
    variant: payload.variant,
    agent: payload.agent,
  })
}

function resolveImmediateCommand(text: string): 'undo' | 'abort' | null {
  const normalized = text.trim().toLowerCase()
  if (normalized === '/undo' || normalized === '/revert') {
    return 'undo'
  }

  if (normalized === '/stop' || normalized === '/abort' || normalized === '/cancel') {
    return 'abort'
  }

  return null
}

function findLatestRevertableMessage(): ChatMessageVm | null {
  for (let index = messages.value.length - 1; index >= 0; index -= 1) {
    const message = messages.value[index]
    if (message.role === 'user' || message.role === 'assistant') {
      return message
    }
  }

  return null
}

async function handleLoadMoreHistory(): Promise<void> {
  await loadMoreHistory()
}

async function handleAbort(): Promise<void> {
  if (!activeSessionId.value || aborting.value) return
  aborting.value = true
  try {
    await chatApi.abortSession(activeSessionId.value)
    ElMessage.success('已请求中断当前会话')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '中断失败')
  } finally {
    aborting.value = false
  }
}

async function handleUndoCommand(): Promise<void> {
  if (!activeSessionId.value) {
    ElMessage.warning('当前没有可回退的对话')
    return
  }

  if (aborting.value || sending.value) {
    return
  }

  const latestMessage = findLatestRevertableMessage()
  const target = latestMessage ? buildRevertTarget(latestMessage) : null
  if (!target) {
    ElMessage.warning('当前没有可回退的对话')
    return
  }

  // 如果是乐观消息（optimistic-/error-），没有后端真实ID
  // 需要先从后端重新加载获取真实 ID，再尝试回退
  if (!target.revertMessageId) {
    // 先尝试重新加载消息，看后端是否已经有了真实 ID
    try {
      await reloadMessages()
    } catch {
      // reload 失败也继续，用本地状态兜底
    }

    // 重新查找回退目标（reload 后可能拿到了真实 ID）
    const refreshedLatest = findLatestRevertableMessage()
    const refreshedTarget = refreshedLatest ? buildRevertTarget(refreshedLatest) : null

    if (refreshedTarget?.revertMessageId) {
      // 拿到真实 ID 了，走正常后端回退流程
      const draftText = refreshedTarget.draftText
      discardFromMessage(refreshedTarget.trimMessageId)
      try {
        await chatApi.revertSession(activeSessionId.value, refreshedTarget.revertMessageId)
        await reloadMessages()
        composerDraft.value = draftText
        composerDraftAttachments.value = refreshedTarget.draftAttachments
        composerDraftAttachmentsKey.value += 1
        ElMessage.success('已回退上一轮')
      } catch (error) {
        await reloadMessages()
        ElMessage.error(error instanceof Error ? error.message : '回退失败')
      }
    } else {
      // 后端也没有这条消息，仅做本地清理
      discardFromMessage(target.trimMessageId)
      composerDraft.value = target.draftText
      composerDraftAttachments.value = target.draftAttachments
      composerDraftAttachmentsKey.value += 1
      ElMessage.success('已回退上一轮')
    }
    return
  }

  // 有后端真实 ID，使用 revertSession 精确指定要回退的消息
  // （而非 undoSession 让后端自行查找，避免前后端目标不一致）
  discardFromMessage(target.trimMessageId)
  try {
    await chatApi.revertSession(activeSessionId.value, target.revertMessageId)
    await reloadMessages()
    composerDraft.value = target.draftText
    composerDraftAttachments.value = target.draftAttachments
    composerDraftAttachmentsKey.value += 1
    ElMessage.success('已回退上一轮')
  } catch (error) {
    await reloadMessages()
    ElMessage.error(error instanceof Error ? error.message : '回退失败')
  }
}

function handleReconnect(): void {
  reconnectStream()
  ElMessage.success('正在重新连接会话流')
}

function collectRetainedMessageIdsBeforeTurn(messageId: string): string[] {
  const turns = buildConversationTurns(messages.value)
  const turnIndex = turns.findIndex(turn => {
    if (turn.userMessage?.id === messageId) return true
    return turn.assistantMessages.some(item => item.id === messageId)
  })

  if (turnIndex < 0) {
    return messages.value.map(item => item.id)
  }

  return turns.slice(0, turnIndex).flatMap(turn => {
    const ids: string[] = []
    if (turn.userMessage?.id) ids.push(turn.userMessage.id)
    for (const assistantMessage of turn.assistantMessages) {
      ids.push(assistantMessage.id)
    }
    return ids
  })
}

async function waitForRevertSettled(sessionId: string, removedMessageIds: string[]): Promise<void> {
  const targets = removedMessageIds.filter(Boolean)
  if (targets.length === 0) {
    await reloadMessages()
    return
  }

  const maxAttempts = 8
  const delayMs = 180
  const limit = Math.min(Math.max(buildConversationTurns(messages.value).length + 5, 30), 100)

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const page = await chatApi.getMessages(sessionId, { limit })
    const ids = new Set(page.messages.map(item => item.info.id))
    if (targets.every(id => !ids.has(id))) {
      await reloadMessages()
      return
    }

    await new Promise(resolve => window.setTimeout(resolve, delayMs))
  }

  await reloadMessages()
}

function buildRevertTarget(message: ChatMessageVm): {
  revertMessageId?: string
  trimMessageId: string
  draftText: string
  draftAttachments: Array<{ url: string; mime: string; filename?: string }>
} | null {
  const clickedIndex = messages.value.findIndex(item => item.id === message.id)
  if (clickedIndex < 0) {
    return null
  }

  let targetIndex = clickedIndex
  if (message.role === 'assistant') {
    for (let index = clickedIndex - 1; index >= 0; index -= 1) {
      if (messages.value[index].role === 'user') {
        targetIndex = index
        break
      }
    }
  }

  const targetMessage = messages.value[targetIndex]
  const backendMessageId = targetMessage.id.startsWith('optimistic-') || targetMessage.id.startsWith('error-')
    ? undefined
    : targetMessage.id

  return {
    revertMessageId: backendMessageId,
    trimMessageId: targetMessage.id,
    draftText: targetMessage.role === 'user' ? targetMessage.text : '',
    draftAttachments: extractDraftAttachments(targetMessage),
  }
}

function extractDraftAttachments(message: ChatMessageVm): Array<{ url: string; mime: string; filename?: string }> {
  return (message.parts || [])
    .filter(part => part.type === 'file')
    .map(part => {
      const filePart = part as Record<string, unknown>
      return {
        url: typeof filePart.url === 'string' ? filePart.url : '',
        mime: typeof filePart.mime === 'string' ? filePart.mime : 'application/octet-stream',
        filename: typeof filePart.filename === 'string' ? filePart.filename : undefined,
      }
    })
    .filter(part => part.url)
}

async function handleRevert(message: ChatMessageVm): Promise<void> {
  if (!activeSessionId.value || aborting.value || sending.value) {
    return
  }

  const target = buildRevertTarget(message)
  if (!target) {
    return
  }

  // 如果是乐观消息，先 reload 尝试获取真实 ID
  if (!target.revertMessageId) {
    try {
      await reloadMessages()
    } catch {
      // reload 失败也继续
    }

    // 重新在刷新后的消息列表中查找对应目标
    const refreshedTarget = buildRevertTarget(message)
    if (refreshedTarget?.revertMessageId) {
      const retainedMessageIds = collectRetainedMessageIdsBeforeTurn(refreshedTarget.trimMessageId)
      // 拿到真实 ID 了，走后端回退
      discardConversationFromMessage(refreshedTarget.trimMessageId)
      try {
        await chatApi.revertSession(activeSessionId.value, refreshedTarget.revertMessageId)
        await waitForRevertSettled(activeSessionId.value, [refreshedTarget.trimMessageId, refreshedTarget.revertMessageId])
        retainMessages(retainedMessageIds)
        composerDraft.value = refreshedTarget.draftText
        composerDraftAttachments.value = refreshedTarget.draftAttachments
        composerDraftAttachmentsKey.value += 1
        ElMessage.success('已回退到所选消息')
      } catch (error) {
        await reloadMessages()
        ElMessage.error(error instanceof Error ? error.message : '回退失败')
      }
    } else {
      // 后端也没有，仅做本地清理
      discardConversationFromMessage(target.trimMessageId)
      composerDraft.value = target.draftText
      composerDraftAttachments.value = target.draftAttachments
      composerDraftAttachmentsKey.value += 1
      ElMessage.success('已回退到所选消息')
    }
    return
  }

  // 有后端真实 ID，执行正常回退流程
  const retainedMessageIds = collectRetainedMessageIdsBeforeTurn(target.trimMessageId)
  discardConversationFromMessage(target.trimMessageId)
  try {
    await chatApi.revertSession(activeSessionId.value, target.revertMessageId)
    await waitForRevertSettled(activeSessionId.value, [target.trimMessageId, target.revertMessageId])
    retainMessages(retainedMessageIds)
    composerDraft.value = target.draftText
    composerDraftAttachments.value = target.draftAttachments
    composerDraftAttachmentsKey.value += 1
    ElMessage.success('已回退到所选消息')
  } catch (error) {
    await reloadMessages()
    ElMessage.error(error instanceof Error ? error.message : '回退失败')
  }
}

function handleWorkspaceKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return

  const key = event.key.toLowerCase()
  if ((event.metaKey || event.ctrlKey) && key === 'k') {
    event.preventDefault()
    sessionSidebarRef.value?.focusSearch()
    return
  }

  if (event.key !== 'Escape') return
  if (activePermission.value || aborting.value) return
  if (!activeSessionId.value) return
  if (!uiRunning.value) return

  event.preventDefault()
  void handleAbort()
}

async function handlePermissionDecision(decision: 'allow' | 'reject' | 'always'): Promise<void> {
  const request = activePermission.value as ChatPermissionRequest | null
  if (!request) return

  permissionLoading.value = true
  try {
    await chatApi.respondPermission({
      permissionId: request.id,
      sessionId: request.sessionId,
      decision,
    })
    resolvePermissionRequest(request.id)
    ElMessage.success('权限请求已处理')
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 410) {
      resolvePermissionRequest(request.id)
      ElMessage.warning('权限请求已过期')
    } else {
      ElMessage.error(error instanceof Error ? error.message : '权限处理失败')
    }
  } finally {
    permissionLoading.value = false
  }
}
</script>

<style scoped>
.workspace-shell {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #f3f4f6;
  color: #111827;
}

.workspace-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid #e5e7eb;
  background: #ffffff;
}

.topbar-left,
.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.panel-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #4b5563;
  cursor: pointer;
}

.panel-toggle--active {
  background: #f3f4f6;
  color: #111827;
}

.chat-workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
}

.workspace-column {
  min-width: 0;
  min-height: 0;
  background: #ffffff;
}

.workspace-column--sidebar {
  flex: 0 0 auto;
  overflow: hidden;
  border-right: 1px solid #e5e7eb;
}

.workspace-column--panel {
  flex: 0 0 auto;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-left: 1px solid #e5e7eb;
}

.workspace-column--panel > :deep(*) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.workspace-column--chat {
  flex: 1 1 auto;
  min-width: 420px;
}

.resize-handle {
  width: 4px;
  flex: 0 0 4px;
  background: #e5e7eb;
  cursor: col-resize;
}

.resize-handle:hover {
  background: #cbd5e1;
}

.create-dialog {
  display: grid;
  gap: 18px;
}

.dialog-field {
  display: grid;
  gap: 8px;
}

.dialog-field label {
  font-size: 13px;
  font-weight: 600;
  color: #1a1a2e;
}

.create-path-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.create-browser {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fafbfc;
}

.create-entry {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 0;
  border-bottom: 1px solid #f0f0f0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}

.create-entry:last-child {
  border-bottom: none;
}

.create-entry:hover {
  background: #eef0f5;
}

.create-entry-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.create-entry-name {
  flex: 1;
  font-size: 13px;
  color: #1a1a2e;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.create-entry-arrow {
  color: #9ca3af;
  font-size: 16px;
  flex-shrink: 0;
}

.create-browser-empty {
  padding: 20px;
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
}

.create-browser-state {
  padding: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fafbfc;
  color: #8b8fa3;
  font-size: 13px;
  text-align: center;
}

.create-browser-state--error {
  color: #dc2626;
  background: #fef2f2;
  border-color: #fecaca;
}

.create-browser-state--loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.create-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.create-dialog-path {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: #6b7280;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.create-dialog-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.chat-workspace :deep(.session-header),
.chat-workspace :deep(.message-input),
.chat-workspace :deep(.message-bubble),
.chat-workspace :deep(.reasoning-card),
.chat-workspace :deep(.tool-card),
.chat-workspace :deep(.tool-placeholder),
.chat-workspace :deep(.placeholder),
.chat-workspace :deep(.summary-item),
.chat-workspace :deep(.count-pill),
.chat-workspace :deep(.last-commit),
.chat-workspace :deep(.file-item),
.chat-workspace :deep(.entry-item),
.chat-workspace :deep(.crumb),
.chat-workspace :deep(.mode-switch),
.chat-workspace :deep(.task-item),
.chat-workspace :deep(.state-card) {
  border-radius: 4px !important;
  box-shadow: none !important;
  background-image: none !important;
  backdrop-filter: none !important;
}

.chat-workspace :deep(.message-bubble),
.chat-workspace :deep(.reasoning-card),
.chat-workspace :deep(.tool-card),
.chat-workspace :deep(.placeholder),
.chat-workspace :deep(.summary-item),
.chat-workspace :deep(.last-commit),
.chat-workspace :deep(.file-item),
.chat-workspace :deep(.entry-item),
.chat-workspace :deep(.task-item) {
  border-color: #e5e7eb !important;
}

.chat-workspace :deep(.message-bubble) {
  border: none;
  background: transparent !important;
}

.chat-workspace :deep(.message-bubble--user) {
  background: transparent !important;
}

.chat-workspace :deep(.el-select__wrapper),
.chat-workspace :deep(.el-textarea__inner),
.chat-workspace :deep(.el-input__wrapper) {
  border-radius: 4px !important;
  box-shadow: inset 0 0 0 1px #d1d5db !important;
}

@media (max-width: 900px) {
  .workspace-topbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .workspace-column--chat {
    min-width: 320px;
  }
}
</style>
