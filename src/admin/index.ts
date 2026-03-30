/**
 * Admin 独立进程入口
 *
 * 职责：
 * 1. 托管 Web 管理面板
 * 2. 在内嵌模式下运行 Bridge 逻辑（进程合并，节省内存）
 * 3. 提供 OpenCode 安装/管理 API
 * 4. 提供版本升级 API
 */

// 首先加载配置（包含 dotenv 初始化）
import '../config.js';

// 设置内嵌模式环境变量，防止 Bridge 自动启动
process.env.BRIDGE_EMBEDDED_MODE = '1';

import pkg from '../../package.json' with { type: 'json' };
import { createAdminServer } from './admin-server.js';
import { bridgeManager, type BridgeStatus } from './bridge-manager.js';
import { configStore } from '../store/config-store.js';
import { initLogger } from '../utils/logger.js';
import { logStore } from '../store/log-store.js';

const ADMIN_PORT = parseInt(process.env.ADMIN_PORT ?? '4098', 10);
const VERSION = pkg.version;

async function main() {
  // 初始化日志收集器
  initLogger(logStore);

  console.log('╔════════════════════════════════════════════════╗');
  console.log('║     OpenCode Bridge Admin v' + VERSION + '          ║');
  console.log('╚════════════════════════════════════════════════╝');

  // 启动 Admin Server
  const adminServer = createAdminServer({
    port: ADMIN_PORT,
    password: process.env.ADMIN_PASSWORD ?? '',
    startedAt: new Date(),
    version: VERSION,
    bridgeManager,
  });

  adminServer.start();

  // 监听 Bridge 状态变化
  bridgeManager.onStatusChange((status: BridgeStatus) => {
    if (status.running) {
      console.log(`[Admin] Bridge 已启动（内嵌模式）`);
    } else {
      console.log(`[Admin] Bridge 已停止，原因: ${status.exitReason || '未知'}`);
    }
  });

  // 启动 Bridge（内嵌模式，在同一进程中运行）
  // 如果是通过 npm run manage:bridge 启动，则不自动启动 Bridge
  const shouldAutoStartBridge = process.env.BRIDGE_AUTO_START !== '0';

  if (shouldAutoStartBridge) {
    console.log('[Admin] 正在启动 Bridge（内嵌模式）...');
    const result = await bridgeManager.start();
    if (result.success) {
      console.log(`[Admin] Bridge 已启动（内嵌模式）`);
    } else {
      console.error(`[Admin] Bridge 启动失败: ${result.error}`);
    }
  }

  // 优雅退出
  const shutdown = async (signal: string) => {
    console.log(`[Admin] 收到 ${signal}，正在关闭...`);
    await bridgeManager.stop();
    adminServer.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Admin] 启动失败:', err);
  process.exit(1);
});