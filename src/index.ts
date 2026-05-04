import { spawn } from 'node:child_process';
import { VERSION } from './utils/version.js';
import { initLogger } from './utils/logger.js';
import { logStore } from './store/log-store.js';
import { createAdminServer } from './admin/admin-server.js';
import { feishuClient, type FeishuMessageEvent } from './feishu/client.js';
// 平台适配器动态加载，不再静态导入
import type { PlatformSender, PlatformAdapter } from './platform/types.js';
import { loadAllConfigured, getSenderByPlatform, getCachedAdapter, getConfiguredPlatforms, clearCache } from './platform/loader.js';
import { opencodeClient, type PermissionRequestEvent } from './opencode/client.js';
import { streamStateManager, type ToolRuntimeState, type TimelineSegment, type StreamTimelineState } from './store/stream-state.js';
import { buildTelegramText, buildPortableUpdateText, buildPortableUpdatePayload } from './utils/text-builder.js';

import { outputBuffer } from './opencode/output-buffer.js';
import { delayedResponseHandler } from './opencode/delayed-handler.js';
import { questionHandler } from './opencode/question-handler.js';
import { permissionHandler } from './permissions/handler.js';
import { chatSessionStore, type InteractionRecord } from './store/chat-session.js';
import { p2pHandler } from './handlers/p2p.js';
import { groupHandler } from './handlers/group.js';
import { lifecycleHandler } from './handlers/lifecycle.js';
import { createDiscordHandler } from './handlers/discord.js';
import { wecomHandler } from './handlers/wecom.js';
import { telegramHandler } from './handlers/telegram.js';
import { qqHandler } from './handlers/qq.js';
import { whatsappHandler } from './handlers/whatsapp.js';
import { weixinHandler } from './handlers/weixin.js';
import { dingtalkHandler } from './handlers/dingtalk.js';
import { commandHandler } from './handlers/command.js';
import { cardActionHandler } from './handlers/card-action.js';
import { validateConfig, routerConfig, outputConfig, reliabilityConfig, opencodeConfig, isPlatformConfigured } from './config.js';
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
              const isWindows = process.platform === 'win32';
              const child = spawn('opencode', [], {
                detached: true,
                stdio: 'ignore',
                shell: isWindows,
                windowsHide: isWindows,
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
      return getSenderByPlatform(platform);
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

      const feishuAdapter = getCachedAdapter('feishu');
      if (!feishuAdapter) {
        logger.error('[Heartbeat] 飞书适配器未加载，无法发送告警');
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
  // 初始化日志收集器（最早执行，捕获所有后续日志）
  initLogger(logStore);

  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   飞书 × OpenCode 桥接服务 v' + VERSION + '     ║');
  console.log('╚════════════════════════════════════════════════╝');

  // 0. 动态加载已配置的平台适配器（避免全量加载 SDK）
  const configuredPlatforms = getConfiguredPlatforms();
  console.log(`[Platform] 已配置的平台: ${configuredPlatforms.join(', ') || '无'}`);
  await loadAllConfigured();

  // 1. 如果启用了 OpenCode 自动启动，通过 process-manager 幂等启动后台服务
  if (opencodeConfig.autoStart) {
    try {
      console.log('[Index] 正在启动 OpenCode serve（后台模式）...');
      const { spawnSync, spawn } = await import('node:child_process');
      const { fileURLToPath } = await import('node:url');
      const pathMod = await import('node:path');
      const isWindows = process.platform === 'win32';

      // 确定 process-manager 路径（兼容开发/打包两种环境）
      // 开发模式检测（process.resourcesPath 是 Electron 特有属性）
      const isDev = process.env.NODE_ENV === 'development' || !(process as any).resourcesPath;
      let processManagerPath: string;
      if ((process as any).resourcesPath && !isDev) {
        // Electron 打包后：scripts 在 resources/app/scripts/
        processManagerPath = pathMod.join((process as any).resourcesPath, 'app', 'scripts', 'process-manager.mjs');
      } else {
        // 开发环境：src/index.ts 位于项目根下的 src/；构建后：dist/index.js 位于项目根下的 dist/
        // 这两种布局到项目根的相对层级一致，因此统一回退一层即可定位 scripts/。
        const selfDir = pathMod.dirname(fileURLToPath(import.meta.url));
        processManagerPath = pathMod.resolve(selfDir, '../scripts/process-manager.mjs');
      }

      // 检查 process-manager 是否存在
      console.log(`[Index] process-manager 路径: ${processManagerPath}`);

      // 使用 start-opencode（幂等：已在运行则跳过）
      const startResult = spawnSync(process.execPath, [processManagerPath, 'start-opencode'], {
        encoding: 'utf-8',
        windowsHide: isWindows,
        timeout: 15000,
        stdio: 'pipe',
      });

      if (startResult.stdout?.trim()) {
        console.log('[Index] OpenCode 启动输出:', startResult.stdout.trim());
      }
      if (startResult.stderr?.trim()) {
        console.warn('[Index] OpenCode 启动错误:', startResult.stderr.trim());
      }

      if (startResult.status !== 0) {
        console.error(`[Index] OpenCode 自动启动失败，退出码: ${startResult.status}（将继续启动 Bridge）`);
        if (startResult.error) {
          console.error('[Index] 错误详情:', startResult.error.message);
        }
      } else {
        console.log('[Index] OpenCode serve 启动成功');
      }

      // 如果开启了前台模式，等待 opencode serve 的端口就绪后再弹出 attach 窗口（Windows 专用）
      // 做法：
      //   1. 轮询 TCP（最多 15s），等待 http://localhost:<port> 可连接
      //   2. 通过 PowerShell 的 Start-Process 拉起一个新的可见 CMD 控制台跑 opencode attach
      //      —— 不能再用 `cmd /c start ... + windowsHide:true`：父进程无 console 时
      //         CREATE_NO_WINDOW 会传染到 start，导致弹窗失败。
      //         核心约束：后台 opencode serve 由 process-manager 用 Start-Process -WindowStyle Hidden
      //         启动且不能弹任何 CMD，本块只影响"前台 attach 窗口"，与之相互独立。
      if (opencodeConfig.autoStartForeground && isWindows) {
        void (async () => {
          const { probeTcpPort } = await import('./reliability/process-guard.js');
          const host = opencodeConfig.host;
          const port = opencodeConfig.port;
          const attachUrl = `http://${host}:${port}`;
          const deadline = Date.now() + 15000;

          let ready = false;
          while (Date.now() < deadline) {
            const probe = await probeTcpPort(host, port, 1000);
            if (probe.isOpen) {
              ready = true;
              break;
            }
            await new Promise(r => setTimeout(r, 500));
          }

          if (!ready) {
            console.warn(`[Index] OpenCode serve 端口未就绪（${attachUrl}），跳过前台 attach 窗口`);
            return;
          }

          try {
            spawn(
              'powershell.exe',
              [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `Start-Process cmd -ArgumentList '/k opencode attach ${attachUrl}'`,
              ],
              {
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
              }
            ).unref();
            console.log(`[Index] OpenCode 前台窗口已拉起（${attachUrl}）`);
          } catch (err) {
            console.warn('[Index] 拉起 OpenCode 前台窗口失败:', err);
          }
        })();
      }
    } catch (error) {
      console.warn('[Index] 启动 OpenCode 失败:', error);
    }
  }

  // 注册进程退出时的清理逻辑（后台 opencode serve 由 process-manager 独立管理，不在此清理）
  const cleanupChildProcess = () => {
    // 已迁移到 process-manager 管理，此处保留钩子供将来扩展
  };

  // 监听主进程退出事件
  process.on('exit', cleanupChildProcess);
  process.on('SIGINT', () => {
    cleanupChildProcess();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanupChildProcess();
    process.exit(0);
  });

  // 3. 验证配置
  try {
    validateConfig();
  } catch (error) {
    console.warn('[Config] ⚠️ 未检测到已配置的平台（可能是首次部署），机器人服务暂不拉起。');
    console.warn('[Config] 💡 核心管理后台即将启动，请前往 Web 控制台配置相关参数并按提示重启服务生效！');
    console.warn(`[Config] 详细信息: ${error instanceof Error ? error.message : String(error)}`);
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

  // 2. 先启动 Admin Server（确保管理面板可用，即使 OpenCode 未运行）
  // 若 TUI 配置 WEB_ADMIN_DISABLED=true 或运行时 env BRIDGE_DISABLE_ADMIN=1，
  // 则跳过 admin server 启动 —— 平台适配器仍会正常工作（仅 web 不可用）。
  const { configStore: _cs } = await import('./store/config-store.js');
  const _adminDisabledByCfg = (_cs.get().WEB_ADMIN_DISABLED ?? '') === 'true';
  const _adminDisabledByEnv = process.env.BRIDGE_DISABLE_ADMIN === '1';
  const adminDisabled = _adminDisabledByCfg || _adminDisabledByEnv;
  if (!process.env.BRIDGE_SPAWNED_BY_ADMIN && !adminDisabled) {
    const adminPort = parseInt(process.env.ADMIN_PORT ?? _cs.get().ADMIN_PORT ?? '4098', 10);
    const adminServer = createAdminServer({
      port: adminPort,
      cronManager: undefined, // cronManager 在后面初始化
      startedAt: new Date(),
      version: VERSION,
    });
    adminServer.start();
    console.log(`[Admin] 管理面板已启动: http://localhost:${adminPort}`);
  } else if (adminDisabled) {
    console.log('[Admin] Web 管理面板已通过配置禁用（接入平台仍正常运行）');
  }

  // 3. 连接 OpenCode（失败不退出，允许用户在管理面板中诊断）
  const connected = await opencodeClient.connect();
  if (!connected) {
    console.warn('[OpenCode] ⚠️ 无法连接到服务器，请确保 opencode serve 已运行');
    console.warn('[OpenCode] 💡 管理面板已启动，请在浏览器中配置并诊断');
  }

  // 3. 配置输出缓冲 (流式响应)
  const STREAM_CARD_COMPONENT_BUDGET = 180;
  const CORRELATION_CACHE_TTL_MS = 10 * 60 * 1000;

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
    return streamStateManager.getOrCreateTimeline(bufferKey);
  };

  const trimTimeline = (timeline: StreamTimelineState): void => {
    streamStateManager.trimTimeline(timeline);
  };

  const upsertTimelineSegment = (bufferKey: string, segmentKey: string, segment: TimelineSegment): void => {
    streamStateManager.upsertTimelineSegment(bufferKey, segmentKey, segment);
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

  const getTimelineSegments = (bufferKey: string): StreamCardSegment[] => {
    const timeline = streamStateManager.getTimeline(bufferKey);
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

  // 关联缓存辅助函数（使用 StreamStateManager）
  const setToolCallCorrelation = (toolCallId: unknown, chatId: unknown): void => {
    const normalizedKey = toNonEmptyString(toolCallId);
    const normalizedChatId = toNonEmptyString(chatId);
    if (!normalizedKey || !normalizedChatId) return;
    streamStateManager.setToolCallChat(normalizedKey, normalizedChatId);
  };

  const setMessageCorrelation = (messageId: unknown, chatId: unknown): void => {
    const normalizedKey = toNonEmptyString(messageId);
    const normalizedChatId = toNonEmptyString(chatId);
    if (!normalizedKey || !normalizedChatId) return;
    streamStateManager.setMessageChat(normalizedKey, normalizedChatId);
  };

  const getToolCallCorrelation = (toolCallId: unknown): string | undefined => {
    const normalizedKey = toNonEmptyString(toolCallId);
    if (!normalizedKey) return undefined;
    const chatId = streamStateManager.getChatIdByToolCall(normalizedKey);
    if (!chatId) return undefined;
    // 会话存在性检查
    if (!chatSessionStore.hasConversationId(chatId)) {
      return undefined;
    }
    return chatId;
  };

  const getMessageCorrelation = (messageId: unknown): string | undefined => {
    const normalizedKey = toNonEmptyString(messageId);
    if (!normalizedKey) return undefined;
    const chatId = streamStateManager.getChatIdByMessage(normalizedKey);
    if (!chatId) return undefined;
    // 会话存在性检查
    if (!chatSessionStore.hasConversationId(chatId)) {
      return undefined;
    }
    return chatId;
  };

  // 兼容旧接口（已废弃，保留导出兼容性）
  const setCorrelationChatRef = (
    _map: unknown,
    key: unknown,
    chatId: unknown
  ): void => {
    console.warn('[Deprecated] setCorrelationChatRef is deprecated, use setToolCallCorrelation or setMessageCorrelation instead');
  };

  const getCorrelationChatRef = (
    _map: unknown,
    key: unknown
  ): string | undefined => {
    console.warn('[Deprecated] getCorrelationChatRef is deprecated, use getToolCallCorrelation or getMessageCorrelation instead');
    return undefined;
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

    const toolCallChatId = getToolCallCorrelation(event.callId);
    if (toolCallChatId) {
      return { chatId: toolCallChatId, source: 'tool_call' };
    }

    const messageChatId = getMessageCorrelation(event.messageId);
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
    let bucket = streamStateManager.getToolStates(bufferKey);
    if (!bucket) {
      bucket = new Map();
      streamStateManager.setToolStates(bufferKey, bucket);
    }
    return bucket;
  };

  const syncToolsToBuffer = (bufferKey: string): void => {
    const bucket = streamStateManager.getToolStates(bufferKey);
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
    const bucket = streamStateManager.getToolStates(bufferKey);
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
    const prev = streamStateManager.getTextSnapshot(key) || '';
    const current = part.text;
    if (current.startsWith(prev)) {
      const deltaText = current.slice(prev.length);
      if (deltaText) {
        outputBuffer.append(bufferKey, deltaText);
      }
    } else if (current !== prev) {
      outputBuffer.append(bufferKey, current);
    }
    streamStateManager.setTextSnapshot(key, current);
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
    const prev = streamStateManager.getReasoningSnapshot(key) || '';
    const current = part.text;
    if (current.startsWith(prev)) {
      const deltaText = current.slice(prev.length);
      if (deltaText) {
        outputBuffer.appendThinking(bufferKey, deltaText);
      }
    } else if (current !== prev) {
      outputBuffer.appendThinking(bufferKey, current);
    }
    streamStateManager.setReasoningSnapshot(key, current);
    setTimelineText(bufferKey, `reasoning:${key}`, 'reasoning', current);
  };

  const clearPartSnapshotsForSession = (sessionID: string): void => {
    // 注意：StreamStateManager 的快照是按 bufferKey 管理的
    // 这里保留旧的 sessionID:partId 格式，但需要遍历所有键
    // 暂时保留原始实现，后续可以优化
    const prefix = `${sessionID}:`;
    // 由于 StreamStateManager 没有暴露 keys() 方法，这里暂时跳过
    // 改为在 clear() 时统一清理
    streamStateManager.setRetryNotice(sessionID, '');
    streamStateManager.setErrorNotice(sessionID, '');
  };

  const FEISHU_RENDER_DEDUPE_WINDOW_MS = 15_000;
  const feishuRecentRenderCache = new Map<string, {
    status: StreamCardData['status'];
    signature: string;
    messageIds: string[];
    updatedAt: number;
  }>();
  const qqProgressState = new Map<string, {
    sentThinking: string;
    lastThinkingChunk: string;
    finalSent: boolean;
  }>();

  const pruneFeishuRecentRenderCache = (): void => {
    const now = Date.now();
    for (const [key, value] of feishuRecentRenderCache.entries()) {
      if (now - value.updatedAt > FEISHU_RENDER_DEDUPE_WINDOW_MS) {
        feishuRecentRenderCache.delete(key);
      }
    }
  };

  const getQQProgressState = (bufferKey: string): { sentThinking: string; lastThinkingChunk: string; finalSent: boolean } => {
    let state = qqProgressState.get(bufferKey);
    if (!state) {
      state = {
        sentThinking: '',
        lastThinkingChunk: '',
        finalSent: false,
      };
      qqProgressState.set(bufferKey, state);
    }
    return state;
  };

  const getIncrementalSuffix = (fullText: string, sentText: string): string => {
    if (!fullText) {
      return '';
    }
    if (!sentText) {
      return fullText;
    }
    if (fullText.startsWith(sentText)) {
      return fullText.slice(sentText.length);
    }
    if (sentText.startsWith(fullText)) {
      return '';
    }
    return fullText;
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

    const current = streamStateManager.getContent(buffer.key) || { text: '', thinking: '' };
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

    streamStateManager.setContent(buffer.key, current);

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

    let existingMessageIds = streamStateManager.getCardMessageIds(buffer.key) || [];
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

    if (platform === 'qq') {
      const sender = getSenderByPlatform(platform);
      if (!sender) {
        console.error('[outputBuffer] 无法获取 QQ sender');
        return;
      }

      const onlyText = chatSessionStore.getSessionByConversation('qq', conversationId)?.qqOutputOnlyText === true;
      const progress = getQQProgressState(buffer.key);

      const thinkingDelta = getIncrementalSuffix(current.thinking, progress.sentThinking);
      const normalizedThinkingDelta = thinkingDelta.trim();

      if (normalizedThinkingDelta && normalizedThinkingDelta !== progress.lastThinkingChunk) {
        const safeThinkingDelta = normalizedThinkingDelta.replace(/```/g, '` ` `');
        const thinkingPayload = onlyText
          ? `思考过程：\n${normalizedThinkingDelta}`
          : `**思考过程**\n\`\`\`text\n${safeThinkingDelta}\n\`\`\``;
        await sender.sendCard(conversationId, onlyText
          ? { qqText: thinkingPayload, forcePlainText: true }
          : { markdown: thinkingPayload, qqText: thinkingPayload });
        progress.sentThinking = current.thinking;
        progress.lastThinkingChunk = normalizedThinkingDelta;
      } else if (current.thinking.length > progress.sentThinking.length) {
        progress.sentThinking = current.thinking;
      }

      if (buffer.status !== 'running' && !progress.finalSent) {
        const finalCardData: StreamCardData = {
          ...cardData,
          thinking: '',
          segments: (cardData.segments ?? []).filter(segment => segment.type !== 'reasoning'),
        };
        const finalPayload = buildPortableUpdatePayload(finalCardData, conversationId, 'qq');
        await sender.sendCard(
          conversationId,
          onlyText
            ? { qqText: finalPayload.qqText, forcePlainText: true }
            : { markdown: finalPayload.markdown, qqText: finalPayload.qqText }
        );
        progress.finalSent = true;
      }

      if (buffer.status !== 'running') {
        qqProgressState.delete(buffer.key);
        streamStateManager.clear(buffer.key);
        clearPartSnapshotsForSession(buffer.sessionId);
        outputBuffer.clear(buffer.key);
      }
      return;
    }

    if (platform !== 'feishu') {
      const sender = getSenderByPlatform(platform);
      if (!sender) {
        console.error(`[outputBuffer] 无法获取平台 ${platform} 的 sender`);
        return;
      }
      const payload = buildPortableUpdatePayload(cardData, conversationId, platform);
      const qqOnlyText = platform === 'qq'
        && chatSessionStore.getSessionByConversation('qq', conversationId)?.qqOutputOnlyText === true;
      const nextMessageIds: string[] = [];
      const existingMessageId = existingMessageIds[0];
      const outboundPayload = qqOnlyText
        ? { qqText: payload.qqText, forcePlainText: true }
        : payload;

      if (existingMessageId) {
        const updated = await sender.updateCard(existingMessageId, outboundPayload);
        if (updated) {
          nextMessageIds.push(existingMessageId);
        } else {
          const replacementMessageId = await sender.sendCard(conversationId, outboundPayload);
          if (replacementMessageId) {
            void sender.deleteMessage(existingMessageId).catch(() => undefined);
            nextMessageIds.push(replacementMessageId);
          }
        }
      } else {
        const newMessageId = await sender.sendCard(conversationId, outboundPayload);
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
        streamStateManager.setCardMessageIds(buffer.key, nextMessageIds);
      } else {
        streamStateManager.setCardMessageIds(buffer.key, []);
      }

      if (buffer.status !== 'running') {
        streamStateManager.clear(buffer.key);
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

    pruneFeishuRecentRenderCache();
    const renderSignature = JSON.stringify(cards);
    const cachedRender = feishuRecentRenderCache.get(buffer.key);

    if (
      existingMessageIds.length === 0 &&
      cachedRender &&
      cachedRender.messageIds.length > 0 &&
      Date.now() - cachedRender.updatedAt <= FEISHU_RENDER_DEDUPE_WINDOW_MS
    ) {
      existingMessageIds = [...cachedRender.messageIds];
      outputBuffer.setMessageId(buffer.key, existingMessageIds[0]);
      streamStateManager.setCardMessageIds(buffer.key, existingMessageIds);
    }

    if (
      cachedRender &&
      cachedRender.status === status &&
      cachedRender.signature === renderSignature &&
      cachedRender.messageIds.length > 0 &&
      Date.now() - cachedRender.updatedAt <= FEISHU_RENDER_DEDUPE_WINDOW_MS
    ) {
      outputBuffer.setMessageId(buffer.key, cachedRender.messageIds[0]);
      streamStateManager.setCardMessageIds(buffer.key, [...cachedRender.messageIds]);

      if (buffer.status !== 'running') {
        streamStateManager.clear(buffer.key);
        clearPartSnapshotsForSession(buffer.sessionId);
        outputBuffer.clear(buffer.key);
      }
      return;
    }

    const nextMessageIds: string[] = [];

    const feishuAdapter = getCachedAdapter('feishu');
    if (!feishuAdapter) {
      console.error('[outputBuffer] 飞书适配器未加载');
      return;
    }
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
        console.warn(`[outputBuffer] 飞书卡片更新失败，保留原卡避免重复发卡: buffer=${buffer.key}, msgId=${existingMessageId}`);
        nextMessageIds.push(existingMessageId);
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
      streamStateManager.setCardMessageIds(buffer.key, nextMessageIds);
      feishuRecentRenderCache.set(buffer.key, {
        status,
        signature: renderSignature,
        messageIds: [...nextMessageIds],
        updatedAt: Date.now(),
      });
    } else {
      streamStateManager.setCardMessageIds(buffer.key, []);
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
      streamStateManager.clear(buffer.key);
      clearPartSnapshotsForSession(buffer.sessionId);
      outputBuffer.clear(buffer.key);
    }
  });

  // 3.5 初始化 Reliability 生命周期（heartbeat + scheduler + rescue orchestrator）
  const reliabilityLifecycle = bootstrapReliabilityLifecycle();

  // 4. 监听飞书消息（通过路由器分发）
  const onFeishuMessage = async (event: FeishuMessageEvent) => {
    await reliabilityLifecycle.onInboundMessage();
    await rootRouter.onMessage(event);
  };
  feishuClient.on('message', onFeishuMessage);

  const onFeishuChatUnavailable = (chatId: string) => {
    console.warn(`[Index] 检测到不可用群聊，移除会话绑定: ${chatId}`);
    chatSessionStore.removeSession(chatId);
  };
  feishuClient.on('chatUnavailable', onFeishuChatUnavailable);

  // 5. 监听飞书卡片动作（通过路由器分发）
  feishuClient.setCardActionHandler(async (event) => {
    return await rootRouter.onAction(event);
  });

  // Discord 消息监听（仅当已配置）
  const discordAdapter = getCachedAdapter('discord');
  if (discordAdapter) {
    const discordHandler = createDiscordHandler(discordAdapter.getSender());
    discordAdapter.onMessage(async (event) => {
      await discordHandler.handleMessage(event);
    });
    if (discordAdapter.onInteraction) {
      discordAdapter.onInteraction(async (interaction: unknown) => {
        await discordHandler.handleInteraction(interaction as any);
      });
    }
  }

  // 企业微信消息监听（仅当已配置）
  const wecomAdapter = getCachedAdapter('wecom');
  if (wecomAdapter) {
    wecomAdapter.onMessage(async (event) => {
      const sender = wecomAdapter.getSender();
      await wecomHandler.handleMessage(event, sender);
    });
  }

  // Telegram 消息监听（仅当已配置）
  const telegramAdapter = getCachedAdapter('telegram');
  if (telegramAdapter) {
    telegramAdapter.onMessage(async (event) => {
      const sender = telegramAdapter.getSender();
      await telegramHandler.handleMessage(event, sender);
    });
    telegramAdapter.onAction(async (event) => {
      const sender = telegramAdapter.getSender();
      await telegramHandler.handleAction(event, sender);
    });
  }

  // QQ 消息监听（仅当已配置）
  const qqAdapter = getCachedAdapter('qq');
  if (qqAdapter) {
    qqAdapter.onMessage(async (event) => {
      const sender = qqAdapter.getSender();
      await qqHandler.handleMessage(event, sender);
    });
    qqAdapter.onAction(async (event) => {
      const sender = qqAdapter.getSender();
      await qqHandler.handleAction(event, sender);
    });
  }

  // WhatsApp 消息监听（仅当已配置）
  const whatsappAdapter = getCachedAdapter('whatsapp');
  if (whatsappAdapter) {
    whatsappAdapter.onMessage(async (event) => {
      const sender = whatsappAdapter.getSender();
      await whatsappHandler.handleMessage(event, sender);
    });
    whatsappAdapter.onAction(async (event) => {
      const sender = whatsappAdapter.getSender();
      await whatsappHandler.handleAction(event, sender);
    });
  }

  // 个人微信消息监听（仅当已配置）
  const weixinAdapter = getCachedAdapter('weixin');
  if (weixinAdapter) {
    weixinAdapter.onMessage(async (event) => {
      const sender = weixinAdapter.getSender();
      await weixinHandler.handleMessage(event, sender);
    });
  }

  // 钉钉消息监听（仅当已配置）
  const dingtalkAdapter = getCachedAdapter('dingtalk');
  if (dingtalkAdapter) {
    dingtalkAdapter.onMessage(async (event) => {
      const sender = dingtalkAdapter.getSender();
      await dingtalkHandler.handleMessage(event, sender);
    });
  }


  // 6. OpenCode 事件监听已移至 openCodeEventHub（单一入口）

  // 6.5 注入事件处理上下文到 OpenCode Event Hub（必须在所有辅助函数声明之后）
  const applyFailureToSession = async (sessionID: string, errorText: string): Promise<void> => {
    const conversation = resolveSessionConversation(sessionID);
    if (!conversation) return;
    const platform = conversation.platform;
    const conversationId = conversation.conversationId;

    const dedupeKey = `${sessionID}:${errorText}`;
    if (streamStateManager.getErrorNotice(sessionID) === dedupeKey) {
      return;
    }
    streamStateManager.setErrorNotice(sessionID, dedupeKey);

    const bufferKey = buildBufferKeyBySession(sessionID, conversationId);
    const existingBuffer = outputBuffer.get(bufferKey) || outputBuffer.getOrCreate(bufferKey, conversationId, sessionID, null);

    upsertTimelineNote(bufferKey, `error:${sessionID}:${errorText}`, `❌ ${errorText}`, 'error');
    outputBuffer.append(bufferKey, `\n\n❌ ${errorText}`);
    outputBuffer.touch(bufferKey);
    outputBuffer.setStatus(bufferKey, 'failed');

    if (!existingBuffer.messageId) {
      const sender = getSenderByPlatform(platform);
      if (sender) {
        await sender.sendText(conversationId, `❌ ${errorText}`);
      }
    }
  };

  openCodeEventHub.setContext({
    streamStateManager,
    toSessionId,
    toNonEmptyString,
    setToolCallCorrelation,
    setMessageCorrelation,
    getToolCallCorrelation,
    getMessageCorrelation,
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

  // 7.5. 启动 Discord 适配器（仅当已配置）
  if (isPlatformConfigured('discord')) {
    const discordAdapter = getCachedAdapter('discord');
    if (discordAdapter) {
      try {
        await discordAdapter.start();
        console.log('[Discord] 适配器已启动');
      } catch (e) {
        console.error('[Discord] 启动失败:', e);
      }
    }
  }

  // 7.6. 启动企业微信适配器（仅当已配置）
  if (isPlatformConfigured('wecom')) {
    const wecomAdapter = getCachedAdapter('wecom');
    if (wecomAdapter) {
      try {
        await wecomAdapter.start();
        console.log('[企业微信] 适配器已启动');
      } catch (e) {
        console.error('[企业微信] 启动失败:', e);
      }
    }
  }

  // 7.7. 启动 Telegram 适配器（仅当已配置）
  if (isPlatformConfigured('telegram')) {
    const telegramAdapter = getCachedAdapter('telegram');
    if (telegramAdapter) {
      try {
        await telegramAdapter.start();
        console.log('[Telegram] 适配器已启动');
      } catch (e) {
        console.error('[Telegram] 启动失败:', e);
      }
    }
  }

  // 7.8. 启动 QQ 适配器（仅当已配置）
  if (isPlatformConfigured('qq')) {
    const qqAdapter = getCachedAdapter('qq');
    if (qqAdapter) {
      try {
        await qqAdapter.start();
        console.log('[QQ] 适配器已启动');
      } catch (e) {
        console.error('[QQ] 启动失败:', e);
      }
    }
  }

  // 7.9. 启动 WhatsApp 适配器（仅当已配置）
  if (isPlatformConfigured('whatsapp')) {
    const whatsappAdapter = getCachedAdapter('whatsapp');
    if (whatsappAdapter) {
      try {
        await whatsappAdapter.start();
        console.log('[WhatsApp] 适配器已启动');
      } catch (e) {
        console.error('[WhatsApp] 启动失败:', e);
      }
    }
  }

  // 7.10. 启动个人微信适配器（仅当已配置）
  if (isPlatformConfigured('weixin')) {
    const weixinAdapter = getCachedAdapter('weixin');
    if (weixinAdapter) {
      try {
        await weixinAdapter.start();
        console.log('[个人微信] 适配器已启动');
      } catch (e) {
        console.error('[个人微信] 启动失败:', e);
      }
    }
  }

  // 7.11. 启动钉钉适配器（仅当已配置）
  if (isPlatformConfigured('dingtalk')) {
    const dingtalkAdapter = getCachedAdapter('dingtalk');
    if (dingtalkAdapter) {
      try {
        await dingtalkAdapter.start();
        console.log('[钉钉] 适配器已启动');
      } catch (e) {
        console.error('[钉钉] 启动失败:', e);
      }
    }
  }

  // 8. 启动飞书客户端
  if (isPlatformConfigured('feishu')) {
    const feishuAdapter = getCachedAdapter('feishu');
    if (feishuAdapter) {
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
      await feishuAdapter.start();
      console.log('[飞书] 适配器已启动');
    }
  } else {
    console.log('[System] 飞书长连接暂未启动 (未配置 FEISHU_APP_ID/FEISHU_APP_SECRET)');
  }

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

    // 内嵌模式下（Admin 进程内 Bridge 重启）不能让整个进程退出，
    // 否则 Admin HTTP 服务一并被杀，导致"立即重启"实际只关闭不启动。
    const isEmbeddedStop = signal === 'EMBEDDED_STOP';

    console.log(`\n[${signal}] 正在关闭服务...`);

    // 1. OpenCode serve 由 process-manager 独立管理，Bridge 关闭时不自动终止它
    //    （如需完全关闭，可通过 Web 面板"终止服务"或 stop.mjs --with-opencode）

    // 2. 停止 reliability 调度和救援资源
    try {
      await reliabilityLifecycle.cleanup();
    } catch (e) {
      console.error('停止 reliability 资源失败:', e);
    }

    // 3. 停止各平台适配器（仅停止已加载的）
    const adaptersToStop = [
      { platform: 'discord', name: 'Discord' },
      { platform: 'wecom', name: '企业微信' },
      { platform: 'telegram', name: 'Telegram' },
      { platform: 'qq', name: 'QQ' },
      { platform: 'whatsapp', name: 'WhatsApp' },
      { platform: 'weixin', name: '个人微信' },
      { platform: 'dingtalk', name: '钉钉' },
    ];

    for (const { platform, name } of adaptersToStop) {
      const adapter = getCachedAdapter(platform);
      if (adapter) {
        try {
          adapter.stop();
        } catch (e) {
          console.error(`[${name}] 停止适配器失败:`, e);
        }
      }
    }

    // 4. 停止飞书连接
    try {
      feishuClient.stop();
    } catch (e) {
      console.error('[飞书] 停止连接失败:', e);
    }

    // 5. 断开 OpenCode 连接
    try {
      opencodeClient.disconnect();
    } catch (e) {
      console.error('[OpenCode] 断开连接失败:', e);
    }

    // 6. 清理所有缓冲区和定时器
    try {
      outputBuffer.clearAll();
      delayedResponseHandler.cleanupExpired(0);
      questionHandler.cleanupExpired(0);
    } catch (e) {
      console.error('[System] 清理资源失败:', e);
    }

    // 7. 清理本轮 main() 注册到 feishuClient 的 EventEmitter 监听，避免 embedded restart 叠加
    try {
      feishuClient.off('message', onFeishuMessage);
      feishuClient.off('chatUnavailable', onFeishuChatUnavailable);
    } catch (e) {
      console.error('[飞书] 清理事件监听失败:', e);
    }

    // 8. 清理平台适配器缓存，避免重启后复用旧实例导致 callback 累积
    try {
      clearCache();
    } catch (e) {
      console.error('[PlatformLoader] 清理适配器缓存失败:', e);
    }

    if (isEmbeddedStop) {
      // 内嵌模式：不退出进程，只清理本次 main() 注册的信号监听器，
      // 并重置 runningInstance，保证下一次 startBridge() 会真正重新启动。
      try {
        process.off('SIGINT', sigintHandler);
        process.off('SIGTERM', sigtermHandler);
        process.off('SIGUSR2', sigusr2Handler);
      } catch { /* ignore */ }
      runningInstance = null;
      console.log('✅ 服务已安全关闭（内嵌模式，保留 Admin 进程）');
      return;
    }

    // 延迟退出以确保所有清理完成
    setTimeout(() => {
      console.log('✅ 服务已安全关闭');
      process.exit(0);
    }, 500);
  };

  const sigintHandler = () => { void gracefulShutdown('SIGINT'); };
  const sigtermHandler = () => { void gracefulShutdown('SIGTERM'); };
  const sigusr2Handler = () => { void gracefulShutdown('SIGUSR2'); }; // nodemon 重启信号

  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);
  process.on('SIGUSR2', sigusr2Handler);

  // 返回停止函数，供进程合并模式下使用
  return {
    stop: () => gracefulShutdown('EMBEDDED_STOP'),
  };
}

// 导出 Bridge 控制接口（供进程合并模式使用）
let runningInstance: { stop: () => Promise<void> } | null = null;

export async function startBridge(): Promise<{ stop: () => Promise<void> }> {
  if (runningInstance) {
    console.log('[Bridge] Already running');
    return runningInstance;
  }
  runningInstance = await main();
  return runningInstance;
}

export async function stopBridge(): Promise<void> {
  if (runningInstance) {
    await runningInstance.stop();
    runningInstance = null;
  }
}

if (
  process.env.VITEST !== 'true' &&
  process.env.BRIDGE_EMBEDDED_MODE !== '1' &&
  process.env.BRIDGE_CLI_MODE !== '1'
) {
  main().catch(error => {
    console.error('Fatal Error:', error);
    process.exit(1);
  });
}
