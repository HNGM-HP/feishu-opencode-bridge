#!/usr/bin/env node

/**
 * 启动后台进程脚本
 *
 * 功能:
 * - 调用 process-manager.mjs 清理旧进程
 * - 构建项目（如果需要）
 * - 启动 Admin 服务（Admin 会自动启动 Bridge 子进程）
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const rootDir = path.resolve(scriptDir, '..');
const logsDir = path.join(rootDir, 'logs');
const pidFile = path.join(logsDir, 'bridge.pid');
const outLog = path.join(logsDir, 'service.log');
const errLog = path.join(logsDir, 'service.err');
const adminEntryFile = path.join(rootDir, 'dist', 'admin', 'index.js');
const processManagerPath = path.join(rootDir, 'scripts', 'process-manager.mjs');

// 是否跳过 opencode serve 启动（用于已由外部管理 opencode 的场景）
const skipOpencodeStart = process.argv.includes('--no-opencode');

function isWindows() {
  return process.platform === 'win32';
}

function getNpmCommandVariants(args) {
  const variants = [];
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath) {
    variants.push({
      command: process.execPath,
      args: [npmExecPath, ...args],
    });
  }

  variants.push({ command: 'npm', args });

  if (isWindows()) {
    variants.push({ command: 'npm.cmd', args });
    variants.push({ command: 'npm.exe', args });
  }

  const seen = new Set();
  const uniqueVariants = [];

  for (const variant of variants) {
    const key = `${variant.command}::${variant.args.join('\u0000')}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueVariants.push(variant);
  }

  return uniqueVariants;
}

function runNpm(args) {
  const variants = getNpmCommandVariants(args);
  let lastResult = null;

  for (const variant of variants) {
    const result = spawnSync(variant.command, variant.args, {
      cwd: rootDir,
      stdio: 'inherit',
      windowsHide: isWindows(),
    });

    if (result.error) {
      lastResult = result;
      continue;
    }

    if (result.status === 0) {
      return result;
    }

    lastResult = result;
  }

  return lastResult;
}

function ensureLogDir() {
  fs.mkdirSync(logsDir, { recursive: true });
}

function ensureBuildIfMissing() {
  const webEntryFile = path.join(rootDir, 'dist', 'public', 'index.html');
  const backendMissing = !fs.existsSync(adminEntryFile);
  const frontendMissing = !fs.existsSync(webEntryFile);

  if (!backendMissing && !frontendMissing) {
    return;
  }

  if (backendMissing && frontendMissing) {
    console.log('[start] 未检测到构建产物，开始自动全量构建');
  } else if (backendMissing) {
    console.log('[start] 未检测到 dist/admin/index.js，开始自动构建');
  } else {
    console.log('[start] 未检测到 dist/public/index.html，开始自动构建前端控制台');
  }

  const result = runNpm(['run', 'build:all']);

  if (!result || result.error || result.status !== 0) {
    console.error('[start] 构建失败，启动中止');
    process.exit(result?.status ?? 1);
  }
}

function startAdmin() {
  const stdoutFd = fs.openSync(outLog, 'a');
  const stderrFd = fs.openSync(errLog, 'a');

  const child = spawn(process.execPath, [adminEntryFile], {
    cwd: rootDir,
    detached: true,
    stdio: ['ignore', stdoutFd, stderrFd],
    windowsHide: isWindows(),
  });

  child.unref();
  fs.closeSync(stdoutFd);
  fs.closeSync(stderrFd);

  fs.writeFileSync(pidFile, String(child.pid), 'utf-8');
  console.log(`[start] 启动成功，PID=${child.pid}`);
  console.log(`[start] 日志文件：${outLog}`);
}

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // 忙等待
  }
}

function runProcessManager(args, options = {}) {
  const result = spawnSync(process.execPath, [processManagerPath, ...args], {
    stdio: 'pipe',
    encoding: 'utf-8',
    windowsHide: isWindows(),
    ...options,
  });
  if (result.stdout?.trim()) console.log(result.stdout.trim());
  if (result.stderr?.trim()) console.error(result.stderr.trim());
  return result;
}

function main() {
  ensureLogDir();

  // 0. 启动 opencode serve（幂等 - 如果已在运行则跳过）
  if (skipOpencodeStart) {
    console.log('[start] 跳过 opencode serve 启动（--no-opencode）');
  } else {
    console.log('[start] 启动 opencode serve...');
    const opencodeResult = runProcessManager(['start-opencode']);
    if (opencodeResult.status !== 0) {
      console.warn('[start] 警告：opencode serve 启动失败，继续启动 Bridge（可稍后手动启动 opencode）');
    }
  }

  // 1. 调用进程管理工具清理旧 Bridge 进程（不传递 --exclude-self，因为这是独立调用）
  console.log('[start] 清理旧 Bridge 进程...');
  runProcessManager(['kill-bridge']);

  // 2. 等待 3 秒，确保旧进程完全退出
  console.log('[start] 等待进程退出...');
  sleep(3000);

  ensureBuildIfMissing();

  // 3. 启动 Admin 服务（Admin 会自动启动 Bridge 子进程）
  startAdmin();
}

main();
