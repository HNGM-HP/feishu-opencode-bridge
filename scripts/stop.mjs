#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const rootDir = path.resolve(scriptDir, '..');
const pidFile = path.join(rootDir, 'logs', 'bridge.pid');
const entryFile = path.join(rootDir, 'dist', 'index.js');

function readPid() {
  if (!fs.existsSync(pidFile)) {
    return null;
  }

  const raw = fs.readFileSync(pidFile, 'utf-8').trim();
  const pid = Number.parseInt(raw, 10);
  return Number.isNaN(pid) ? null : pid;
}

function stopByPid(pid) {
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
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
    console.warn(`[stop] 扫描进程失败：${error.message}`);
  }

  return pids;
}

function main() {
  const pidFromFile = readPid();
  const pidsFromScan = findBridgeProcesses();

  // 合并 PID 列表并去重
  const allPids = new Set([...(pidFromFile ? [pidFromFile] : []), ...pidsFromScan]);

  if (allPids.size === 0) {
    console.log('[stop] 未检测到运行中的服务进程');
    return;
  }

  console.log(`[stop] 发现 ${allPids.size} 个服务进程：${Array.from(allPids).join(', ')}`);

  let stoppedCount = 0;
  for (const pid of allPids) {
    const stopped = stopByPid(pid);
    if (stopped) {
      stoppedCount++;
      console.log(`[stop] 已发送 SIGTERM 信号，PID=${pid}`);
    } else {
      console.log(`[stop] 进程可能已退出 (PID=${pid})`);
    }
  }

  // 清理 PID 文件
  fs.rmSync(pidFile, { force: true });

  // 等待进程完全退出
  console.log('[stop] 等待进程退出...');
  let waitCount = 0;
  while (waitCount < 10) {
    const remaining = findBridgeProcesses();
    if (remaining.length === 0) {
      console.log(`[stop] 所有进程已退出，共终止 ${stoppedCount} 个进程`);
      return;
    }
    waitCount++;
    const ms = Math.min(100 * Math.pow(2, waitCount), 2000);
    process.stdout.write(`[stop] 等待中... (${waitCount * 100}ms)\n`);
    require('node:timers').sleep(ms);
  }

  console.log(`[stop] 等待超时，仍有 ${findBridgeProcesses().length} 个进程在运行`);
  console.log('[stop] 如需强制终止，请手动执行：kill -9 <PID>');
}

main();
