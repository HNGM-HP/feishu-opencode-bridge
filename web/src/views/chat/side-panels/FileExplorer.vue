<template>
  <div class="workspace-tool">
    <div class="tool-header">
      <div>
        <h4>文件浏览</h4>
        <p>按当前工作目录浏览文件树，并支持直接预览文本文件。</p>
      </div>

      <el-button
        size="small"
        plain
        :loading="loading && !listing"
        @click="refreshCurrent"
      >
        刷新
      </el-button>
    </div>

    <div v-if="!directory" class="placeholder">
      当前没有工作目录。先绑定会话目录，或在配置里设置 `DEFAULT_WORK_DIRECTORY`。
    </div>

    <template v-else>
      <div class="pathbar">
        <button
          type="button"
          :class="['crumb', { 'crumb--active': !currentPath }]"
          @click="loadDirectory('')"
        >
          root
        </button>

        <button
          v-for="(segment, index) in breadcrumbs"
          :key="`${index}-${segment}`"
          type="button"
          :class="['crumb', { 'crumb--active': index === breadcrumbs.length - 1 }]"
          @click="jumpTo(index)"
        >
          / {{ segment }}
        </button>

        <el-button
          text
          size="small"
          :disabled="!currentPath"
          @click="goUp"
        >
          上一级
        </el-button>
      </div>

      <div v-if="error" class="placeholder placeholder--error">
        {{ error }}
      </div>

      <div v-else class="browser-body">
        <div class="entry-section">
          <div class="section-head">
            <h5>目录项</h5>
            <span>{{ listing?.entries.length || 0 }}</span>
          </div>

          <div v-if="loading && !listing" class="placeholder">
            正在读取目录...
          </div>

          <div v-else-if="listing && listing.entries.length === 0" class="placeholder">
            当前目录为空。
          </div>

          <div v-else class="entry-list">
            <button
              v-for="entry in listing?.entries || []"
              :key="entry.path"
              type="button"
              :class="['entry-item', {
                'entry-item--active': selectedFilePath === entry.path,
                'entry-item--inaccessible': entry.inaccessible,
              }]"
              :disabled="entry.inaccessible"
              :title="entry.inaccessible ? '无权访问（系统受保护目录）' : undefined"
              @click="entry.inaccessible ? undefined : (entry.type === 'directory' ? openDirectory(entry.path) : openFile(entry))"
            >
              <span class="entry-type">{{ entry.type === 'directory' ? 'DIR' : 'FILE' }}</span>
              <span class="entry-name">{{ entry.name }}</span>
              <span class="entry-meta">{{ formatEntryMeta(entry) }}</span>
            </button>
          </div>

          <div v-if="listing?.truncated" class="placeholder">
            当前目录项过多，仅显示前 {{ listing.entries.length }} 条。
          </div>
        </div>

        <div class="preview-section">
          <div class="section-head">
            <h5>文件预览</h5>
            <span>{{ preview?.path || selectedFilePath || '未选择' }}</span>
          </div>

          <div v-if="previewLoading" class="placeholder">
            正在读取文件内容...
          </div>

          <div v-else-if="preview?.isBinary" class="placeholder">
            二进制文件暂不提供文本预览。
          </div>

          <template v-else-if="preview">
            <CodeBlock
              :code="preview.content"
              :language="detectLanguage(preview.path)"
              :title="preview.path"
            />
            <p v-if="preview.truncated" class="preview-note">
              文件较大，当前仅预览前 120 KB 内容。
            </p>
          </template>

          <div v-else class="placeholder">
            选择一个文件查看内容。
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import CodeBlock from '../../../components/ai-elements/CodeBlock.vue'
import { workspaceApi, type WorkspaceFileContent, type WorkspaceFileEntry, type WorkspaceFileTree } from '../../../api'

const props = defineProps<{
  directory?: string
}>()

const listing = ref<WorkspaceFileTree | null>(null)
const preview = ref<WorkspaceFileContent | null>(null)
const selectedFilePath = ref('')
const loading = ref(false)
const previewLoading = ref(false)
const error = ref<string | null>(null)

let listVersion = 0
let previewVersion = 0

const currentPath = computed(() => listing.value?.path || '')
const breadcrumbs = computed(() => currentPath.value.split('/').filter(Boolean))

watch(
  () => props.directory,
  async directory => {
    listVersion += 1
    previewVersion += 1
    listing.value = null
    preview.value = null
    selectedFilePath.value = ''
    error.value = null

    if (!directory) return
    await loadDirectory('')
  },
  { immediate: true }
)

async function loadDirectory(nextPath = ''): Promise<void> {
  if (!props.directory) return
  const currentVersion = ++listVersion
  loading.value = true
  error.value = null

  try {
    const nextListing = await workspaceApi.listFiles({
      directory: props.directory,
      path: nextPath,
      limit: 250,
    })
    if (currentVersion !== listVersion) return
    listing.value = nextListing

    if (selectedFilePath.value) {
      const exists = nextListing.entries.some(entry => entry.path === selectedFilePath.value)
      if (!exists) {
        preview.value = null
        selectedFilePath.value = ''
      }
    }
  } catch (err) {
    // 改进错误处理，提供更友好的错误消息
    let errorMessage = '读取目录失败'

    if (err instanceof Error) {
      const error_message = err.message.toLowerCase()

      // 检查是否是权限问题
      if (error_message.includes('403') || error_message.includes('forbidden')) {
        errorMessage = '权限不足：无法访问当前目录，请检查目录权限'
      }
      // 检查是否是目录不存在
      else if (error_message.includes('no such file') || error_message.includes('directory not found')) {
        errorMessage = '目录不存在：请先创建目标目录或检查路径'
      }
      // 其他错误
      else {
        errorMessage = err.message
      }
    }

    error.value = errorMessage
  } finally {
    if (currentVersion === listVersion) {
      loading.value = false
    }
  }
}

async function refreshCurrent(): Promise<void> {
  await loadDirectory(currentPath.value)
  if (selectedFilePath.value) {
    const entry = listing.value?.entries.find(item => item.path === selectedFilePath.value)
    if (entry && entry.type === 'file') {
      await openFile(entry, false)
    }
  }
  ElMessage.success('目录内容已刷新')
}

async function openDirectory(nextPath: string): Promise<void> {
  preview.value = null
  selectedFilePath.value = ''
  await loadDirectory(nextPath)
}

async function openFile(entry: WorkspaceFileEntry, announce = true): Promise<void> {
  if (!props.directory) return
  selectedFilePath.value = entry.path
  const currentVersion = ++previewVersion
  previewLoading.value = true

  try {
    const nextPreview = await workspaceApi.readFile(props.directory, entry.path)
    if (currentVersion !== previewVersion) return
    preview.value = nextPreview
    if (announce) {
      ElMessage.success(`已打开 ${entry.name}`)
    }
  } catch (err) {
    if (currentVersion !== previewVersion) return

    // 改进错误处理，提供更友好的错误消息
    let errorMessage = '读取文件失败'

    if (err instanceof Error) {
      const error_message = err.message.toLowerCase()

      // 检查是否是权限问题
      if (error_message.includes('403') || error_message.includes('forbidden')) {
        errorMessage = '权限不足：无法读取该文件，请检查文件权限'
      }
      // 检查是否是文件不存在
      else if (error_message.includes('no such file') || error_message.includes('file not found')) {
        errorMessage = '文件不存在：该文件可能已被删除或移动'
      }
      // 其他错误
      else {
        errorMessage = err.message
      }
    }

    ElMessage.error(errorMessage)
  } finally {
    if (currentVersion === previewVersion) {
      previewLoading.value = false
    }
  }
}

async function goUp(): Promise<void> {
  if (!currentPath.value) return
  const segments = currentPath.value.split('/').filter(Boolean)
  segments.pop()
  await loadDirectory(segments.join('/'))
}

async function jumpTo(index: number): Promise<void> {
  const target = breadcrumbs.value.slice(0, index + 1).join('/')
  await loadDirectory(target)
}

function formatEntryMeta(entry: WorkspaceFileEntry): string {
  if (entry.inaccessible) {
    return '无权访问'
  }

  if (entry.type === 'directory') {
    return '目录'
  }

  const size = entry.size
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function detectLanguage(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.tsx')) return 'tsx'
  if (lower.endsWith('.ts')) return 'typescript'
  if (lower.endsWith('.jsx')) return 'jsx'
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript'
  if (lower.endsWith('.vue')) return 'vue'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.html')) return 'html'
  if (lower.endsWith('.sql')) return 'sql'
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'bash'
  return 'plaintext'
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

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 12px;
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

.pathbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-bottom: 12px;
}

.crumb {
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  background: transparent;
  color: #6b7280;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.crumb:hover {
  background: #f0f1f5;
}

.crumb--active {
  background: #e8eaf3;
  color: #1a1a2e;
  font-weight: 600;
}

.browser-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.section-head span {
  color: #8b8fa3;
  font-size: 12px;
  font-weight: 600;
  word-break: break-word;
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.entry-item {
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}

.entry-item:hover {
  background: #f0f1f5;
}

.entry-item--active {
  background: #e8eaf3;
}

.entry-type {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 4px;
  background: #f0f1f5;
  color: #4a4e69;
  font-size: 10px;
  font-weight: 700;
}

.entry-name {
  color: #1a1a2e;
  word-break: break-word;
  line-height: 1.4;
  font-size: 13px;
}

.entry-meta {
  color: #8b8fa3;
  font-size: 11px;
}

.preview-note {
  margin-top: 8px;
  color: #8b8fa3;
  font-size: 12px;
  line-height: 1.5;
}
</style>
