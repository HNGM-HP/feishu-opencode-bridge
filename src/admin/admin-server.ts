/**
 * Admin HTTP Server（独立进程）
 *
 * 提供：
 * - GET  /api/config          读取当前配置
 * - POST /api/config          全量保存配置，返回 needRestart 标志
 * - GET  /api/cron            列出所有运行时 Cron 任务
 * - POST /api/cron/:id/toggle 切换任务启用/禁用
 * - DELETE /api/cron/:id      删除任务
 * - POST /api/admin/restart   重启 Bridge 子进程
 * - GET  /api/admin/status    服务状态（uptime、版本等）
 * - GET  /api/admin/bridge    Bridge 进程状态
 * - POST /api/admin/upgrade   一键升级
 * - GET  /api/opencode/status OpenCode 状态
 * - POST /api/opencode/install 安装/升级 OpenCode
 * - POST /api/opencode/start  启动 OpenCode CLI
 * - 静态托管 dist/public/     (前端构建产物)
 */

import express from 'express';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configStore, type BridgeSettings } from '../store/config-store.js';
import { logStore } from '../store/log-store.js';
import type { RuntimeCronManager } from '../reliability/runtime-cron.js';
import type { BridgeManager } from './bridge-manager.js';
import { createSessionRoutes } from './routes/session.js';
import { registerWorkspaceGitRoutes } from './routes/workspace-git.js';
import { registerWorkspaceFilesRoutes } from './routes/workspace-files.js';
import { registerWorkspaceTerminalRoutes } from './routes/workspace-terminal.js';
import { registerResourcesTerminalRoutes, setupResourcesTerminalWebSocket } from './routes/resources-terminal.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerChatUploadRoutes } from './routes/chat-upload.js';
import { createResourcesRoutes } from './routes/resources.js';
import { getAutoStart, setAutoStart } from './autostart.js';
import { initResourceSystem } from '../services/resources/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 开发模式检测（process.resourcesPath 是 Electron 特有属性）
const isDev = process.env.NODE_ENV === 'development' || !(process as any).resourcesPath;

/**
 * 获取 process-manager.mjs 的绝对路径
 * 兼容：开发环境 / 源码部署 / Electron 打包后
 */
function resolveProcessManagerPath(): string {
  if ((process as any).resourcesPath && !isDev) {
    // Electron 打包：scripts 在 resources/app/scripts/
    return path.join((process as any).resourcesPath, 'app', 'scripts', 'process-manager.mjs');
  }
  // 开发 / 源码部署：从 dist/admin/ 向上两级到项目根
  return path.resolve(__dirname, '../../scripts/process-manager.mjs');
}

// ──────────────────────────────────────────────
// 需要重启才能生效的敏感配置项
// ──────────────────────────────────────────────
const RESTART_REQUIRED_KEYS: (keyof BridgeSettings)[] = [
  'FEISHU_ENABLED',
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_ENCRYPT_KEY',
  'FEISHU_VERIFICATION_TOKEN',
  'DISCORD_ENABLED',
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'WECOM_ENABLED',
  'WECOM_BOT_ID',
  'WECOM_SECRET',
  'WEIXIN_ENABLED',
  'DINGTALK_ENABLED',
  'TELEGRAM_ENABLED',
  'TELEGRAM_BOT_TOKEN',
  'QQ_ENABLED',
  'QQ_PROTOCOL',
  'QQ_ONEBOT_HTTP_URL',
  'QQ_ONEBOT_WS_URL',
  'QQ_APP_ID',
  'QQ_SECRET',
  'QQ_CALLBACK_URL',
  'QQ_ENCRYPT_KEY',
  'WHATSAPP_ENABLED',
  'WHATSAPP_MODE',
  'WHATSAPP_BUSINESS_PHONE_ID',
  'WHATSAPP_BUSINESS_ACCESS_TOKEN',
  'OPENCODE_HOST',
  'OPENCODE_PORT',
  'OPENCODE_SERVER_USERNAME',
  'OPENCODE_SERVER_PASSWORD',
  'OPENCODE_AUTO_START',
  'OPENCODE_AUTO_START_FOREGROUND',
  'RELIABILITY_CRON_ENABLED',
  'RELIABILITY_CRON_API_ENABLED',
  'RELIABILITY_CRON_API_HOST',
  'RELIABILITY_CRON_API_PORT',
  'RELIABILITY_CRON_API_TOKEN',
];

// ── TCP 端口探测函数
async function probeTcpPort(host: string, port: number, timeoutMs = 2000): Promise<{ isOpen: boolean; reason?: string }> {
  const net = await import('node:net');
  return new Promise(resolve => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ isOpen: false, reason: 'timeout' });
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ isOpen: true });
    });

    socket.once('error', (err: Error & { code?: string }) => {
      clearTimeout(timer);
      resolve({ isOpen: false, reason: err.code || err.message });
    });

    socket.connect(port, host);
  });
}

export interface AdminServerOptions {
  port: number;
  cronManager?: RuntimeCronManager;
  startedAt?: Date;
  version?: string;
  bridgeManager?: BridgeManager;
}

export function createAdminServer(options: AdminServerOptions): { start: () => Promise<void>; stop: () => void } {
  const app = express();
  const { port, cronManager, bridgeManager } = options;
  const startedAt = options.startedAt ?? new Date();
  const version = options.version ?? 'unknown';

  app.use(express.json());

  // ── 静态前端文件（dist/public）
  const publicDir = path.resolve(__dirname, '../../dist/public');
  app.use(express.static(publicDir));

  // ── 管理后台不再启用账号 / 密码鉴权，所有请求直接放行
  const api = express.Router();

  // ── Register Chat Routes (Phase A: Native Chat UI)
  registerChatRoutes(app);
  registerChatUploadRoutes(app);

  // ── GET /api/config
  api.get('/config', (_req, res) => {
    const settings = configStore.get();
    // 脱敏：不直接返回密钥原文给前端（返回掩码，前端保存时若未修改则不覆盖）
    const masked = { ...settings };
    const secretKeys: (keyof BridgeSettings)[] = [
      'FEISHU_APP_SECRET',
      'DISCORD_TOKEN',
      'WECOM_SECRET',
      'TELEGRAM_BOT_TOKEN',
      'QQ_SECRET',
      'WHATSAPP_BUSINESS_ACCESS_TOKEN',
      'OPENCODE_SERVER_PASSWORD',
      'RELIABILITY_CRON_API_TOKEN',
    ];
    for (const k of secretKeys) {
      if (masked[k]) {
        masked[k] = '••••••••';
      }
    }
    res.json({ settings: masked });
  });

  // ── POST /api/config
  api.post('/config', (req, res) => {
    const incoming = req.body as Partial<BridgeSettings>;
    const current = configStore.get();

    // 若前端传来的仍是掩码值，则保留原始值
    const MASK = '••••••••';
    const secretKeys: (keyof BridgeSettings)[] = [
      'FEISHU_APP_SECRET',
      'DISCORD_TOKEN',
      'WECOM_SECRET',
      'TELEGRAM_BOT_TOKEN',
      'QQ_SECRET',
      'WHATSAPP_BUSINESS_ACCESS_TOKEN',
      'OPENCODE_SERVER_PASSWORD',
      'RELIABILITY_CRON_API_TOKEN',
    ];
    const merged: BridgeSettings = { ...current };
    for (const [k, v] of Object.entries(incoming)) {
      const key = k as keyof BridgeSettings;
      if (secretKeys.includes(key) && v === MASK) {
        // 保留原值，不覆盖
        continue;
      }
      if (v === undefined || v === '') {
        delete merged[key];
      } else {
        (merged as Record<string, string>)[key] = String(v);
      }
    }

    configStore.set(merged);

    // 同步更新 process.env，确保运行时配置立即生效
    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined && value !== '') {
        process.env[key] = String(value);
      } else {
        delete process.env[key];
      }
    }

    // 检测哪些敏感 key 发生了变更
    const changedRestartKeys = RESTART_REQUIRED_KEYS.filter(k => {
      const oldVal = (current as Record<string, string | undefined>)[k] ?? '';
      const newVal = (incoming as Record<string, string | undefined>)[k] ?? '';
      return newVal !== MASK && newVal !== oldVal;
    });

    res.json({
      ok: true,
      needRestart: changedRestartKeys.length > 0,
      changedKeys: changedRestartKeys,
    });
  });

  // ── GET /api/cron
  api.get('/cron', (_req, res) => {
    if (!cronManager) {
      res.json({ jobs: [] });
      return;
    }
    res.json({ jobs: cronManager.listJobs() });
  });

  // ── POST /api/cron/create
  api.post('/cron/create', (req, res) => {
    if (!cronManager) {
      res.status(503).json({ error: 'CronManager not available' });
      return;
    }
    const { name, cronExpression, platform, conversationId, prompt } = req.body;
    if (!cronExpression || !platform || !conversationId) {
      res.status(400).json({ error: 'Missing required fields: cronExpression, platform, conversationId' });
      return;
    }
    try {
      const job = cronManager.addJob({
        name: name || 'Custom Cron',
        schedule: { kind: 'cron', expr: cronExpression },
        payload: {
          kind: 'systemEvent',
          text: prompt || 'Please respond with OK',
          delivery: {
            platform,
            conversationId,
          },
        },
        enabled: true,
      });
      res.json({ ok: true, job });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to create job' });
    }
  });

  // ── POST /api/cron/:id/toggle
  api.post('/cron/:id/toggle', (req, res) => {
    if (!cronManager) {
      res.status(503).json({ error: 'CronManager not available' });
      return;
    }
    const job = cronManager.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    const updated = cronManager.updateJob({ id: job.id, enabled: !job.enabled });
    res.json({ ok: true, job: updated });
  });

  // ── DELETE /api/cron/:id
  api.delete('/cron/:id', (req, res) => {
    if (!cronManager) {
      res.status(503).json({ error: 'CronManager not available' });
      return;
    }
    const removed = cronManager.removeJob(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json({ ok: true });
  });

  // ── GET /api/admin/status
  api.get('/admin/status', (_req, res) => {
    res.json({
      version,
      uptime: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      startedAt: startedAt.toISOString(),
      dbPath: configStore.getDbPath(),
      cronJobCount: cronManager?.listJobs().length ?? 0,
    });
  });

  // ── POST /api/admin/restart
  api.post('/admin/restart', async (_req, res) => {
    if (!bridgeManager) {
      res.status(503).json({ error: 'Bridge 管理器未初始化' });
      return;
    }

    const result = await bridgeManager.restart();

    if (result.success) {
      console.log(`[Admin] Bridge 重启成功，PID=${result.pid}`);
      res.json({ ok: true, pid: result.pid, message: 'Bridge 重启成功' });
      return;
    }

    console.error(`[Admin] Bridge 重启失败: ${result.error}`);
    res.status(500).json({ error: result.error || '重启失败' });
  });

  // ── POST /api/admin/stop-bridge（仅停止 Bridge 进程）
  api.post('/admin/stop-bridge', async (_req, res) => {
    if (!bridgeManager) {
      res.status(503).json({ error: 'Bridge 管理器未初始化' });
      return;
    }

    res.json({ ok: true, message: 'Bridge 正在终止...' });

    // 异步执行终止逻辑
    bridgeManager.stop().then(() => {
      console.log('[Admin] Bridge 进程已终止（Web 面板保持运行）');
    }).catch((e: any) => {
      console.error('[Admin] Bridge 终止失败:', e.message);
    });
  });

  // ── GET /api/admin/bridge
  api.get('/admin/bridge', (_req, res) => {
    if (!bridgeManager) {
      res.json({ running: false, managed: false });
      return;
    }

    const status = bridgeManager.getStatus();
    res.json({ managed: true, ...status });
  });

  // ── POST /api/admin/upgrade
  api.post('/admin/upgrade', async (_req, res) => {
    try {
      // 拉取最新代码
      try {
        execSync('git pull --ff-only', { encoding: 'utf-8', cwd: process.cwd(), windowsHide: true });
      } catch {
        // 忽略 git 错误，可能是本地修改
      }

      // 根据时区判断是否使用国内镜像
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const isChinaRegion = timezone.startsWith('Asia/Shanghai')
        || timezone.startsWith('Asia/Chongqing')
        || timezone.startsWith('Asia/Hong_Kong')
        || timezone.startsWith('Asia/Taipei')
        || timezone.startsWith('Asia/Macau');

      const originalEnv = process.env.PUPPETEER_DOWNLOAD_HOST;
      let puppeteerHostSet = false;

      if (isChinaRegion && !originalEnv) {
        process.env.PUPPETEER_DOWNLOAD_HOST = 'https://cdn.npmmirror.com/binaries/chrome-for-testing';
        puppeteerHostSet = true;
      }

      try {
        // 安装依赖
        execSync('npm install --include=dev', { encoding: 'utf-8', cwd: process.cwd(), windowsHide: true });
      } finally {
        if (puppeteerHostSet) {
          if (originalEnv) {
            process.env.PUPPETEER_DOWNLOAD_HOST = originalEnv;
          } else {
            delete process.env.PUPPETEER_DOWNLOAD_HOST;
          }
        }
      }

      // 构建前端
      execSync('npm run build:web', { encoding: 'utf-8', cwd: process.cwd(), windowsHide: true });

      // 构建后端
      execSync('npm run build', { encoding: 'utf-8', cwd: process.cwd(), windowsHide: true });

      res.json({ ok: true, message: '升级完成，请重启服务' });
    } catch (error: any) {
      console.error('[Admin] 升级失败:', error.message);
      res.status(500).json({ error: '升级失败：' + error.message });
    }
  });

  // ── GET /api/opencode/status
  api.get('/opencode/status', async (_req, res) => {
    try {
      // 检查是否安装
      let version: string | null = null;
      try {
        version = execSync('opencode --version', { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim();
      } catch {
        // 未安装
      }

      // 检查端口
      const probeResult = await probeTcpPort('localhost', 4096, 2000);

      res.json({
        installed: !!version,
        version,
        portOpen: probeResult.isOpen,
        portReason: probeResult.reason,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── GET /api/opencode/check-update
  api.get('/opencode/check-update', async (_req, res) => {
    try {
      // 通过 GitHub API 获取最新发行版本
      let latestVersion: string | null = null;
      let githubError: string | null = null;
      try {
        const https = await import('node:https');
        const ghRes = await new Promise<string>((resolve, reject) => {
          const req = https.request(
            {
              hostname: 'api.github.com',
              path: '/repos/anomalyco/opencode/releases/latest',
              method: 'GET',
              headers: { 'User-Agent': 'opencode-bridge' },
              timeout: 10000,
            },
            (ghRes) => {
              let data = '';
              ghRes.on('data', chunk => (data += chunk));
              ghRes.on('end', () => resolve(data));
              ghRes.on('error', reject);
            }
          );
          req.on('error', reject);
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
          });
          req.end();
        });

        const release = JSON.parse(ghRes);
        if (release.tag_name) {
          latestVersion = release.tag_name.replace(/^v/, ''); // 移除 v 前缀
        }
      } catch (e: any) {
        console.error('[Admin] 获取 OpenCode 最新版本失败:', e.message);
        githubError = e.message;
      }

      // 直接返回最新版本信息，不检测本地安装状态（由 /status 接口负责）
      res.json({
        latestVersion,
        githubError,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── GET /api/admin/check-update
  api.get('/admin/check-update', async (_req, res) => {
    try {
      // 获取本地版本
      const localVersion = version;

      // 获取远程最新版本（通过 git fetch）
      try {
        execSync('git fetch --tags', { encoding: 'utf-8', timeout: 30000, windowsHide: true });
      } catch {
        // 忽略 fetch 错误
      }

      // 获取最新 tag
      let latestTag = '';
      try {
        latestTag = execSync('git describe --tags "$(git rev-list --tags --max-count=1)"', {
          encoding: 'utf-8',
          timeout: 5000,
          windowsHide: true,
        }).trim();
      } catch {
        // 没有 tag
      }

      // 检查是否有更新
      let hasUpdate = false;
      if (latestTag) {
        try {
          const currentCommit = execSync('git rev-parse HEAD', { encoding: 'utf-8', windowsHide: true }).trim();
          const tagCommit = execSync('git rev-parse ' + latestTag, { encoding: 'utf-8', windowsHide: true }).trim();
          hasUpdate = currentCommit !== tagCommit;
        } catch {
          // 忽略错误
        }
      }

      res.json({
        hasUpdate,
        currentVersion: localVersion,
        latestVersion: latestTag || null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── POST /api/opencode/install
  api.post('/opencode/install', (_req, res) => {
    res.json({ ok: true, message: '正在安装 OpenCode...' });

    // 异步安装（使用 npm 安装）
    setTimeout(() => {
      try {
        execSync('npm i -g opencode-ai', { encoding: 'utf-8', timeout: 120000, windowsHide: true });
        console.log('[Admin] OpenCode 安装完成');
      } catch (error: any) {
        console.error('[Admin] OpenCode 安装失败:', error.message);
      }
    }, 100);
  });

  // ── POST /api/opencode/upgrade
  api.post('/opencode/upgrade', (_req, res) => {
    res.json({ ok: true, message: '正在升级 OpenCode...' });

    // 异步升级（使用 opencode upgrade 命令）
    setTimeout(() => {
      try {
        execSync('opencode upgrade', { encoding: 'utf-8', timeout: 120000, windowsHide: true });
        console.log('[Admin] OpenCode 升级完成');
      } catch (error: any) {
        console.error('[Admin] OpenCode 升级失败:', error.message);
      }
    }, 100);
  });

  // ── POST /api/opencode/start
  // 始终使用后台无窗口模式（通过 process-manager start-opencode，幂等）
  api.post('/opencode/start', async (_req, res) => {
    try {
      const { spawnSync: spawnSyncLocal } = await import('node:child_process');
      const scriptPath = resolveProcessManagerPath();
      const isWindows = process.platform === 'win32';

      const result = spawnSyncLocal(process.execPath, [scriptPath, 'start-opencode'], {
        encoding: 'utf-8',
        timeout: 20000,
        windowsHide: isWindows,
      });

      const stdout = (result.stdout || '').trim();
      const stderr = (result.stderr || '').trim();
      if (stdout) console.log('[Admin] opencode start:', stdout);
      if (stderr) console.warn('[Admin] opencode start stderr:', stderr);

      if (result.status !== 0 || result.error) {
        const msg = result.error?.message || stderr || '启动失败';
        res.status(500).json({ error: msg });
        return;
      }

      // 判断是"已运行"还是"新启动"
      const skipped = stdout.includes('已在运行');
      res.json({
        ok: true,
        message: skipped ? 'OpenCode 已在后台运行（无需重复启动）' : 'OpenCode 已后台启动',
      });
    } catch (error: any) {
      res.status(500).json({ error: '启动失败：' + error.message });
    }
  });

  // ── POST /api/opencode/attach
  // 在前台弹出 CMD 窗口执行 opencode attach <url>（Windows 专用）
  api.post('/opencode/attach', (req, res) => {
    const isWindows = process.platform === 'win32';
    if (!isWindows) {
      res.status(400).json({ error: '前台 attach 窗口仅支持 Windows 平台' });
      return;
    }

    try {
      const { port = 4096, host = 'localhost' } = req.body || {};
      const attachUrl = `http://${host}:${port}`;

      // ⚠️ Windows 弹窗坑：旧实现 spawn('cmd', ['/c', 'start ... cmd /k ...'], { windowsHide: true })
      // 在打包后（Electron 主进程无控制台）等价于 CREATE_NO_WINDOW，会被传给后续的 cmd 子树，
      // 导致 start 命令也无法分配可见控制台 → 用户点了按钮但什么都看不到。
      //
      // 这里改用 PowerShell 的 Start-Process：
      //   - 外层 powershell.exe 仍 windowsHide:true，不污染界面，与
      //     scripts/process-manager.mjs 隐藏 opencode serve 的策略一致；
      //   - 由 Start-Process 显式 CreateProcess 一个新的可见 cmd 控制台来跑 attach，
      //     不依赖父进程是否有 console，从而保留"自启动 opencode 后台无窗"能力的同时
      //     恢复"前台 attach 窗口可见"行为。
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

      console.log(`[Admin] OpenCode attach 窗口已拉起（${attachUrl}）`);
      res.json({ ok: true, message: `OpenCode 前台窗口已打开（${attachUrl}）` });
    } catch (error: any) {
      res.status(500).json({ error: '打开前台窗口失败：' + error.message });
    }
  });

  // ── POST /api/opencode/stop
  api.post('/opencode/stop', (_req, res) => {
    res.json({ ok: true, message: '正在终止 OpenCode...' });

    // 异步终止 OpenCode 进程
    setTimeout(() => {
      try {
        const scriptPath = resolveProcessManagerPath();
        console.log('[Admin] 终止脚本路径:', scriptPath);
        console.log('[Admin] Node 路径:', process.execPath);

        const result = execSync('"' + process.execPath + '" "' + scriptPath + '" kill-opencode', {
          encoding: 'utf-8',
          timeout: 15000,
          windowsHide: true,
        });
        console.log('[Admin] OpenCode 终止结果:', result.trim());
      } catch (error: any) {
        console.error('[Admin] OpenCode 终止失败:', error.message);
        if (error.stdout) {
          console.error('[Admin] stdout:', error.stdout);
        }
        if (error.stderr) {
          console.error('[Admin] stderr:', error.stderr);
        }
      }
    }, 100);
  });

  // ── GET /api/admin/health（健康检测）
  api.get('/admin/health', async (_req, res) => {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {
        database: { status: 'unknown', message: '' },
        opencode: { status: 'unknown', message: '' },
        feishu: { status: 'unknown', message: '' },
        discord: { status: 'unknown', message: '' },
        wecom: { status: 'unknown', message: '' },
        telegram: { status: 'unknown', message: '' },
        qq: { status: 'unknown', message: '' },
        whatsapp: { status: 'unknown', message: '' },
        weixin: { status: 'unknown', message: '' },
        dingtalk: { status: 'unknown', message: '' },
      },
    };

    // 检测数据库
    try {
      const dbPath = configStore.getDbPath();
      if (dbPath) {
        const fs = await import('node:fs');
        if (fs.existsSync(dbPath)) {
          health.checks.database = { status: 'ok', message: `数据库正常: ${dbPath}` };
        } else {
          health.checks.database = { status: 'warning', message: '数据库文件不存在，将自动创建' };
        }
      }
    } catch (e: any) {
      health.checks.database = { status: 'error', message: e.message };
      health.status = 'degraded';
    }

    // 检测 OpenCode 连接
    try {
      const { host, port } = { host: 'localhost', port: 4096 };
      const probeResult = await probeTcpPort(host, port, 2000);
      if (probeResult.isOpen) {
        health.checks.opencode = { status: 'ok', message: `OpenCode 服务正常 (${host}:${port})` };
      } else {
        health.checks.opencode = { status: 'error', message: `OpenCode 服务未响应 (${host}:${port})` };
        health.status = 'degraded';
      }
    } catch (e: any) {
      health.checks.opencode = { status: 'error', message: e.message };
      health.status = 'degraded';
    }

    // 检测飞书配置
    try {
      const settings = configStore.get();
      if (settings.FEISHU_ENABLED === 'true' && settings.FEISHU_APP_ID && settings.FEISHU_APP_SECRET) {
        health.checks.feishu = { status: 'ok', message: '飞书凭据已配置' };
      } else if (settings.FEISHU_ENABLED === 'true') {
        health.checks.feishu = { status: 'warning', message: '飞书已启用但凭据未配置' };
      } else {
        health.checks.feishu = { status: 'ok', message: '飞书未启用' };
      }
    } catch (e: any) {
      health.checks.feishu = { status: 'error', message: e.message };
    }

    // 检测 Discord 配置
    try {
      const settings = configStore.get();
      if (settings.DISCORD_ENABLED === 'true' && settings.DISCORD_TOKEN) {
        health.checks.discord = { status: 'ok', message: 'Discord 凭据已配置' };
      } else if (settings.DISCORD_ENABLED === 'true') {
        health.checks.discord = { status: 'warning', message: 'Discord 已启用但凭据未配置' };
      } else {
        health.checks.discord = { status: 'ok', message: 'Discord 未启用' };
      }
    } catch (e: any) {
      health.checks.discord = { status: 'error', message: e.message };
    }

    // 检测企业微信配置
    try {
      const settings = configStore.get();
      if (settings.WECOM_ENABLED === 'true' && settings.WECOM_BOT_ID && settings.WECOM_SECRET) {
        health.checks.wecom = { status: 'ok', message: '企业微信凭据已配置' };
      } else if (settings.WECOM_ENABLED === 'true') {
        health.checks.wecom = { status: 'warning', message: '企业微信已启用但凭据未配置' };
      } else {
        health.checks.wecom = { status: 'ok', message: '企业微信未启用' };
      }
    } catch (e: any) {
      health.checks.wecom = { status: 'error', message: e.message };
    }

    // 检测 Telegram 配置
    try {
      const settings = configStore.get();
      if (settings.TELEGRAM_ENABLED === 'true' && settings.TELEGRAM_BOT_TOKEN) {
        health.checks.telegram = { status: 'ok', message: 'Telegram 凭据已配置' };
      } else if (settings.TELEGRAM_ENABLED === 'true') {
        health.checks.telegram = { status: 'warning', message: 'Telegram 已启用但凭据未配置' };
      } else {
        health.checks.telegram = { status: 'ok', message: 'Telegram 未启用' };
      }
    } catch (e: any) {
      health.checks.telegram = { status: 'error', message: e.message };
    }

    // 检测 QQ 配置
    try {
      const settings = configStore.get();
      if (settings.QQ_ENABLED === 'true') {
        const protocol = settings.QQ_PROTOCOL || 'onebot';
        if (protocol === 'official') {
          if (settings.QQ_APP_ID && settings.QQ_SECRET) {
            health.checks.qq = { status: 'ok', message: 'QQ 官方 API 已配置' };
          } else {
            health.checks.qq = { status: 'warning', message: 'QQ 已启用但官方 API 凭据未配置' };
          }
        } else {
          // OneBot 协议
          if (settings.QQ_ONEBOT_WS_URL || settings.QQ_ONEBOT_HTTP_URL) {
            health.checks.qq = { status: 'ok', message: 'QQ OneBot 已配置' };
          } else {
            health.checks.qq = { status: 'warning', message: 'QQ 已启用但 OneBot 地址未配置' };
          }
        }
      } else {
        health.checks.qq = { status: 'ok', message: 'QQ 未启用' };
      }
    } catch (e: any) {
      health.checks.qq = { status: 'error', message: e.message };
    }

    // 检测 WhatsApp 配置
    try {
      const settings = configStore.get();
      const whatsappMode = settings.WHATSAPP_MODE || 'personal';
      if (settings.WHATSAPP_ENABLED === 'true') {
        if (whatsappMode === 'business') {
          if (settings.WHATSAPP_BUSINESS_PHONE_ID && settings.WHATSAPP_BUSINESS_ACCESS_TOKEN) {
            health.checks.whatsapp = { status: 'ok', message: 'WhatsApp Business API 已配置' };
          } else {
            health.checks.whatsapp = { status: 'warning', message: 'WhatsApp Business 已启用但凭据未配置' };
          }
        } else {
          health.checks.whatsapp = { status: 'ok', message: 'WhatsApp Personal 模式已启用' };
        }
      } else {
        health.checks.whatsapp = { status: 'ok', message: 'WhatsApp 未启用' };
      }
    } catch (e: any) {
      health.checks.whatsapp = { status: 'error', message: e.message };
    }

    // 检测个人微信配置
    try {
      const settings = configStore.get();
      if (settings.WEIXIN_ENABLED === 'true') {
        const accounts = configStore.getWeixinAccounts();
        const enabledAccounts = accounts.filter(a => a.enabled === 1);
        if (enabledAccounts.length > 0) {
          health.checks.weixin = { status: 'ok', message: `个人微信已配置 ${enabledAccounts.length} 个账号` };
        } else {
          health.checks.weixin = { status: 'warning', message: '个人微信已启用但无有效账号' };
        }
      } else {
        health.checks.weixin = { status: 'ok', message: '个人微信未启用' };
      }
    } catch (e: any) {
      health.checks.weixin = { status: 'error', message: e.message };
    }

    // 检测钉钉配置
    try {
      const settings = configStore.get();
      if (settings.DINGTALK_ENABLED === 'true') {
        const accounts = configStore.getDingtalkAccounts();
        const enabledAccounts = accounts.filter(a => a.enabled === 1);
        if (enabledAccounts.length > 0) {
          health.checks.dingtalk = { status: 'ok', message: `钉钉已配置 ${enabledAccounts.length} 个账号` };
        } else {
          health.checks.dingtalk = { status: 'warning', message: '钉钉已启用但无有效账号' };
        }
      } else {
        health.checks.dingtalk = { status: 'ok', message: '钉钉未启用' };
      }
    } catch (e: any) {
      health.checks.dingtalk = { status: 'error', message: e.message };
    }

    res.json(health);
  });

  // ── POST /api/admin/repair（修复功能）
  api.post('/admin/repair', async (_req, res) => {
    const results: string[] = [];

    // 重新初始化数据库（如果不存在）
    try {
      const dbPath = configStore.getDbPath();
      const fs = await import('node:fs');
      if (dbPath && !fs.existsSync(dbPath)) {
        // 触发数据库初始化
        configStore.get();
        results.push('数据库已初始化');
      }
    } catch (e: any) {
      results.push(`数据库初始化失败: ${e.message}`);
    }

    // 清理日志缓存
    try {
      logStore.clear();
      results.push('日志缓存已清理');
    } catch (e: any) {
      results.push(`日志清理失败: ${e.message}`);
    }

    res.json({ ok: true, results });
  });

  // ── GET /api/opencode/models
  api.get('/opencode/models', async (_req, res) => {
    try {
      const { execSync } = await import('node:child_process');
      const output = execSync('opencode models', { encoding: 'utf-8', timeout: 30000, windowsHide: true });
      const models = output
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('opencode/'));

      // 按供应商分组
      const grouped: Record<string, string[]> = {};
      for (const model of models) {
        const [provider, ...rest] = model.split('/');
        const modelName = rest.join('/');
        if (!grouped[provider]) grouped[provider] = [];
        grouped[provider].push(modelName);
      }
      res.json({ models: grouped, raw: models });
    } catch (error: any) {
      console.error('[Admin] 获取模型列表失败:', error.message);
      res.status(500).json({ error: '获取模型列表失败：' + error.message });
    }
  });

  // ── GET /api/logs（查询日志）
  api.get('/logs', (req, res) => {
    const { level, search, start, end, page = '1', limit = '100' } = req.query;

    const result = logStore.query({
      level: level as 'debug' | 'info' | 'warn' | 'error' | undefined,
      search: search as string | undefined,
      start: start ? new Date(start as string) : undefined,
      end: end ? new Date(end as string) : undefined,
      page: parseInt(page as string, 10) || 1,
      limit: Math.min(parseInt(limit as string, 10) || 100, 500),
    });

    res.json(result);
  });

  // ── GET /api/logs/stats（日志统计）
  api.get('/logs/stats', (_req, res) => {
    const stats = logStore.getStats();
    res.json(stats);
  });

  // ── DELETE /api/logs（清空日志）
  api.delete('/logs', (_req, res) => {
    logStore.clear();
    res.json({ ok: true, message: '日志已清空' });
  });

  // ── Session 管理路由
  api.use('/sessions', createSessionRoutes());
  registerWorkspaceGitRoutes(api);
  registerWorkspaceFilesRoutes(api);
  registerWorkspaceTerminalRoutes(api);

  // ── Resources 管理路由（Skills, MCP, Agents, Providers）
  api.use('/resources', createResourcesRoutes());

  // ── Resources 终端路由（WebSocket终端用于OAuth登录）
  registerResourcesTerminalRoutes(api);

  // ── POST /api/admin/shutdown（终止服务）
  api.post('/admin/shutdown', async (_req, res) => {
    res.json({ ok: true, message: '服务正在终止...' });

    // 异步执行终止逻辑
    setTimeout(async () => {
      try {
        // 1. 终止 Bridge 子进程
        if (bridgeManager) {
          await bridgeManager.stop();
          console.log('[Admin] Bridge 进程已终止');
        }

        // 2. 终止 OpenCode 进程
        try {
          const { spawnSync } = await import('node:child_process');
          spawnSync(process.execPath, [resolveProcessManagerPath(), 'kill-opencode'], {
            stdio: 'inherit',
            windowsHide: true,
          });
          console.log('[Admin] OpenCode 进程已终止');
        } catch (e: any) {
          console.error('[Admin] 终止 OpenCode 失败:', e.message);
        }

        // 3. 退出 Admin 进程
        console.log('[Admin] 服务已终止');
        process.exit(0);
      } catch (e: any) {
        console.error('[Admin] 终止服务失败:', e.message);
        process.exit(1);
      }
    }, 500);
  });

  // ── GET /api/admin/autostart（查询开机自启状态）
  api.get('/admin/autostart', (_req, res) => {
    try {
      res.json(getAutoStart());
    } catch (e: any) {
      res.status(500).json({ error: e?.message || '查询自启状态失败' });
    }
  });

  // ── PUT /api/admin/autostart（启用/关闭开机自启）
  api.put('/admin/autostart', (req, res) => {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled 必须为布尔值' });
      return;
    }
    try {
      setAutoStart(enabled);
      res.json({ ok: true, ...getAutoStart() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || '设置自启失败' });
    }
  });

  // ──────────────────────────────────────────────
  // 个人微信管理 API
  // ──────────────────────────────────────────────

  // ── GET /api/weixin/accounts（列出所有微信账号）
  api.get('/weixin/accounts', (_req, res) => {
    const accounts = configStore.getWeixinAccounts();
    // 字段映射：数据库字段 -> 前端期望字段
    const mapped = accounts.map(acc => ({
      id: acc.account_id,
      wxid: acc.account_id,
      nickname: acc.name || acc.account_id,
      avatar: '', // 微信协议不提供头像，使用默认
      enabled: acc.enabled === 1,
      userId: acc.user_id,
      createdAt: acc.created_at,
      lastLoginAt: acc.last_login_at,
    }));
    res.json({ accounts: mapped });
  });

  // ── DELETE /api/weixin/accounts/:id（删除账号）
  api.delete('/weixin/accounts/:id', (req, res) => {
    const accountId = req.params.id;
    const success = configStore.deleteWeixinAccount(accountId);
    if (success) {
      res.json({ ok: true, message: `账号 ${accountId} 已删除` });
    } else {
      res.status(404).json({ error: '账号不存在' });
    }
  });

  // ── POST /api/weixin/accounts/:id/toggle（启用/禁用账号）
  api.post('/weixin/accounts/:id/toggle', async (req, res) => {
    const accountId = req.params.id;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled 必须是布尔值' });
      return;
    }

    const account = configStore.getWeixinAccount(accountId);
    if (!account) {
      res.status(404).json({ error: '账号不存在' });
      return;
    }

    configStore.setWeixinAccountEnabled(accountId, enabled);

    // 启用/禁用时控制消息轮询
    try {
      const { weixinAdapter } = await import('../platform/adapters/weixin-adapter.js');
      if (enabled) {
        weixinAdapter.restartAccount(accountId);
      } else {
        // 禁用时通过临时暂停机制实现
        weixinAdapter.restartAccount(accountId); // 这会重置状态
      }
    } catch (err) {
      console.error('[Admin] 控制消息轮询失败:', err);
    }

    res.json({ ok: true, accountId, enabled, message: `账号已${enabled ? '启用' : '禁用'}` });
  });

  // ── POST /api/weixin/login/start（启动 QR 登录）
  api.post('/weixin/login/start', async (_req, res) => {
    try {
      const { startQrLoginSession } = await import('../platform/adapters/weixin/weixin-auth.js');
      const { sessionId, qrImage } = await startQrLoginSession();
      res.json({ ok: true, sessionId, qrImage });
    } catch (error: any) {
      console.error('[Admin] 启动微信登录失败:', error.message);
      res.status(500).json({ error: '启动登录失败: ' + error.message });
    }
  });

  // ── GET /api/weixin/login/wait（轮询登录状态）
  api.get('/weixin/login/wait', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      res.status(400).json({ error: '缺少 sessionId 参数' });
      return;
    }

    try {
      const { pollQrLoginStatus } = await import('../platform/adapters/weixin/weixin-auth.js');
      const session = await pollQrLoginStatus(sessionId);

      // 构建响应，匹配前端 WeixinLoginSession 接口
      const response: {
        ok: boolean;
        sessionId: string;
        status: string;
        qrImage?: string;
        account?: { id: string; wxid: string; nickname: string; avatar: string; enabled: boolean };
        error?: string;
      } = {
        ok: true,
        sessionId,
        status: session.status,
      };

      if (session.qrImage) {
        response.qrImage = session.qrImage;
      }

      if (session.error) {
        response.error = session.error;
      }

      // 登录成功时返回账号信息并启动轮询
      if (session.status === 'confirmed' && session.accountId) {
        response.account = {
          id: session.accountId,
          wxid: session.accountId,
          nickname: session.accountId,
          avatar: '',
          enabled: true,
        };

        // 启动新登录账号的消息轮询
        try {
          const { weixinAdapter } = await import('../platform/adapters/weixin-adapter.js');
          weixinAdapter.restartAccount(session.accountId);
          console.log(`[Admin] 已启动账号 ${session.accountId} 的消息轮询`);
        } catch (err) {
          console.error('[Admin] 启动消息轮询失败:', err);
        }
      }

      res.json(response);
    } catch (error: any) {
      console.error('[Admin] 轮询微信登录状态失败:', error.message);
      res.status(500).json({ error: '轮询登录状态失败: ' + error.message });
    }
  });

  // ── POST /api/weixin/login/cancel（取消登录）
  api.post('/weixin/login/cancel', async (req, res) => {
    const sessionId = req.body.sessionId as string;
    if (sessionId) {
      const { cancelQrLoginSession } = await import('../platform/adapters/weixin/weixin-auth.js');
      cancelQrLoginSession(sessionId);
    }
    res.json({ ok: true, message: '登录已取消' });
  });

  // ──────────────────────────────────────────────
  // WhatsApp 管理 API
  // ──────────────────────────────────────────────

  // ── GET /api/whatsapp/status（获取连接状态和二维码）
  api.get('/whatsapp/status', async (_req, res) => {
    try {
      // 从状态文件读取（跨进程通信）
      const { readStatusFile } = await import('../platform/adapters/whatsapp-adapter.js');
      const status = readStatusFile();
      if (status) {
        res.json({ ok: true, ...status });
      } else {
        // 状态文件不存在，返回默认状态
        const settings = configStore.get();
        res.json({
          ok: true,
          enabled: settings.WHATSAPP_ENABLED === 'true',
          mode: (settings.WHATSAPP_MODE || 'personal') as 'personal' | 'business',
          status: 'disconnected',
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Admin] 获取 WhatsApp 状态失败:', message);
      res.status(500).json({ error: '获取状态失败: ' + message });
    }
  });

  // ──────────────────────────────────────────────
  // 钉钉管理 API
  // ──────────────────────────────────────────────

  // ── GET /api/dingtalk/accounts（列出所有钉钉账号）
  api.get('/dingtalk/accounts', (_req, res) => {
    const accounts = configStore.getDingtalkAccounts();
    const mapped = accounts.map(acc => ({
      id: acc.account_id,
      accountId: acc.account_id,
      clientId: acc.client_id,
      clientSecret: '••••••••', // 脱敏
      name: acc.name || acc.account_id,
      enabled: acc.enabled === 1,
      endpoint: acc.endpoint,
      createdAt: acc.created_at,
    }));
    res.json({ accounts: mapped });
  });

  // ── POST /api/dingtalk/accounts（创建钉钉账号）
  api.post('/dingtalk/accounts', (req, res) => {
    const { accountId, clientId, clientSecret, name, endpoint } = req.body;

    if (!accountId || !clientId || !clientSecret) {
      res.status(400).json({ error: '缺少必填字段: accountId, clientId, clientSecret' });
      return;
    }

    configStore.upsertDingtalkAccount({
      accountId,
      clientId,
      clientSecret,
      name,
      enabled: true,
      endpoint,
    });

    res.json({ ok: true, message: '账号创建成功' });
  });

  // ── PUT /api/dingtalk/accounts/:id（更新钉钉账号）
  api.put('/dingtalk/accounts/:id', (req, res) => {
    const accountId = req.params.id;
    const { clientId, clientSecret, name, endpoint } = req.body;

    const existing = configStore.getDingtalkAccount(accountId);
    if (!existing) {
      res.status(404).json({ error: '账号不存在' });
      return;
    }

    configStore.upsertDingtalkAccount({
      accountId,
      clientId: clientId || existing.client_id,
      clientSecret: clientSecret && clientSecret !== '••••••••' ? clientSecret : existing.client_secret,
      name: name !== undefined ? name : existing.name,
      enabled: existing.enabled === 1,
      endpoint: endpoint || existing.endpoint,
    });

    res.json({ ok: true, message: '账号更新成功' });
  });

  // ── DELETE /api/dingtalk/accounts/:id（删除账号）
  api.delete('/dingtalk/accounts/:id', (req, res) => {
    const accountId = req.params.id;
    const success = configStore.deleteDingtalkAccount(accountId);
    if (success) {
      res.json({ ok: true, message: `账号 ${accountId} 已删除` });
    } else {
      res.status(404).json({ error: '账号不存在' });
    }
  });

  // ── POST /api/dingtalk/accounts/:id/toggle（启用/禁用账号）
  api.post('/dingtalk/accounts/:id/toggle', async (req, res) => {
    const accountId = req.params.id;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled 必须是布尔值' });
      return;
    }

    const account = configStore.getDingtalkAccount(accountId);
    if (!account) {
      res.status(404).json({ error: '账号不存在' });
      return;
    }

    configStore.setDingtalkAccountEnabled(accountId, enabled);

    // 启用/禁用时控制连接
    try {
      const { dingtalkAdapter } = await import('../platform/adapters/dingtalk/index.js');
      if (enabled) {
        dingtalkAdapter.restartAccount(accountId);
      } else {
        dingtalkAdapter.stopAccount(accountId);
      }
    } catch (err) {
      console.error('[Admin] 控制钉钉连接失败:', err);
    }

    res.json({ ok: true, accountId, enabled, message: `账号已${enabled ? '启用' : '禁用'}` });
  });

  app.use('/api', api);

  // SPA fallback（所有非 /api 路由返回 index.html）
  app.use((_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  let server: ReturnType<typeof app.listen> | null = null;

  return {
    async start() {
      // ── 初始化资源系统（skills/mcp/agents/providers 目录与事件总线）
      await initResourceSystem();

      server = app.listen(port, '0.0.0.0', () => {
    const interfaces = os.networkInterfaces();
    let lanIp = 'localhost';
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          lanIp = net.address;
          break;
        }
      }
      if (lanIp !== 'localhost') break;
    }
    console.log(`[Admin] 可视化配置面板已启动: http://${lanIp}:${port}`);
  });

      // ── 设置 WebSocket 终端服务器（用于 OAuth 登录）
      setupResourcesTerminalWebSocket(server);
    },
    stop() {
      server?.close();
    },
  };
}
