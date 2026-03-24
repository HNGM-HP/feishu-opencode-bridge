/**
 * 平台配置模块
 *
 * 集中管理所有平台的配置解析和验证
 *
 * 注意：配置对象使用 getter 延迟读取 process.env，
 * 确保 dotenv 初始化后才能获取正确的值。
 */

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

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

  normalized = normalized
    .replace(/\s+#.*$/, '')
    .replace(/\s+\/\/.*$/, '')
    .trim();

  if (!normalized) return undefined;

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

// ──────────────────────────────────────────────
// 路由器配置
// ──────────────────────────────────────────────

export const routerConfig = {
  get mode() {
    const value = process.env.ROUTER_MODE?.trim().toLowerCase();
    if (value === 'legacy' || value === 'dual' || value === 'router') {
      return value as 'legacy' | 'dual' | 'router';
    }
    return 'legacy';
  },

  get enabledPlatforms() {
    const value = process.env.ENABLED_PLATFORMS;
    if (!value) return [];
    return value
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(item => item.length > 0);
  },

  isPlatformEnabled(platformId: string): boolean {
    if (this.enabledPlatforms.length === 0) return true;
    return this.enabledPlatforms.includes(platformId.toLowerCase());
  },
};

// ──────────────────────────────────────────────
// 平台配置
// ──────────────────────────────────────────────

export const feishuConfig = {
  get enabled() { return parseBooleanEnv(process.env.FEISHU_ENABLED, false); },
  get appId() { return process.env.FEISHU_APP_ID || ''; },
  get appSecret() { return process.env.FEISHU_APP_SECRET || ''; },
  get encryptKey() { return process.env.FEISHU_ENCRYPT_KEY; },
  get verificationToken() { return process.env.FEISHU_VERIFICATION_TOKEN; },
};

export const discordConfig = {
  get enabled() { return parseBooleanEnv(process.env.DISCORD_ENABLED, false); },
  get token() { return process.env.DISCORD_TOKEN?.trim() || ''; },
  get clientId() { return process.env.DISCORD_CLIENT_ID?.trim() || ''; },
  get allowedBotIds() {
    const raw = process.env.DISCORD_ALLOWED_BOT_IDS || '';
    return raw
      .split(',')
      .map(item => item.trim())
      .filter(item => {
        if (!item) return false;
        if (!/^\d+$/.test(item)) {
          console.warn(`[Config] 无效的 Bot ID "${item}" 已被跳过（需为纯数字）`);
          return false;
        }
        return true;
      });
  },
};

export const wecomConfig = {
  get enabled() { return parseBooleanEnv(process.env.WECOM_ENABLED, false); },
  get botId() { return process.env.WECOM_BOT_ID?.trim() || ''; },
  get secret() { return process.env.WECOM_SECRET?.trim() || ''; },
};

export const telegramConfig = {
  get enabled() { return parseBooleanEnv(process.env.TELEGRAM_ENABLED, false); },
  get botToken() { return process.env.TELEGRAM_BOT_TOKEN?.trim() || ''; },
};

export const qqConfig = {
  get enabled() { return parseBooleanEnv(process.env.QQ_ENABLED, false); },
  get protocol() { return (process.env.QQ_PROTOCOL?.trim().toLowerCase() || 'onebot') as 'official' | 'onebot'; },
  get onebotWsUrl() { return process.env.QQ_ONEBOT_WS_URL?.trim() || undefined; },
  get onebotHttpUrl() { return process.env.QQ_ONEBOT_HTTP_URL?.trim() || undefined; },
  get appId() { return process.env.QQ_APP_ID?.trim() || undefined; },
  get secret() { return process.env.QQ_SECRET?.trim() || undefined; },
};

export const whatsappConfig = {
  get enabled() { return parseBooleanEnv(process.env.WHATSAPP_ENABLED, false); },
  get mode() { return (process.env.WHATSAPP_MODE?.trim().toLowerCase() || 'personal') as 'personal' | 'business'; },
  get sessionPath() { return process.env.WHATSAPP_SESSION_PATH?.trim() || undefined; },
  get businessPhoneId() { return process.env.WHATSAPP_BUSINESS_PHONE_ID?.trim() || undefined; },
  get businessAccessToken() { return process.env.WHATSAPP_BUSINESS_ACCESS_TOKEN?.trim() || undefined; },
  get businessWebhookVerifyToken() { return process.env.WHATSAPP_BUSINESS_WEBHOOK_VERIFY_TOKEN?.trim() || undefined; },
};

export const dingtalkConfig = {
  get enabled() { return parseBooleanEnv(process.env.DINGTALK_ENABLED, false); },
};

// ──────────────────────────────────────────────
// 其他配置
// ──────────────────────────────────────────────

export const groupConfig = {
  get requireMentionInGroup() {
    return parseBooleanEnv(
      process.env.GROUP_REQUIRE_MENTION ?? process.env.GROUP_REPLY_REQUIRE_MENTION,
      false
    );
  },
};

export const opencodeConfig = {
  get host() { return process.env.OPENCODE_HOST || 'localhost'; },
  get port() { return parseInt(process.env.OPENCODE_PORT || '4096', 10); },
  get serverUsername() { return process.env.OPENCODE_SERVER_USERNAME?.trim() || 'opencode'; },
  get serverPassword() { return process.env.OPENCODE_SERVER_PASSWORD?.trim() || undefined; },
  get autoStart() { return parseBooleanEnv(process.env.OPENCODE_AUTO_START, false); },
  get autoStartCmd() { return process.env.OPENCODE_AUTO_START_CMD?.trim() || 'opencode serve'; },
  get baseUrl() {
    return `http://${this.host}:${this.port}`;
  },
};

export const userConfig = {
  get allowedUsers() {
    return (process.env.ALLOWED_USERS || '')
      .split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0);
  },
  get enableManualSessionBind() { return parseBooleanEnv(process.env.ENABLE_MANUAL_SESSION_BIND, true); },
  get isWhitelistEnabled() {
    return this.allowedUsers.length > 0;
  },
};

export const modelConfig = {
  get defaultProvider(): string | undefined {
    const provider = process.env.DEFAULT_PROVIDER?.trim();
    const model = process.env.DEFAULT_MODEL?.trim();
    return provider && model ? provider : undefined;
  },
  get defaultModel(): string | undefined {
    const provider = process.env.DEFAULT_PROVIDER?.trim();
    const model = process.env.DEFAULT_MODEL?.trim();
    return provider && model ? model : undefined;
  },
};

export const permissionConfig = {
  get toolWhitelist() { return (process.env.TOOL_WHITELIST || 'Read,Glob,Grep,Task').split(',').filter(Boolean); },
  get requestTimeout() { return parseNonNegativeIntEnv(process.env.PERMISSION_REQUEST_TIMEOUT_MS, 0); },
};

// 输出配置
const getShowThinkingChain = () => parseBooleanEnv(process.env.SHOW_THINKING_CHAIN, true);
const getShowToolChain = () => parseBooleanEnv(process.env.SHOW_TOOL_CHAIN, true);

export const outputConfig = {
  get updateInterval() { return parseInt(process.env.OUTPUT_UPDATE_INTERVAL || '3000', 10); },
  maxMessageLength: 4000,
  get showThinkingChain() { return getShowThinkingChain(); },
  get showToolChain() { return getShowToolChain(); },
  get feishu() {
    const showThinkingChain = getShowThinkingChain();
    const showToolChain = getShowToolChain();
    return {
      get showThinkingChain() { return parseOptionalBooleanEnv(process.env.FEISHU_SHOW_THINKING_CHAIN) ?? showThinkingChain; },
      get showToolChain() { return parseOptionalBooleanEnv(process.env.FEISHU_SHOW_TOOL_CHAIN) ?? showToolChain; },
    };
  },
  get discord() {
    const showThinkingChain = getShowThinkingChain();
    const showToolChain = getShowToolChain();
    return {
      get showThinkingChain() { return parseOptionalBooleanEnv(process.env.DISCORD_SHOW_THINKING_CHAIN) ?? showThinkingChain; },
      get showToolChain() { return parseOptionalBooleanEnv(process.env.DISCORD_SHOW_TOOL_CHAIN) ?? showToolChain; },
    };
  },
  get wecom() {
    const showThinkingChain = getShowThinkingChain();
    const showToolChain = getShowToolChain();
    return {
      get showThinkingChain() { return parseOptionalBooleanEnv(process.env.WECOM_SHOW_THINKING_CHAIN) ?? showThinkingChain; },
      get showToolChain() { return parseOptionalBooleanEnv(process.env.WECOM_SHOW_TOOL_CHAIN) ?? showToolChain; },
    };
  },
  get telegram() {
    const showThinkingChain = getShowThinkingChain();
    const showToolChain = getShowToolChain();
    return {
      get showThinkingChain() { return parseOptionalBooleanEnv(process.env.TELEGRAM_SHOW_THINKING_CHAIN) ?? showThinkingChain; },
      get showToolChain() { return parseOptionalBooleanEnv(process.env.TELEGRAM_SHOW_TOOL_CHAIN) ?? showToolChain; },
    };
  },
  get qq() {
    const showThinkingChain = getShowThinkingChain();
    const showToolChain = getShowToolChain();
    return {
      get showThinkingChain() { return parseOptionalBooleanEnv(process.env.QQ_SHOW_THINKING_CHAIN) ?? showThinkingChain; },
      get showToolChain() { return parseOptionalBooleanEnv(process.env.QQ_SHOW_TOOL_CHAIN) ?? showToolChain; },
    };
  },
  get whatsapp() {
    const showThinkingChain = getShowThinkingChain();
    const showToolChain = getShowToolChain();
    return {
      get showThinkingChain() { return parseOptionalBooleanEnv(process.env.WHATSAPP_SHOW_THINKING_CHAIN) ?? showThinkingChain; },
      get showToolChain() { return parseOptionalBooleanEnv(process.env.WHATSAPP_SHOW_TOOL_CHAIN) ?? showToolChain; },
    };
  },
  get weixin() {
    const showThinkingChain = getShowThinkingChain();
    const showToolChain = getShowToolChain();
    return {
      get showThinkingChain() { return parseOptionalBooleanEnv(process.env.WEIXIN_SHOW_THINKING_CHAIN) ?? showThinkingChain; },
      get showToolChain() { return parseOptionalBooleanEnv(process.env.WEIXIN_SHOW_TOOL_CHAIN) ?? showToolChain; },
    };
  },
  get dingtalk() {
    const showThinkingChain = getShowThinkingChain();
    const showToolChain = getShowToolChain();
    return {
      get showThinkingChain() { return parseOptionalBooleanEnv(process.env.DINGTALK_SHOW_THINKING_CHAIN) ?? showThinkingChain; },
      get showToolChain() { return parseOptionalBooleanEnv(process.env.DINGTALK_SHOW_TOOL_CHAIN) ?? showToolChain; },
    };
  },
};

export const attachmentConfig = {
  get maxSize() { return parseInt(process.env.ATTACHMENT_MAX_SIZE || String(50 * 1024 * 1024), 10); },
};

function parseProjectAliases(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result = Object.create(null) as Record<string, string>;
    for (const [key, item] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof item === 'string' && item.trim()) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        result[key] = item.trim();
      }
    }
    return result;
  } catch (error) {
    console.warn('[Config] PROJECT_ALIASES 解析失败:', error);
    return {};
  }
}

export const directoryConfig = {
  get allowedDirectories() {
    return (process.env.ALLOWED_DIRECTORIES || '')
      .split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0);
  },
  get defaultWorkDirectory() { return process.env.DEFAULT_WORK_DIRECTORY?.trim() || undefined; },
  get projectAliases() { return parseProjectAliases(process.env.PROJECT_ALIASES); },
  get gitRootNormalization() { return parseBooleanEnv(process.env.GIT_ROOT_NORMALIZATION, true); },
  maxPathLength: 500,
  get isAllowlistEnforced() {
    return this.allowedDirectories.length > 0;
  },
};

export const reliabilityConfig = {
  get cronEnabled() { return parseBooleanEnv(process.env.RELIABILITY_CRON_ENABLED, true); },
  get cronApiEnabled() { return parseBooleanEnv(process.env.RELIABILITY_CRON_API_ENABLED, false); },
  get cronApiHost() { return process.env.RELIABILITY_CRON_API_HOST?.trim() || '127.0.0.1'; },
  get cronApiPort() {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_CRON_API_PORT, -1);
    return parsed > 0 ? parsed : 4097;
  },
  get cronApiToken() { return process.env.RELIABILITY_CRON_API_TOKEN?.trim() || undefined; },
  get cronJobsFile() { return process.env.RELIABILITY_CRON_JOBS_FILE?.trim() || undefined; },
  get cronOrphanAutoCleanup() { return parseBooleanEnv(process.env.RELIABILITY_CRON_ORPHAN_AUTO_CLEANUP, false); },
  get cronForwardToPrivateChat() { return parseBooleanEnv(process.env.RELIABILITY_CRON_FORWARD_TO_PRIVATE, false); },
  get cronFallbackFeishuChatId() { return process.env.RELIABILITY_CRON_FALLBACK_FEISHU_CHAT_ID?.trim() || undefined; },
  get cronFallbackDiscordConversationId() { return process.env.RELIABILITY_CRON_FALLBACK_DISCORD_CONVERSATION_ID?.trim() || undefined; },
  get proactiveHeartbeatEnabled() { return parseBooleanEnv(process.env.RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED, false); },
  get inboundHeartbeatEnabled() { return parseBooleanEnv(process.env.RELIABILITY_INBOUND_HEARTBEAT_ENABLED, false); },
  get heartbeatIntervalMs() {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_HEARTBEAT_INTERVAL_MS, -1);
    return parsed > 0 ? parsed : 1800000;
  },
  get heartbeatAgent() { return process.env.RELIABILITY_HEARTBEAT_AGENT?.trim() || undefined; },
  get heartbeatPrompt() { return process.env.RELIABILITY_HEARTBEAT_PROMPT?.trim() || undefined; },
  get heartbeatAlertChats() {
    return (process.env.RELIABILITY_HEARTBEAT_ALERT_CHATS || '')
      .split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0);
  },
  get failureThreshold() {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_FAILURE_THRESHOLD, -1);
    return parsed > 0 ? parsed : 3;
  },
  get windowMs() {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_WINDOW_MS, -1);
    return parsed > 0 ? parsed : 90000;
  },
  get cooldownMs() {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_COOLDOWN_MS, -1);
    return parsed > 0 ? parsed : 300000;
  },
  get repairBudget() {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_REPAIR_BUDGET, -1);
    return parsed > 0 ? parsed : 3;
  },
  get mode() {
    const value = process.env.RELIABILITY_MODE?.trim().toLowerCase();
    if (value === 'observe' || value === 'shadow' || value === 'active') {
      return value as 'observe' | 'shadow' | 'active';
    }
    return 'observe';
  },
  get loopbackOnly() { return parseBooleanEnv(process.env.RELIABILITY_LOOPBACK_ONLY, true); },
};

// ──────────────────────────────────────────────
// 验证函数
// ──────────────────────────────────────────────

export function validateConfig(): void {
  const errors: string[] = [];

  const platformStatus = {
    feishu: !!(feishuConfig.enabled && feishuConfig.appId && feishuConfig.appSecret),
    discord: !!(discordConfig.enabled && discordConfig.token),
    wecom: !!(wecomConfig.enabled && wecomConfig.botId && wecomConfig.secret),
    telegram: !!(telegramConfig.enabled && telegramConfig.botToken),
    qq: !!(qqConfig.enabled && (
      (qqConfig.protocol === 'onebot' && (qqConfig.onebotWsUrl || qqConfig.onebotHttpUrl)) ||
      (qqConfig.protocol === 'official' && qqConfig.appId && qqConfig.secret)
    )),
    whatsapp: !!(whatsappConfig.enabled && (
      (whatsappConfig.mode === 'personal') ||
      (whatsappConfig.mode === 'business' && whatsappConfig.businessPhoneId && whatsappConfig.businessAccessToken)
    )),
    dingtalk: !!(dingtalkConfig.enabled),
  };

  const hasAnyPlatform = Object.values(platformStatus).some(Boolean);

  if (!hasAnyPlatform) {
    errors.push('至少需要配置一个平台:');
    if (!platformStatus.feishu) {
      errors.push(feishuConfig.enabled
        ? '  - 飞书: 缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET'
        : '  - 飞书: 未启用');
    }
    if (!platformStatus.discord) {
      errors.push(discordConfig.enabled
        ? '  - Discord: 缺少 DISCORD_TOKEN'
        : '  - Discord: 未启用');
    }
    if (!platformStatus.wecom) {
      errors.push(wecomConfig.enabled
        ? '  - 企业微信: 缺少 WECOM_BOT_ID 或 WECOM_SECRET'
        : '  - 企业微信: 未启用');
    }
    if (!platformStatus.telegram) {
      errors.push(telegramConfig.enabled
        ? '  - Telegram: 缺少 TELEGRAM_BOT_TOKEN'
        : '  - Telegram: 未启用');
    }
    if (!platformStatus.qq) {
      if (!qqConfig.enabled) {
        errors.push('  - QQ: 未启用');
      } else if (qqConfig.protocol === 'official') {
        errors.push('  - QQ官方API: 缺少 QQ_APP_ID 或 QQ_SECRET');
      } else {
        errors.push('  - QQ OneBot: 缺少 QQ_ONEBOT_WS_URL 或 QQ_ONEBOT_HTTP_URL');
      }
    }
    if (!platformStatus.whatsapp) {
      if (!whatsappConfig.enabled) {
        errors.push('  - WhatsApp: 未启用');
      } else if (whatsappConfig.mode === 'business') {
        errors.push('  - WhatsApp Business: 缺少 WHATSAPP_BUSINESS_PHONE_ID 或 WHATSAPP_BUSINESS_ACCESS_TOKEN');
      } else {
        errors.push('  - WhatsApp: 配置不完整');
      }
    }
    if (!platformStatus.dingtalk) {
      errors.push('  - 钉钉: 未启用或未配置账号');
    }
  }

  if (errors.length > 0) {
    throw new Error(`配置错误:\n${errors.join('\n')}`);
  }
}

export function isPlatformConfigured(platform: 'feishu' | 'discord' | 'wecom' | 'telegram' | 'qq' | 'whatsapp' | 'dingtalk'): boolean {
  switch (platform) {
    case 'feishu':
      return !!(feishuConfig.enabled && feishuConfig.appId && feishuConfig.appSecret);
    case 'discord':
      return !!(discordConfig.enabled && discordConfig.token);
    case 'wecom':
      return !!(wecomConfig.enabled && wecomConfig.botId && wecomConfig.secret);
    case 'telegram':
      return !!(telegramConfig.enabled && telegramConfig.botToken);
    case 'qq':
      if (!qqConfig.enabled) return false;
      return qqConfig.protocol === 'official'
        ? !!(qqConfig.appId && qqConfig.secret)
        : !!(qqConfig.onebotWsUrl || qqConfig.onebotHttpUrl);
    case 'whatsapp':
      if (!whatsappConfig.enabled) return false;
      return whatsappConfig.mode === 'personal' ||
        !!(whatsappConfig.businessPhoneId && whatsappConfig.businessAccessToken);
    case 'dingtalk':
      return dingtalkConfig.enabled;
    default:
      return false;
  }
}