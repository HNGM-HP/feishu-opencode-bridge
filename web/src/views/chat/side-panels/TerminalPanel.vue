<template>
  <section class="terminal-drawer">
    <div class="terminal-window">
      <div class="terminal-meta">
        <span>{{ shellLabel || 'bash' }}</span>
      </div>

      <div
        v-if="!directory"
        class="terminal-state"
      >
        当前没有工作目录。先绑定会话目录，或在配置里设置 `DEFAULT_WORK_DIRECTORY`。
      </div>

      <div
        v-else-if="opening"
        class="terminal-state"
      >
        正在连接 {{ shellLabel || 'shell' }}...
      </div>

      <div
        v-else
        ref="outputRef"
        class="terminal-screen"
      >
        <div
          v-for="entry in commandHistory"
          :key="entry.id"
          class="terminal-block"
        >
          <div class="terminal-command-line">
            <span class="prompt-symbol">{{ promptSymbol }}</span>
            <span class="prompt-path">{{ entry.cwd }}</span>
            <span class="prompt-command">{{ entry.command }}</span>
            <span
              :class="[
                'command-status',
                entry.pending
                  ? 'command-status--pending'
                  : entry.exitCode === 0
                    ? 'command-status--success'
                    : 'command-status--error',
              ]"
            >
              {{ entry.pending ? '运行中' : `exit ${entry.exitCode}` }}
            </span>
          </div>

          <pre v-if="entry.stdout" class="terminal-stream">{{ entry.stdout }}</pre>
          <pre v-if="entry.stderr" class="terminal-stream terminal-stream--error">{{ entry.stderr }}</pre>
        </div>

        <div v-if="terminalError" class="terminal-inline-error">
          {{ terminalError }}
        </div>

        <div class="terminal-live-prompt">
          <div class="terminal-prompt">
            <span class="prompt-symbol">{{ promptSymbol }}</span>
            <span class="prompt-path">{{ currentDirectory || directory }}</span>

            <textarea
              ref="inputRef"
              v-model="command"
              class="prompt-editor"
              rows="1"
              spellcheck="false"
              :disabled="opening || executing || !sessionId"
              placeholder="输入命令..."
              @keydown="handleKeydown"
            />
          </div>

          <div
            v-if="commandHistory.length === 0"
            class="terminal-empty"
          >
            Enter 执行，Shift/Ctrl + Enter 换行，↑/↓ 历史。
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { workspaceApi } from '../../../api'

const props = defineProps<{
  directory?: string
}>()

type CommandEntry = {
  id: string
  command: string
  exitCode: number | null
  stdout: string
  stderr: string
  cwd: string
  pending: boolean
}

const command = ref('')
const opening = ref(false)
const executing = ref(false)
const sessionId = ref('')
const shellLabel = ref('')
const currentDirectory = ref('')
const terminalError = ref('')
const outputRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const commandHistory = ref<CommandEntry[]>([])
const historyCursor = ref(-1)
const draftBeforeHistory = ref('')

const promptSymbol = ref('$')

let openVersion = 0

watch(
  () => props.directory,
  async directory => {
    openVersion += 1
    const currentVersion = openVersion

    await disposeSession()
    commandHistory.value = []
    command.value = ''
    terminalError.value = ''
    currentDirectory.value = directory || ''
    shellLabel.value = ''
    historyCursor.value = -1
    draftBeforeHistory.value = ''
    syncPromptSymbol()

    if (!directory) {
      return
    }

    opening.value = true
    try {
      const session = await workspaceApi.openTerminal(directory)
      if (currentVersion !== openVersion) {
        await workspaceApi.closeTerminal(session.sessionId).catch(() => undefined)
        return
      }

      sessionId.value = session.sessionId
      shellLabel.value = session.shell
      currentDirectory.value = session.cwd
      terminalError.value = ''
      syncPromptSymbol()
      await focusEditor()
    } catch (error) {
      if (currentVersion !== openVersion) return
      terminalError.value = error instanceof Error ? error.message : '终端连接失败'
    } finally {
      if (currentVersion === openVersion) {
        opening.value = false
      }
    }
  },
  { immediate: true }
)

watch(
  () => shellLabel.value,
  () => {
    syncPromptSymbol()
  }
)

onBeforeUnmount(() => {
  void disposeSession()
})

async function disposeSession(): Promise<void> {
  const activeSessionId = sessionId.value
  sessionId.value = ''
  executing.value = false

  if (!activeSessionId) {
    return
  }

  try {
    await workspaceApi.closeTerminal(activeSessionId)
  } catch {
    // 关闭阶段静默处理，避免打断用户操作
  }
}

function syncPromptSymbol(): void {
  const shell = shellLabel.value.toLowerCase()
  promptSymbol.value = shell.includes('power') || shell.includes('cmd') ? '>' : '$'
}

async function executeCommand(): Promise<void> {
  const activeSessionId = sessionId.value
  const nextCommand = command.value.trim()
  if (!activeSessionId || !nextCommand || executing.value) return

  executing.value = true
  terminalError.value = ''
  historyCursor.value = -1
  draftBeforeHistory.value = ''

  const entry: CommandEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    command: nextCommand,
    exitCode: null,
    stdout: '',
    stderr: '',
    cwd: currentDirectory.value || props.directory || '',
    pending: true,
  }

  commandHistory.value.push(entry)
  command.value = ''
  await scrollToBottom()

  try {
    const result = await workspaceApi.executeCommand({
      sessionId: activeSessionId,
      command: nextCommand,
    })

    entry.exitCode = result.exitCode
    entry.stdout = result.stdout
    entry.stderr = result.stderr
    entry.cwd = result.cwd
    entry.pending = false
    currentDirectory.value = result.cwd
  } catch (error) {
    const message = error instanceof Error ? error.message : '命令执行失败'
    entry.exitCode = -1
    entry.stderr = message
    entry.pending = false
    terminalError.value = message
  } finally {
    executing.value = false
    await scrollToBottom()
    await focusEditor()
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return

  if (event.key === 'ArrowUp' && !event.metaKey && !event.ctrlKey && !event.shiftKey && canUseHistoryNavigation('up', event)) {
    event.preventDefault()
    applyHistoryStep(-1)
    return
  }

  if (event.key === 'ArrowDown' && !event.metaKey && !event.ctrlKey && !event.shiftKey && canUseHistoryNavigation('down', event)) {
    event.preventDefault()
    applyHistoryStep(1)
    return
  }

  if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    event.preventDefault()
    void executeCommand()
  }
}

function canUseHistoryNavigation(direction: 'up' | 'down', event: KeyboardEvent): boolean {
  if (commandHistory.value.length === 0) {
    return false
  }

  const target = event.target instanceof HTMLTextAreaElement ? event.target : null
  if (!target) {
    return true
  }

  const value = target.value
  const selectionStart = target.selectionStart ?? 0
  const selectionEnd = target.selectionEnd ?? 0
  if (selectionStart !== selectionEnd) {
    return false
  }

  const before = value.slice(0, selectionStart)
  const after = value.slice(selectionEnd)
  const currentLineIndex = before.split('\n').length - 1
  const lastLineIndex = value.split('\n').length - 1

  if (direction === 'up') {
    return currentLineIndex === 0
  }

  return currentLineIndex === lastLineIndex && !after.includes('\n')
}

function applyHistoryStep(delta: number): void {
  const records = commandHistory.value
    .filter(entry => entry.command.trim())
    .map(entry => entry.command)

  if (records.length === 0) {
    return
  }

  if (historyCursor.value === -1) {
    draftBeforeHistory.value = command.value
    historyCursor.value = records.length
  }

  const nextCursor = Math.min(Math.max(historyCursor.value + delta, 0), records.length)
  historyCursor.value = nextCursor

  if (nextCursor === records.length) {
    command.value = draftBeforeHistory.value
  } else {
    command.value = records[nextCursor]
  }

  void nextTick(() => {
    const input = inputRef.value
    if (!input) return
    const length = input.value.length
    input.setSelectionRange(length, length)
  })
}

async function scrollToBottom(): Promise<void> {
  await nextTick()
  if (outputRef.value) {
    outputRef.value.scrollTop = outputRef.value.scrollHeight
  }
}

async function focusEditor(): Promise<void> {
  await nextTick()
  inputRef.value?.focus()
}
</script>

<style scoped>
.terminal-drawer {
  min-height: 260px;
  max-height: 360px;
  border-top: 1px solid #e5e7eb;
}

.terminal-window {
  display: flex;
  flex-direction: column;
  min-height: 260px;
  max-height: 360px;
  background: #fbfbfc;
}

.terminal-state {
  padding: 16px 14px;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}

.terminal-state--error {
  color: #b91c1c;
}

.terminal-meta {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-height: 34px;
  padding: 0 14px;
  border-bottom: 1px solid #eceff3;
  background: #f9fafb;
  color: #667085;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 11px;
  text-transform: lowercase;
}

.terminal-screen {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(249, 250, 251, 0.98)),
    linear-gradient(135deg, rgba(229, 231, 235, 0.35), transparent 55%);
}

.terminal-empty {
  color: #6b7280;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}

.terminal-block {
  display: grid;
  gap: 8px;
}

.terminal-command-line {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px;
  color: #111827;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
}

.prompt-symbol {
  color: #2563eb;
  font-weight: 700;
}

.prompt-path {
  color: #7c8798;
  white-space: nowrap;
}

.prompt-command {
  word-break: break-word;
  white-space: pre-wrap;
}

.command-status {
  align-self: center;
  border-radius: 999px;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.command-status--pending {
  background: #eef2ff;
  color: #4f46e5;
}

.command-status--success {
  background: #eaf7ee;
  color: #217a45;
}

.command-status--error {
  background: #fcecec;
  color: #b42318;
}

.terminal-stream {
  margin: 0 0 0 20px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  color: #1f2937;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  line-height: 1.58;
  white-space: pre-wrap;
  word-break: break-word;
}

.terminal-stream--error {
  border-color: #f3c7c7;
  background: #fff7f7;
  color: #b42318;
}

.terminal-inline-error {
  margin-left: 20px;
  color: #b42318;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}

.terminal-live-prompt {
  display: grid;
  gap: 8px;
  position: sticky;
  bottom: 0;
  margin-top: auto;
  padding-top: 8px;
  background: #ffffff;
}

.terminal-prompt {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
}

.prompt-editor {
  min-height: 22px;
  max-height: 108px;
  border: 0;
  outline: none;
  resize: none;
  overflow-y: auto;
  padding: 0;
  background: transparent;
  color: #111827;
  font: inherit;
  line-height: inherit;
}

.prompt-editor::placeholder {
  color: #9ca3af;
}

.prompt-editor:disabled {
  color: #9ca3af;
}
</style>
