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
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configStore, type BridgeSettings } from '../store/config-store.js';
import { logStore } from '../store/log-store.js';
import type { RuntimeCronManager } from '../reliability/runtime-cron.js';
import type { BridgeManager } from './bridge-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID',
  'WECOM_ENABLED',
  'WECOM_BOT_ID',
  'WECOM_SECRET',
  'OPENCODE_HOST',
  'OPENCODE_PORT',
  'OPENCODE_SERVER_USERNAME',
  'OPENCODE_SERVER_PASSWORD',
  'OPENCODE_AUTO_START',
  'OPENCODE_AUTO_START_CMD',
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
  password: string; // 仅用于首次初始化
  cronManager?: RuntimeCronManager;
  startedAt?: Date;
  version?: string;
  bridgeManager?: BridgeManager;
}

export function createAdminServer(options: AdminServerOptions): { start: () => void; stop: () => void } {
  const app = express();
  const { port, cronManager, bridgeManager } = options;
  const startedAt = options.startedAt ?? new Date();
  const version = options.version ?? 'unknown';

  // ── 密码初始化：首次启动从 env 读取，后续使用数据库密码
  const envPassword = options.password;
  let dbPassword = configStore.getAdminPassword();
  if (!dbPassword && envPassword) {
    configStore.setAdminPassword(envPassword);
    dbPassword = envPassword;
    console.log('[Admin] 首次启动，已从环境变量初始化管理员密码');
  }

  app.use(express.json());

  // ── 静态前端文件（dist/public）
  const publicDir = path.resolve(__dirname, '../../dist/public');
  app.use(express.static(publicDir));

  // ── 基础 Token 鉴权中间件（Bearer password）
  // 每次请求从数据库读取密码，确保修改密码后立即生效
  function authMiddleware(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): void {
    const currentPassword = configStore.getAdminPassword() || '';
    if (!currentPassword) {
      next();
      return;
    }
    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const tokenBuf = Buffer.from(token);
    const passBuf = Buffer.from(currentPassword);
    if (tokenBuf.length !== passBuf.length || !crypto.timingSafeEqual(tokenBuf, passBuf)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  }

  const api = express.Router();
  api.use(authMiddleware);

  // ── GET /api/config
  api.get('/config', (_req, res) => {
    const settings = configStore.get();
    // 脱敏：不直接返回密钥原文给前端（返回掩码，前端保存时若未修改则不覆盖）
    const masked = { ...settings };
    const secretKeys: (keyof BridgeSettings)[] = [
      'FEISHU_APP_SECRET',
      'DISCORD_TOKEN',
      'DISCORD_BOT_TOKEN',
      'WECOM_SECRET',
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
      'DISCORD_BOT_TOKEN',
      'WECOM_SECRET',
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
      needsPasswordChange: configStore.needsPasswordChange(),
    });
  });

  // ── GET /api/admin/password-status
  api.get('/admin/password-status', (_req, res) => {
    res.json({
      needsPasswordChange: configStore.needsPasswordChange(),
      hasPassword: !!configStore.getAdminPassword(),
    });
  });

  // ── PUT /api/admin/password
  api.put('/admin/password', (req, res) => {
    const { oldPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ error: '新密码长度至少 8 位' });
      return;
    }

    // 验证旧密码
    const currentPassword = configStore.getAdminPassword() || '';
    if (oldPassword !== currentPassword) {
      res.status(401).json({ error: '原密码错误' });
      return;
    }

    // 更新密码
    configStore.setAdminPassword(newPassword);
    configStore.setPasswordChangedAt(new Date().toISOString());

    res.json({ ok: true, message: '密码修改成功，请使用新密码重新登录' });
  });

  // ── POST /api/admin/restart
  api.post('/admin/restart', async (_req, res) => {
    if (!bridgeManager) {
      res.status(503).json({ error: 'Bridge 管理器未初始化' });
      return;
    }

    res.json({ ok: true, message: '正在重启 Bridge 服务...' });

    // 异步重启，不阻塞响应
    bridgeManager.restart().then(result => {
      if (result.success) {
        console.log(`[Admin] Bridge 重启成功，PID=${result.pid}`);
      } else {
        console.error(`[Admin] Bridge 重启失败: ${result.error}`);
      }
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
        execSync('git pull --ff-only', { encoding: 'utf-8', cwd: process.cwd() });
      } catch {
        // 忽略 git 错误，可能是本地修改
      }

      // 安装依赖
      execSync('npm install --include=dev', { encoding: 'utf-8', cwd: process.cwd() });

      // 构建前端
      execSync('npm run build:web', { encoding: 'utf-8', cwd: process.cwd() });

      // 构建后端
      execSync('npm run build', { encoding: 'utf-8', cwd: process.cwd() });

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
        version = execSync('opencode --version', { encoding: 'utf-8', timeout: 5000 }).trim();
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
        execSync('git fetch --tags', { encoding: 'utf-8', timeout: 30000 });
      } catch {
        // 忽略 fetch 错误
      }

      // 获取最新 tag
      let latestTag = '';
      try {
        latestTag = execSync('git describe --tags "$(git rev-list --tags --max-count=1)"', {
          encoding: 'utf-8',
          timeout: 5000
        }).trim();
      } catch {
        // 没有 tag
      }

      // 检查是否有更新
      let hasUpdate = false;
      if (latestTag) {
        try {
          const currentCommit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
          const tagCommit = execSync('git rev-parse ' + latestTag, { encoding: 'utf-8' }).trim();
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
        execSync('npm i -g opencode-ai', { encoding: 'utf-8', timeout: 120000 });
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
        execSync('opencode upgrade', { encoding: 'utf-8', timeout: 120000 });
        console.log('[Admin] OpenCode 升级完成');
      } catch (error: any) {
        console.error('[Admin] OpenCode 升级失败:', error.message);
      }
    }, 100);
  });

  // ── POST /api/opencode/start
  api.post('/opencode/start', async (_req, res) => {
    try {
      // 写入 server 配置
      const opencodeConfigDir = path.join(os.homedir(), '.config', 'opencode');
      const fs = await import('node:fs');
      fs.mkdirSync(opencodeConfigDir, { recursive: true });

      const configPath = path.join(opencodeConfigDir, 'opencode.json');
      let config: any = {};
      if (fs.existsSync(configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch {
          // 忽略解析错误
        }
      }

      config.server = {
        port: 4096,
        hostname: '0.0.0.0',
        cors: ['*'],
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      // 启动 OpenCode
      spawn('opencode', [], {
        detached: true,
        stdio: 'ignore',
      });

      res.json({ ok: true, message: 'OpenCode 已启动' });
    } catch (error: any) {
      res.status(500).json({ error: '启动失败：' + error.message });
    }
  });

  // ── POST /api/opencode/stop
  api.post('/opencode/stop', (_req, res) => {
    res.json({ ok: true, message: '正在终止 OpenCode...' });

    // 异步终止 OpenCode 进程
    setTimeout(() => {
      try {
        execSync('node ' + path.join(process.cwd(), 'scripts', 'process-manager.mjs') + ' kill-opencode', {
          encoding: 'utf-8',
          timeout: 10000,
        });
        console.log('[Admin] OpenCode 进程已终止');
      } catch (error: any) {
        console.error('[Admin] OpenCode 终止失败:', error.message);
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
      const feishuEnabled = settings.FEISHU_ENABLED !== 'false'; // 默认启用，只有显式设为 false 才禁用
      if (!feishuEnabled) {
        health.checks.feishu = { status: 'warning', message: '飞书已禁用 (FEISHU_ENABLED=false)' };
      } else if (settings.FEISHU_APP_ID && settings.FEISHU_APP_SECRET) {
        health.checks.feishu = { status: 'ok', message: '飞书凭据已配置' };
      } else {
        health.checks.feishu = { status: 'warning', message: '飞书凭据未配置' };
      }
    } catch (e: any) {
      health.checks.feishu = { status: 'error', message: e.message };
    }

    // 检测 Discord 配置
    try {
      const settings = configStore.get();
      if (settings.DISCORD_ENABLED === 'true' && (settings.DISCORD_TOKEN || settings.DISCORD_BOT_TOKEN)) {
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
      const output = execSync('opencode models', { encoding: 'utf-8', timeout: 30000 });
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

  // ── GET /api/sessions
  api.get('/sessions', async (_req, res) => {
    try {
      // 从 chat-session-store 读取当前活跃的会话
      const { chatSessionStore } = await import('../store/chat-session.js');

      // 获取飞书会话
      const feishuChatIds = chatSessionStore.getChatIdsByPlatform?.('feishu') || [];
      const feishuSessions = feishuChatIds.map((chatId: string) => {
        const session = chatSessionStore.getSession?.(chatId);
        return {
          chatId,
          title: session?.title || '未命名会话',
          userId: session?.creatorId,
        };
      });

      // 获取 Discord 会话（从 chatSessionStore 中获取 discord 平台的会话）
      const discordChatIds = chatSessionStore.getChatIdsByPlatform?.('discord') || [];
      const discordSessions = discordChatIds.map((chatId: string) => {
        const session = chatSessionStore.getSession?.(chatId);
        return {
          conversationId: chatId,
          title: session?.title || '未命名会话',
          userId: session?.creatorId,
        };
      });

      // 获取企业微信会话
      const wecomChatIds = chatSessionStore.getChatIdsByPlatform?.('wecom') || [];
      const wecomSessions = wecomChatIds.map((chatId: string) => {
        const session = chatSessionStore.getSession?.(chatId);
        return {
          conversationId: chatId,
          title: session?.title || '未命名会话',
          userId: session?.creatorId,
        };
      });

      res.json({
        feishu: feishuSessions,
        discord: discordSessions,
        wecom: wecomSessions,
      });
    } catch (error: any) {
      console.error('[Admin] 获取会话列表失败:', error.message);
      // 如果获取失败，返回空列表
      res.json({ feishu: [], discord: [], wecom: [] });
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
          const processManagerPath = path.resolve(__dirname, '../../scripts/process-manager.mjs');
          spawnSync(process.execPath, [processManagerPath, 'kill-opencode'], {
            stdio: 'inherit',
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

  // ── GET /api/admin/login-timeout（获取登录超时配置）
  api.get('/admin/login-timeout', (_req, res) => {
    const timeoutMinutes = configStore.getLoginTimeout();
    res.json({ timeoutMinutes });
  });

  // ── PUT /api/admin/login-timeout（设置登录超时配置）
  api.put('/admin/login-timeout', (req, res) => {
    const { timeoutMinutes } = req.body;

    if (typeof timeoutMinutes !== 'number' || timeoutMinutes < 0) {
      res.status(400).json({ error: '超时时间必须为非负整数' });
      return;
    }

    configStore.setLoginTimeout(timeoutMinutes);
    res.json({ ok: true, timeoutMinutes, message: '登录超时设置已保存' });
  });

  app.use('/api', api);

  // SPA fallback（所有非 /api 路由返回 index.html）
  app.use((_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  let server: ReturnType<typeof app.listen> | null = null;

  return {
    start() {
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
    },
    stop() {
      server?.close();
    },
  };
}
