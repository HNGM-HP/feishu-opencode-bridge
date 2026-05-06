import { ref } from 'vue'
import { configApi } from '../api/index'

/**
 * 首次安装引导（onboarding）状态管理
 *
 * 设计：
 * - 后端持久化为权威源（admin_meta.onboarding_completed）
 * - 前端 localStorage 仅作缓存，避免每次刷新都拉接口
 * - 完成 / 跳过 都会写入 true，避免重复打扰
 */

const LOCAL_STORAGE_KEY = 'opencode_bridge_onboarding_completed'

const isCompleted = ref<boolean | null>(readLocalCache())
const loading = ref(false)
const visible = ref(false)

function readLocalCache(): boolean | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
  if (raw === '1') return true
  if (raw === '0') return false
  return null
}

function writeLocalCache(value: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LOCAL_STORAGE_KEY, value ? '1' : '0')
}

async function fetchStatus(force = false): Promise<boolean> {
  if (!force && isCompleted.value !== null) return isCompleted.value
  loading.value = true
  try {
    const { completed } = await configApi.getOnboardingStatus()
    isCompleted.value = completed
    writeLocalCache(completed)
    return completed
  } catch {
    // 后端不可达时，按本地缓存（若无则按未完成）渲染，避免首次访问空白
    const fallback = readLocalCache() ?? false
    isCompleted.value = fallback
    return fallback
  } finally {
    loading.value = false
  }
}

async function markCompleted(): Promise<void> {
  isCompleted.value = true
  writeLocalCache(true)
  visible.value = false
  try {
    await configApi.setOnboardingStatus(true)
  } catch {
    // 后端写入失败不影响本次会话；下次启动会再次拉取，必要时重新展示
  }
}

/** 用户主动跳过引导，与 markCompleted 行为一致（不再打扰） */
async function markSkipped(): Promise<void> {
  await markCompleted()
}

/** 启动入口：拉取后端状态，未完成则展示引导浮层 */
async function bootstrap(): Promise<void> {
  const done = await fetchStatus(false)
  if (!done) {
    visible.value = true
  }
}

function show(): void {
  visible.value = true
}

function hide(): void {
  visible.value = false
}

export function useOnboarding() {
  return {
    isCompleted,
    loading,
    visible,
    bootstrap,
    fetchStatus,
    markCompleted,
    markSkipped,
    show,
    hide,
  }
}
