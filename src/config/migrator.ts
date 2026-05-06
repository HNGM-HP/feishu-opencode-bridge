/**
 * migrator.ts
 *
 * 配置迁移器
 * 负责 .env → SQLite 的一次性迁移
 */

import fs from 'node:fs';
import dotenv from 'dotenv';
import { configStore, type BridgeSettings } from '../store/config-store.js';
import { resolvedEnvFile } from './env-loader.js';

/**
 * 需要从 .env 迁移的配置键
 */
const MIGRATABLE_KEYS: (keyof BridgeSettings)[] = [
  'FEISHU_ENABLED', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_ENCRYPT_KEY', 'FEISHU_VERIFICATION_TOKEN',
  'ALLOWED_USERS', 'ENABLED_PLATFORMS',
  'DISCORD_ENABLED', 'DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_ALLOWED_BOT_IDS',
  'WECOM_ENABLED', 'WECOM_BOT_ID', 'WECOM_SECRET',
  'TELEGRAM_ENABLED', 'TELEGRAM_BOT_TOKEN',
  'QQ_ENABLED', 'QQ_PROTOCOL', 'QQ_ONEBOT_HTTP_URL', 'QQ_ONEBOT_WS_URL',
  'QQ_APP_ID', 'QQ_SECRET', 'QQ_CALLBACK_URL', 'QQ_ENCRYPT_KEY',
  'WHATSAPP_ENABLED', 'WHATSAPP_MODE', 'WHATSAPP_SESSION_PATH',
  'WHATSAPP_BUSINESS_PHONE_ID', 'WHATSAPP_BUSINESS_ACCESS_TOKEN', 'WHATSAPP_BUSINESS_WEBHOOK_VERIFY_TOKEN',
  'WEIXIN_ENABLED', 'DINGTALK_ENABLED',
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
  'WECOM_SHOW_THINKING_CHAIN', 'WECOM_SHOW_TOOL_CHAIN',
  'TELEGRAM_SHOW_THINKING_CHAIN', 'TELEGRAM_SHOW_TOOL_CHAIN',
  'QQ_SHOW_THINKING_CHAIN', 'QQ_SHOW_TOOL_CHAIN',
  'WHATSAPP_SHOW_THINKING_CHAIN', 'WHATSAPP_SHOW_TOOL_CHAIN',
  'WEIXIN_SHOW_THINKING_CHAIN', 'WEIXIN_SHOW_TOOL_CHAIN',
  'DINGTALK_SHOW_THINKING_CHAIN', 'DINGTALK_SHOW_TOOL_CHAIN',
  'ALLOWED_DIRECTORIES', 'DEFAULT_WORK_DIRECTORY', 'PROJECT_ALIASES', 'GIT_ROOT_NORMALIZATION',
  'TOOL_WHITELIST', 'PERMISSION_REQUEST_TIMEOUT_MS',
  'OUTPUT_UPDATE_INTERVAL', 'MAX_DELAYED_RESPONSE_WAIT_MS',
  'ENABLE_MANUAL_SESSION_BIND', 'ROUTER_MODE',
  'ATTACHMENT_MAX_SIZE', 'DEFAULT_PROVIDER', 'DEFAULT_MODEL',
  'IMAGE_VISION_PREPROCESS', 'VISION_OCR_MODEL', 'VISION_OCR_PROMPT',
];

/**
 * 执行配置迁移（仅首次运行时执行）
 */
export function runMigration(): void {
  if (configStore.isMigrated() || !resolvedEnvFile) {
    return;
  }

  const migrated: BridgeSettings = {};
  let backupParsed: Record<string, string> = {};
  const backupPath = `${resolvedEnvFile}.backup`;

  if (fs.existsSync(backupPath)) {
    const content = fs.readFileSync(backupPath, 'utf-8');
    backupParsed = dotenv.parse(content);
  }

  for (const key of MIGRATABLE_KEYS) {
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

/**
 * 从 SQLite 读取配置并注入 process.env
 */
export function injectFromDatabase(): void {
  const dbSettings = configStore.get();
  for (const [key, value] of Object.entries(dbSettings)) {
    if (value !== undefined && value !== '' && process.env[key] === undefined) {
      process.env[key] = String(value);
    }
  }
}