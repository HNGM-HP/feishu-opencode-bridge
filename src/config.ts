/**
 * config.ts
 *
 * 配置加载层（SQLite 优先，首次自动迁移 .env）
 *
 * 启动逻辑：
 * 1. configStore.isMigrated() == false && .env 存在 → 解析 .env → 写入 SQLite → 标记迁移 → 重命名 .env.backup
 * 2. configStore.isMigrated() == true              → 直接从 SQLite 读取
 * 3. 两种路径最终都把 KV 注入 process.env，确保下游代码零改动
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { configStore, type BridgeSettings } from './store/config-store.js';

// ──────────────────────────────────────────────
// Admin 面板专用 .env（仅含 ADMIN_PORT / ADMIN_PASSWORD）
// ──────────────────────────────────────────────
const explicitEnvFile = process.env.OPENCODE_BRIDGE_ENV_FILE?.trim();
const explicitConfigDir = process.env.OPENCODE_BRIDGE_CONFIG_DIR?.trim();
const cwdEnvFile = path.join(process.cwd(), '.env');
const defaultConfigDir = path.join(os.homedir(), '.config', 'opencode-bridge');
const defaultEnvFile = path.join(defaultConfigDir, '.env');

const resolvedEnvFile = (() => {
  if (explicitEnvFile) {
    const f = path.resolve(explicitEnvFile);
    return fs.existsSync(f) ? f : undefined;
  }
  if (explicitConfigDir) {
    const f = path.join(path.resolve(explicitConfigDir), '.env');
    return fs.existsSync(f) ? f : undefined;
  }
  if (fs.existsSync(cwdEnvFile)) return cwdEnvFile;
  if (fs.existsSync(defaultEnvFile)) return defaultEnvFile;
  return undefined;
})();


// 自动为首次通过 npm run dev 启动的用户生成必要的安全配置文件
if (!resolvedEnvFile) {
  const generatedEnvFile = path.resolve(process.cwd(), '.env');
  const pureEnvContent = `ADMIN_PORT=4098\nADMIN_PASSWORD=${crypto.randomBytes(8).toString('hex')}\n`;
  fs.writeFileSync(generatedEnvFile, pureEnvContent, 'utf-8');
  console.log('[Config] 🔑 检测到无 .env 文件，已自动生成默认包含 ADMIN_PORT=4098 与高强度口令的 .env 文件。');
  dotenv.config({ path: generatedEnvFile });
  process.env.OPENCODE_BRIDGE_ACTIVE_ENV_FILE = generatedEnvFile;
} else {
  dotenv.config({ path: resolvedEnvFile });
  process.env.OPENCODE_BRIDGE_ACTIVE_ENV_FILE ??= resolvedEnvFile;
}


// ──────────────────────────────────────────────
// .env → SQLite 迁移（仅执行一次）
// ──────────────────────────────────────────────
if (!configStore.isMigrated() && resolvedEnvFile) {
  const envKeys: (keyof BridgeSettings)[] = [
    'FEISHU_ENABLED', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_ENCRYPT_KEY', 'FEISHU_VERIFICATION_TOKEN',
    'ALLOWED_USERS', 'ENABLED_PLATFORMS',
    'DISCORD_ENABLED', 'DISCORD_TOKEN', 'DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_ALLOWED_BOT_IDS',
    'WECOM_ENABLED', 'WECOM_BOT_ID', 'WECOM_SECRET',
    'TELEGRAM_ENABLED', 'TELEGRAM_BOT_TOKEN',
    'QQ_ENABLED', 'QQ_PROTOCOL', 'QQ_ONEBOT_HTTP_URL', 'QQ_ONEBOT_WS_URL',
    'QQ_APP_ID', 'QQ_SECRET', 'QQ_CALLBACK_URL', 'QQ_ENCRYPT_KEY',
    'WHATSAPP_ENABLED', 'WHATSAPP_MODE', 'WHATSAPP_SESSION_PATH',
    'WHATSAPP_BUSINESS_PHONE_ID', 'WHATSAPP_BUSINESS_ACCESS_TOKEN', 'WHATSAPP_BUSINESS_WEBHOOK_VERIFY_TOKEN',
    'OPENCODE_HOST', 'OPENCODE_PORT', 'OPENCODE_AUTO_START', 'OPENCODE_AUTO_START_CMD',
    'OPENCODE_SERVER_USERNAME', 'OPENCODE_SERVER_PASSWORD', 'OPENCODE_CONFIG_FILE',
    'RELIABILITY_CRON_ENABLED', 'RELIABILITY_CRON_API_ENABLED', 'RELIABILITY_CRON_API_HOST',
    'RELIABILITY_CRON_API_PORT', 'RELIABILITY_CRON_API_TOKEN', 'RELIABILITY_CRON_JOBS_FILE',
    'RELIABILITY_CRON_ORPHAN_AUTO_CLEANUP', 'RELIABILITY_CRON_FORWARD_TO_PRIVATE',
    'RELIABILITY_CRON_FALLBACK_FEISHU_CHAT_ID', 'RELIABILITY_CRON_FALLBACK_DISCORD_CONVERSATION_ID',
    'RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED', 'RELIABILITY_INBOUND_HEARTBEAT_ENABLED',
    'RELIABILITY_HEARTBEAT_INTERVAL_MS', 'RELIABILITY_HEARTBEAT_AGENT',
    'RELIABILITY_HEARTBEAT_PROMPT', 'RELIABILITY_HEARTBEAT_ALERT_CHATS',
    'RELIABILITY_FAILURE_THRESHOLD', 'RELIABILITY_WINDOW_MS', 'RELIABILITY_COOLDOWN_MS',
    'RELIABILITY_REPAIR_BUDGET', 'RELIABILITY_MODE', 'RELIABILITY_LOOPBACK_ONLY',
    'GROUP_REQUIRE_MENTION', 'GROUP_REPLY_REQUIRE_MENTION',
    'SHOW_THINKING_CHAIN', 'SHOW_TOOL_CHAIN',
    'FEISHU_SHOW_THINKING_CHAIN', 'FEISHU_SHOW_TOOL_CHAIN',
    'DISCORD_SHOW_THINKING_CHAIN', 'DISCORD_SHOW_TOOL_CHAIN',
    'ALLOWED_DIRECTORIES', 'DEFAULT_WORK_DIRECTORY', 'PROJECT_ALIASES', 'GIT_ROOT_NORMALIZATION',
    'TOOL_WHITELIST', 'PERMISSION_REQUEST_TIMEOUT_MS',
    'OUTPUT_UPDATE_INTERVAL', 'MAX_DELAYED_RESPONSE_WAIT_MS',
    'ENABLE_MANUAL_SESSION_BIND', 'ROUTER_MODE',
    'ATTACHMENT_MAX_SIZE', 'DEFAULT_PROVIDER', 'DEFAULT_MODEL',
  ];

  const migrated: BridgeSettings = {};
  let backupParsed: Record<string, string> = {};
  const backupPath = `${resolvedEnvFile}.backup`;
  if (fs.existsSync(backupPath)) {
    const content = fs.readFileSync(backupPath, 'utf-8');
    backupParsed = dotenv.parse(content);
  }

  for (const key of envKeys) {
    const val = backupParsed[key] ?? process.env[key];
    if (val !== undefined && val.trim() !== '') {
      (migrated as Record<string, string>)[key] = val.trim();
    }
  }

  configStore.set(migrated);
  configStore.markMigrated();

  console.log(`[Config] ✅ 配置已自动迁移至 SQLite: ${configStore.getDbPath()}`);
  console.log(`[Config] 原 .env 已由部署脚本备份至: ${backupPath}`);
  console.log(`[Config] 请通过浏览器访问可视化管理面板以查看或修改完整的配置参数。`);
}

// ──────────────────────────────────────────────
// 从 SQLite 读取配置并注入 process.env
// ──────────────────────────────────────────────
const dbSettings = configStore.get();
for (const [key, value] of Object.entries(dbSettings)) {
  if (value !== undefined && value !== '' && process.env[key] === undefined) {
    process.env[key] = String(value);
  }
}

// ──────────────────────────────────────────────
// 以下解析逻辑保持原样（下游零改动）
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

// 路由器模式配置
export const routerConfig = {
  mode: (() => {
    const value = process.env.ROUTER_MODE?.trim().toLowerCase();
    if (value === 'legacy' || value === 'dual' || value === 'router') {
      return value as 'legacy' | 'dual' | 'router';
    }
    return 'legacy';
  })(),

  enabledPlatforms: (() => {
    const value = process.env.ENABLED_PLATFORMS;
    if (!value) return [];
    return value
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(item => item.length > 0);
  })(),

  isPlatformEnabled(platformId: string): boolean {
    if (this.enabledPlatforms.length === 0) return true;
    return this.enabledPlatforms.includes(platformId.toLowerCase());
  },
};

// 飞书配置
export const feishuConfig = {
  enabled: parseBooleanEnv(process.env.FEISHU_ENABLED, true), // 默认启用
  appId: process.env.FEISHU_APP_ID || '',
  appSecret: process.env.FEISHU_APP_SECRET || '',
  encryptKey: process.env.FEISHU_ENCRYPT_KEY,
  verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
};

// Discord配置
export const discordConfig = {
  enabled: parseBooleanEnv(process.env.DISCORD_ENABLED, false),
  token: process.env.DISCORD_TOKEN?.trim() || process.env.DISCORD_BOT_TOKEN?.trim() || '',
  clientId: process.env.DISCORD_CLIENT_ID?.trim() || '',
  allowedBotIds: (() => {
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
  })(),
};

// 企业微信配置
export const wecomConfig = {
  enabled: parseBooleanEnv(process.env.WECOM_ENABLED, false),
  botId: process.env.WECOM_BOT_ID?.trim() || '',
  secret: process.env.WECOM_SECRET?.trim() || '',
};

// Telegram 配置
export const telegramConfig = {
  enabled: parseBooleanEnv(process.env.TELEGRAM_ENABLED, false),
  botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || '',
};

// QQ 配置 (支持官方 API 和 OneBot 双协议)
export const qqConfig = {
  enabled: parseBooleanEnv(process.env.QQ_ENABLED, false),
  // 协议类型: 'official' (QQ官方频道机器人) 或 'onebot' (NapCat/go-cqhttp)
  protocol: (process.env.QQ_PROTOCOL?.trim().toLowerCase() || 'onebot') as 'official' | 'onebot',
  // OneBot 协议配置
  onebotWsUrl: process.env.QQ_ONEBOT_WS_URL?.trim() || undefined,
  onebotHttpUrl: process.env.QQ_ONEBOT_HTTP_URL?.trim() || undefined,
  // QQ 官方 API 配置
  appId: process.env.QQ_APP_ID?.trim() || undefined,
  secret: process.env.QQ_SECRET?.trim() || undefined,
  callbackUrl: process.env.QQ_CALLBACK_URL?.trim() || undefined,
  encryptKey: process.env.QQ_ENCRYPT_KEY?.trim() || undefined,
};

// WhatsApp 配置
export const whatsappConfig = {
  enabled: parseBooleanEnv(process.env.WHATSAPP_ENABLED, false),
  mode: (process.env.WHATSAPP_MODE?.trim().toLowerCase() || 'personal') as 'personal' | 'business',
  sessionPath: process.env.WHATSAPP_SESSION_PATH?.trim() || undefined,
  // Business API 配置
  businessPhoneId: process.env.WHATSAPP_BUSINESS_PHONE_ID?.trim() || undefined,
  businessAccessToken: process.env.WHATSAPP_BUSINESS_ACCESS_TOKEN?.trim() || undefined,
  businessWebhookVerifyToken: process.env.WHATSAPP_BUSINESS_WEBHOOK_VERIFY_TOKEN?.trim() || undefined,
};

// 群聊消息触发策略
export const groupConfig = {
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
  autoStart: parseBooleanEnv(process.env.OPENCODE_AUTO_START, false),
  autoStartCmd: process.env.OPENCODE_AUTO_START_CMD?.trim() || 'opencode serve',
  get baseUrl() {
    return `http://${this.host}:${this.port}`;
  },
};

// 用户配置
export const userConfig = {
  allowedUsers: (process.env.ALLOWED_USERS || '')
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0),
  enableManualSessionBind: parseBooleanEnv(process.env.ENABLE_MANUAL_SESSION_BIND, true),
  get isWhitelistEnabled() {
    return this.allowedUsers.length > 0;
  },
};

// 模型配置（动态读取，支持运行时更新）
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

// 权限配置
export const permissionConfig = {
  toolWhitelist: (process.env.TOOL_WHITELIST || 'Read,Glob,Grep,Task').split(',').filter(Boolean),
  requestTimeout: parseNonNegativeIntEnv(process.env.PERMISSION_REQUEST_TIMEOUT_MS, 0),
};

// 输出配置
const showThinkingChain = parseBooleanEnv(process.env.SHOW_THINKING_CHAIN, true);
const showToolChain = parseBooleanEnv(process.env.SHOW_TOOL_CHAIN, true);

export const outputConfig = {
  updateInterval: parseInt(process.env.OUTPUT_UPDATE_INTERVAL || '3000', 10),
  maxMessageLength: 4000,
  showThinkingChain,
  showToolChain,
  feishu: {
    showThinkingChain: parseOptionalBooleanEnv(process.env.FEISHU_SHOW_THINKING_CHAIN) ?? showThinkingChain,
    showToolChain: parseOptionalBooleanEnv(process.env.FEISHU_SHOW_TOOL_CHAIN) ?? showToolChain,
  },
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
  cronEnabled: parseBooleanEnv(process.env.RELIABILITY_CRON_ENABLED, true),
  cronApiEnabled: parseBooleanEnv(process.env.RELIABILITY_CRON_API_ENABLED, false),
  cronApiHost: process.env.RELIABILITY_CRON_API_HOST?.trim() || '127.0.0.1',
  cronApiPort: (() => {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_CRON_API_PORT, -1);
    return parsed > 0 ? parsed : 4097;
  })(),
  cronApiToken: process.env.RELIABILITY_CRON_API_TOKEN?.trim() || undefined,
  cronJobsFile: process.env.RELIABILITY_CRON_JOBS_FILE?.trim() || undefined,
  cronOrphanAutoCleanup: parseBooleanEnv(process.env.RELIABILITY_CRON_ORPHAN_AUTO_CLEANUP, false),
  cronForwardToPrivateChat: parseBooleanEnv(process.env.RELIABILITY_CRON_FORWARD_TO_PRIVATE, false),
  cronFallbackFeishuChatId: process.env.RELIABILITY_CRON_FALLBACK_FEISHU_CHAT_ID?.trim() || undefined,
  cronFallbackDiscordConversationId: process.env.RELIABILITY_CRON_FALLBACK_DISCORD_CONVERSATION_ID?.trim() || undefined,
  proactiveHeartbeatEnabled: parseBooleanEnv(process.env.RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED, false),
  inboundHeartbeatEnabled: parseBooleanEnv(process.env.RELIABILITY_INBOUND_HEARTBEAT_ENABLED, false),
  heartbeatIntervalMs: (() => {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_HEARTBEAT_INTERVAL_MS, -1);
    return parsed > 0 ? parsed : 1800000;
  })(),
  heartbeatAgent: process.env.RELIABILITY_HEARTBEAT_AGENT?.trim() || undefined,
  heartbeatPrompt: process.env.RELIABILITY_HEARTBEAT_PROMPT?.trim() || undefined,
  heartbeatAlertChats: (process.env.RELIABILITY_HEARTBEAT_ALERT_CHATS || '')
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0),
  failureThreshold: (() => {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_FAILURE_THRESHOLD, -1);
    return parsed > 0 ? parsed : 3;
  })(),
  windowMs: (() => {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_WINDOW_MS, -1);
    return parsed > 0 ? parsed : 90000;
  })(),
  cooldownMs: (() => {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_COOLDOWN_MS, -1);
    return parsed > 0 ? parsed : 300000;
  })(),
  repairBudget: (() => {
    const parsed = parseNonNegativeIntEnv(process.env.RELIABILITY_REPAIR_BUDGET, -1);
    return parsed > 0 ? parsed : 3;
  })(),
  mode: (() => {
    const value = process.env.RELIABILITY_MODE?.trim().toLowerCase();
    if (value === 'observe' || value === 'shadow' || value === 'active') {
      return value as 'observe' | 'shadow' | 'active';
    }
    return 'observe';
  })(),
  loopbackOnly: parseBooleanEnv(process.env.RELIABILITY_LOOPBACK_ONLY, true),
};

// 验证配置：至少有一个平台已配置
export function validateConfig(): void {
  const errors: string[] = [];

  // 检查各平台配置状态
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
  };

  // 至少一个平台配置完成即可
  const hasAnyPlatform = Object.values(platformStatus).some(Boolean);

  if (!hasAnyPlatform) {
    errors.push('至少需要配置一个平台:');
    if (!platformStatus.feishu) {
      if (!feishuConfig.enabled) {
        errors.push('  - 飞书: 已禁用 (FEISHU_ENABLED=false)');
      } else {
        errors.push('  - 飞书: 缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET');
      }
    }
    if (!platformStatus.discord) {
      errors.push('  - Discord: 需设置 DISCORD_ENABLED=true 并配置 DISCORD_TOKEN');
    }
    if (!platformStatus.wecom) {
      if (!wecomConfig.enabled) {
        errors.push('  - 企业微信：已禁用 (WECOM_ENABLED=false)');
      } else {
        errors.push('  - 企业微信：缺少 WECOM_BOT_ID 或 WECOM_SECRET');
      }
    }
    if (!platformStatus.telegram) {
      if (!telegramConfig.enabled) {
        errors.push('  - Telegram: 已禁用 (TELEGRAM_ENABLED=false)');
      } else {
        errors.push('  - Telegram: 缺少 TELEGRAM_BOT_TOKEN');
      }
    }
    if (!platformStatus.qq) {
      if (!qqConfig.enabled) {
        errors.push('  - QQ: 已禁用 (QQ_ENABLED=false)');
      } else if (qqConfig.protocol === 'official') {
        errors.push('  - QQ官方API: 缺少 QQ_APP_ID 或 QQ_SECRET');
      } else {
        errors.push('  - QQ OneBot: 缺少 QQ_ONEBOT_WS_URL 或 QQ_ONEBOT_HTTP_URL');
      }
    }
    if (!platformStatus.whatsapp) {
      if (!whatsappConfig.enabled) {
        errors.push('  - WhatsApp: 已禁用 (WHATSAPP_ENABLED=false)');
      } else if (whatsappConfig.mode === 'business') {
        errors.push('  - WhatsApp Business: 缺少 WHATSAPP_BUSINESS_PHONE_ID 或 WHATSAPP_BUSINESS_ACCESS_TOKEN');
      } else {
        errors.push('  - WhatsApp: 配置不完整');
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`配置错误:\n${errors.join('\n')}`);
  }
}

// 检查平台是否已配置（用于启动判断）
export function isPlatformConfigured(platform: 'feishu' | 'discord' | 'wecom' | 'telegram' | 'qq' | 'whatsapp'): boolean {
  if (platform === 'feishu') {
    return !!(feishuConfig.enabled && feishuConfig.appId && feishuConfig.appSecret);
  }
  if (platform === 'discord') {
    return !!(discordConfig.enabled && discordConfig.token);
  }
  if (platform === 'wecom') {
    return !!(wecomConfig.enabled && wecomConfig.botId && wecomConfig.secret);
  }
  if (platform === 'telegram') {
    return !!(telegramConfig.enabled && telegramConfig.botToken);
  }
  if (platform === 'qq') {
    if (!qqConfig.enabled) return false;
    if (qqConfig.protocol === 'official') {
      return !!(qqConfig.appId && qqConfig.secret);
    }
    return !!(qqConfig.onebotWsUrl || qqConfig.onebotHttpUrl);
  }
  if (platform === 'whatsapp') {
    if (!whatsappConfig.enabled) return false;
    if (whatsappConfig.mode === 'personal') return true;
    return !!(whatsappConfig.businessPhoneId && whatsappConfig.businessAccessToken);
  }
  return false;
}
