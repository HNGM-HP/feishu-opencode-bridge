import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { opencodeConfig, reliabilityConfig } from '../config.js';
import { probeOpenCodeHealth } from './opencode-probe.js';
import { checkOpenCodeSingleInstance, type ProcessGuardResult } from './process-guard.js';

type ProbeHealthFn = (options: { host: string; port: number }) => Promise<{ ok: boolean }>;
type CheckSingleInstanceFn = (options: {
  pidFilePath: string;
  host: string;
  port: number;
  timeoutMs?: number;
  processKeywords?: string[];
}) => Promise<ProcessGuardResult>;
type KillProcessFn = (pid: number) => void;
type StartProcessFn = () => Promise<void>;
type SleepFn = (ms: number) => Promise<void>;

export interface RestartOpenCodeOptions {
  host?: string;
  port?: number;
  pidFilePath?: string;
  processKeywords?: string[];
  healthCheckRetries?: number;
  healthCheckIntervalMs?: number;
  checkSingleInstance?: CheckSingleInstanceFn;
  killProcess?: KillProcessFn;
  startProcess?: StartProcessFn;
  probeHealth?: ProbeHealthFn;
  sleep?: SleepFn;
}

export interface RestartOpenCodeResult {
  ok: boolean;
  reason:
    | 'loopback_only_blocked'
    | 'stop_failed'
    | 'start_failed'
    | 'health_check_failed'
    | 'restarted';
  host: string;
  port: number;
  killedPids: number[];
  failedToKillPids: number[];
}

export async function restartOpenCodeProcess(options: RestartOpenCodeOptions = {}): Promise<RestartOpenCodeResult> {
  const host = options.host ?? opencodeConfig.host;
  const port = options.port ?? opencodeConfig.port;
  const pidFilePath = options.pidFilePath ?? './logs/opencode.pid';
  const processKeywords = options.processKeywords ?? ['opencode'];
  const healthCheckRetries = options.healthCheckRetries ?? 6;
  const healthCheckIntervalMs = options.healthCheckIntervalMs ?? 1000;
  const checkSingleInstance = options.checkSingleInstance ?? checkOpenCodeSingleInstance;
  const killProcess = options.killProcess ?? ((pid: number) => {
    process.kill(pid);
  });
  const startProcess = options.startProcess ?? defaultStartProcess;
  const probeHealth = options.probeHealth ?? probeOpenCodeHealth;
  const sleep = options.sleep ?? defaultSleep;

  if (reliabilityConfig.loopbackOnly && !isLoopbackHost(host)) {
    return {
      ok: false,
      reason: 'loopback_only_blocked',
      host,
      port,
      killedPids: [],
      failedToKillPids: [],
    };
  }

  const snapshot = await checkSingleInstance({
    pidFilePath,
    host,
    port,
    processKeywords,
  });

  const killedPids: number[] = [];
  const failedToKillPids: number[] = [];
  for (const pid of snapshot.runningPids) {
    try {
      killProcess(pid);
      killedPids.push(pid);
    } catch (error) {
      if (!isNoSuchProcessError(error)) {
        failedToKillPids.push(pid);
      }
    }
  }

  if (failedToKillPids.length > 0) {
    return {
      ok: false,
      reason: 'stop_failed',
      host,
      port,
      killedPids,
      failedToKillPids,
    };
  }

  await fs.rm(pidFilePath, { force: true }).catch(() => undefined);

  try {
    await startProcess();
  } catch {
    return {
      ok: false,
      reason: 'start_failed',
      host,
      port,
      killedPids,
      failedToKillPids,
    };
  }

  for (let attempt = 0; attempt < healthCheckRetries; attempt += 1) {
    const health = await probeHealth({ host, port });
    if (health.ok) {
      return {
        ok: true,
        reason: 'restarted',
        host,
        port,
        killedPids,
        failedToKillPids,
      };
    }
    if (attempt < healthCheckRetries - 1) {
      await sleep(healthCheckIntervalMs);
    }
  }

  return {
    ok: false,
    reason: 'health_check_failed',
    host,
    port,
    killedPids,
    failedToKillPids,
  };
}

export function formatRestartResultText(result: RestartOpenCodeResult): string {
  if (result.ok) {
    return [
      '✅ OpenCode 已重启成功',
      `- endpoint: ${result.host}:${result.port}`,
      `- stoppedPids: ${result.killedPids.length > 0 ? result.killedPids.join(',') : 'none'}`,
    ].join('\n');
  }

  switch (result.reason) {
    case 'loopback_only_blocked':
      return `❌ 已拒绝重启：当前 host=${result.host} 非本地 loopback（受 RELIABILITY_LOOPBACK_ONLY 保护）`;
    case 'stop_failed':
      return `❌ 重启失败：无法停止进程 pid=${result.failedToKillPids.join(',')}`;
    case 'start_failed':
      return '❌ 重启失败：OpenCode 启动命令执行失败';
    case 'health_check_failed':
      return `❌ 重启失败：启动后健康检查未通过（${result.host}:${result.port}）`;
    default:
      return '❌ 重启失败：未知原因';
  }
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1';
}

function isNoSuchProcessError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  if (!('code' in error)) {
    return false;
  }
  const code = String((error as { code?: unknown }).code || '');
  return code === 'ESRCH';
}

async function defaultStartProcess(pidFilePath = './logs/opencode.pid'): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    try {
      const isWindows = process.platform === 'win32';

      let pid: number | null = null;

      if (isWindows) {
        // Windows: 走 PowerShell Start-Process -WindowStyle Hidden，
        // 避免 Node 的 CREATE_NO_WINDOW 导致孙进程 opencode-windows-x64\bin\opencode.exe 弹黑窗。
        pid = startOpencodeWindowsHidden();
      } else {
        const child = spawn('opencode', ['serve'], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        pid = child.pid ?? null;
      }

      // 写入 PID 文件，供 process-guard 和 kill-opencode 使用
      if (pid) {
        try {
          const dir = path.dirname(pidFilePath);
          fsSync.mkdirSync(dir, { recursive: true });
          fsSync.writeFileSync(pidFilePath, String(pid), 'utf-8');
        } catch {
          // PID 文件写入失败不影响启动
        }
      }

      setTimeout(() => resolve(), 500);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Windows 专用：通过 PowerShell Start-Process -WindowStyle Hidden 启动 opencode serve。
 *
 * 为什么不用 Node spawn({ windowsHide: true })？
 *   - windowsHide 对应 CREATE_NO_WINDOW：node 进程完全不分配 console。
 *   - 但 opencode-ai 的 JS 入口会再 spawn 平台二进制 opencode-windows-x64\bin\opencode.exe；
 *     父进程没 console，Windows 会给这个孙进程**重新分配一个可见的黑窗**。
 *   - PS 的 -WindowStyle Hidden 对应 STARTF_USESHOWWINDOW + SW_HIDE：分配 console 但隐藏，
 *     孙进程继承这个隐藏 console，不弹窗。
 *
 * 返回真实 node.exe / opencode.exe 的 PID（通过 -PassThru 取得）。
 */
function startOpencodeWindowsHidden(): number | null {
  // 1. 定位 opencode JS 入口（优先）或可执行文件
  let filePath: string | null = null;
  let argList: string[] = [];

  try {
    const npmRoot = spawnSync('npm', ['root', '-g'], {
      encoding: 'utf-8',
      windowsHide: true,
      shell: true,
      timeout: 8000,
    });
    if (!npmRoot.error && npmRoot.status === 0) {
      const globalRoot = (npmRoot.stdout as string).trim();
      const candidates = [
        path.join(globalRoot, 'opencode-ai', 'bin', 'opencode'),
        path.join(globalRoot, '@opencode-ai', 'opencode', 'bin', 'opencode'),
        path.join(globalRoot, 'opencode', 'bin', 'opencode'),
      ];
      for (const candidate of candidates) {
        if (fsSync.existsSync(candidate)) {
          filePath = process.execPath;
          argList = [candidate, 'serve'];
          break;
        }
      }
    }
  } catch {
    // ignore
  }

  // 2. 回退：让 PS 自己从 PATH 里找 opencode（通常是 opencode.cmd → node.exe script）
  if (!filePath) {
    filePath = 'opencode';
    argList = ['serve'];
  }

  return invokeHiddenPowershell(filePath, argList);
}

function invokeHiddenPowershell(filePath: string, argList: string[]): number | null {
  const psEscape = (s: string): string => String(s).replace(/'/g, "''");
  const argListLiteral = argList.length === 0
    ? '@()'
    : argList.map(a => `'${psEscape(a)}'`).join(',');

  const psCommand = [
    `$ErrorActionPreference='Stop'`,
    `$p = Start-Process -WindowStyle Hidden -FilePath '${psEscape(filePath)}' -ArgumentList ${argListLiteral} -PassThru`,
    `Write-Output $p.Id`,
  ].join('; ');

  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-Command', psCommand,
  ], {
    encoding: 'utf-8',
    windowsHide: true,
    timeout: 15000,
  });

  if (result.error || result.status !== 0) {
    return null;
  }
  const pidStr = String(result.stdout || '').trim().split(/\s+/).pop() ?? '';
  const pid = Number.parseInt(pidStr, 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}
