import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { configApi, type BridgeSettings, type CronJob, type ServiceStatus, type CreateCronJobInput, type SessionInfo, type ModelProvider } from '../api/index'

export const useConfigStore = defineStore('config', () => {
  const settings = ref<BridgeSettings>({})
  const cronJobs = ref<CronJob[]>([])
  const status = ref<ServiceStatus | null>(null)
  const sessions = ref<SessionInfo[]>([])
  const modelProviders = ref<ModelProvider[]>([])
  const loading = ref(false)
  const initialized = ref(false)
  const pendingRestart = ref(false)
  const pendingRestartKeys = ref<string[]>([])

  const cronJobCount = computed(() => cronJobs.value.length)
  const runningJobCount = computed(() => cronJobs.value.filter(j => j.enabled).length)

  async function fetchConfig() {
    loading.value = true
    try {
      settings.value = await configApi.getConfig()
    } finally {
      loading.value = false
    }
  }

  async function saveConfig(partial: BridgeSettings) {
    const result = await configApi.saveConfig({ ...settings.value, ...partial })
    settings.value = { ...settings.value, ...partial }
    if (result.needRestart) {
      pendingRestart.value = true
      pendingRestartKeys.value = result.changedKeys
    }
    return result
  }

  async function fetchCronJobs() {
    cronJobs.value = await configApi.getCronJobs()
  }

  async function toggleCronJob(id: string) {
    const updated = await configApi.toggleCronJob(id)
    const idx = cronJobs.value.findIndex(j => j.id === id)
    if (idx !== -1) cronJobs.value[idx] = updated
  }

  async function deleteCronJob(id: string) {
    await configApi.deleteCronJob(id)
    cronJobs.value = cronJobs.value.filter(j => j.id !== id)
  }

  async function createCronJob(input: CreateCronJobInput) {
    const created = await configApi.createCronJob(input)
    cronJobs.value = [...cronJobs.value, created]
  }

  async function fetchStatus() {
    status.value = await configApi.getStatus()
  }

  async function fetchSessions() {
    const data = await configApi.getSessions()
    // 将各平台会话合并，并添加 platform 字段
    const feishuSessions = (data.feishu || []).map(s => ({ ...s, platform: 'feishu' as const }))
    const discordSessions = (data.discord || []).map(s => ({ ...s, platform: 'discord' as const }))
    const wecomSessions = (data.wecom || []).map(s => ({ ...s, platform: 'wecom' as const }))
    const telegramSessions = (data.telegram || []).map(s => ({ ...s, platform: 'telegram' as const }))
    const qqSessions = (data.qq || []).map(s => ({ ...s, platform: 'qq' as const }))
    const whatsappSessions = (data.whatsapp || []).map(s => ({ ...s, platform: 'whatsapp' as const }))
    const weixinSessions = (data.weixin || []).map(s => ({ ...s, platform: 'weixin' as const }))
    sessions.value = [...feishuSessions, ...discordSessions, ...wecomSessions, ...telegramSessions, ...qqSessions, ...whatsappSessions, ...weixinSessions]
  }

  async function fetchModels() {
    const data = await configApi.getModels()
    modelProviders.value = data.providers
  }

  async function initializeAll() {
    if (initialized.value) return
    loading.value = true
    try {
      await Promise.all([
        fetchConfig(),
        fetchStatus(),
        fetchCronJobs(),
        fetchSessions(),
        fetchModels(),
      ])
      initialized.value = true
    } finally {
      loading.value = false
    }
  }

  async function restart() {
    await configApi.restart()
    pendingRestart.value = false
    pendingRestartKeys.value = []
  }

  return {
    settings, cronJobs, status, sessions, modelProviders,
    loading, initialized,
    pendingRestart, pendingRestartKeys,
    cronJobCount, runningJobCount,
    fetchConfig, saveConfig,
    fetchCronJobs, toggleCronJob, deleteCronJob, createCronJob,
    fetchStatus, fetchSessions, fetchModels,
    initializeAll, restart,
  }
})
