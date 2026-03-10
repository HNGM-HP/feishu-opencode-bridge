import cron, { type ScheduledTask } from 'node-cron';

export interface JobExecutionContext {
  jobId: string;
  triggeredAt: Date;
}

export interface SchedulerJobDefinition {
  id: string;
  cronExpression: string;
  run: (context: JobExecutionContext) => Promise<void> | void;
  timezone?: string;
  waitForCompletion?: boolean;
}

export interface SchedulerJobState {
  activeRunCount: number;
  totalRuns: number;
  skippedRuns: number;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastError: string | null;
}

interface InternalRegisteredJob {
  definition: SchedulerJobDefinition;
  task: ScheduledTask | null;
  state: SchedulerJobState;
  currentRun: Promise<void> | null;
}

const createInitialState = (): SchedulerJobState => {
  return {
    activeRunCount: 0,
    totalRuns: 0,
    skippedRuns: 0,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastError: null,
  };
};

export class CronScheduler {
  private readonly jobs = new Map<string, InternalRegisteredJob>();

  private running = false;

  registerJob(definition: SchedulerJobDefinition): void {
    if (this.jobs.has(definition.id)) {
      throw new Error(`[Scheduler] 重复任务 ID: ${definition.id}`);
    }
    if (!cron.validate(definition.cronExpression)) {
      throw new Error(`[Scheduler] 非法 cron 表达式: ${definition.cronExpression}`);
    }

    this.jobs.set(definition.id, {
      definition,
      task: null,
      state: createInitialState(),
      currentRun: null,
    });
  }

  getRegisteredJobIds(): string[] {
    return Array.from(this.jobs.keys());
  }

  getJobState(jobId: string): SchedulerJobState {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`[Scheduler] 未找到任务: ${jobId}`);
    }
    return { ...job.state };
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    for (const [jobId, job] of this.jobs.entries()) {
      const task = cron.schedule(
        job.definition.cronExpression,
        async () => {
          await this.executeJob(jobId);
        },
        {
          timezone: job.definition.timezone,
          noOverlap: true,
        }
      );
      job.task = task;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) {
      for (const job of this.jobs.values()) {
        job.task?.destroy();
        job.task = null;
      }
      return;
    }

    this.running = false;

    const waitList: Promise<void>[] = [];
    for (const job of this.jobs.values()) {
      if (job.task) {
        job.task.stop();
        job.task.destroy();
        job.task = null;
      }
      if (job.definition.waitForCompletion && job.currentRun) {
        waitList.push(job.currentRun);
      }
    }

    if (waitList.length > 0) {
      await Promise.allSettled(waitList);
    }
  }

  private async executeJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }
    if (!this.running) {
      return;
    }

    if (job.state.activeRunCount > 0) {
      job.state.skippedRuns += 1;
      return;
    }

    job.state.activeRunCount = 1;
    job.state.totalRuns += 1;
    job.state.lastStartedAt = Date.now();
    job.state.lastError = null;

    const currentRun = Promise.resolve(
      job.definition.run({
        jobId,
        triggeredAt: new Date(),
      })
    )
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        job.state.lastError = message;
      })
      .finally(() => {
        job.state.activeRunCount = 0;
        job.state.lastFinishedAt = Date.now();
        job.currentRun = null;
      });

    job.currentRun = currentRun;
    await currentRun;
  }
}
