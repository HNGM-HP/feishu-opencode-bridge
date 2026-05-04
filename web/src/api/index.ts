import axios from 'axios'

// 管理后台不再启用账号/密码鉴权，所有请求直接放行
const http = axios.create({ baseURL: '/api' })

export interface BridgeSettings {
  FEISHU_ENABLED?: string
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
  /** @deprecated 不再使用，保留供旧配置兼容 */
  OPENCODE_AUTO_START_CMD?: string
  OPENCODE_AUTO_START_FOREGROUND?: string
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
  CHAT_MODEL_WHITELIST?: string
  // 非多模态模型图片预处理（OCR 回退）
  IMAGE_VISION_PREPROCESS?: string
  VISION_OCR_MODEL?: string
  VISION_OCR_PROMPT?: string
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
  platform?: 'feishu' | 'discord' | 'wecom' | 'telegram' | 'qq' | 'whatsapp' | 'weixin'
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
  updatedAt?: number
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

export interface ChatSessionSummary {
  id: string
  title: string
  projectId: string
  directory: string
  parentId?: string
  createdAt: number
  updatedAt: number
  version: string
  summary?: {
    additions: number
    deletions: number
    files: number
  }
  share?: {
    url: string
  }
}

export interface ChatWorkspaceOption {
  id: string
  label: string
  directory: string
  source: 'project' | 'default' | 'allowlist'
}

export interface ChatAgentInfo {
  name: string
  description?: string
  mode?: 'primary' | 'subagent' | 'all'
  hidden?: boolean
  builtIn?: boolean
  native?: boolean
}

export interface ChatCommandInfo {
  name: string
  description?: string
  agent?: string
  model?: string
  source?: 'command' | 'mcp' | 'skill' | 'bridge-doc' | 'agent'
  template: string
  subtask?: boolean
  hints: string[]
  group?: string
}

export interface ChatModelOption {
  id: string
  name: string
  variants: string[]
}

export interface ChatModelProviderInfo {
  id: string
  name: string
  models: ChatModelOption[]
}

export interface ChatVisionModelInfo {
  providerID: string
  providerName: string
  modelID: string
  modelName: string
}

export interface ChatTokenUsage {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost?: number
}

export interface ChatTodoItem {
  id: string
  content: string
  status: string
  priority?: string
}

export interface ChatPermissionRequest {
  id: string
  sessionId: string
  tool: string
  description: string
  risk?: string
  messageId?: string
  callId?: string
  metadata?: Record<string, unknown>
}

export interface ChatModelRef {
  providerId: string
  modelId: string
}

export interface ChatMessageMeta {
  id: string
  role: 'user' | 'assistant'
  createdAt: number
  parentId?: string
  model?: ChatModelRef
  agent?: string
}

export type ChatMessagePart =
  | {
      id: string
      messageID: string
      sessionID: string
      type: 'text'
      text: string
    }
  | {
      id: string
      messageID: string
      sessionID: string
      type: 'reasoning'
      text: string
    }
  | {
      id: string
      messageID: string
      sessionID: string
      type: 'tool'
      callID: string
      tool: string
      state:
        | { status: 'pending'; input: Record<string, unknown>; raw?: string }
        | { status: 'running'; input: Record<string, unknown>; title?: string; metadata?: Record<string, unknown> }
        | {
            status: 'completed'
            input: Record<string, unknown>
            output: string
            title: string
            metadata?: Record<string, unknown>
          }
        | {
            status: 'error'
            input: Record<string, unknown>
            error: string
            metadata?: Record<string, unknown>
          }
    }
  | {
      id: string
      messageID: string
      sessionID: string
      type: 'file' | 'subtask' | 'step-start' | 'step-finish' | 'snapshot' | 'patch' | 'agent' | 'retry' | 'compaction'
      [key: string]: unknown
    }

export interface ChatHistoryMessage {
  info: {
    id: string
    sessionID: string
    role: 'user' | 'assistant'
    parentID?: string
    time: {
      created: number
      completed?: number
    }
    error?: {
      data?: {
        message?: string
      }
    }
    finish?: string
    agent?: string
    mode?: string
    model?: {
      providerID: string
      modelID: string
    }
    providerID?: string
    modelID?: string
    cost?: number
    tokens?: {
      input: number
      output: number
      reasoning: number
      cache: {
        read: number
        write: number
      }
    }
  }
  parts: ChatMessagePart[]
}

export interface ChatMessagePage {
  messages: ChatHistoryMessage[]
  tasks: ChatTodoItem[]
  total: number
  hasMore: boolean
  nextCursor: string | null
}

export type ChatEvent =
  | { type: 'message_start'; msg: ChatMessageMeta }
  | { type: 'text_delta'; msgId: string; text: string }
  | { type: 'reasoning_delta'; msgId: string; text: string }
  | {
      type: 'tool_start'
      msgId: string
      tool: { id: string; callId: string; name: string; input: unknown; title?: string }
    }
  | { type: 'tool_delta'; msgId: string; toolId: string; output: string }
  | {
      type: 'tool_end'
      msgId: string
      toolId: string
      callId: string
      name: string
      result: string
      isError: boolean
      title?: string
      durationMs?: number
    }
  | { type: 'message_end'; msgId: string; usage?: ChatTokenUsage; finish?: string; error?: string }
  | { type: 'permission_ask'; req: ChatPermissionRequest }
  | { type: 'permission_resolved'; reqId: string; decision: 'allow' | 'reject' | 'always' }
  | { type: 'task_update'; todos: ChatTodoItem[] }
  | { type: 'session_idle'; sessionId: string }
  | { type: 'session_status'; sessionId: string; status: string }
  | { type: 'error'; message: string }
  | { type: 'keepalive' }

export interface WorkspaceGitFileStatus {
  path: string
  index: string
  workingTree: string
  staged: boolean
  modified: boolean
  untracked: boolean
  conflicted: boolean
}

export interface WorkspaceGitStatus {
  directory: string
  repositoryRoot: string
  branch: string
  tracking?: string
  ahead: number
  behind: number
  clean: boolean
  detached: boolean
  branches: string[]
  counts: {
    staged: number
    modified: number
    untracked: number
    conflicted: number
  }
  files: WorkspaceGitFileStatus[]
  lastCommit?: {
    hash: string
    message: string
    authorName: string
    date: string
  }
}

export interface WorkspaceGitLogEntry {
  sha: string
  message: string
  authorName: string
  authorEmail: string
  date: string
}

export interface WorkspaceGitCommitDetail {
  sha: string
  message: string
  authorName: string
  authorEmail: string
  date: string
  stats: string
  diff: string
}

export interface WorkspaceTerminalSession {
  sessionId: string
  shell: string
  cwd: string
}

export interface WorkspaceTerminalCommandResult {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  cwd: string
}

export interface WorkspaceFileEntry {
  name: string
  path: string
  type: 'directory' | 'file'
  size: number
  mtimeMs: number
  /**
   * 条目存在于目录列表中，但 stat 调用失败（Windows 下常见于
   * C:\PerfLogs、C:\System Volume Information 等受限系统目录）。
   * 前端可据此灰显或禁止点入。
   */
  inaccessible?: boolean
}

export interface WorkspaceFileTree {
  directory: string
  path: string
  entries: WorkspaceFileEntry[]
  truncated: boolean
}

export interface WorkspaceFileContent {
  directory: string
  path: string
  size: number
  truncated: boolean
  isBinary: boolean
  content: string
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

  async restart(): Promise<{ ok: boolean; pid?: number; message: string }> {
    const res = await http.post<{ ok: boolean; pid?: number; message: string }>('/admin/restart')
    return res.data
  },

  async getModels(): Promise<{ providers: ModelProvider[]; raw: string[] }> {
    const res = await http.get<{ models: Record<string, string[]>; raw: string[] }>('/opencode/models')
    const providers: ModelProvider[] = Object.entries(res.data.models).map(([name, models]) => ({
      name,
      models,
    }))
    return { providers, raw: res.data.raw }
  },

  async getModelCatalog(): Promise<ChatModelProviderInfo[]> {
    const res = await http.get<{ providers: ChatModelProviderInfo[] }>('/opencode/model-catalog')
    return Array.isArray(res.data.providers) ? res.data.providers : []
  },

  async syncEnabledModelsFromOpenCode(): Promise<{ source: string; models: string[]; count: number }> {
    const res = await http.get<{ source: string; models: string[]; count: number }>('/opencode/enabled-models-sync')
    return {
      source: res.data.source,
      models: Array.isArray(res.data.models) ? res.data.models : [],
      count: typeof res.data.count === 'number' ? res.data.count : 0,
    }
  },

  async getSessions(): Promise<{
    feishu: SessionInfo[]
    discord: SessionInfo[]
    wecom: SessionInfo[]
    telegram: SessionInfo[]
    qq: SessionInfo[]
    whatsapp: SessionInfo[]
    weixin: SessionInfo[]
  }> {
    const res = await http.get<{
      feishu: SessionInfo[]
      discord: SessionInfo[]
      wecom: SessionInfo[]
      telegram: SessionInfo[]
      qq: SessionInfo[]
      whatsapp: SessionInfo[]
      weixin: SessionInfo[]
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

  async attachOpenCode(host?: string, port?: number): Promise<{ ok: boolean; message: string }> {
    const res = await http.post('/opencode/attach', { host: host ?? 'localhost', port: port ?? 4096 })
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

  async getAutoStart(): Promise<{ enabled: boolean; supported: boolean; platform: string }> {
    const res = await http.get<{ enabled: boolean; supported: boolean; platform: string }>('/admin/autostart')
    return res.data
  },

  async setAutoStart(enabled: boolean): Promise<{ ok: boolean; enabled: boolean; supported: boolean; platform: string }> {
    const res = await http.put<{ ok: boolean; enabled: boolean; supported: boolean; platform: string }>('/admin/autostart', { enabled })
    return res.data
  },

  async getOnboardingStatus(): Promise<{ completed: boolean }> {
    const res = await http.get<{ completed: boolean }>('/admin/onboarding-status')
    return res.data
  },

  async setOnboardingStatus(completed: boolean): Promise<{ ok: boolean; completed: boolean }> {
    const res = await http.put<{ ok: boolean; completed: boolean }>('/admin/onboarding-status', { completed })
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

export const chatApi = {
  async listSessions(): Promise<ChatSessionSummary[]> {
    const res = await http.get<{ sessions: ChatSessionSummary[] }>('/chat/sessions')
    return res.data.sessions
  },

  async createSession(payload?: { title?: string; directory?: string }): Promise<ChatSessionSummary> {
    const res = await http.post<{ session: ChatSessionSummary }>('/chat/sessions', payload)
    return res.data.session
  },

  async renameSession(sessionId: string, title: string): Promise<void> {
    await http.patch(`/chat/sessions/${encodeURIComponent(sessionId)}`, { title })
  },

  async deleteSession(sessionId: string): Promise<void> {
    await http.delete(`/chat/sessions/${encodeURIComponent(sessionId)}`)
  },

  async getMessages(sessionId: string, payload?: {
    limit?: number
    cursor?: string | null
  }): Promise<ChatMessagePage> {
    const res = await http.get<ChatMessagePage>(`/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
      params: {
        limit: payload?.limit,
        cursor: payload?.cursor ?? undefined,
      },
    })
    return {
      messages: Array.isArray(res.data.messages) ? res.data.messages : [],
      tasks: Array.isArray(res.data.tasks) ? res.data.tasks : [],
      total: typeof res.data.total === 'number' ? res.data.total : 0,
      hasMore: Boolean(res.data.hasMore),
      nextCursor: typeof res.data.nextCursor === 'string' ? res.data.nextCursor : null,
    }
  },

  async listWorkspaces(): Promise<ChatWorkspaceOption[]> {
    const res = await http.get<{ workspaces: ChatWorkspaceOption[] }>('/chat/workspaces')
    return Array.isArray(res.data.workspaces) ? res.data.workspaces : []
  },

  async listAgents(): Promise<ChatAgentInfo[]> {
    const res = await http.get<{ agents: ChatAgentInfo[] }>('/chat/agents')
    return Array.isArray(res.data.agents) ? res.data.agents : []
  },

  async listModels(): Promise<ChatModelProviderInfo[]> {
    const res = await http.get<{ providers: ChatModelProviderInfo[] }>('/chat/models')
    return Array.isArray(res.data.providers) ? res.data.providers : []
  },

  async listVisionModels(): Promise<ChatVisionModelInfo[]> {
    const res = await http.get<{ models: ChatVisionModelInfo[] }>('/chat/vision-models')
    return Array.isArray(res.data.models) ? res.data.models : []
  },

  async listCommands(): Promise<ChatCommandInfo[]> {
    const res = await http.get<{ commands: ChatCommandInfo[] }>('/chat/commands')
    return Array.isArray(res.data.commands) ? res.data.commands : []
  },

  async sendPrompt(payload: {
    sessionId: string
    text: string
    parts?: Array<{ type: 'text'; text: string } | { type: 'file'; mime: string; url: string; filename?: string }>
    providerId?: string
    modelId?: string
    agent?: string
    variant?: string
    directory?: string
  }): Promise<void> {
    await http.post('/chat/prompt', {
      sessionId: payload.sessionId,
      parts: payload.parts || [{ type: 'text', text: payload.text }],
      providerId: payload.providerId,
      modelId: payload.modelId,
      agent: payload.agent,
      variant: payload.variant,
      directory: payload.directory,
    })
  },

  async uploadFile(file: File): Promise<{
    ok: boolean
    file: {
      url: string
      filename: string
      mime: string
      size: number
    }
  }> {
    const formData = new FormData()
    formData.append('file', file)

    const res = await http.post<{
      ok: boolean
      file: {
        url: string
        filename: string
        mime: string
        size: number
      }
    }>('/chat/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
    return res.data
  },

  async respondPermission(payload: {
    permissionId: string
    sessionId: string
    decision: 'allow' | 'reject' | 'always'
  }): Promise<void> {
    await http.post(`/chat/permissions/${encodeURIComponent(payload.permissionId)}`, {
      sessionId: payload.sessionId,
      decision: payload.decision,
    })
  },

  async abortSession(sessionId: string): Promise<void> {
    await http.post(`/chat/sessions/${encodeURIComponent(sessionId)}/abort`)
  },

  async undoSession(sessionId: string): Promise<{ messageId?: string }> {
    const res = await http.post<{ ok: boolean; messageId?: string }>(`/chat/sessions/${encodeURIComponent(sessionId)}/undo`)
    return { messageId: res.data.messageId }
  },

  async revertSession(sessionId: string, messageId: string): Promise<void> {
    await http.post(`/chat/sessions/${encodeURIComponent(sessionId)}/revert`, { messageId })
  },
}

export const workspaceApi = {
  async getGitStatus(directory: string): Promise<WorkspaceGitStatus> {
    const res = await http.get<WorkspaceGitStatus>('/workspace/git/status', {
      params: { directory },
    })
    return res.data
  },

  async getGitDiff(payload: {
    directory: string
    filePath?: string
    staged?: boolean
  }): Promise<{ directory: string; filePath?: string; staged: boolean; diff: string }> {
    const res = await http.get<{ directory: string; filePath?: string; staged: boolean; diff: string }>('/workspace/git/diff', {
      params: {
        directory: payload.directory,
        filePath: payload.filePath,
        staged: payload.staged,
      },
    })
    return res.data
  },

  async commitAll(directory: string, message: string): Promise<void> {
    await http.post('/workspace/git/commit', { directory, message })
  },

  async pull(directory: string): Promise<void> {
    await http.post('/workspace/git/pull', { directory })
  },

  async push(directory: string): Promise<void> {
    await http.post('/workspace/git/push', { directory })
  },

  async checkout(directory: string, branch: string): Promise<void> {
    await http.post('/workspace/git/checkout', { directory, branch })
  },

  async checkoutCommit(directory: string, sha: string): Promise<void> {
    await http.post('/workspace/git/checkout', { directory, ref: sha, detach: true })
  },

  async createBranch(directory: string, branch: string, switchAfterCreate = true): Promise<{ branch: string; switched: boolean }> {
    const res = await http.post<{ ok: boolean; branch: string; switched: boolean }>('/workspace/git/branch/create', {
      directory,
      branch,
      switchAfterCreate,
    })
    return {
      branch: res.data.branch,
      switched: res.data.switched,
    }
  },

  async deleteBranch(directory: string, branch: string): Promise<void> {
    await http.post('/workspace/git/branch/delete', { directory, branch })
  },

  async getGitHistory(directory: string, limit = 30): Promise<WorkspaceGitLogEntry[]> {
    const res = await http.get<{ entries: WorkspaceGitLogEntry[] }>('/workspace/git/log', {
      params: { directory, limit },
    })
    return res.data.entries
  },

  async getGitCommitDetail(directory: string, sha: string): Promise<WorkspaceGitCommitDetail> {
    const res = await http.get<WorkspaceGitCommitDetail>('/workspace/git/log/detail', {
      params: { directory, sha },
    })
    return res.data
  },

  async initRepo(directory: string): Promise<void> {
    await http.post('/workspace/git/init', { directory })
  },

  async openTerminal(directory: string): Promise<WorkspaceTerminalSession> {
    const res = await http.post<{ ok: boolean; sessionId: string; shell: string; cwd: string }>('/workspace/terminal/open', {
      directory,
    })
    return {
      sessionId: res.data.sessionId,
      shell: res.data.shell,
      cwd: res.data.cwd,
    }
  },

  async executeCommand(payload: {
    sessionId: string
    command: string
  }): Promise<WorkspaceTerminalCommandResult> {
    const res = await http.post<WorkspaceTerminalCommandResult>('/workspace/terminal/execute', {
      sessionId: payload.sessionId,
      command: payload.command,
    })
    return res.data
  },

  async closeTerminal(sessionId: string): Promise<void> {
    await http.post('/workspace/terminal/close', { sessionId })
  },

  async listFiles(payload: {
    directory: string
    path?: string
    limit?: number
  }): Promise<WorkspaceFileTree> {
    const res = await http.get<WorkspaceFileTree>('/workspace/files/tree', {
      params: {
        directory: payload.directory,
        path: payload.path,
        limit: payload.limit,
      },
    })
    return res.data
  },

  async readFile(directory: string, filePath: string): Promise<WorkspaceFileContent> {
    const res = await http.get<WorkspaceFileContent>('/workspace/files/content', {
      params: {
        directory,
        path: filePath,
      },
    })
    return res.data
  },
}
