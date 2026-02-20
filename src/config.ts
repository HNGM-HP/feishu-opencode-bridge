import 'dotenv/config';

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNonNegativeIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

// 飞书配置
export const feishuConfig = {
  appId: process.env.FEISHU_APP_ID || '',
  appSecret: process.env.FEISHU_APP_SECRET || '',
  encryptKey: process.env.FEISHU_ENCRYPT_KEY,
  verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
};

// OpenCode配置
export const opencodeConfig = {
  host: process.env.OPENCODE_HOST || 'localhost',
  port: parseInt(process.env.OPENCODE_PORT || '4096', 10),
  serverUsername: process.env.OPENCODE_SERVER_USERNAME?.trim() || 'opencode',
  serverPassword: process.env.OPENCODE_SERVER_PASSWORD?.trim() || undefined,
  get baseUrl() {
    return `http://${this.host}:${this.port}`;
  },
};

// 用户配置
export const userConfig = {
  // 允许使用机器人的用户open_id列表
  allowedUsers: (process.env.ALLOWED_USERS || '')
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0),

  // 是否开启手动绑定已有 OpenCode 会话能力
  enableManualSessionBind: parseBooleanEnv(process.env.ENABLE_MANUAL_SESSION_BIND, true),
  
  // 是否启用用户白名单（如果为空则不限制）
  get isWhitelistEnabled() {
    return this.allowedUsers.length > 0;
  },
};

// 模型配置
const configuredDefaultProvider = process.env.DEFAULT_PROVIDER?.trim();
const configuredDefaultModel = process.env.DEFAULT_MODEL?.trim();
const hasConfiguredDefaultModel = Boolean(configuredDefaultProvider && configuredDefaultModel);

export const modelConfig = {
  // 不配置时交由 OpenCode 自身默认模型决策
  defaultProvider: hasConfiguredDefaultModel ? configuredDefaultProvider : undefined,
  defaultModel: hasConfiguredDefaultModel ? configuredDefaultModel : undefined,
};

// 权限配置
export const permissionConfig = {
  // 自动允许的工具列表
  toolWhitelist: (process.env.TOOL_WHITELIST || 'Read,Glob,Grep,Task').split(',').filter(Boolean),
  
  // 权限请求超时时间（毫秒）；<= 0 表示不超时，始终等待用户回复
  requestTimeout: parseNonNegativeIntEnv(process.env.PERMISSION_REQUEST_TIMEOUT_MS, 0),
};

// 输出配置
export const outputConfig = {
  // 输出更新间隔（毫秒）
  updateInterval: parseInt(process.env.OUTPUT_UPDATE_INTERVAL || '3000', 10),
  
  // 单条消息最大长度（飞书限制）
  maxMessageLength: 4000,
};

// 附件配置
export const attachmentConfig = {
  maxSize: parseInt(process.env.ATTACHMENT_MAX_SIZE || String(50 * 1024 * 1024), 10),
};

// 验证配置
export function validateConfig(): void {
  const errors: string[] = [];
  
  if (!feishuConfig.appId) {
    errors.push('缺少 FEISHU_APP_ID');
  }
  if (!feishuConfig.appSecret) {
    errors.push('缺少 FEISHU_APP_SECRET');
  }
  
  if (errors.length > 0) {
    throw new Error(`配置错误:\n${errors.join('\n')}`);
  }
}
