/**
 * env-loader.ts
 *
 * 环境变量文件加载器
 * 负责解析 .env 文件并将配置注入 process.env
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

// ──────────────────────────────────────────────
// 文件路径解析
// ──────────────────────────────────────────────
const explicitEnvFile = process.env.OPENCODE_BRIDGE_ENV_FILE?.trim();
const explicitConfigDir = process.env.OPENCODE_BRIDGE_CONFIG_DIR?.trim();
const cwdEnvFile = path.join(process.cwd(), '.env');
const defaultConfigDir = path.join(os.homedir(), '.config', 'opencode-bridge');
const defaultEnvFile = path.join(defaultConfigDir, '.env');

/**
 * 解析环境变量文件路径
 * 优先级：OPENCODE_BRIDGE_ENV_FILE > OPENCODE_BRIDGE_CONFIG_DIR > cwd/.env > ~/.config/opencode-bridge/.env
 */
export const resolvedEnvFile = (() => {
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

/**
 * 加载环境变量文件
 * 如果不存在则自动生成默认配置
 */
export function loadEnvFile(): string | undefined {
  if (!resolvedEnvFile) {
    const generatedEnvFile = path.resolve(process.cwd(), '.env');
    // 生成 16 字节（32 位十六进制）的高强度密码
    const pureEnvContent = `ADMIN_PORT=4098\nADMIN_PASSWORD=${crypto.randomBytes(16).toString('hex')}\n`;
    fs.writeFileSync(generatedEnvFile, pureEnvContent, 'utf-8');
    console.log('[Config] 🔑 检测到无 .env 文件，已自动生成默认包含 ADMIN_PORT=4098 与高强度口令的 .env 文件。');
    dotenv.config({ path: generatedEnvFile });
    process.env.OPENCODE_BRIDGE_ACTIVE_ENV_FILE = generatedEnvFile;
    return generatedEnvFile;
  }

  dotenv.config({ path: resolvedEnvFile });
  process.env.OPENCODE_BRIDGE_ACTIVE_ENV_FILE ??= resolvedEnvFile;
  return resolvedEnvFile;
}