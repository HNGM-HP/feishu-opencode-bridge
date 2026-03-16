#!/usr/bin/env node

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
const entryFile = path.join(rootDir, 'dist', 'index.js');

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

function readPid() {
  if (!fs.existsSync(pidFile)) {
    return null;
  }

  const raw = fs.readFileSync(pidFile, 'utf-8').trim();
  const pid = Number.parseInt(raw, 10);
  return Number.isNaN(pid) ? null : pid;
}

function findBridgeProcesses() {
  const pids = [];

  try {
    const result = spawnSync('ps', ['aux'], {
      encoding: 'utf-8',
    });

    if (result.error || result.status !== 0) {
      return pids;
    }

    const lines = result.stdout.split('\n');
    const absEntryFile = path.resolve(entryFile);

    for (const line of lines) {
      if (!line.trim()) continue;

      const parts = line.split(/\s+/);
      if (parts.length < 11) continue;

      const pid = Number.parseInt(parts[1], 10);
      if (Number.isNaN(pid)) continue;

      // 跳过当前进程和 init 进程
      if (pid === process.pid || pid === 1) continue;

      const command = parts.slice(10).join(' ');

      // 匹配 dist/index.js 或 opencode-bridge 相关进程
      if (command.includes('dist/index.js')
          || command.includes('opencode-bridge')
          || command.includes(absEntryFile)) {
        pids.push(pid);
      }
    }
  } catch (error) {
    console.warn(`[start] 扫描进程失败：${error.message}`);
  }

  return pids;
}

function stopExistingProcesses() {
  const pidFromFile = readPid();
  const pidsFromScan = findBridgeProcesses();

  // 合并 PID 列表并去重
  const allPids = new Set([...(pidFromFile ? [pidFromFile] : []), ...pidsFromScan]);

  if (allPids.size === 0) {
    return;
  }

  console.log(`[start] 检测到 ${allPids.size} 个旧进程正在运行：${Array.from(allPids).join(', ')}`);
  console.log('[start] 自动终止旧进程...');

  for (const pid of allPids) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[start] 已发送 SIGTERM 信号，PID=${pid}`);
    } catch {
      console.log(`[start] 进程 ${pid} 可能已退出`);
    }
  }

  // 等待进程退出
  let waitCount = 0;
  while (waitCount < 15) {
    const remaining = findBridgeProcesses();
    if (remaining.length === 0) {
      console.log('[start] 旧进程已全部退出');
      return;
    }

    waitCount++;
    const ms = Math.min(200 * Math.pow(1.5, waitCount), 3000);

    // 如果还有残留，等待更长时间
    if (waitCount <= 5) {
      process.stdout.write(`[start] 等待进程退出... (${waitCount * 200}ms)\n`);
    }

    require('node:timers').sleep(ms);
  }

  // 如果还有残留进程，尝试 SIGKILL
  const stillRemaining = findBridgeProcesses();
  if (stillRemaining.length > 0) {
    console.log(`[start] 警告：${stillRemaining.length} 个进程未响应 SIGTERM，尝试 SIGKILL...`);

    for (const pid of stillRemaining) {
      try {
        process.kill(pid, 'SIGKILL');
        console.log(`[start] 已发送 SIGKILL 信号，PID=${pid}`);
      } catch {
        console.log(`[start] 无法终止进程 ${pid}`);
      }
    }

    // 再等待一下
    require('node:timers').sleep(500);
  }

  // 清理 PID 文件
  fs.rmSync(pidFile, { force: true });
}

function ensureBuildIfMissing() {
  if (fs.existsSync(entryFile)) {
    return;
  }

  console.log('[start] 未检测到 dist/index.js，开始自动构建');
  const result = runNpm(['run', 'build']);

  if (!result || result.error || result.status !== 0) {
    console.error('[start] 构建失败，启动中止');
    process.exit(result?.status ?? 1);
  }
}

function ensureLogDir() {
  fs.mkdirSync(logsDir, { recursive: true });
}

function startBridge() {
  const stdoutFd = fs.openSync(outLog, 'a');
  const stderrFd = fs.openSync(errLog, 'a');

  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: rootDir,
    detached: true,
    stdio: ['ignore', stdoutFd, stderrFd],
    windowsHide: true,
  });

  child.unref();
  fs.closeSync(stdoutFd);
  fs.closeSync(stderrFd);

  fs.writeFileSync(pidFile, String(child.pid), 'utf-8');
  console.log(`[start] 启动成功，PID=${child.pid}`);
  console.log(`[start] 日志文件：${outLog}`);
}

function main() {
  ensureLogDir();

  // 启动前自动扫描并杀死旧进程
  stopExistingProcesses();

  ensureBuildIfMissing();
  startBridge();
}

main();
