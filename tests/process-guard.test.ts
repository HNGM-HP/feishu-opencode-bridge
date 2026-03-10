import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  acquireRescueLock,
  checkOpenCodeSingleInstance,
  type OpenCodeProcessInfo,
} from '../src/reliability/process-guard.js';

describe('process-guard', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'process-guard-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('OpenCode 未运行时应返回 not-running', async () => {
    const pidFilePath = path.join(tempDir, 'bridge.pid');
    const result = await checkOpenCodeSingleInstance({
      pidFilePath,
      host: '127.0.0.1',
      port: 4096,
      processAliveChecker: async () => false,
      processListProvider: async (): Promise<OpenCodeProcessInfo[]> => [],
      portProbe: async () => ({ isOpen: false, reason: 'ECONNREFUSED' }),
    });

    expect(result.status).toBe('not-running');
    expect(result.portOpen).toBe(false);
    expect(result.pidFromFile).toBeNull();
  });

  it('检测到多个 OpenCode 实例时应返回 single-instance-violation', async () => {
    const pidFilePath = path.join(tempDir, 'bridge.pid');
    await fs.writeFile(pidFilePath, '101', 'utf-8');

    const result = await checkOpenCodeSingleInstance({
      pidFilePath,
      host: '127.0.0.1',
      port: 4096,
      processAliveChecker: async pid => pid === 101 || pid === 202,
      processListProvider: async (): Promise<OpenCodeProcessInfo[]> => [
        { pid: 101, command: 'node opencode serve' },
        { pid: 202, command: 'node opencode serve --config ~/.config/opencode' },
      ],
      portProbe: async () => ({ isOpen: true, reason: 'connected' }),
    });

    expect(result.status).toBe('single-instance-violation');
    expect(result.runningPids).toEqual([101, 202]);
    expect(result.conflictPids).toEqual([202]);
  });

  it('并发触发救援锁时第二个请求应返回 lock-busy', async () => {
    const lockTargetPath = path.join(tempDir, 'rescue-mutex');

    const first = await acquireRescueLock({
      lockTargetPath,
      updateMs: 5000,
      staleMs: 10000,
    });

    const second = await acquireRescueLock({
      lockTargetPath,
      updateMs: 5000,
      staleMs: 10000,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe('lock-busy');
    }

    if (first.ok) {
      await first.release();
    }
  });
});
