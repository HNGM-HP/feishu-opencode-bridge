<template>
  <div class="workspace-tool">
    <div class="tool-header">
      <div>
        <h4>仓库操作</h4>
        <p>查看当前工作区状态，提交全部变更，或直接同步远端。</p>
      </div>

      <el-button
        size="small"
        plain
        :loading="loading && !status"
        @click="refreshStatus(true)"
      >
        刷新
      </el-button>
    </div>

    <div v-if="!directory" class="placeholder">
      当前没有工作目录。先绑定会话目录，或在配置里设置 `DEFAULT_WORK_DIRECTORY`。
    </div>

    <div v-else-if="error" class="placeholder placeholder--error">
      {{ error }}
    </div>

    <div v-else-if="loading && !status" class="placeholder">
      正在读取 Git 状态...
    </div>

    <template v-else-if="status">
      <section class="section-card">
        <div class="section-head">
          <h5>状态</h5>
          <span>{{ status.clean ? '干净' : '有变更' }}</span>
        </div>

        <div class="repo-summary">
          <div class="summary-item">
            <span>分支</span>
            <strong>{{ status.branch }}</strong>
          </div>
          <div class="summary-item">
            <span>上游</span>
            <strong>{{ status.tracking || '未绑定' }}</strong>
          </div>
          <div class="summary-item">
            <span>前进</span>
            <strong>{{ status.ahead }}</strong>
          </div>
          <div class="summary-item">
            <span>落后</span>
            <strong>{{ status.behind }}</strong>
          </div>
        </div>

        <div class="count-row">
          <span class="count-pill">暂存 {{ status.counts.staged }}</span>
          <span class="count-pill">工作区 {{ status.counts.modified }}</span>
          <span class="count-pill">未跟踪 {{ status.counts.untracked }}</span>
          <span class="count-pill count-pill--danger">冲突 {{ status.counts.conflicted }}</span>
        </div>
      </section>

      <section class="section-card">
        <div class="section-head">
          <h5>提交全部 / 推送</h5>
          <span>{{ status.branch }}</span>
        </div>

        <div class="commit-box">
          <el-input
            v-model="commitMessage"
            type="textarea"
            :rows="2"
            resize="none"
            placeholder="提交说明。会自动 add -A 后提交当前目录下全部变更。"
          />

          <div class="commit-actions">
            <el-button
              type="primary"
              :disabled="!commitMessage.trim()"
              :loading="busyAction === 'commit'"
              @click="handleCommit"
            >
              提交全部
            </el-button>

            <el-button
              plain
              :loading="busyAction === 'push'"
              @click="handlePush"
            >
              推送
            </el-button>
          </div>
        </div>
      </section>

      <section class="section-card">
        <div class="section-head">
          <h5>分支</h5>
          <span>{{ status.branches.length }}</span>
        </div>

        <div class="action-grid">
          <el-select
            v-model="selectedBranch"
            size="small"
            filterable
            placeholder="选择分支"
            :disabled="status.branches.length === 0 || busyAction === 'checkout'"
          >
            <el-option
              v-for="branch in status.branches"
              :key="branch"
              :label="branch"
              :value="branch"
            />
          </el-select>

          <el-button
            size="small"
            plain
            :disabled="!selectedBranch || selectedBranch === status.branch"
            :loading="busyAction === 'checkout'"
            @click="handleCheckout"
          >
            切换分支
          </el-button>
        </div>
      </section>

      <section class="section-card">
        <div class="section-head">
          <h5>历史</h5>
          <span>{{ status.lastCommit ? '最近一条' : '暂无' }}</span>
        </div>

        <div v-if="status.lastCommit" class="last-commit">
          <div class="eyebrow">最近提交</div>
          <strong>{{ status.lastCommit.message }}</strong>
          <span>{{ status.lastCommit.authorName }} · {{ formatCommitDate(status.lastCommit.date) }}</span>
        </div>
        <div v-else class="placeholder">
          当前仓库还没有可展示的提交记录。
        </div>
      </section>

      <section class="section-card">
        <div class="section-head">
          <h5>工作树</h5>
          <span>{{ status.files.length }}</span>
        </div>

        <div v-if="status.clean" class="placeholder">
          工作区干净，没有待处理的变更。
        </div>

        <div v-else class="file-list">
          <button
            v-for="file in status.files"
            :key="file.path"
            type="button"
            :class="['file-item', { 'file-item--active': file.path === selectedPath }]"
            @click="selectFile(file.path)"
          >
            <div class="file-main">
              <span class="file-path">{{ file.path }}</span>
              <span class="badge-row">
                <span
                  v-for="badge in buildBadges(file)"
                  :key="badge"
                  class="file-badge"
                >
                  {{ badge }}
                </span>
              </span>
            </div>
            <span class="signature">{{ file.index }}{{ file.workingTree }}</span>
          </button>
        </div>

        <div class="section-head section-head--diff">
          <h5>Diff</h5>

          <div v-if="showDiffToggle" class="mode-switch">
            <button
              type="button"
              :class="['mode-button', { 'mode-button--active': diffMode === 'working' }]"
              @click="diffMode = 'working'"
            >
              工作区
            </button>
            <button
              type="button"
              :class="['mode-button', { 'mode-button--active': diffMode === 'staged' }]"
              @click="diffMode = 'staged'"
            >
              已暂存
            </button>
          </div>
        </div>

        <div v-if="diffLoading" class="placeholder">
          正在加载 diff...
        </div>

        <div v-else-if="diffNotice" class="placeholder">
          {{ diffNotice }}
        </div>

        <CodeBlock
          v-else-if="diffText"
          :code="diffText"
          language="diff"
          :title="selectedPath || 'diff'"
        />

        <div v-else class="placeholder">
          选择一个变更文件查看 diff。
        </div>
      </section>

      <section class="section-card">
        <div class="section-head">
          <h5>其它功能</h5>
          <span>{{ status.detached ? 'Detached' : '常规' }}</span>
        </div>

        <div class="other-actions">
          <el-button
            size="small"
            plain
            :loading="busyAction === 'pull'"
            @click="handlePull"
          >
            Pull
          </el-button>

          <div class="other-meta">
            <span>仓库根目录 {{ status.repositoryRoot }}</span>
            <span>{{ status.detached ? '当前处于 detached HEAD' : '当前分支正常' }}</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import CodeBlock from '../../../components/ai-elements/CodeBlock.vue'
import { workspaceApi, type WorkspaceGitFileStatus, type WorkspaceGitStatus } from '../../../api'

const props = defineProps<{
  directory?: string
}>()

type BusyAction = 'refresh' | 'pull' | 'push' | 'commit' | 'checkout' | null
type DiffMode = 'working' | 'staged'

const status = ref<WorkspaceGitStatus | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const busyAction = ref<BusyAction>(null)
const commitMessage = ref('')
const selectedBranch = ref('')
const selectedPath = ref('')
const diffMode = ref<DiffMode>('working')
const diffLoading = ref(false)
const diffText = ref('')
const diffNotice = ref('选择一个变更文件查看 diff。')

let statusVersion = 0
let diffVersion = 0

const selectedFile = computed(() => {
  return status.value?.files.find(file => file.path === selectedPath.value) || null
})

const showDiffToggle = computed(() => {
  return Boolean(selectedFile.value?.staged && selectedFile.value?.modified)
})

watch(
  () => props.directory,
  async directory => {
    statusVersion += 1
    diffVersion += 1
    status.value = null
    error.value = null
    selectedPath.value = ''
    selectedBranch.value = ''
    diffText.value = ''
    diffNotice.value = directory
      ? '选择一个变更文件查看 diff。'
      : '当前没有工作目录。'

    if (!directory) return
    await refreshStatus(true)
  },
  { immediate: true }
)

watch(
  () => [selectedPath.value, diffMode.value, props.directory] as const,
  async () => {
    await loadDiff()
  }
)

async function refreshStatus(announce = false): Promise<void> {
  if (!props.directory) return
  const currentVersion = ++statusVersion
  loading.value = true
  error.value = null
  busyAction.value = busyAction.value ?? 'refresh'

  try {
    const nextStatus = await workspaceApi.getGitStatus(props.directory)
    if (currentVersion !== statusVersion) return

    status.value = nextStatus
    const currentFile = nextStatus.files.find(file => file.path === selectedPath.value)
    if (!currentFile) {
      selectedPath.value = nextStatus.files[0]?.path || ''
    }

    const activeBranch = nextStatus.branches.includes(nextStatus.branch)
      ? nextStatus.branch
      : nextStatus.branches[0] || ''
    selectedBranch.value = nextStatus.branches.includes(selectedBranch.value)
      ? selectedBranch.value
      : activeBranch

    const defaultDiffMode = pickDefaultDiffMode(nextStatus.files.find(file => file.path === selectedPath.value) || null)
    if (defaultDiffMode) {
      diffMode.value = defaultDiffMode
    }

    if (announce) {
      ElMessage.success('Git 状态已刷新')
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '读取 Git 状态失败'
  } finally {
    if (currentVersion === statusVersion) {
      loading.value = false
      if (busyAction.value === 'refresh') {
        busyAction.value = null
      }
    }
  }
}

async function loadDiff(): Promise<void> {
  if (!props.directory || !selectedFile.value) {
    diffText.value = ''
    diffNotice.value = props.directory ? '选择一个变更文件查看 diff。' : '当前没有工作目录。'
    return
  }

  const file = selectedFile.value
  const staged = diffMode.value === 'staged'

  if (file.untracked) {
    diffText.value = ''
    diffNotice.value = '未跟踪文件暂不支持 Git diff，可切到文件面板查看内容。'
    return
  }

  if (staged && !file.staged) {
    diffText.value = ''
    diffNotice.value = '当前文件没有已暂存的 diff。'
    return
  }

  if (!staged && !file.modified && file.staged) {
    diffText.value = ''
    diffNotice.value = '当前文件只有已暂存 diff，请切换到“已暂存”查看。'
    return
  }

  const currentVersion = ++diffVersion
  diffLoading.value = true

  try {
    const result = await workspaceApi.getGitDiff({
      directory: props.directory,
      filePath: file.path,
      staged,
    })
    if (currentVersion !== diffVersion) return

    diffText.value = result.diff
    diffNotice.value = result.diff ? '' : '当前选择没有 diff 输出。'
  } catch (err) {
    if (currentVersion !== diffVersion) return
    diffText.value = ''
    diffNotice.value = err instanceof Error ? err.message : '加载 diff 失败'
  } finally {
    if (currentVersion === diffVersion) {
      diffLoading.value = false
    }
  }
}

function selectFile(path: string): void {
  selectedPath.value = path
  const nextFile = status.value?.files.find(file => file.path === path) || null
  const nextMode = pickDefaultDiffMode(nextFile)
  if (nextMode) {
    diffMode.value = nextMode
  }
}

function pickDefaultDiffMode(file: WorkspaceGitFileStatus | null): DiffMode | null {
  if (!file) return null
  if (file.modified) return 'working'
  if (file.staged) return 'staged'
  return 'working'
}

function buildBadges(file: WorkspaceGitFileStatus): string[] {
  const badges: string[] = []
  if (file.untracked) badges.push('未跟踪')
  if (file.staged) badges.push('已暂存')
  if (file.modified) badges.push('工作区')
  if (file.conflicted) badges.push('冲突')
  return badges
}

async function runAction(action: Exclude<BusyAction, 'refresh' | null>, successMessage: string, task: () => Promise<void>): Promise<void> {
  if (!props.directory) return
  busyAction.value = action
  try {
    await task()
    ElMessage.success(successMessage)
    await refreshStatus(false)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Git 操作失败')
  } finally {
    busyAction.value = null
  }
}

async function handleCommit(): Promise<void> {
  const message = commitMessage.value.trim()
  if (!props.directory || !message) return

  await runAction('commit', '提交完成', async () => {
    await workspaceApi.commitAll(props.directory!, message)
    commitMessage.value = ''
  })
}

async function handlePull(): Promise<void> {
  if (!props.directory) return
  await runAction('pull', '已完成 pull', () => workspaceApi.pull(props.directory!))
}

async function handlePush(): Promise<void> {
  if (!props.directory) return
  await runAction('push', '已完成 push', () => workspaceApi.push(props.directory!))
}

async function handleCheckout(): Promise<void> {
  if (!props.directory || !status.value || !selectedBranch.value || selectedBranch.value === status.value.branch) {
    return
  }

  await runAction('checkout', `已切换到 ${selectedBranch.value}`, async () => {
    await workspaceApi.checkout(props.directory!, selectedBranch.value)
  })
}

function formatCommitDate(raw: string): string {
  const value = new Date(raw)
  return Number.isNaN(value.getTime())
    ? raw
    : value.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.workspace-tool {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 16px;
  min-height: 0;
}

.section-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 0;
  border-bottom: 1px solid #f0f0f0;
}

.section-card:last-child {
  border-bottom: none;
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 4px;
}

.tool-header h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #1a1a2e;
}

.section-head h5 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #1a1a2e;
}

.tool-header p {
  margin: 4px 0 0;
  color: #8b8fa3;
  line-height: 1.5;
  font-size: 12px;
}

.placeholder {
  padding: 12px 14px;
  border-radius: 6px;
  background: #f8f9fb;
  color: #8b8fa3;
  line-height: 1.6;
  font-size: 13px;
}

.placeholder--error {
  background: #fef2f2;
  color: #dc2626;
}

.repo-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.summary-item {
  padding: 10px 12px;
  border-radius: 6px;
  background: #f8f9fb;
}

.summary-item span {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #8b8fa3;
}

.summary-item strong {
  display: block;
  margin-top: 4px;
  color: #1a1a2e;
  font-size: 13px;
  word-break: break-word;
}

.count-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.count-pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 12px;
  background: #f0f1f5;
  color: #4a4e69;
  font-size: 12px;
  font-weight: 600;
}

.count-pill--danger {
  background: #fef2f2;
  color: #dc2626;
}

.last-commit {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 6px;
  background: #f8f9fb;
}

.eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #8b8fa3;
}

.last-commit strong {
  color: #1a1a2e;
  font-size: 13px;
}

.last-commit span {
  color: #6b7280;
  font-size: 12px;
}

.action-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.commit-box {
  display: grid;
  gap: 8px;
}

.commit-actions,
.other-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-head--diff {
  margin-top: 4px;
}

.section-head span {
  color: #8b8fa3;
  font-size: 12px;
  font-weight: 600;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-item {
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background: #f8f9fb;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}

.file-item:hover {
  background: #eef0f5;
}

.file-item--active {
  background: #e8eaf3;
}

.file-main {
  display: grid;
  gap: 4px;
}

.file-path {
  color: #1a1a2e;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.4;
}

.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.file-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 4px;
  background: #e8eaf3;
  color: #4a4e69;
  font-size: 10px;
  font-weight: 600;
}

.signature {
  display: inline-flex;
  margin-top: 4px;
  color: #8b8fa3;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 11px;
}

.other-meta {
  min-width: 0;
  display: grid;
  gap: 4px;
  color: #8b8fa3;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}

.mode-switch {
  display: inline-flex;
  border-radius: 6px;
  background: #f0f1f5;
  padding: 2px;
}

.mode-button {
  border: 0;
  background: transparent;
  padding: 4px 10px;
  border-radius: 4px;
  color: #6b7280;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.mode-button--active {
  background: #fff;
  color: #1a1a2e;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}
</style>
