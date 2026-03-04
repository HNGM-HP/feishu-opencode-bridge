#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const rootDir = path.resolve(scriptDir, '..');
const pidFile = path.join(rootDir, 'logs', 'bridge.pid');

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

function main() {
  const pid = readPid();

  if (!pid) {
    console.log('[stop] 未找到 PID 文件，无需停止');
    return;
  }

  const stopped = stopByPid(pid);
  fs.rmSync(pidFile, { force: true });

  if (stopped) {
    console.log(`[stop] 已发送停止信号，PID=${pid}`);
  } else {
    console.log(`[stop] 进程可能已退出，已清理 PID 文件 (PID=${pid})`);
  }
}

main();
