/**
 * config.ts
 *
 * 配置入口文件
 *
 * 启动逻辑：
 * 1. configStore.isMigrated() == false && .env 存在 → 解析 .env → 写入 SQLite → 标记迁移 → 重命名 .env.backup
 * 2. configStore.isMigrated() == true              → 直接从 SQLite 读取
 * 3. 两种路径最终都把 KV 注入 process.env，确保下游代码零改动
 */

// 导入拆分后的模块
import { loadEnvFile } from './config/env-loader.js';
import { runMigration, injectFromDatabase } from './config/migrator.js';

// 步骤 1：加载环境变量文件
loadEnvFile();

// 步骤 2：执行配置迁移（仅首次）
runMigration();

// 步骤 3：从 SQLite 注入配置到 process.env
injectFromDatabase();

// 重新导出所有配置（保持向后兼容）
export {
  routerConfig,
  feishuConfig,
  discordConfig,
  wecomConfig,
  telegramConfig,
  qqConfig,
  whatsappConfig,
  groupConfig,
  opencodeConfig,
  userConfig,
  modelConfig,
  permissionConfig,
  outputConfig,
  attachmentConfig,
  directoryConfig,
  reliabilityConfig,
  validateConfig,
  isPlatformConfigured,
} from './config/platform.js';