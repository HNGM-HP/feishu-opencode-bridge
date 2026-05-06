import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeManager } from '../src/admin/bridge-manager.js';

type RestartResult = { success: boolean; pid?: number; error?: string };
type StopResult = { success: boolean; error?: string };

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('BridgeManager restart dedupe', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('并发 restart 调用应复用同一重启流程', async () => {
    vi.useFakeTimers();

    const manager = new BridgeManager(true) as BridgeManager & {
      stop: () => Promise<StopResult>;
      start: () => Promise<RestartResult>;
    };
    const stopDeferred = createDeferred<StopResult>();

    manager.stop = vi.fn(() => stopDeferred.promise);
    manager.start = vi.fn(async () => ({ success: true, pid: 4242 }));

    const firstRestart = manager.restart();
    const secondRestart = manager.restart();

    expect(manager.stop).toHaveBeenCalledTimes(1);
    expect(manager.start).not.toHaveBeenCalled();

    stopDeferred.resolve({ success: true });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);

    await expect(Promise.all([firstRestart, secondRestart])).resolves.toEqual([
      { success: true, pid: 4242 },
      { success: true, pid: 4242 },
    ]);

    expect(manager.stop).toHaveBeenCalledTimes(1);
    expect(manager.start).toHaveBeenCalledTimes(1);
  });
});
