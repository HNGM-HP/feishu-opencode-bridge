/**
 * 进程清理工具 - 封装跨平台进程管理功能
 *
 * 调用 scripts/process-manager.mjs 实现跨平台进程管理
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 从 dist/utils/ 返回到项目根目录
const rootDir = path.resolve(__dirname, '..', '..');
const processManagerPath = path.join(rootDir, 'scripts', 'process-manager.mjs');

/**
 * 执行进程管理命令
 */
function runProcessManager(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const isWindows = process.platform === 'win32';
  const result = spawnSync(process.execPath, [processManagerPath, ...args], {
    cwd: rootDir,
    encoding: 'utf-8',
    windowsHide: isWindows,
  });

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}

/**
 * 扫描 Bridge 进程
 */
export function findBridgeProcesses(): number[] {
  const result = runProcessManager(['list-bridge']);
  // 解析输出："[process-manager] Bridge 进程列表：123, 456"
  const match = result.stdout.match(/进程列表：(.+)/);
  if (match) {
    return match[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  }
  return [];
}

/**
 * 扫描 OpenCode 进程
 */
export function findOpenCodeProcesses(): number[] {
  const result = runProcessManager(['list-opencode']);
  const match = result.stdout.match(/进程列表：(.+)/);
  if (match) {
    return match[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  }
  return [];
}

/**
 * 清理 Bridge 进程（排除当前进程）
 */
export async function cleanupStaleProcesses(): Promise<void> {
  const currentPid = process.pid;
  const result = runProcessManager(['kill-bridge', '--exclude-pid', String(currentPid)]);
  if (result.stdout) {
    console.log(result.stdout.trim());
  }
  if (result.stderr) {
    console.error(result.stderr.trim());
  }
}

/**
 * 清理 OpenCode 进程
 */
export async function cleanupOpenCodeProcesses(): Promise<void> {
  const result = runProcessManager(['kill-opencode']);
  if (result.stdout) {
    console.log(result.stdout.trim());
  }
  if (result.stderr) {
    console.error(result.stderr.trim());
  }
}
