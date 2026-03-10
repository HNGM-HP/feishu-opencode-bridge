import 'dotenv/config';

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = normalizeBooleanToken(value);
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseOptionalBooleanEnv(value: string | undefined): boolean | undefined {
  const normalized = normalizeBooleanToken(value);
  if (!normalized) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function normalizeBooleanToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let normalized = value.trim();
  if (!normalized) return undefined;

  // 兼容行内注释写法：SHOW_X=false # note / SHOW_X=false // note
  normalized = normalized
    .replace(/\s+#.*$/, '')
    .replace(/\s+\/\/.*$/, '')
    .trim();

  if (!normalized) return undefined;

  // 去掉包裹引号
  if (
    (normalized.startsWith('"') && normalized.endsWith('"'))
    || (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  return normalized ? normalized.toLowerCase() : undefined;
}

function parseNonNegativeIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

// 路由器模式配置
export const routerConfig = {
  // 路由器模式: legacy | dual | router
  // 默认 legacy 确保向后兼容
  mode: (() => {
    const value = process.env.ROUTER_MODE?.trim().toLowerCase();
    if (value === 'legacy' || value === 'dual' || value === 'router') {
      return value as 'legacy' | 'dual' | 'router';
    }
    return 'legacy';
  })(),

  // 启用的平台列表（逗号分隔，如 'feishu,discord'）
  enabledPlatforms: (() => {
    const value = process.env.ENABLED_PLATFORMS;
    if (!value) {
      return [];
    }
    return value
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(item => item.length > 0);
  })(),

  // 检查指定平台是否被明确启用
  isPlatformEnabled(platformId: string): boolean {
    // 如果未指定平台列表，则认为所有平台可用（由各自的启用状态控制）
    if (this.enabledPlatforms.length === 0) {
      return true;
    }
    return this.enabledPlatforms.includes(platformId.toLowerCase());
  },
};

// 飞书配置
export const feishuConfig = {
  appId: process.env.FEISHU_APP_ID || '',
  appSecret: process.env.FEISHU_APP_SECRET || '',
  encryptKey: process.env.FEISHU_ENCRYPT_KEY,
  verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
};

// Discord配置
export const discordConfig = {
  // 是否启用 Discord 适配器（默认关闭）
  enabled: parseBooleanEnv(process.env.DISCORD_ENABLED, false),

  // Discord Bot Token（兼容 DISCORD_BOT_TOKEN）
  token: process.env.DISCORD_TOKEN?.trim() || process.env.DISCORD_BOT_TOKEN?.trim() || '',

  // Discord Client ID（当前用于配置兼容，后续 OAuth/交互可直接复用）
  clientId: process.env.DISCORD_CLIENT_ID?.trim() || '',

  // 允许其他 Bot 添加到白名单（逗号分隔的 Discord snowflake ID 列表）
  // 仅接受纯数字格式的 ID，无效 ID 会被跳过
  allowedBotIds: (() => {
    const raw = process.env.DISCORD_ALLOWED_BOT_IDS || '';
    return raw
      .split(',')
      .map(item => item.trim())
      .filter(item => {
        if (!item) return false;
        // Discord snowflake 是纯数字
        if (!/^\d+$/.test(item)) {
          console.warn(`[Config] 无效的 Bot ID "${item}" 已被跳过（需为纯数字）`);
          return false;
        }
        return true;
      });
  })(),
  };

// 群聊消息触发策略
export const groupConfig = {
  // 为 true 时：群聊仅在消息明确 @ 时才触发机器人处理
  // 兼容别名 GROUP_REPLY_REQUIRE_MENTION
  requireMentionInGroup: parseBooleanEnv(
    process.env.GROUP_REQUIRE_MENTION ?? process.env.GROUP_REPLY_REQUIRE_MENTION,
    false
  ),
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
const showThinkingChain = parseBooleanEnv(process.env.SHOW_THINKING_CHAIN, true);
const showToolChain = parseBooleanEnv(process.env.SHOW_TOOL_CHAIN, true);

export const outputConfig = {
  // 输出更新间隔（毫秒）
  updateInterval: parseInt(process.env.OUTPUT_UPDATE_INTERVAL || '3000', 10),
  
  // 单条消息最大长度（飞书限制）
  maxMessageLength: 4000,
  
  // 思维链可见性控制（默认为 true，保持向后兼容）
  showThinkingChain,
  
  // 工具链可见性控制（默认为 true，保持向后兼容）
  showToolChain,
  
  // 飞书平台特定可见性控制
  feishu: {
    showThinkingChain: parseOptionalBooleanEnv(process.env.FEISHU_SHOW_THINKING_CHAIN) ?? showThinkingChain,
    showToolChain: parseOptionalBooleanEnv(process.env.FEISHU_SHOW_TOOL_CHAIN) ?? showToolChain,
  },
  
  // Discord 平台特定可见性控制
  discord: {
    showThinkingChain: parseOptionalBooleanEnv(process.env.DISCORD_SHOW_THINKING_CHAIN) ?? showThinkingChain,
    showToolChain: parseOptionalBooleanEnv(process.env.DISCORD_SHOW_TOOL_CHAIN) ?? showToolChain,
  },
};
// 附件配置
export const attachmentConfig = {
  maxSize: parseInt(process.env.ATTACHMENT_MAX_SIZE || String(50 * 1024 * 1024), 10),
};

function parseProjectAliases(value: string | undefined): Record<string, string> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const result = Object.create(null) as Record<string, string>;
    for (const [key, item] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof item === 'string' && item.trim()) {
        // 过滤原型污染 key
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          continue;
        }
        result[key] = item.trim();
      }
    }
    return result;
  } catch (error) {
    console.warn('[Config] PROJECT_ALIASES 解析失败:', error);
    return {};
  }
}

// 目录配置
export const directoryConfig = {
  allowedDirectories: (process.env.ALLOWED_DIRECTORIES || '')
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0),
  defaultWorkDirectory: process.env.DEFAULT_WORK_DIRECTORY?.trim() || undefined,
  projectAliases: parseProjectAliases(process.env.PROJECT_ALIASES),
  gitRootNormalization: parseBooleanEnv(process.env.GIT_ROOT_NORMALIZATION, true),
  maxPathLength: 500,
  get isAllowlistEnforced() {
    return this.allowedDirectories.length > 0;
  },
};

// 可靠性配置
export const reliabilityConfig = {
  // 心跳间隔 (毫秒)，默认 30 分钟
  heartbeatIntervalMs: (() => {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_HEARTBEAT_INTERVAL_MS, -1);
    return parsed > 0 ? parsed : 1800000;
  })(),

  // 失败阈值，默认 3
  failureThreshold: (() => {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_FAILURE_THRESHOLD, -1);
    return parsed > 0 ? parsed : 3;
  })(),

  // 窗口大小 (毫秒)，默认 90 秒
  windowMs: (() => {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_WINDOW_MS, -1);
    return parsed > 0 ? parsed : 90000;
  })(),

  // 冷却窗口 (毫秒)，默认 5 分钟
  cooldownMs: (() => {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_COOLDOWN_MS, -1);
    return parsed > 0 ? parsed : 300000;
  })(),

  // 修复预算，默认 3
  repairBudget: (() => {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_REPAIR_BUDGET, -1);
    return parsed > 0 ? parsed : 3;
  })(),

  // 模式：observe | shadow | active，默认 observe
  mode: (() => {
    const value = process.env.RELIABILITY_MODE?.trim().toLowerCase();
    if (value === 'observe' || value === 'shadow' || value === 'active') {
      return value as 'observe' | 'shadow' | 'active';
    }
    return 'observe';
  })(),

  // 仅本地自动救援，默认 true
  loopbackOnly: parseBooleanEnv(process.env.RELIABILITY_LOOPBACK_ONLY, true),
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
