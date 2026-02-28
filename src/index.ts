import { spawn } from 'node:child_process';
import { feishuClient, type FeishuMessageEvent } from './feishu/client.js';
import { feishuAdapter } from './platform/adapters/feishu-adapter.js';
import { discordAdapter } from './platform/adapters/discord-adapter.js';
import { opencodeClient, type PermissionRequestEvent } from './opencode/client.js';
import { outputBuffer } from './opencode/output-buffer.js';
import { delayedResponseHandler } from './opencode/delayed-handler.js';
import { questionHandler } from './opencode/question-handler.js';
import { permissionHandler } from './permissions/handler.js';
import { chatSessionStore, type InteractionRecord } from './store/chat-session.js';
import { p2pHandler } from './handlers/p2p.js';
import { groupHandler } from './handlers/group.js';
import { lifecycleHandler } from './handlers/lifecycle.js';
import { createDiscordHandler } from './handlers/discord.js';
import { commandHandler } from './handlers/command.js';
import { cardActionHandler } from './handlers/card-action.js';
import { validateConfig, routerConfig, outputConfig, reliabilityConfig, opencodeConfig } from './config.js';
import { rootRouter } from './router/root-router.js';
import { ConversationHeartbeatEngine } from './reliability/conversation-heartbeat.js';
import { CronScheduler } from './reliability/scheduler.js';
import { createInternalJobRegistry } from './reliability/job-registry.js';
import { createProcessCheckJobRunner, createRepairBudgetState } from './reliability/process-check-job.js';
import { createProactiveHeartbeatRunner } from './reliability/proactive-heartbeat.js';
import { RuntimeCronManager } from './reliability/runtime-cron.js';
import { createCronApiServer } from './reliability/cron-api-server.js';
import { getRuntimeCronManager, setRuntimeCronManager } from './reliability/runtime-cron-registry.js';
import { createRuntimeCronDispatcher } from './reliability/runtime-cron-dispatcher.js';
import { cleanupRuntimeCronJobsByConversation, scanAndCleanupOrphanRuntimeCronJobs } from './reliability/runtime-cron-orphan.js';
import { probeOpenCodeHealth } from './reliability/opencode-probe.js';
import { decideRescuePolicy } from './reliability/rescue-policy.js';
import { executeRescuePipeline } from './reliability/rescue-executor.js';
import { reportRecoveryContext } from './reliability/recovery-reporter.js';
import { FailureType, RescueState } from './reliability/types.js';
import {
  createPermissionActionCallbacks,
  createQuestionActionCallbacks,
} from './router/action-handlers.js';
import { openCodeEventHub } from './router/opencode-event-hub.js';
import {
  buildStreamCards,
  type StreamCardData,
  type StreamCardSegment,
  type StreamCardPendingPermission,
  type StreamCardPendingQuestion,
} from './feishu/cards-stream.js';

export interface ReliabilityRescueOrchestrator {
  runWatchdogProbe: () => Promise<void> | void;
  runStaleCleanup: () => Promise<void> | void;
  runBudgetReset: () => Promise<void> | void;
  cleanup: () => Promise<void> | void;
}

export interface ReliabilityJobHandlers {
  watchdogProbe: () => Promise<void>;
  processConsistencyCheck: () => Promise<void>;
  staleCleanup: () => Promise<void>;
  budgetReset: () => Promise<void>;
}

export interface ReliabilityScheduler {
  start: () => void;
  stop: () => Promise<void>;
}

export interface ReliabilityLifecycleDependencies {
  createHeartbeatEngine?: () => Pick<ConversationHeartbeatEngine, 'onInboundMessage'>;
  createScheduler?: () => ReliabilityScheduler;
  createRescueOrchestrator?: () => ReliabilityRescueOrchestrator;
  createJobRegistry?: (handlers: ReliabilityJobHandlers) => {
    registerAll: (scheduler: ReliabilityScheduler) => void;
  };
  logger?: Pick<Console, 'info' | 'error'>;
}

export interface ReliabilityLifecycle {
  onInboundMessage: () => Promise<void>;
  cleanup: () => Promise<void>;
}

export const createRescueOrchestrator = (
  logger: Pick<Console, 'info' | 'error'> = console
): ReliabilityRescueOrchestrator => {
  let rescueState: RescueState = RescueState.HEALTHY;
  let failureCount = 0;
  let firstFailureAtMs = 0;
  let repairBudgetRemaining = reliabilityConfig.repairBudget;
  let lastRepairAtMs: number | undefined;
  const HEALTHY_LOG_INTERVAL_MS = 10 * 60 * 1000;
  const WAIT_LOG_INTERVAL_MS = 5 * 60 * 1000;
  let lastHealthyLogAtMs = 0;
  let lastPolicyLogAtMs = 0;
  let lastPolicySignature = '';

  return {
    runWatchdogProbe: async () => {
      const nowMs = Date.now();
      try {
        const probeResult = await probeOpenCodeHealth({
          host: opencodeConfig.host,
          port: opencodeConfig.port,
        });

        if (probeResult.ok) {
          failureCount = 0;
          firstFailureAtMs = 0;
          rescueState = RescueState.HEALTHY;
          const shouldLogHealthy =
            lastHealthyLogAtMs === 0 || nowMs - lastHealthyLogAtMs >= HEALTHY_LOG_INTERVAL_MS;
          if (shouldLogHealthy) {
            logger.info('[Reliability] watchdog probe healthy');
            lastHealthyLogAtMs = nowMs;
          }
          return;
        }

        failureCount += 1;
        if (firstFailureAtMs === 0) {
          firstFailureAtMs = nowMs;
        }

        const failureType = probeResult.failureType ?? FailureType.OPENCODE_HTTP_DOWN;
        const policyDecision = decideRescuePolicy({
          failureType,
          currentState: rescueState,
          latestAttemptFailed: true,
          nowMs,
          retry: {
            mode: 'infinite',
            attempt: failureCount,
            failureCount,
            firstFailureAtMs,
          },
          rescue: {
            targetHost: opencodeConfig.host,
            budgetRemaining: repairBudgetRemaining,
            lastRepairAtMs,
          },
        });

        rescueState = policyDecision.nextState;
        repairBudgetRemaining = policyDecision.nextBudgetRemaining;

        if (policyDecision.action !== 'repair') {
          const signature = `${policyDecision.action}:${policyDecision.reason}`;
          const shouldLogPolicy =
            signature !== lastPolicySignature
            || lastPolicyLogAtMs === 0
            || nowMs - lastPolicyLogAtMs >= WAIT_LOG_INTERVAL_MS;
          if (shouldLogPolicy) {
            logger.info(`[Reliability] watchdog policy=${policyDecision.action} reason=${policyDecision.reason}`);
            lastPolicyLogAtMs = nowMs;
            lastPolicySignature = signature;
          }
          return;
        }

        logger.info(`[Reliability] watchdog rescue start reason=${policyDecision.reason}`);

        const startOpenCode = async (): Promise<void> => {
          return new Promise((resolve, reject) => {
            try {
              const child = spawn('opencode', [], {
                detached: true,
                stdio: 'ignore',
              });
              child.unref();
              setTimeout(() => resolve(), 2000);
            } catch (error) {
              reject(error);
            }
          });
        };

        const rescueResult = await executeRescuePipeline({
          lockTargetPath: './logs/opencode-rescue',
          pidFilePath: './logs/opencode.pid',
          host: opencodeConfig.host,
          port: opencodeConfig.port,
          configPath: process.env.OPENCODE_CONFIG_FILE?.trim() || './opencode.json',
          serverFields: {
            host: opencodeConfig.host,
            port: opencodeConfig.port,
            auth: {
              username: opencodeConfig.serverUsername,
              password: opencodeConfig.serverPassword,
            },
          },
          startOpenCode,
        });

        if (!rescueResult.ok) {
          rescueState = RescueState.DEGRADED;
          logger.error(`[Reliability] rescue failed step=${rescueResult.failedStep} reason=${rescueResult.reason}`);
          return;
        }

        lastRepairAtMs = Date.now();
        rescueState = RescueState.RECOVERED;
        await reportRecoveryContext({
          failureType,
          failureReason: policyDecision.reason,
          backupPath: rescueResult.config.backup.path,
          nextActions: [
            '检查 OpenCode 健康端点与认证配置是否长期稳定',
            '观察下一轮 watchdog 探针，确认故障不再复现',
          ],
          selfCheckCommands: [
            'npm run build',
            'npm test -- tests/reliability-bootstrap.test.ts',
          ],
          context: {
            policyAction: policyDecision.action,
            policyReason: policyDecision.reason,
            trace: rescueResult.trace,
            health: rescueResult.health,
          },
        });
        logger.info('[Reliability] rescue succeeded and recovery context reported');
      } catch (error) {
        logger.error('[Reliability] watchdog probe failed:', error);
      }
    },
    runStaleCleanup: async () => {
      logger.info('[Reliability] stale cleanup tick');
    },
    runBudgetReset: async () => {
      logger.info('[Reliability] budget reset tick');
    },
    cleanup: async () => {
      logger.info('[Reliability] rescue orchestrator cleaned');
    },
  };
};

export const bootstrapReliabilityLifecycle = (
  dependencies: ReliabilityLifecycleDependencies = {}
): ReliabilityLifecycle => {
  const logger = dependencies.logger ?? console;
  const shouldUseInboundHeartbeat = reliabilityConfig.inboundHeartbeatEnabled || Boolean(dependencies.createHeartbeatEngine);
  const heartbeatEngine = dependencies.createHeartbeatEngine?.()
    ?? new ConversationHeartbeatEngine({
      windowMs: reliabilityConfig.heartbeatIntervalMs,
    });
  const scheduler = dependencies.createScheduler?.() ?? new CronScheduler();
  const rescueOrchestrator = dependencies.createRescueOrchestrator?.() ?? createRescueOrchestrator(logger);

  // 初始化 process check job runner
  const repairBudgetState = createRepairBudgetState(reliabilityConfig.repairBudget);
  const processCheckRunner = createProcessCheckJobRunner({
    bridgePidFilePath: './logs/bridge.pid',
    opencodePidFilePath: './logs/opencode.pid',
    opencodeHost: 'localhost',
    opencodePort: 4096,
    repairBudgetState,
    staleLockPaths: [],
  });

  const jobHandlers: ReliabilityJobHandlers = {
    watchdogProbe: async () => {
      await rescueOrchestrator.runWatchdogProbe();
    },
    processConsistencyCheck: async () => {
      await processCheckRunner.checkProcessConsistency();
    },
    staleCleanup: async () => {
      await rescueOrchestrator.runStaleCleanup();
      await cleanupOrphanCronJobs();
    },
    budgetReset: async () => {
      await processCheckRunner.resetBudget();
    },
  };

  const registry = dependencies.createJobRegistry?.(jobHandlers)
    ?? {
      registerAll: (injectedScheduler: ReliabilityScheduler) => {
        if (!(injectedScheduler instanceof CronScheduler)) {
          throw new Error('[Reliability] 默认任务注册器要求 CronScheduler 实例');
        }
        createInternalJobRegistry({
          handlers: jobHandlers,
        }).registerAll(injectedScheduler as CronScheduler);
      },
    };

  registry.registerAll(scheduler);

  let runtimeCronManager: RuntimeCronManager | null = null;
  const runtimeCronDispatcher = createRuntimeCronDispatcher({
    getSessionById: async (sessionId, options) => {
      return await opencodeClient.getSessionById(sessionId, options);
    },
    sendMessage: async (sessionId, text, options) => {
      return await opencodeClient.sendMessage(sessionId, text, options);
    },
    sendMessageAsync: async (sessionId, text, options) => {
      await opencodeClient.sendMessageAsync(sessionId, text, options);
      return true;
    },
    getSender: platform => {
      if (platform === 'feishu') {
        return feishuAdapter.getSender();
      }
      if (platform === 'discord') {
        return discordAdapter.getSender();
      }
      return null;
    },
    logger: {
      info: message => {
        logger.info(message);
      },
      warn: message => {
        logger.info(message);
      },
      error: (...args: unknown[]) => {
        logger.error('[RuntimeCronDispatch]', ...args);
      },
    },
  });
  if (scheduler instanceof CronScheduler) {
    runtimeCronManager = new RuntimeCronManager({
      scheduler,
      filePath: reliabilityConfig.cronJobsFile,
      dispatchPayload: async (job) => {
        await runtimeCronDispatcher.dispatch(job);
      },
      logger: {
        info: message => {
          logger.info(message);
        },
        warn: message => {
          logger.info(message);
        },
        error: (...args: unknown[]) => {
          logger.error('[RuntimeCron]', ...args);
        },
      },
    });
    setRuntimeCronManager(runtimeCronManager);
  } else {
    logger.info('[Reliability] 当前 scheduler 非 CronScheduler，跳过 runtime cron manager 注入');
    setRuntimeCronManager(null);
  }

  const cleanupOrphanCronJobs = async (): Promise<void> => {
    if (!runtimeCronManager || !reliabilityConfig.cronOrphanAutoCleanup) {
      return;
    }

    const cleanup = await scanAndCleanupOrphanRuntimeCronJobs(runtimeCronManager, {
      hasConversationBinding: (platform, conversationId, sessionId) => {
        const binding = chatSessionStore.getSessionByConversation(platform, conversationId);
        if (!binding) {
          return false;
        }
        return !sessionId || binding.sessionId === sessionId;
      },
      getSessionStatus: async (sessionId, directory) => {
        try {
          const session = await opencodeClient.getSessionById(
            sessionId,
            directory ? { directory } : undefined
          );
          return session ? 'exists' : 'missing';
        } catch {
          return 'unknown';
        }
      },
    });

    if (cleanup.removedJobIds.length > 0) {
      logger.info(`[RuntimeCron] orphan cleanup removed ${cleanup.removedJobIds.length} job(s)`);
    }
  };

  const proactiveHeartbeatRunner = createProactiveHeartbeatRunner({
    enabled: reliabilityConfig.proactiveHeartbeatEnabled,
    intervalMs: reliabilityConfig.heartbeatIntervalMs,
    prompt: reliabilityConfig.heartbeatPrompt || '',
    agent: reliabilityConfig.heartbeatAgent,
    client: {
      createSession: async (title?: string, directory?: string) => {
        const created = await opencodeClient.createSession(title, directory);
        return { id: created.id };
      },
      getSessionById: async (sessionId: string, options?: { directory?: string }) => {
        return await opencodeClient.getSessionById(sessionId, options);
      },
      sendMessage: async (
        sessionId: string,
        text: string,
        options?: {
          agent?: string;
          directory?: string;
          providerId?: string;
          modelId?: string;
          variant?: string;
        }
      ) => {
        const response = await opencodeClient.sendMessage(sessionId, text, options);
        return { parts: response.parts as unknown[] };
      },
    },
    notifyAlert: async (alertText: string) => {
      if (reliabilityConfig.heartbeatAlertChats.length === 0) {
        return;
      }

      const sender = feishuAdapter.getSender();
      for (const chatId of reliabilityConfig.heartbeatAlertChats) {
        try {
          await sender.sendText(chatId, `⚠️ [Heartbeat Alert]\n${alertText}`);
        } catch (error) {
          logger.error(`[Heartbeat] 发送告警失败 chat=${chatId}:`, error);
        }
      }
    },
    logger: {
      info: message => {
        logger.info(message);
      },
      warn: message => {
        logger.info(message);
      },
      error: (...args: unknown[]) => {
        logger.error(...args);
      },
    },
  });

  let cronApiServer: { start: () => Promise<void>; stop: () => Promise<void> } | null = null;
  if (reliabilityConfig.cronApiEnabled && runtimeCronManager) {
    cronApiServer = createCronApiServer(runtimeCronManager, {
      host: reliabilityConfig.cronApiHost,
      port: reliabilityConfig.cronApiPort,
      token: reliabilityConfig.cronApiToken,
      logger: {
        info: message => {
          logger.info(message);
        },
        warn: message => {
          logger.info(message);
        },
        error: (...args: unknown[]) => {
          logger.error(...args);
        },
      },
    });
    void cronApiServer.start().catch(error => {
      logger.error('[RuntimeCronAPI] 启动失败:', error);
    });
  }

  if (reliabilityConfig.cronEnabled) {
    void cleanupOrphanCronJobs().catch(error => {
      logger.error('[RuntimeCron] startup orphan cleanup failed:', error);
    });
    scheduler.start();
  }
  proactiveHeartbeatRunner.start();
  logger.info('[Reliability] bootstrap 完成（heartbeat + scheduler + rescue orchestrator）');

  let cleaned = false;

  return {
    onInboundMessage: async () => {
      if (!shouldUseInboundHeartbeat) {
        return;
      }
      try {
        await heartbeatEngine.onInboundMessage();
      } catch (error) {
        logger.error('[Heartbeat] 入站触发执行失败:', error);
      }
    },
    cleanup: async () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      await Promise.all([
        scheduler.stop(),
        Promise.resolve(rescueOrchestrator.cleanup()),
        Promise.resolve(proactiveHeartbeatRunner.stop()),
        cronApiServer ? cronApiServer.stop() : Promise.resolve(),
      ]);
      setRuntimeCronManager(null);
      logger.info('[Reliability] cleanup 完成');
    },
  };
};

async function main() {

  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   飞书 × OpenCode 桥接服务 v2.9.1 ║');
  console.log('╚════════════════════════════════════════════════╝');

  // 1. 如果启用了 OpenCode 自动启动，先清理旧进程并启动
  let opencodeChildProcess: import('node:child_process').ChildProcess | undefined;
  if (opencodeConfig.autoStart) {
    try {
      const { cleanupOpenCodeProcesses } = await import('./utils/process-cleanup.js');
      await cleanupOpenCodeProcesses();

      // 等待 3 秒确保 OpenCode 进程完全退出
      await new Promise(resolve => setTimeout(resolve, 3000));

      const { spawn } = await import('node:child_process');
      opencodeChildProcess = spawn(opencodeConfig.autoStartCmd, [], {
        stdio: 'ignore',
        detached: true,
      });

      opencodeChildProcess.on('error', (err) => {
        console.error('[Index] OpenCode 子进程错误:', err);
      });

      opencodeChildProcess.on('exit', (code) => {
        console.log(`[Index] OpenCode 子进程已退出，code=${code}`);
      });

      console.log(`[Index] OpenCode 已自动启动，PID=${opencodeChildProcess.pid}`);
    } catch (error) {
      console.warn('[Index] 启动 OpenCode 失败:', error);
    }
  }

  // 3. 验证配置
  try {
    validateConfig();
  } catch (error) {
    console.error('配置错误:', error);
    process.exit(1);
  }

  // 1.5. 路由器模式配置
  console.log(`[Config] 路由器模式: ${routerConfig.mode}`);
  if (routerConfig.enabledPlatforms.length > 0) {
    console.log(`[Config] 启用的平台: ${routerConfig.enabledPlatforms.join(', ')}`);
  } else {
    console.log(`[Config] 平台过滤: 未指定（所有平台可用）`);
  }
  if (routerConfig.mode === 'dual') {
    console.log(`[Config] ⚠️  双轨模式: 将记录新旧路由对比日志，不改变当前行为`);
    console.log(`[Config] 📝 如需回滚到旧版路由，设置 ROUTER_MODE=legacy 并重启服务`);
  }

  // 2. 连接 OpenCode
  const connected = await opencodeClient.connect();
  if (!connected) {
    console.error('无法连接到OpenCode服务器，请确保 opencode serve 已运行');
    process.exit(1);
  }

  // 3. 配置输出缓冲 (流式响应)
  const streamContentMap = new Map<string, { text: string; thinking: string }>();
  const reasoningSnapshotMap = new Map<string, string>();
  const textSnapshotMap = new Map<string, string>();
  const retryNoticeMap = new Map<string, string>();
  const errorNoticeMap = new Map<string, string>();
  const streamCardMessageIdsMap = new Map<string, string[]>();
  const STREAM_CARD_COMPONENT_BUDGET = 180;
  const CORRELATION_CACHE_TTL_MS = 10 * 60 * 1000;

  type CorrelationChatRef = {
    chatId: string;
    expiresAt: number;
  };

  const toolCallChatMap = new Map<string, CorrelationChatRef>();
  const messageChatMap = new Map<string, CorrelationChatRef>();

  type ToolRuntimeState = {
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    output?: string;
    kind?: 'tool' | 'subtask';
  };

  type TimelineSegment =
    | {
        type: 'text';
        text: string;
      }
    | {
        type: 'reasoning';
        text: string;
      }
    | {
        type: 'tool';
        name: string;
        status: ToolRuntimeState['status'];
        output?: string;
        kind?: 'tool' | 'subtask';
      }
    | {
        type: 'note';
        text: string;
        variant?: 'retry' | 'compaction' | 'question' | 'error' | 'permission';
      };

  type StreamTimelineState = {
    order: string[];
    segments: Map<string, TimelineSegment>;
  };

  const streamToolStateMap = new Map<string, Map<string, ToolRuntimeState>>();
  const streamTimelineMap = new Map<string, StreamTimelineState>();
  const getPendingPermissionForChat = (chatId: string): StreamCardPendingPermission | undefined => {
    const head = permissionHandler.peekForChat(chatId);
    if (!head) return undefined;

    const pendingCount = permissionHandler.getQueueSizeForChat(chatId);
    return {
      sessionId: head.sessionId,
      permissionId: head.permissionId,
      tool: head.tool,
      description: head.description,
      risk: head.risk,
      pendingCount,
      parentSessionId: head.parentSessionId,
      relatedSessionId: head.relatedSessionId,
    };
  };

  const getOrCreateTimelineState = (bufferKey: string): StreamTimelineState => {
    let timeline = streamTimelineMap.get(bufferKey);
    if (!timeline) {
      timeline = {
        order: [],
        segments: new Map(),
      };
      streamTimelineMap.set(bufferKey, timeline);
    }
    return timeline;
  };

  const trimTimeline = (timeline: StreamTimelineState): void => {
    const limit = 80;
    while (timeline.order.length > limit) {
      const removedKey = timeline.order.shift();
      if (removedKey) {
        timeline.segments.delete(removedKey);
      }
    }
  };

  const upsertTimelineSegment = (bufferKey: string, segmentKey: string, segment: TimelineSegment): void => {
    const timeline = getOrCreateTimelineState(bufferKey);
    if (!timeline.segments.has(segmentKey)) {
      timeline.order.push(segmentKey);
      trimTimeline(timeline);
    }
    timeline.segments.set(segmentKey, segment);
  };

  const appendTimelineText = (
    bufferKey: string,
    segmentKey: string,
    type: 'text' | 'reasoning',
    deltaText: string
  ): void => {
    if (!deltaText) return;
    const timeline = getOrCreateTimelineState(bufferKey);
    const previous = timeline.segments.get(segmentKey);
    if (previous && previous.type === type) {
      timeline.segments.set(segmentKey, {
        type,
        text: `${previous.text}${deltaText}`,
      });
      return;
    }

    if (!timeline.segments.has(segmentKey)) {
      timeline.order.push(segmentKey);
      trimTimeline(timeline);
    }
    timeline.segments.set(segmentKey, {
      type,
      text: deltaText,
    });
  };

  const setTimelineText = (
    bufferKey: string,
    segmentKey: string,
    type: 'text' | 'reasoning',
    text: string
  ): void => {
    const timeline = getOrCreateTimelineState(bufferKey);
    const previous = timeline.segments.get(segmentKey);
    if (previous && previous.type === type && previous.text === text) {
      return;
    }

    if (!timeline.segments.has(segmentKey)) {
      timeline.order.push(segmentKey);
      trimTimeline(timeline);
    }
    timeline.segments.set(segmentKey, { type, text });
  };

  const upsertTimelineTool = (
    bufferKey: string,
    toolKey: string,
    state: ToolRuntimeState,
    kind: 'tool' | 'subtask' = 'tool'
  ): void => {
    const segmentKey = `tool:${toolKey}`;
    const timeline = getOrCreateTimelineState(bufferKey);
    const previous = timeline.segments.get(segmentKey);
    if (previous && previous.type === 'tool') {
      timeline.segments.set(segmentKey, {
        type: 'tool',
        name: state.name,
        status: state.status,
        output: state.output ?? previous.output,
        kind,
      });
      return;
    }

    if (!timeline.segments.has(segmentKey)) {
      timeline.order.push(segmentKey);
      trimTimeline(timeline);
    }
    timeline.segments.set(segmentKey, {
      type: 'tool',
      name: state.name,
      status: state.status,
      ...(state.output !== undefined ? { output: state.output } : {}),
      kind,
    });
  };

  const upsertTimelineNote = (
    bufferKey: string,
    noteKey: string,
    text: string,
    variant?: 'retry' | 'compaction' | 'question' | 'error' | 'permission'
  ): void => {
    upsertTimelineSegment(bufferKey, `note:${noteKey}`, {
      type: 'note',
      text,
      ...(variant ? { variant } : {}),
    });
  };

  // 注入动作处理回调到 RootRouter
  rootRouter.setPermissionCallbacks(createPermissionActionCallbacks(upsertTimelineNote));
  rootRouter.setQuestionCallbacks(createQuestionActionCallbacks());
  const discordHandler = createDiscordHandler(discordAdapter.getSender());

  const getTimelineSegments = (bufferKey: string): StreamCardSegment[] => {
    const timeline = streamTimelineMap.get(bufferKey);
    if (!timeline) {
      return [];
    }

    const segments: StreamCardSegment[] = [];
    for (const key of timeline.order) {
      const segment = timeline.segments.get(key);
      if (!segment) continue;

      if (segment.type === 'text' || segment.type === 'reasoning') {
        if (!segment.text.trim()) continue;
        segments.push({
          type: segment.type,
          text: segment.text,
        });
        continue;
      }

      if (segment.type === 'tool') {
        segments.push({
          type: 'tool',
          name: segment.name,
          status: segment.status,
          ...(segment.output !== undefined ? { output: segment.output } : {}),
          ...(segment.kind ? { kind: segment.kind } : {}),
        });
        continue;
      }

      if (!segment.text.trim()) continue;
      segments.push({
        type: 'note',
        text: segment.text,
        ...(segment.variant ? { variant: segment.variant } : {}),
      });
    }

    return segments;
  };

  const getPendingQuestionForBuffer = (sessionId: string, chatId: string): StreamCardPendingQuestion | undefined => {
    const pending = questionHandler.getBySession(sessionId);
    if (!pending || pending.chatId !== chatId) {
      return undefined;
    }

    const totalQuestions = pending.request.questions.length;
    if (totalQuestions === 0) {
      return undefined;
    }

    const safeIndex = Math.min(Math.max(pending.currentQuestionIndex, 0), totalQuestions - 1);
    const question = pending.request.questions[safeIndex];
    if (!question) {
      return undefined;
    }

    return {
      requestId: pending.request.id,
      sessionId: pending.request.sessionID,
      chatId: pending.chatId,
      questionIndex: safeIndex,
      totalQuestions,
      header: typeof question.header === 'string' ? question.header : '',
      question: typeof question.question === 'string' ? question.question : '',
      options: Array.isArray(question.options)
        ? question.options.map(option => ({
            label: typeof option.label === 'string' ? option.label : '',
            description: typeof option.description === 'string' ? option.description : '',
          }))
        : [],
      multiple: question.multiple === true,
    };
  };

  const toSessionId = (value: unknown): string => {
    return typeof value === 'string' ? value : '';
  };

  const toNonEmptyString = (value: unknown): string | undefined => {
    if (typeof value !== 'string') {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  };

  const setCorrelationChatRef = (
    map: Map<string, CorrelationChatRef>,
    key: unknown,
    chatId: unknown
  ): void => {
    const normalizedKey = toNonEmptyString(key);
    const normalizedChatId = toNonEmptyString(chatId);
    if (!normalizedKey || !normalizedChatId) {
      return;
    }

    map.set(normalizedKey, {
      chatId: normalizedChatId,
      expiresAt: Date.now() + CORRELATION_CACHE_TTL_MS,
    });
  };

  const getCorrelationChatRef = (
    map: Map<string, CorrelationChatRef>,
    key: unknown
  ): string | undefined => {
    const normalizedKey = toNonEmptyString(key);
    if (!normalizedKey) {
      return undefined;
    }

    const entry = map.get(normalizedKey);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      map.delete(normalizedKey);
      return undefined;
    }

    if (!chatSessionStore.hasConversationId(entry.chatId)) {
      map.delete(normalizedKey);
      return undefined;
    }

    return entry.chatId;
  };

  type PermissionChatResolution = {
    chatId?: string;
    source: 'session' | 'parent_session' | 'related_session' | 'tool_call' | 'message' | 'unresolved';
  };

  const resolvePermissionChat = (event: PermissionRequestEvent): PermissionChatResolution => {
    const directChatId = chatSessionStore.getChatId(event.sessionId);
    if (directChatId) {
      return { chatId: directChatId, source: 'session' };
    }

    const parentSessionId = toNonEmptyString(event.parentSessionId);
    if (parentSessionId) {
      const parentChatId = chatSessionStore.getChatId(parentSessionId);
      if (parentChatId) {
        return { chatId: parentChatId, source: 'parent_session' };
      }
    }

    const relatedSessionId = toNonEmptyString(event.relatedSessionId);
    if (relatedSessionId) {
      const relatedChatId = chatSessionStore.getChatId(relatedSessionId);
      if (relatedChatId) {
        return { chatId: relatedChatId, source: 'related_session' };
      }
    }

    const toolCallChatId = getCorrelationChatRef(toolCallChatMap, event.callId);
    if (toolCallChatId) {
      return { chatId: toolCallChatId, source: 'tool_call' };
    }

    const messageChatId = getCorrelationChatRef(messageChatMap, event.messageId);
    if (messageChatId) {
      return { chatId: messageChatId, source: 'message' };
    }

    return { source: 'unresolved' };
  };

  const resolveSessionConversation = (
    sessionId: string
  ): { platform: string; conversationId: string } | null => {
    const conversation = chatSessionStore.getConversationBySessionId(sessionId);
    if (conversation) {
      return {
        platform: conversation.platform,
        conversationId: conversation.conversationId,
      };
    }

    const feishuChatId = chatSessionStore.getChatId(sessionId);
    if (feishuChatId) {
      return {
        platform: 'feishu',
        conversationId: feishuChatId,
      };
    }
    return null;
  };

  const buildBufferKeyBySession = (sessionId: string, conversationId: string): string => {
    const conversation = resolveSessionConversation(sessionId);
    const platform = conversation?.platform ?? 'feishu';
    const resolvedConversationId = conversation?.conversationId ?? conversationId;

    if (platform === 'feishu') {
      return `chat:${resolvedConversationId}`;
    }
    return `chat:${platform}:${resolvedConversationId}`;
  };

  const buildPermissionQueueKeyBySession = (sessionId: string, conversationId: string): string => {
    const conversation = resolveSessionConversation(sessionId);
    const platform = conversation?.platform ?? 'feishu';
    const resolvedConversationId = conversation?.conversationId ?? conversationId;

    if (platform === 'feishu') {
      return resolvedConversationId;
    }
    return `${platform}:${resolvedConversationId}`;
  };

  const buildPortableUpdateText = (data: StreamCardData, showThinking: boolean = true): string => {
    const mainText = data.text.trim();
    const thinkingText = showThinking ? data.thinking.trim() : '';

    if (mainText && thinkingText) {
      const safeThinking = thinkingText.replace(/```/g, '` ` `');
      const clippedThinking = safeThinking.length > 1400
        ? `${safeThinking.slice(0, 1400)}\n...(思考内容已截断)`
        : safeThinking;
      return [
        '-----------',
        '```md',
        clippedThinking,
        '```',
        '-----------',
        mainText,
      ].join('\n');
    }

    if (mainText) {
      return `-----------\n${mainText}`;
    }

    if (thinkingText) {
      const safeThinking = thinkingText.replace(/```/g, '` ` `');
      const clippedThinking = safeThinking.length > 1400
        ? `${safeThinking.slice(0, 1400)}\n...(思考内容已截断)`
        : safeThinking;
      return [
        '-----------',
        '```md',
        clippedThinking,
        '```',
        '-----------',
        '⏳ 正在处理...',
      ].join('\n');
    }

    if (data.status === 'failed') {
      return '❌ 执行失败';
    }

    if (data.status === 'completed') {
      return '✅ 已完成';
    }

    return '⏳ 正在处理...';
  };

  const buildPortableUpdatePayload = (data: StreamCardData, conversationId: string, platform: string = 'feishu'): { discordText: string; discordComponents?: Array<{
    type: 'select';
    customId: string;
    placeholder: string;
    options: Array<{ label: string; value: string; description?: string }>;
    minValues?: number;
    maxValues?: number;
  }> } => {
    // 根据平台读取可见性配置
    const showThinkingChain = platform === 'discord'
      ? outputConfig.discord.showThinkingChain
      : platform === 'feishu'
        ? outputConfig.feishu.showThinkingChain
        : outputConfig.showThinkingChain;
    const showToolChain = platform === 'discord'
      ? outputConfig.discord.showToolChain
      : platform === 'feishu'
        ? outputConfig.feishu.showToolChain
        : outputConfig.showToolChain;

    // 过滤 segments，移除 tool 和 reasoning 类型（当对应开关关闭时）
    const filteredSegments = showToolChain && showThinkingChain
      ? data.segments
      : (data.segments ?? []).filter(segment => {
          if (!showToolChain && segment.type === 'tool') return false;
          if (!showThinkingChain && segment.type === 'reasoning') return false;
          return true;
        });

    const filteredData: StreamCardData = {
      ...data,
      segments: filteredSegments,
    };

    const baseText = buildPortableUpdateText(filteredData, showThinkingChain);
    if (!data.pendingQuestion) {
      return { discordText: baseText };
    }

    const questionLine = `❓ ${data.pendingQuestion.question}`;
    const progressLine = `第 ${data.pendingQuestion.questionIndex + 1}/${data.pendingQuestion.totalQuestions} 题`;
    const discordText = `${baseText}\n${questionLine}\n${progressLine}`;

    const optionList = data.pendingQuestion.options
      .filter(option => option.label.trim().length > 0)
      .slice(0, 24)
      .map(option => ({
        label: option.label,
        value: option.label,
        ...(option.description ? { description: option.description } : {}),
      }));

    const options = [...optionList, {
      label: '跳过本题',
      value: '__skip__',
      description: '留空并进入下一题',
    }];

    if (options.length === 0) {
      return { discordText };
    }

    const maxValues = data.pendingQuestion.multiple
      ? Math.min(Math.max(1, optionList.length), 25)
      : 1;

    return {
      discordText,
      discordComponents: [
        {
          type: 'select',
          customId: `oc_question:${conversationId}`,
          placeholder: '选择当前问题答案',
          options,
          minValues: 1,
          maxValues,
        },
      ],
    };
  };

  const normalizeToolStatus = (status: unknown): 'pending' | 'running' | 'completed' | 'failed' => {
    if (status === 'pending' || status === 'running' || status === 'completed') {
      return status;
    }
    if (status === 'error' || status === 'failed') {
      return 'failed';
    }
    return 'running';
  };

  const getToolStatusText = (status: ToolRuntimeState['status']): string => {
    if (status === 'pending') return '等待中';
    if (status === 'running') return '执行中';
    if (status === 'completed') return '已完成';
    return '失败';
  };

  const stringifyToolOutput = (value: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  };

  const pickFirstDefined = (...values: unknown[]): unknown => {
    for (const value of values) {
      if (value !== undefined && value !== null) {
        return value;
      }
    }
    return undefined;
  };

  const buildToolTraceOutput = (
    part: Record<string, unknown>,
    status: ToolRuntimeState['status'],
    withInput: boolean
  ): string | undefined => {
    const state = asRecord(part.state);
    const inputValue = withInput
      ? pickFirstDefined(
          part.input,
          part.args,
          part.arguments,
          part.raw,
          part.rawInput,
          state?.input,
          state?.args,
          state?.arguments,
          state?.raw
        )
      : undefined;
    const outputValue = status === 'failed'
      ? pickFirstDefined(state?.error, state?.output, part.error)
      : pickFirstDefined(state?.output, state?.result, state?.message, part.output, part.result);

    const inputText = stringifyToolOutput(inputValue);
    const outputText = stringifyToolOutput(outputValue);
    const blocks: string[] = [];

    if (inputText && inputText.trim()) {
      blocks.push(`调用参数:\n${inputText.trim()}`);
    }

    if (outputText && outputText.trim()) {
      blocks.push(`${status === 'failed' ? '错误输出' : '执行输出'}:\n${outputText.trim()}`);
    }

    if (blocks.length === 0) {
      return `状态更新：${getToolStatusText(status)}`;
    }

    return blocks.join('\n\n');
  };

  const TOOL_TRACE_LIMIT = 20000;
  const clipToolTrace = (text: string): string => {
    if (text.length <= TOOL_TRACE_LIMIT) {
      return text;
    }
    const retained = text.slice(-TOOL_TRACE_LIMIT);
    return `...（历史输出过长，已截断前 ${text.length - TOOL_TRACE_LIMIT} 字）...\n${retained}`;
  };

  const mergeToolOutput = (previous: string | undefined, incoming: string | undefined): string | undefined => {
    if (!incoming || !incoming.trim()) {
      return previous;
    }

    const next = incoming.trim();
    if (!previous || !previous.trim()) {
      return clipToolTrace(next);
    }

    const prev = previous.trim();
    if (prev === next) {
      return previous;
    }

    if (next.startsWith(prev) || next.includes(prev)) {
      return clipToolTrace(next);
    }

    if (prev.startsWith(next) || prev.includes(next)) {
      return previous;
    }

    return clipToolTrace(`${previous}\n\n---\n${next}`);
  };

  const getOrCreateToolStateBucket = (bufferKey: string): Map<string, ToolRuntimeState> => {
    let bucket = streamToolStateMap.get(bufferKey);
    if (!bucket) {
      bucket = new Map();
      streamToolStateMap.set(bufferKey, bucket);
    }
    return bucket;
  };

  const syncToolsToBuffer = (bufferKey: string): void => {
    const bucket = streamToolStateMap.get(bufferKey);
    if (!bucket) {
      outputBuffer.setTools(bufferKey, []);
      return;
    }
    outputBuffer.setTools(bufferKey, Array.from(bucket.values()).map(item => ({
      name: item.name,
      status: item.status,
      ...(item.output !== undefined ? { output: item.output } : {}),
    })));
  };

  const upsertToolState = (
    bufferKey: string,
    toolKey: string,
    nextState: ToolRuntimeState,
    kind: 'tool' | 'subtask' = 'tool'
  ): void => {
    const bucket = getOrCreateToolStateBucket(bufferKey);
    const previous = bucket.get(toolKey);
    const mergedOutput = mergeToolOutput(previous?.output, nextState.output);
    bucket.set(toolKey, {
      name: nextState.name,
      status: nextState.status,
      output: mergedOutput,
      kind: nextState.kind ?? previous?.kind ?? kind,
    });
    upsertTimelineTool(bufferKey, toolKey, {
      name: nextState.name,
      status: nextState.status,
      output: mergedOutput,
      kind: nextState.kind ?? previous?.kind ?? kind,
    }, nextState.kind ?? previous?.kind ?? kind);
    syncToolsToBuffer(bufferKey);
  };

  const markActiveToolsCompleted = (bufferKey: string): void => {
    const bucket = streamToolStateMap.get(bufferKey);
    if (!bucket) return;
    for (const [toolKey, item] of bucket.entries()) {
      if (item.status === 'running' || item.status === 'pending') {
        bucket.set(toolKey, {
          ...item,
          status: 'completed',
        });
        upsertTimelineTool(bufferKey, toolKey, {
          ...item,
          status: 'completed',
        }, item.kind ?? 'tool');
      }
    }
    syncToolsToBuffer(bufferKey);
  };

  const appendTextFromPart = (sessionID: string, part: { id?: unknown; text?: unknown }, bufferKey: string): void => {
    if (typeof part.text !== 'string') return;
    if (typeof part.id !== 'string' || !part.id) {
      outputBuffer.append(bufferKey, part.text);
      appendTimelineText(bufferKey, `text:${sessionID}:anonymous`, 'text', part.text);
      return;
    }

    const key = `${sessionID}:${part.id}`;
    const prev = textSnapshotMap.get(key) || '';
    const current = part.text;
    if (current.startsWith(prev)) {
      const deltaText = current.slice(prev.length);
      if (deltaText) {
        outputBuffer.append(bufferKey, deltaText);
      }
    } else if (current !== prev) {
      outputBuffer.append(bufferKey, current);
    }
    textSnapshotMap.set(key, current);
    setTimelineText(bufferKey, `text:${key}`, 'text', current);
  };

  const appendReasoningFromPart = (sessionID: string, part: { id?: unknown; text?: unknown }, bufferKey: string): void => {
    if (typeof part.text !== 'string') return;
    if (typeof part.id !== 'string' || !part.id) {
      outputBuffer.appendThinking(bufferKey, part.text);
      appendTimelineText(bufferKey, `reasoning:${sessionID}:anonymous`, 'reasoning', part.text);
      return;
    }

    const key = `${sessionID}:${part.id}`;
    const prev = reasoningSnapshotMap.get(key) || '';
    const current = part.text;
    if (current.startsWith(prev)) {
      const deltaText = current.slice(prev.length);
      if (deltaText) {
        outputBuffer.appendThinking(bufferKey, deltaText);
      }
    } else if (current !== prev) {
      outputBuffer.appendThinking(bufferKey, current);
    }
    reasoningSnapshotMap.set(key, current);
    setTimelineText(bufferKey, `reasoning:${key}`, 'reasoning', current);
  };

  const clearPartSnapshotsForSession = (sessionID: string): void => {
    const prefix = `${sessionID}:`;
    for (const key of reasoningSnapshotMap.keys()) {
      if (key.startsWith(prefix)) {
        reasoningSnapshotMap.delete(key);
      }
    }
    for (const key of textSnapshotMap.keys()) {
      if (key.startsWith(prefix)) {
        textSnapshotMap.delete(key);
      }
    }
    retryNoticeMap.delete(sessionID);
    errorNoticeMap.delete(sessionID);
  };

  const formatProviderError = (raw: unknown): string => {
    if (!raw || typeof raw !== 'object') {
      return '模型执行失败';
    }

    const error = raw as { name?: unknown; data?: Record<string, unknown> };
    const name = typeof error.name === 'string' ? error.name : 'UnknownError';
    const data = error.data && typeof error.data === 'object' ? error.data : {};

    if (name === 'APIError') {
      const message = typeof data.message === 'string' ? data.message : '上游接口报错';
      const statusCode = typeof data.statusCode === 'number' ? data.statusCode : undefined;
      if (statusCode === 429) {
        return `模型请求过快（429）：${message}`;
      }
      if (statusCode === 408 || statusCode === 504) {
        return `模型响应超时：${message}`;
      }
      return statusCode ? `模型接口错误（${statusCode}）：${message}` : `模型接口错误：${message}`;
    }

    if (name === 'ProviderAuthError') {
      const providerID = typeof data.providerID === 'string' ? data.providerID : 'unknown';
      const message = typeof data.message === 'string' ? data.message : '鉴权失败';
      return `模型鉴权失败（${providerID}）：${message}`;
    }

    if (name === 'MessageOutputLengthError') {
      return '模型输出超过长度限制，已中断';
    }

    if (name === 'MessageAbortedError') {
      const message = typeof data.message === 'string' ? data.message : '会话已中断';
      return `会话已中断：${message}`;
    }

    const generic = typeof data.message === 'string' ? data.message : '';
    return generic ? `${name}：${generic}` : `${name}`;
  };

  const upsertLiveCardInteraction = (
    chatId: string,
    replyMessageId: string | null,
    cardData: StreamCardData,
    bodyMessageIds: string[],
    thinkingMessageId: string | null,
    openCodeMsgId: string
  ): void => {
    const botMessageIds = [...bodyMessageIds, thinkingMessageId].filter((id: string | null): id is string => typeof id === 'string' && id.length > 0);
    if (botMessageIds.length === 0) {
      return;
    }

    let existing: InteractionRecord | undefined;
    for (const msgId of botMessageIds) {
      existing = chatSessionStore.findInteractionByBotMsgId(chatId, msgId);
      if (existing) {
        break;
      }
    }

    if (existing) {
      chatSessionStore.updateInteraction(
        chatId,
        r => r === existing,
        r => {
          if (!r.userFeishuMsgId && replyMessageId) {
            r.userFeishuMsgId = replyMessageId;
          }

          for (const msgId of botMessageIds) {
            if (!r.botFeishuMsgIds.includes(msgId)) {
              r.botFeishuMsgIds.push(msgId);
            }
          }

          r.cardData = { ...cardData };
          r.type = 'normal';
          if (openCodeMsgId) {
            r.openCodeMsgId = openCodeMsgId;
          }
          r.timestamp = Date.now();
        }
      );
      return;
    }

    chatSessionStore.addInteraction(chatId, {
      userFeishuMsgId: replyMessageId || '',
      openCodeMsgId: openCodeMsgId || '',
      botFeishuMsgIds: botMessageIds,
      type: 'normal',
      cardData: { ...cardData },
      timestamp: Date.now(),
    });
  };

  outputBuffer.setUpdateCallback(async (buffer) => {
    const { text, thinking } = outputBuffer.getAndClear(buffer.key);
    const timelineSegments = getTimelineSegments(buffer.key);
    const sessionConversation = resolveSessionConversation(buffer.sessionId);
    const platform = sessionConversation?.platform ?? 'feishu';
    const conversationId = sessionConversation?.conversationId ?? buffer.chatId;
    const permissionQueueKey = buildPermissionQueueKeyBySession(buffer.sessionId, conversationId);
    const pendingPermission = getPendingPermissionForChat(permissionQueueKey);
    const pendingQuestion = getPendingQuestionForBuffer(buffer.sessionId, conversationId);

    if (
      !text &&
      !thinking &&
      timelineSegments.length === 0 &&
      buffer.tools.length === 0 &&
      !pendingPermission &&
      !pendingQuestion &&
      buffer.status === 'running'
    ) return;

    const current = streamContentMap.get(buffer.key) || { text: '', thinking: '' };
    current.text += text;
    current.thinking += thinking;

    if (buffer.status !== 'running') {
      if (buffer.finalText) {
        current.text = buffer.finalText;
      }
      if (buffer.finalThinking) {
        current.thinking = buffer.finalThinking;
      }
    }

    streamContentMap.set(buffer.key, current);

    const hasVisibleContent =
      current.text.trim().length > 0 ||
      current.thinking.trim().length > 0 ||
      buffer.tools.length > 0 ||
      timelineSegments.length > 0 ||
      Boolean(pendingPermission) ||
      Boolean(pendingQuestion);

    if (!hasVisibleContent && buffer.status === 'running') return;

    const status: StreamCardData['status'] =
      buffer.status === 'failed' || buffer.status === 'aborted'
        ? 'failed'
        : buffer.status === 'completed'
          ? 'completed'
          : 'processing';

    let existingMessageIds = streamCardMessageIdsMap.get(buffer.key) || [];
    if (existingMessageIds.length === 0 && buffer.messageId) {
      existingMessageIds = [buffer.messageId];
    }

    const cardData: StreamCardData = {
      text: current.text,
      thinking: current.thinking,
      chatId: conversationId,
      messageId: existingMessageIds[0] || undefined,
      tools: [...buffer.tools],
      segments: timelineSegments,
      ...(pendingPermission ? { pendingPermission } : {}),
      ...(pendingQuestion ? { pendingQuestion } : {}),
      status,
      showThinking: false,
    };

    if (platform !== 'feishu') {
      const sender = platform === 'discord' ? discordAdapter.getSender() : feishuAdapter.getSender();
      const payload = buildPortableUpdatePayload(cardData, conversationId, platform);
      const nextMessageIds: string[] = [];
      const existingMessageId = existingMessageIds[0];

      if (existingMessageId) {
        const updated = await sender.updateCard(existingMessageId, payload);
        if (updated) {
          nextMessageIds.push(existingMessageId);
        } else {
          const replacementMessageId = await sender.sendCard(conversationId, payload);
          if (replacementMessageId) {
            void sender.deleteMessage(existingMessageId).catch(() => undefined);
            nextMessageIds.push(replacementMessageId);
          }
        }
      } else {
        const newMessageId = await sender.sendCard(conversationId, payload);
        if (newMessageId) {
          nextMessageIds.push(newMessageId);
        }
      }

      for (let index = 1; index < existingMessageIds.length; index++) {
        const redundantMessageId = existingMessageIds[index];
        if (!redundantMessageId) {
          continue;
        }
        void sender.deleteMessage(redundantMessageId).catch(() => undefined);
      }

      if (nextMessageIds.length > 0) {
        outputBuffer.setMessageId(buffer.key, nextMessageIds[0]);
        streamCardMessageIdsMap.set(buffer.key, nextMessageIds);
      } else {
        streamCardMessageIdsMap.delete(buffer.key);
      }

      if (buffer.status !== 'running') {
        streamContentMap.delete(buffer.key);
        streamToolStateMap.delete(buffer.key);
        streamTimelineMap.delete(buffer.key);
        streamCardMessageIdsMap.delete(buffer.key);
        clearPartSnapshotsForSession(buffer.sessionId);
        outputBuffer.clear(buffer.key);
      }
      return;
    }

    const cards = buildStreamCards(
      {
        ...cardData,
        messageId: existingMessageIds[0] || undefined,
      },
      {
        componentBudget: STREAM_CARD_COMPONENT_BUDGET,
      }
    );

    const nextMessageIds: string[] = [];

    const sender = feishuAdapter.getSender();
    for (let index = 0; index < cards.length; index++) {
      const card = cards[index];
      const existingMessageId = existingMessageIds[index];

      if (existingMessageId) {
        const updated = await sender.updateCard(existingMessageId, card);
        if (updated) {
          nextMessageIds.push(existingMessageId);
          continue;
        }

        const replacementMessageId = await sender.sendCard(conversationId, card);
        if (replacementMessageId) {
          void sender.deleteMessage(existingMessageId).catch(() => undefined);
          nextMessageIds.push(replacementMessageId);
        } else {
          nextMessageIds.push(existingMessageId);
        }
        continue;
      }

      const newMessageId = await sender.sendCard(conversationId, card);
      if (newMessageId) {
        nextMessageIds.push(newMessageId);
      }
    }

    for (let index = cards.length; index < existingMessageIds.length; index++) {
      const redundantMessageId = existingMessageIds[index];
      if (!redundantMessageId) {
        continue;
      }
      void sender.deleteMessage(redundantMessageId).catch(() => undefined);
    }

    if (nextMessageIds.length > 0) {
      outputBuffer.setMessageId(buffer.key, nextMessageIds[0]);
      streamCardMessageIdsMap.set(buffer.key, nextMessageIds);
    } else {
      streamCardMessageIdsMap.delete(buffer.key);
    }

    cardData.messageId = nextMessageIds[0] || undefined;
    cardData.thinkingMessageId = undefined;

    upsertLiveCardInteraction(
      conversationId,
      buffer.replyMessageId,
      cardData,
      nextMessageIds,
      null,
      buffer.openCodeMsgId
    );

    if (buffer.status !== 'running') {
      streamContentMap.delete(buffer.key);
      streamToolStateMap.delete(buffer.key);
      streamTimelineMap.delete(buffer.key);
      streamCardMessageIdsMap.delete(buffer.key);
      clearPartSnapshotsForSession(buffer.sessionId);
      outputBuffer.clear(buffer.key);
    }
  });

  // 3.5 初始化 Reliability 生命周期（heartbeat + scheduler + rescue orchestrator）
  const reliabilityLifecycle = bootstrapReliabilityLifecycle();

  // 4. 监听飞书消息（通过路由器分发）
  feishuClient.on('message', async (event) => {
    await reliabilityLifecycle.onInboundMessage();
    await rootRouter.onMessage(event);
  });

  feishuClient.on('chatUnavailable', (chatId: string) => {
    console.warn(`[Index] 检测到不可用群聊，移除会话绑定: ${chatId}`);
    chatSessionStore.removeSession(chatId);
  });

  // 5. 监听飞书卡片动作（通过路由器分发）
  feishuClient.setCardActionHandler(async (event) => {
    return await rootRouter.onAction(event);
  });

  discordAdapter.onMessage(async (event) => {
    await discordHandler.handleMessage(event);
  });

  discordAdapter.onInteraction(async (interaction) => {
    await discordHandler.handleInteraction(interaction);
  });


  // 6. OpenCode 事件监听已移至 openCodeEventHub（单一入口）

  // 6.5 注入事件处理上下文到 OpenCode Event Hub（必须在所有辅助函数声明之后）
  const applyFailureToSession = async (sessionID: string, errorText: string): Promise<void> => {
    const conversation = resolveSessionConversation(sessionID);
    if (!conversation) return;
    const platform = conversation.platform;
    const conversationId = conversation.conversationId;

    const dedupeKey = `${sessionID}:${errorText}`;
    if (errorNoticeMap.get(sessionID) === dedupeKey) {
      return;
    }
    errorNoticeMap.set(sessionID, dedupeKey);

    const bufferKey = buildBufferKeyBySession(sessionID, conversationId);
    const existingBuffer = outputBuffer.get(bufferKey) || outputBuffer.getOrCreate(bufferKey, conversationId, sessionID, null);

    upsertTimelineNote(bufferKey, `error:${sessionID}:${errorText}`, `❌ ${errorText}`, 'error');
    outputBuffer.append(bufferKey, `\n\n❌ ${errorText}`);
    outputBuffer.touch(bufferKey);
    outputBuffer.setStatus(bufferKey, 'failed');

    if (!existingBuffer.messageId) {
      const sender = platform === 'discord' ? discordAdapter.getSender() : feishuAdapter.getSender();
      await sender.sendText(conversationId, `❌ ${errorText}`);
    }
  };

  openCodeEventHub.setContext({
    CORRELATION_CACHE_TTL_MS,
    streamContentMap,
    reasoningSnapshotMap,
    textSnapshotMap,
    retryNoticeMap,
    errorNoticeMap,
    streamCardMessageIdsMap,
    toolCallChatMap,
    messageChatMap,
    streamToolStateMap,
    streamTimelineMap,
    toSessionId,
    toNonEmptyString,
    setCorrelationChatRef,
    getCorrelationChatRef,
    resolvePermissionChat,
    normalizeToolStatus,
    getToolStatusText,
    stringifyToolOutput,
    asRecord,
    pickFirstDefined,
    buildToolTraceOutput,
    clipToolTrace,
    mergeToolOutput,
    getOrCreateToolStateBucket,
    syncToolsToBuffer,
    upsertToolState,
    markActiveToolsCompleted,
    appendTextFromPart,
    appendReasoningFromPart,
    clearPartSnapshotsForSession,
    formatProviderError,
    upsertLiveCardInteraction,
    getTimelineSegments,
    getPendingPermissionForChat,
    getPendingQuestionForBuffer,
    applyFailureToSession,
    upsertTimelineNote,
    appendTimelineText,
    setTimelineText,
    upsertTimelineTool,
  });

  // 注册 OpenCode 事件监听器（单一入口）
  openCodeEventHub.register();

  // 7. 监听生命周期事件 (需要在启动后注册)
  feishuClient.onMemberLeft(async (chatId, memberId) => {
    await lifecycleHandler.handleMemberLeft(chatId, memberId);
  });

  feishuClient.onChatDisbanded(async (chatId) => {
    console.log(`[Index] 群 ${chatId} 已解散`);
    if (reliabilityConfig.cronOrphanAutoCleanup) {
      cleanupRuntimeCronJobsByConversation(getRuntimeCronManager(), 'feishu', chatId);
    }
    chatSessionStore.removeSession(chatId);
  });
  
  feishuClient.onMessageRecalled(async (event) => {
    // 处理撤回
    // event.message_id, event.chat_id
    // 如果撤回的消息是该会话最后一条 User Message，则触发 Undo
    const chatId = event.chat_id;
    const recalledMsgId = event.message_id;
    
    if (chatId && recalledMsgId) {
       const session = chatSessionStore.getSession(chatId);
       if (session && session.lastFeishuUserMsgId === recalledMsgId) {
          console.log(`[Index] 检测到用户撤回最后一条消息: ${recalledMsgId}`);
          await commandHandler.handleUndo(chatId);
       }
    }
  });

  // 7.5. 启动 Discord 适配器（如果启用）
  try {
    await discordAdapter.start();
  } catch (e) {
    console.error('[Discord] 启动失败:', e);
    // Discord 启动失败不影响 Feishu 流程
  }
  // 8. 启动飞书客户端
  feishuClient.setCardActionHandler(async (event) => {
    const actionValue = event.action?.value;
    const action = actionValue && typeof actionValue === 'object'
      ? (actionValue as Record<string, unknown>).action
      : undefined;
    const actionName = typeof action === 'string' ? action : '';

    if (actionName.startsWith('create_chat')) {
      return await p2pHandler.handleCardAction(event);
    }

    return await cardActionHandler.handle(event);
  });
  await feishuClient.start();

  // 9. 启动清理检查
  await lifecycleHandler.cleanUpOnStart();

  console.log('✅ 服务已就绪');
  
  // 优雅退出处理
  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    console.log(`\n[${signal}] 正在关闭服务...`);

    // 1. 优先终止 OpenCode 子进程（如果由 Bridge 启动）
    if (opencodeChildProcess) {
      try {
        console.log('[Shutdown] 正在终止 OpenCode 子进程...');
        opencodeChildProcess.kill('SIGTERM');
        // 等待子进程退出
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (!opencodeChildProcess.killed) {
          opencodeChildProcess.kill('SIGKILL');
          console.log('[Shutdown] 已强制终止 OpenCode 子进程');
        }
      } catch (e) {
        console.error('[Shutdown] 终止 OpenCode 子进程失败:', e);
      }
    }

    // 2. 停止 reliability 调度和救援资源
    try {
      await reliabilityLifecycle.cleanup();
    } catch (e) {
      console.error('停止 reliability 资源失败:', e);
    }

    // 3. 停止 Discord 适配器
    try {
      discordAdapter.stop();
    } catch (e) {
      console.error('停止 Discord 适配器失败:', e);
    }

    // 4. 停止飞书连接
    try {
      feishuClient.stop();
    } catch (e) {
      console.error('停止飞书连接失败:', e);
    }

    // 5. 断开 OpenCode 连接
    try {
      opencodeClient.disconnect();
    } catch (e) {
      console.error('断开 OpenCode 失败:', e);
    }

    // 6. 清理所有缓冲区和定时器
    try {
      outputBuffer.clearAll();
      delayedResponseHandler.cleanupExpired(0);
      questionHandler.cleanupExpired(0);
    } catch (e) {
      console.error('清理资源失败:', e);
    }

    // 延迟退出以确保所有清理完成
    setTimeout(() => {
      console.log('✅ 服务已安全关闭');
      process.exit(0);
    }, 500);
  };

  process.on('SIGINT', () => {
    void gracefulShutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM');
  });
  process.on('SIGUSR2', () => {
    void gracefulShutdown('SIGUSR2');
  }); // nodemon 重启信号
}

if (process.env.VITEST !== 'true') {
  main().catch(error => {
    console.error('Fatal Error:', error);
    process.exit(1);
  });
}
