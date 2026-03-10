import { describe, it, expect } from 'vitest';
import { CronScheduler } from '../src/reliability/scheduler.js';
import { createInternalJobRegistry } from '../src/reliability/job-registry.js';

const waitMs = async (ms: number): Promise<void> => {
  await new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
};

const createDeferred = (): {
  promise: Promise<void>;
  resolve: () => void;
} => {
  let resolve = () => {
    return;
  };
  const promise = new Promise<void>(innerResolve => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

describe('CronScheduler + JobRegistry', () => {
  it('应注册内部任务并按 cron 周期执行', async () => {
    const executed: string[] = [];
    const scheduler = new CronScheduler();
    const registry = createInternalJobRegistry({
      cronExpressions: {
        watchdogProbe: '*/1 * * * * *',
        staleCleanup: '*/1 * * * * *',
        budgetReset: '*/1 * * * * *',
      },
      handlers: {
        watchdogProbe: async () => {
          executed.push('watchdogProbe');
        },
        staleCleanup: async () => {
          executed.push('staleCleanup');
        },
        budgetReset: async () => {
          executed.push('budgetReset');
        },
      },
    });

    registry.registerAll(scheduler);
    const registeredJobIds = scheduler.getRegisteredJobIds().sort();
    expect(registeredJobIds).toEqual(['budget-reset', 'stale-cleanup', 'watchdog-probe']);

    scheduler.start();
    await waitMs(1200);
    await scheduler.stop();

    expect(executed.length).toBeGreaterThan(0);
    expect(executed.includes('watchdogProbe')).toBe(true);
    expect(executed.includes('staleCleanup')).toBe(true);
    expect(executed.includes('budgetReset')).toBe(true);
  });

  it('应阻止慢任务重叠执行（activeRunCount <= 1）', async () => {
    let concurrentRuns = 0;
    let maxConcurrentRuns = 0;
    const scheduler = new CronScheduler();

    scheduler.registerJob({
      id: 'slow-job',
      cronExpression: '*/1 * * * * *',
      waitForCompletion: true,
      run: async () => {
        concurrentRuns += 1;
        maxConcurrentRuns = Math.max(maxConcurrentRuns, concurrentRuns);
        await waitMs(1500);
        concurrentRuns -= 1;
      },
    });

    scheduler.start();
    await waitMs(3200);
    await scheduler.stop();

    const state = scheduler.getJobState('slow-job');
    expect(maxConcurrentRuns).toBe(1);
    expect(state.activeRunCount).toBe(0);
    expect(state.totalRuns).toBeLessThanOrEqual(2);
  });

  it('stop 应等待运行中任务完成并清理调度器', async () => {
    const deferred = createDeferred();
    let runs = 0;
    const scheduler = new CronScheduler();

    scheduler.registerJob({
      id: 'blocking-job',
      cronExpression: '*/1 * * * * *',
      waitForCompletion: true,
      run: async () => {
        runs += 1;
        await deferred.promise;
      },
    });

    scheduler.start();
    await waitMs(1100);

    const stopPromise = scheduler.stop();
    let stopResolved = false;
    stopPromise.then(() => {
      stopResolved = true;
    });

    await waitMs(100);
    expect(stopResolved).toBe(false);

    deferred.resolve();
    await stopPromise;

    const runsAfterStop = runs;
    await waitMs(1200);

    expect(scheduler.isRunning()).toBe(false);
    expect(runs).toBe(runsAfterStop);
  });
});
