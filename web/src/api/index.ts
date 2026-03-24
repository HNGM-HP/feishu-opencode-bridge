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
  DISCORD_CLIENT_ID?: string
  DISCORD_ALLOWED_BOT_IDS?: string
  // WeCom
  WECOM_ENABLED?: string
  WECOM_BOT_ID?: string
  WECOM_SECRET?: string
  // Weixin
  WEIXIN_ENABLED?: string
  // DingTalk
  DINGTALK_ENABLED?: string
  // Telegram
  TELEGRAM_ENABLED?: string
  TELEGRAM_BOT_TOKEN?: string
  // QQ
  QQ_ENABLED?: string
  QQ_PROTOCOL?: string
  QQ_ONEBOT_WS_URL?: string
  QQ_APP_ID?: string
  QQ_SECRET?: string
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
  WECOM_SHOW_THINKING_CHAIN?: string
  WECOM_SHOW_TOOL_CHAIN?: string
  TELEGRAM_SHOW_THINKING_CHAIN?: string
  TELEGRAM_SHOW_TOOL_CHAIN?: string
  QQ_SHOW_THINKING_CHAIN?: string
  QQ_SHOW_TOOL_CHAIN?: string
  WHATSAPP_SHOW_THINKING_CHAIN?: string
  WHATSAPP_SHOW_TOOL_CHAIN?: string
  WEIXIN_SHOW_THINKING_CHAIN?: string
  WEIXIN_SHOW_TOOL_CHAIN?: string
  DINGTALK_SHOW_THINKING_CHAIN?: string
  DINGTALK_SHOW_TOOL_CHAIN?: string
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

export interface WeixinAccount {
  id: string
  wxid: string
  nickname?: string
  avatar?: string
  enabled: boolean
  createdAt: number
  lastUsedAt?: number
}

export interface WeixinLoginSession {
  sessionId: string
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'cancelled' | 'error'
  qrImage?: string
  account?: WeixinAccount
  error?: string
}

// 钉钉账号类型
export interface DingtalkAccount {
  id: string
  accountId: string
  clientId: string
  clientSecret: string
  name: string
  enabled: boolean
  endpoint: string
  createdAt: string
}

// Session 管理相关类型
export interface SessionBindingItem {
  platform: string
  conversationId: string
  sessionId: string
  title?: string
  chatType?: 'p2p' | 'group'
  creatorId: string
  sessionDirectory?: string
  resolvedDirectory?: string
  projectName?: string
  createdAt: number
}

export interface SessionBindingsResponse {
  bindings: SessionBindingItem[]
  total: number
  page: number
  limit: number
}

export interface CreateBindingRequest {
  platform: string
  conversationId: string
  sessionId: string
  title?: string
  creatorId?: string
  chatType?: 'p2p' | 'group'
  sessionDirectory?: string
}

export interface UpdateBindingRequest {
  sessionId?: string
  title?: string
  sessionDirectory?: string
  resolvedDirectory?: string
  projectName?: string
}

export interface SessionStats {
  total: number
  byPlatform: Record<string, number>
  byType: { p2p: number; group: number; unknown: number }
}

export interface OpenCodeSessionBinding {
  platform: string
  conversationId: string
  title?: string
  chatType?: 'p2p' | 'group'
}

export interface OpenCodeSession {
  id: string
  title?: string
  createdAt?: string
  projectPath?: string
  directory?: string
  isBound: boolean
  bindings: OpenCodeSessionBinding[]
  localOnly?: boolean  // 仅存在于本地绑定，OpenCode 中已不存在
}

export interface OpenCodeSessionsResponse {
  sessions: OpenCodeSession[]
  openCodeAvailable: boolean
}

export interface PlatformInfo {
  id: string
  name: string
  icon: string
}

export interface PlatformChat {
  id: string
  name: string
  type: 'p2p' | 'group' | 'channel'
  avatar?: string
  memberCount?: number
  isBound: boolean
  boundSessionId?: string
  boundSessionTitle?: string
}

export const weixinApi = {
  async getAccounts(): Promise<WeixinAccount[]> {
    const res = await http.get<{ accounts: WeixinAccount[] }>('/weixin/accounts')
    return res.data.accounts
  },

  async deleteAccount(id: string): Promise<{ ok: boolean }> {
    const res = await http.delete<{ ok: boolean }>(`/weixin/accounts/${id}`)
    return res.data
  },

  async toggleAccount(id: string, enabled: boolean): Promise<{ ok: boolean; enabled: boolean }> {
    const res = await http.post<{ ok: boolean; enabled: boolean }>(`/weixin/accounts/${id}/toggle`, { enabled })
    return res.data
  },

  async startLogin(): Promise<{ ok: boolean; sessionId: string; qrImage: string }> {
    const res = await http.post<{ ok: boolean; sessionId: string; qrImage: string }>('/weixin/login/start')
    return res.data
  },

  async waitLogin(sessionId: string): Promise<WeixinLoginSession> {
    const res = await http.get<WeixinLoginSession>('/weixin/login/wait', { params: { sessionId } })
    return res.data
  },

  async cancelLogin(sessionId: string): Promise<{ ok: boolean }> {
    const res = await http.post<{ ok: boolean }>('/weixin/login/cancel', { sessionId })
    return res.data
  },
}

export const dingtalkApi = {
  async getAccounts(): Promise<DingtalkAccount[]> {
    const res = await http.get<{ accounts: DingtalkAccount[] }>('/dingtalk/accounts')
    return res.data.accounts
  },

  async createAccount(data: {
    accountId: string
    clientId: string
    clientSecret: string
    name?: string
    endpoint?: string
  }): Promise<{ ok: boolean; message: string }> {
    const res = await http.post<{ ok: boolean; message: string }>('/dingtalk/accounts', data)
    return res.data
  },

  async updateAccount(id: string, data: {
    clientId?: string
    clientSecret?: string
    name?: string
    endpoint?: string
  }): Promise<{ ok: boolean; message: string }> {
    const res = await http.put<{ ok: boolean; message: string }>(`/dingtalk/accounts/${id}`, data)
    return res.data
  },

  async deleteAccount(id: string): Promise<{ ok: boolean }> {
    const res = await http.delete<{ ok: boolean }>(`/dingtalk/accounts/${id}`)
    return res.data
  },

  async toggleAccount(id: string, enabled: boolean): Promise<{ ok: boolean; enabled: boolean }> {
    const res = await http.post<{ ok: boolean; enabled: boolean }>(`/dingtalk/accounts/${id}/toggle`, { enabled })
    return res.data
  },
}

export type WhatsAppConnectionStatus = 'connected' | 'need_scan' | 'disconnected' | 'connecting'

export interface WhatsAppStatus {
  ok: boolean
  enabled: boolean
  mode: 'personal' | 'business'
  status: WhatsAppConnectionStatus
  qrCode?: string
}

export const whatsappApi = {
  async getStatus(): Promise<WhatsAppStatus> {
    const res = await http.get<WhatsAppStatus>('/whatsapp/status')
    return res.data
  },
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

  async stopBridge(): Promise<{ ok: boolean; message: string }> {
    const res = await http.post<{ ok: boolean; message: string }>('/admin/stop-bridge')
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

export const sessionApi = {
  async getBindings(params?: {
    platform?: string
    chatType?: 'p2p' | 'group'
    creatorId?: string
    page?: number
    limit?: number
    search?: string
  }): Promise<SessionBindingsResponse> {
    const res = await http.get<SessionBindingsResponse>('/sessions/bindings', { params })
    return res.data
  },

  async getStats(): Promise<SessionStats> {
    const res = await http.get<SessionStats>('/sessions/bindings/stats')
    return res.data
  },

  async createBinding(data: CreateBindingRequest): Promise<{ ok: boolean; binding: SessionBindingItem }> {
    const res = await http.post<{ ok: boolean; binding: SessionBindingItem }>('/sessions/bindings', data)
    return res.data
  },

  async updateBinding(
    platform: string,
    conversationId: string,
    data: UpdateBindingRequest
  ): Promise<{ ok: boolean; message: string }> {
    const res = await http.put<{ ok: boolean; message: string }>(
      `/sessions/bindings/${platform}/${encodeURIComponent(conversationId)}`,
      data
    )
    return res.data
  },

  async deleteBinding(
    platform: string,
    conversationId: string,
    deleteOpenCode = false
  ): Promise<{ ok: boolean; message: string; openCodeDeleted: boolean }> {
    const res = await http.delete<{ ok: boolean; message: string; openCodeDeleted: boolean }>(
      `/sessions/bindings/${platform}/${encodeURIComponent(conversationId)}`,
      { params: { deleteOpenCode } }
    )
    return res.data
  },

  async batchOperation(
    action: 'unbind' | 'delete',
    bindings: Array<{ platform: string; conversationId: string }>
  ): Promise<{
    ok: boolean
    action: string
    total: number
    successCount: number
    failCount: number
    results: Array<{ platform: string; conversationId: string; success: boolean; error?: string }>
  }> {
    const res = await http.post('/sessions/bindings/batch', { action, bindings })
    return res.data
  },

  async getOpenCodeSessions(): Promise<{ sessions: OpenCodeSession[]; openCodeAvailable: boolean }> {
    const res = await http.get<{ sessions: OpenCodeSession[]; openCodeAvailable: boolean }>('/sessions/opencode/list')
    return res.data
  },

  async deleteOpenCodeSession(sessionId: string): Promise<{ ok: boolean; message: string }> {
    const res = await http.delete<{ ok: boolean; message: string }>(`/sessions/opencode/${encodeURIComponent(sessionId)}`)
    return res.data
  },

  async getPlatforms(): Promise<PlatformInfo[]> {
    const res = await http.get<{ platforms: PlatformInfo[] }>('/sessions/platforms')
    return res.data.platforms
  },

  async getPlatformChats(platform: string): Promise<{ chats: PlatformChat[]; platform: string }> {
    const res = await http.get<{ chats: PlatformChat[]; platform: string }>(`/sessions/platform-chats/${platform}`)
    return res.data
  },
}
