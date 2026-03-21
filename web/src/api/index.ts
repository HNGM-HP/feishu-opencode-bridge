import axios from 'axios'

const http = axios.create({ baseURL: '/api' })

// 从 localStorage 读取 token 注入 Authorization 头
http.interceptors.request.use(config => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export interface BridgeSettings {
  FEISHU_APP_ID?: string
  FEISHU_APP_SECRET?: string
  FEISHU_ENCRYPT_KEY?: string
  FEISHU_VERIFICATION_TOKEN?: string
  ALLOWED_USERS?: string
  ENABLED_PLATFORMS?: string
  // Discord
  DISCORD_ENABLED?: string
  DISCORD_TOKEN?: string
  DISCORD_BOT_TOKEN?: string
  DISCORD_CLIENT_ID?: string
  DISCORD_ALLOWED_BOT_IDS?: string
  // WeCom
  WECOM_ENABLED?: string
  WECOM_BOT_ID?: string
  WECOM_SECRET?: string
  // Telegram
  TELEGRAM_ENABLED?: string
  TELEGRAM_BOT_TOKEN?: string
  // QQ
  QQ_ENABLED?: string
  QQ_PROTOCOL?: string
  QQ_ONEBOT_WS_URL?: string
  QQ_APP_ID?: string
  QQ_SECRET?: string
  QQ_CALLBACK_URL?: string
  QQ_ENCRYPT_KEY?: string
  // WhatsApp
  WHATSAPP_ENABLED?: string
  WHATSAPP_MODE?: string
  WHATSAPP_SESSION_PATH?: string
  WHATSAPP_BUSINESS_PHONE_ID?: string
  WHATSAPP_BUSINESS_ACCESS_TOKEN?: string
  OPENCODE_HOST?: string
  OPENCODE_PORT?: string
  OPENCODE_AUTO_START?: string
  OPENCODE_AUTO_START_CMD?: string
  OPENCODE_SERVER_USERNAME?: string
  OPENCODE_SERVER_PASSWORD?: string
  OPENCODE_CONFIG_FILE?: string
  RELIABILITY_CRON_ENABLED?: string
  RELIABILITY_CRON_API_ENABLED?: string
  RELIABILITY_CRON_API_HOST?: string
  RELIABILITY_CRON_API_PORT?: string
  RELIABILITY_CRON_API_TOKEN?: string
  RELIABILITY_CRON_JOBS_FILE?: string
  RELIABILITY_CRON_ORPHAN_AUTO_CLEANUP?: string
  RELIABILITY_CRON_FORWARD_TO_PRIVATE?: string
  RELIABILITY_CRON_FALLBACK_FEISHU_CHAT_ID?: string
  RELIABILITY_CRON_FALLBACK_DISCORD_CONVERSATION_ID?: string
  RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED?: string
  RELIABILITY_INBOUND_HEARTBEAT_ENABLED?: string
  RELIABILITY_HEARTBEAT_INTERVAL_MS?: string
  RELIABILITY_HEARTBEAT_AGENT?: string
  RELIABILITY_HEARTBEAT_PROMPT?: string
  RELIABILITY_HEARTBEAT_ALERT_CHATS?: string
  RELIABILITY_FAILURE_THRESHOLD?: string
  RELIABILITY_WINDOW_MS?: string
  RELIABILITY_COOLDOWN_MS?: string
  RELIABILITY_REPAIR_BUDGET?: string
  RELIABILITY_MODE?: string
  RELIABILITY_LOOPBACK_ONLY?: string
  GROUP_REQUIRE_MENTION?: string
  GROUP_REPLY_REQUIRE_MENTION?: string
  SHOW_THINKING_CHAIN?: string
  SHOW_TOOL_CHAIN?: string
  FEISHU_SHOW_THINKING_CHAIN?: string
  FEISHU_SHOW_TOOL_CHAIN?: string
  DISCORD_SHOW_THINKING_CHAIN?: string
  DISCORD_SHOW_TOOL_CHAIN?: string
  ALLOWED_DIRECTORIES?: string
  DEFAULT_WORK_DIRECTORY?: string
  PROJECT_ALIASES?: string
  GIT_ROOT_NORMALIZATION?: string
  TOOL_WHITELIST?: string
  PERMISSION_REQUEST_TIMEOUT_MS?: string
  OUTPUT_UPDATE_INTERVAL?: string
  MAX_DELAYED_RESPONSE_WAIT_MS?: string
  ATTACHMENT_MAX_SIZE?: string
  ENABLE_MANUAL_SESSION_BIND?: string
  ROUTER_MODE?: string
  DEFAULT_PROVIDER?: string
  DEFAULT_MODEL?: string
}

export interface SaveConfigResult {
  ok: boolean
  needRestart: boolean
  changedKeys: string[]
}

export interface CronJob {
  id: string
  name?: string
  cronExpression: string
  enabled: boolean
  platform: string
  conversationId: string
  lastRunAt?: string
  nextRunAt?: string
  state?: { status: string; lastError?: string }
}

export interface ServiceStatus {
  version: string
  uptime: number
  startedAt: string
  dbPath: string
  cronJobCount: number
  needsPasswordChange?: boolean
  bridgeRunning?: boolean
  bridgePid?: number
}

export interface BridgeStatus {
  managed: boolean
  running: boolean
  pid?: number
  startedAt?: string
  exitCode?: number
  exitReason?: string
}

export interface OpenCodeStatus {
  installed: boolean
  version?: string
  portOpen: boolean
  portReason?: string
}

export interface OpenCodeUpdateCheck {
  latestVersion: string | null
  githubError?: string | null
}

export interface CreateCronJobInput {
  name?: string
  cronExpression: string
  platform: 'feishu' | 'discord' | 'wecom' | 'telegram' | 'qq' | 'whatsapp'
  conversationId: string
  prompt?: string
}

export interface ModelProvider {
  name: string
  models: string[]
}

export interface SessionInfo {
  chatId?: string
  conversationId?: string
  title: string
  userId?: string
  platform?: 'feishu' | 'discord' | 'wecom' | 'telegram' | 'qq' | 'whatsapp'
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  source: string
  message: string
  raw: string[]
}

export interface LogQueryResult {
  entries: LogEntry[]
  total: number
}

export interface LogStats {
  total: number
  debug: number
  info: number
  warn: number
  error: number
}

export const configApi = {
  async getConfig(): Promise<BridgeSettings> {
    const res = await http.get<{ settings: BridgeSettings }>('/config')
    return res.data.settings
  },

  async saveConfig(settings: BridgeSettings): Promise<SaveConfigResult> {
    const res = await http.post<SaveConfigResult>('/config', settings)
    return res.data
  },

  async getCronJobs(): Promise<CronJob[]> {
    const res = await http.get<{ jobs: CronJob[] }>('/cron')
    return res.data.jobs
  },

  async createCronJob(input: CreateCronJobInput): Promise<CronJob> {
    const res = await http.post<{ job: CronJob }>('/cron/create', input)
    return res.data.job
  },

  async toggleCronJob(id: string): Promise<CronJob> {
    const res = await http.post<{ job: CronJob }>(`/cron/${id}/toggle`)
    return res.data.job
  },

  async deleteCronJob(id: string): Promise<void> {
    await http.delete(`/cron/${id}`)
  },

  async getStatus(): Promise<ServiceStatus> {
    const res = await http.get<ServiceStatus>('/admin/status')
    return res.data
  },

  async restart(): Promise<void> {
    await http.post('/admin/restart')
  },

  async getModels(): Promise<{ providers: ModelProvider[]; raw: string[] }> {
    const res = await http.get<{ models: Record<string, string[]>; raw: string[] }>('/opencode/models')
    const providers: ModelProvider[] = Object.entries(res.data.models).map(([name, models]) => ({
      name,
      models,
    }))
    return { providers, raw: res.data.raw }
  },

  async getSessions(): Promise<{
    feishu: SessionInfo[]
    discord: SessionInfo[]
    wecom: SessionInfo[]
    telegram: SessionInfo[]
    qq: SessionInfo[]
    whatsapp: SessionInfo[]
  }> {
    const res = await http.get<{
      feishu: SessionInfo[]
      discord: SessionInfo[]
      wecom: SessionInfo[]
      telegram: SessionInfo[]
      qq: SessionInfo[]
      whatsapp: SessionInfo[]
    }>('/sessions')
    return res.data
  },

  async getLogs(params?: {
    level?: LogLevel
    search?: string
    start?: string
    end?: string
    page?: number
    limit?: number
  }): Promise<LogQueryResult> {
    const res = await http.get<LogQueryResult>('/logs', { params })
    return res.data
  },

  async getLogStats(): Promise<LogStats> {
    const res = await http.get<LogStats>('/logs/stats')
    return res.data
  },

  async clearLogs(): Promise<void> {
    await http.delete('/logs')
  },

  async getHealth(): Promise<{
    status: string
    timestamp: string
    checks: {
      database: { status: string; message: string }
      opencode: { status: string; message: string }
      feishu: { status: string; message: string }
      discord: { status: string; message: string }
      wecom: { status: string; message: string }
      telegram: { status: string; message: string }
      qq: { status: string; message: string }
      whatsapp: { status: string; message: string }
    }
  }> {
    const res = await http.get('/admin/health')
    return res.data
  },

  async repair(): Promise<{ ok: boolean; results: string[] }> {
    const res = await http.post('/admin/repair')
    return res.data
  },

  async getPasswordStatus(): Promise<{ needsPasswordChange: boolean; hasPassword: boolean }> {
    const res = await http.get('/admin/password-status')
    return res.data
  },

  async changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean; message: string }> {
    const res = await http.put('/admin/password', { oldPassword, newPassword })
    return res.data
  },

  async getBridgeStatus(): Promise<BridgeStatus> {
    const res = await http.get<BridgeStatus>('/admin/bridge')
    return res.data
  },

  async upgrade(): Promise<{ ok: boolean; message: string }> {
    const res = await http.post('/admin/upgrade')
    return res.data
  },

  async getOpenCodeStatus(): Promise<OpenCodeStatus> {
    const res = await http.get<OpenCodeStatus>('/opencode/status')
    return res.data
  },

  async installOpenCode(): Promise<{ ok: boolean; message: string }> {
    const res = await http.post('/opencode/install')
    return res.data
  },

  async upgradeOpenCode(): Promise<{ ok: boolean; message: string }> {
    const res = await http.post('/opencode/upgrade')
    return res.data
  },

  async startOpenCode(): Promise<{ ok: boolean; message: string }> {
    const res = await http.post('/opencode/start')
    return res.data
  },

  async stopOpenCode(): Promise<{ ok: boolean; message: string }> {
    const res = await http.post('/opencode/stop')
    return res.data
  },

  async checkOpenCodeUpdate(): Promise<OpenCodeUpdateCheck> {
    const res = await http.get<OpenCodeUpdateCheck>('/opencode/check-update')
    return res.data
  },

  async checkBridgeUpdate(): Promise<{ hasUpdate: boolean; currentVersion: string; latestVersion: string | null }> {
    const res = await http.get<{ hasUpdate: boolean; currentVersion: string; latestVersion: string | null }>('/admin/check-update')
    return res.data
  },

  async shutdown(): Promise<{ ok: boolean; message: string }> {
    const res = await http.post<{ ok: boolean; message: string }>('/admin/shutdown')
    return res.data
  },

  async getLoginTimeout(): Promise<{ timeoutMinutes: number }> {
    const res = await http.get<{ timeoutMinutes: number }>('/admin/login-timeout')
    return res.data
  },

  async setLoginTimeout(timeoutMinutes: number): Promise<{ ok: boolean; timeoutMinutes: number; message: string }> {
    const res = await http.put<{ ok: boolean; timeoutMinutes: number; message: string }>('/admin/login-timeout', { timeoutMinutes })
    return res.data
  },
}
