import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface OpenCodeProcessInfo {
  pid: number;
  command: string;
}

type ProcessAliveChecker = (pid: number) => Promise<boolean>;
type ProcessListProvider = () => Promise<OpenCodeProcessInfo[]>;
type PortProbe = (host: string, port: number, timeoutMs: number) => Promise<PortProbeResult>;

export interface PortProbeResult {
  isOpen: boolean;
  reason: string;
}

export interface ProcessGuardOptions {
  pidFilePath: string;
  host: string;
  port: number;
  timeoutMs?: number;
  processKeywords?: string[];
  processAliveChecker?: ProcessAliveChecker;
  processListProvider?: ProcessListProvider;
  portProbe?: PortProbe;
}

export type ProcessGuardStatus = 'ok' | 'not-running' | 'single-instance-violation';

export interface ProcessGuardResult {
  status: ProcessGuardStatus;
  pidFromFile: number | null;
  pidAlive: boolean;
  portOpen: boolean;
  probeReason: string;
  runningPids: number[];
  conflictPids: number[];
}

export interface RescueLockOptions {
  lockTargetPath: string;
  staleMs?: number;
  updateMs?: number;
  now?: () => number;
}

export interface RescueLockBusyResult {
  ok: false;
  code: 'lock-busy';
  lockPath: string;
}

export interface RescueLockSuccessResult {
  ok: true;
  lockPath: string;
  release: () => Promise<void>;
}

export type RescueLockAcquireResult = RescueLockBusyResult | RescueLockSuccessResult;

export async function checkOpenCodeSingleInstance(
  options: ProcessGuardOptions
): Promise<ProcessGuardResult> {
  const timeoutMs = options.timeoutMs ?? 1200;
  const processKeywords = options.processKeywords ?? ['opencode'];
  const processAliveChecker = options.processAliveChecker ?? isProcessAlive;
  const portProbe = options.portProbe ?? probeTcpPort;

  const pidFromFile = await readPidFile(options.pidFilePath);
  const pidAlive = pidFromFile !== null ? await processAliveChecker(pidFromFile) : false;

  const probeResult = await portProbe(options.host, options.port, timeoutMs);
  const processList = options.processListProvider
    ? await options.processListProvider()
    : await listOpenCodeProcesses(processKeywords);

  const keywordMatched = processList.filter(item => matchesProcessKeywords(item, processKeywords));
  const runningPidSet = new Set<number>(keywordMatched.map(item => item.pid));

  if (pidFromFile !== null && pidAlive) {
    runningPidSet.add(pidFromFile);
  }

  const runningPids = Array.from(runningPidSet).sort((left, right) => left - right);
  const conflictPids = runningPids.filter(pid => pidFromFile === null || pid !== pidFromFile);

  if (runningPids.length > 1) {
    return {
      status: 'single-instance-violation',
      pidFromFile,
      pidAlive,
      portOpen: probeResult.isOpen,
      probeReason: probeResult.reason,
      runningPids,
      conflictPids,
    };
  }

  if (!pidAlive && !probeResult.isOpen && runningPids.length === 0) {
    return {
      status: 'not-running',
      pidFromFile,
      pidAlive,
      portOpen: probeResult.isOpen,
      probeReason: probeResult.reason,
      runningPids,
      conflictPids,
    };
  }

  return {
    status: 'ok',
    pidFromFile,
    pidAlive,
    portOpen: probeResult.isOpen,
    probeReason: probeResult.reason,
    runningPids,
    conflictPids,
  };
}

export async function acquireRescueLock(options: RescueLockOptions): Promise<RescueLockAcquireResult> {
  const staleMs = options.staleMs ?? 30_000;
  const updateMs = options.updateMs ?? Math.max(1_000, Math.floor(staleMs / 2));
  const getNow = options.now ?? Date.now;
  const lockPath = `${options.lockTargetPath}.lock`;
  const ownerFilePath = `${lockPath}/owner.json`;

  const acquired = await tryAcquireLockPath(lockPath, staleMs, getNow);
  if (!acquired) {
    return {
      ok: false,
      code: 'lock-busy',
      lockPath,
    };
  }

  const ownerInfo = {
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: getNow(),
  };
  await fs.writeFile(ownerFilePath, JSON.stringify(ownerInfo), 'utf-8');

  const heartbeatTimer = setInterval(async () => {
    try {
      const now = new Date(getNow());
      await fs.utimes(lockPath, now, now);
    } catch {
      // 锁被外部清理时，心跳更新可安全忽略。
    }
  }, updateMs);
  heartbeatTimer.unref();

  let released = false;
  const release = async (): Promise<void> => {
    if (released) {
      return;
    }
    released = true;
    clearInterval(heartbeatTimer);
    await fs.rm(lockPath, { recursive: true, force: true });
  };

  return {
    ok: true,
    lockPath,
    release,
  };
}

async function tryAcquireLockPath(
  lockPath: string,
  staleMs: number,
  now: () => number
): Promise<boolean> {
  try {
    await fs.mkdir(lockPath);
    return true;
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
  }

  if (!(await isLockStale(lockPath, staleMs, now))) {
    return false;
  }

  await fs.rm(lockPath, { recursive: true, force: true });

  try {
    await fs.mkdir(lockPath);
    return true;
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return false;
    }
    throw error;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  if (!('code' in error)) {
    return false;
  }
  return String(error.code) === 'EEXIST';
}

async function isLockStale(lockPath: string, staleMs: number, now: () => number): Promise<boolean> {
  try {
    const stat = await fs.stat(lockPath);
    const ageMs = now() - stat.mtimeMs;
    return ageMs > staleMs;
  } catch {
    return false;
  }
}

async function readPidFile(pidFilePath: string): Promise<number | null> {
  try {
    const raw = (await fs.readFile(pidFilePath, 'utf-8')).trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function probeTcpPort(
  host: string,
  port: number,
  timeoutMs = 1200
): Promise<PortProbeResult> {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (isOpen: boolean, reason: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve({ isOpen, reason });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, 'connected'));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', error => {
      const reason =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : error instanceof Error
            ? error.message
            : String(error);
      finish(false, reason);
    });

    socket.connect(port, host);
  });
}

async function listOpenCodeProcesses(processKeywords: string[]): Promise<OpenCodeProcessInfo[]> {
  const snapshot = await listAllProcesses();
  return snapshot.filter(item => matchesProcessKeywords(item, processKeywords));
}

function matchesProcessKeywords(item: OpenCodeProcessInfo, processKeywords: string[]): boolean {
  const command = item.command.toLowerCase();
  return processKeywords.some(keyword => command.includes(keyword.toLowerCase()));
}

async function listAllProcesses(): Promise<OpenCodeProcessInfo[]> {
  if (process.platform === 'win32') {
    const fromPowerShell = await listProcessesByPowerShell();
    if (fromPowerShell.length > 0) {
      return fromPowerShell;
    }
    return listProcessesByTaskList();
  }
  return listProcessesByPs();
}

async function listProcessesByPowerShell(): Promise<OpenCodeProcessInfo[]> {
  try {
    const command =
      'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress';
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', command], {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
    });
    const content = stdout.trim();
    if (!content) {
      return [];
    }

    const parsed: unknown = JSON.parse(content);
    const records = Array.isArray(parsed) ? parsed : [parsed];
    const processList: OpenCodeProcessInfo[] = [];
    for (const record of records) {
      if (!record || typeof record !== 'object') {
        continue;
      }
      const pidValue = 'ProcessId' in record ? record.ProcessId : undefined;
      const nameValue = 'Name' in record ? record.Name : '';
      const commandValue = 'CommandLine' in record ? record.CommandLine : '';
      const pid = Number.parseInt(String(pidValue), 10);
      if (Number.isNaN(pid)) {
        continue;
      }
      const command = String(commandValue || nameValue || '').trim();
      if (!command) {
        continue;
      }
      processList.push({ pid, command });
    }
    return processList;
  } catch {
    return [];
  }
}

async function listProcessesByTaskList(): Promise<OpenCodeProcessInfo[]> {
  try {
    const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
    });

    const lines = stdout
      .split(/\r?\n/u)
      .map(line => line.trim())
      .filter(Boolean);
    const processList: OpenCodeProcessInfo[] = [];
    for (const line of lines) {
      const columns = parseWindowsCsvLine(line);
      if (columns.length < 2) {
        continue;
      }
      const imageName = columns[0] ?? '';
      const pid = Number.parseInt((columns[1] ?? '').replace(/,/gu, ''), 10);
      if (Number.isNaN(pid) || !imageName) {
        continue;
      }
      processList.push({ pid, command: imageName });
    }
    return processList;
  } catch {
    return [];
  }
}

function parseWindowsCsvLine(line: string): string[] {
  const values: string[] = [];
  let cursor = 0;

  while (cursor < line.length) {
    if (line[cursor] === '"') {
      cursor += 1;
      let field = '';
      while (cursor < line.length) {
        if (line[cursor] === '"') {
          if (line[cursor + 1] === '"') {
            field += '"';
            cursor += 2;
            continue;
          }
          cursor += 1;
          break;
        }
        field += line[cursor] ?? '';
        cursor += 1;
      }
      values.push(field);
      if (line[cursor] === ',') {
        cursor += 1;
      }
      continue;
    }

    let field = '';
    while (cursor < line.length && line[cursor] !== ',') {
      field += line[cursor] ?? '';
      cursor += 1;
    }
    values.push(field.trim());
    if (line[cursor] === ',') {
      cursor += 1;
    }
  }

  return values;
}

async function listProcessesByPs(): Promise<OpenCodeProcessInfo[]> {
  try {
    const { stdout } = await execFileAsync('ps', ['-ax', '-o', 'pid=,command='], {
      maxBuffer: 1024 * 1024 * 8,
    });

    const lines = stdout
      .split(/\r?\n/u)
      .map(line => line.trim())
      .filter(Boolean);

    const processList: OpenCodeProcessInfo[] = [];
    for (const line of lines) {
      const matched = line.match(/^(\d+)\s+(.+)$/u);
      if (!matched) {
        continue;
      }
      const pid = Number.parseInt(matched[1], 10);
      const command = matched[2]?.trim() ?? '';
      if (Number.isNaN(pid) || !command) {
        continue;
      }
      processList.push({ pid, command });
    }
    return processList;
  } catch {
    return [];
  }
}
