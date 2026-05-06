/**
 * Admin 独立进程入口
 *
 * 职责：
 * 1. 托管 Web 管理面板
 * 2. 在内嵌模式下运行 Bridge 逻辑（进程合并，节省内存）
 * 3. 提供 OpenCode 安装/管理 API
 * 4. 提供版本升级 API
 * 5. 启动时检测并终止所有旧的 Bridge 进程（防止并行运行）
 */

// 首先加载配置（包含 dotenv 初始化）
import '../config.js';

// 设置内嵌模式环境变量，防止 Bridge 自动启动
process.env.BRIDGE_EMBEDDED_MODE = '1';

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAdminServer } from './admin-server.js';
import { bridgeManager, type BridgeStatus } from './bridge-manager.js';
import { initLogger } from '../utils/logger.js';
import { logStore } from '../store/log-store.js';
import { VERSION } from '../utils/version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_PORT = parseInt(process.env.ADMIN_PORT ?? '4098', 10);

// 开发模式检测（process.resourcesPath 是 Electron 特有属性）
const isDev = process.env.NODE_ENV === 'development' || !(process as any).resourcesPath;

/**
 * 终止所有旧的 Bridge 进程（防止并行运行）
 * 包括：cmd/git bash/powershell/Electron 等各种方式启动的进程
 */
function killOldBridgeProcesses(): void {
  // 获取脚本路径（兼容开发环境和 Electron 打包环境）
  let scriptPath: string;
  if ((process as any).resourcesPath && !isDev) {
    // Electron 打包后：scripts 在 resources/app/scripts/
    scriptPath = path.join((process as any).resourcesPath, 'app', 'scripts', 'process-manager.mjs');
  } else {
    // 开发环境或非 Electron 环境
    scriptPath = path.resolve(__dirname, '../../scripts/process-manager.mjs');
  }
  const isWindows = process.platform === 'win32';

  try {
    console.log('[Admin] 检测并终止旧的 Bridge 进程...');
    console.log('[Admin] 脚本路径:', scriptPath);
    const result = spawnSync(process.execPath, [scriptPath, 'kill-bridge', '--exclude-pid', String(process.pid)], {
      encoding: 'utf-8',
      timeout: 15000,
      windowsHide: isWindows,
    });

    if (result.stdout) {
      console.log('[Admin] ' + result.stdout.trim());
    }
    if (result.stderr && result.stderr.trim()) {
      console.error('[Admin] ' + result.stderr.trim());
    }
  } catch (e: any) {
    console.error('[Admin] 终止旧进程失败:', e.message);
  }
}

async function main() {
  // 初始化日志收集器
  initLogger(logStore);

  // 首先终止所有旧的 Bridge 进程（防止并行运行）
  killOldBridgeProcesses();

  console.log('╔════════════════════════════════════════════════╗');
  console.log('║     OpenCode Bridge Admin v' + VERSION + '          ║');
  console.log('╚════════════════════════════════════════════════╝');

  // 启动 Admin Server（已移除账号 / 密码鉴权）
  const adminServer = createAdminServer({
    port: ADMIN_PORT,
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
  if (err?.code === 'MODULE_NOT_FOUND' || String(err?.message || '').includes('better-sqlite3')) {
    console.error('[Admin] 原生模块加载失败，诊断信息:');
    console.error(`[Admin] platform=${process.platform} arch=${process.arch} node=${process.versions.node}`);
    if (process.platform === 'darwin') {
      console.error('[Admin] macOS: 请确认安装包与 CPU 架构匹配，或执行 xattr -cr 移除安全隔离');
    }
  }
  process.exit(1);
});