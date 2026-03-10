import { type CronScheduler, type SchedulerJobDefinition } from './scheduler.js';

export interface InternalJobHandlers {
  watchdogProbe: () => Promise<void> | void;
  staleCleanup: () => Promise<void> | void;
  budgetReset: () => Promise<void> | void;
}

export interface InternalJobCronExpressions {
  watchdogProbe: string;
  staleCleanup: string;
  budgetReset: string;
}

export interface InternalJobRegistryOptions {
  handlers?: Partial<InternalJobHandlers>;
  cronExpressions?: Partial<InternalJobCronExpressions>;
  timezone?: string;
}

const DEFAULT_CRON_EXPRESSIONS: InternalJobCronExpressions = {
  watchdogProbe: '*/30 * * * * *',
  staleCleanup: '0 */5 * * * *',
  budgetReset: '0 0 * * *',
};

const NOOP_ASYNC_HANDLER = async (): Promise<void> => {
  return;
};

const createDefinitions = (options: InternalJobRegistryOptions = {}): SchedulerJobDefinition[] => {
  const cronExpressions: InternalJobCronExpressions = {
    ...DEFAULT_CRON_EXPRESSIONS,
    ...options.cronExpressions,
  };

  const handlers: InternalJobHandlers = {
    watchdogProbe: options.handlers?.watchdogProbe ?? NOOP_ASYNC_HANDLER,
    staleCleanup: options.handlers?.staleCleanup ?? NOOP_ASYNC_HANDLER,
    budgetReset: options.handlers?.budgetReset ?? NOOP_ASYNC_HANDLER,
  };

  return [
    {
      id: 'watchdog-probe',
      cronExpression: cronExpressions.watchdogProbe,
      timezone: options.timezone,
      waitForCompletion: true,
      run: async () => {
        await handlers.watchdogProbe();
      },
    },
    {
      id: 'stale-cleanup',
      cronExpression: cronExpressions.staleCleanup,
      timezone: options.timezone,
      waitForCompletion: true,
      run: async () => {
        await handlers.staleCleanup();
      },
    },
    {
      id: 'budget-reset',
      cronExpression: cronExpressions.budgetReset,
      timezone: options.timezone,
      waitForCompletion: true,
      run: async () => {
        await handlers.budgetReset();
      },
    },
  ];
};

export class JobRegistry {
  private readonly definitions: SchedulerJobDefinition[];

  constructor(definitions: SchedulerJobDefinition[]) {
    this.definitions = definitions;
  }

  list(): SchedulerJobDefinition[] {
    return [...this.definitions];
  }

  registerAll(scheduler: CronScheduler): void {
    for (const definition of this.definitions) {
      scheduler.registerJob(definition);
    }
  }
}

export const createInternalJobRegistry = (options: InternalJobRegistryOptions = {}): JobRegistry => {
  return new JobRegistry(createDefinitions(options));
};
