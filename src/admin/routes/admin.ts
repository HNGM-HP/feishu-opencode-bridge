/**
 * Admin API 路由
 *
 * 处理管理相关的 API 端点
 */

import express from 'express';
import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { configStore } from '../../store/config-store.js';
import { logStore } from '../../store/log-store.js';
import type { BridgeManager } from '../bridge-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AdminRoutesOptions {
  version: string;
  startedAt: Date;
  cronJobCount: number;
  bridgeManager: BridgeManager | undefined;
}

export function createAdminRoutes(options: AdminRoutesOptions): express.Router {
  const router = express.Router();
  const { version, startedAt, cronJobCount, bridgeManager } = options;

  // ── GET /api/admin/status
  router.get('/status', (_req, res) => {
    res.json({
      version,
      uptime: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      startedAt: startedAt.toISOString(),
      dbPath: configStore.getDbPath(),
      cronJobCount,
    });
  });

  // ── POST /api/admin/restart
  router.post('/restart', async (_req, res) => {
    if (!bridgeManager) {
      res.status(503).json({ error: 'Bridge 管理器未初始化' });
      return;
    }

    // 同步等待重启完成
    const result = await bridgeManager.restart();

    if (result.success) {
      res.json({ ok: true, pid: result.pid, message: 'Bridge 重启成功' });
    } else {
      res.status(500).json({ error: result.error || '重启失败' });
    }
  });

  // ── POST /api/admin/stop-bridge（仅停止 Bridge 进程）
  router.post('/stop-bridge', async (_req, res) => {
    if (!bridgeManager) {
      res.status(503).json({ error: 'Bridge 管理器未初始化' });
      return;
    }

    res.json({ ok: true, message: 'Bridge 正在终止...' });

    // 异步执行终止逻辑
    bridgeManager.stop().then(() => {
      console.log('[Admin] Bridge 进程已终止（Web 面板保持运行）');
    }).catch((e: Error) => {
      console.error('[Admin] Bridge 终止失败:', e.message);
    });
  });

  // ── GET /api/admin/bridge
  router.get('/bridge', (_req, res) => {
    if (!bridgeManager) {
      res.json({ running: false, managed: false });
      return;
    }

    const status = bridgeManager.getStatus();
    res.json({ managed: true, ...status });
  });

  // ── POST /api/admin/upgrade
  router.post('/upgrade', async (_req, res) => {
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Admin] 升级失败:', message);
      res.status(500).json({ error: '升级失败：' + message });
    }
  });

  // ── POST /api/admin/shutdown（终止服务）
  router.post('/shutdown', async (_req, res) => {
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
          const processManagerPath = path.resolve(__dirname, '../../../scripts/process-manager.mjs');
          const { spawnSync } = await import('node:child_process');
          spawnSync(process.execPath, [processManagerPath, 'kill-opencode'], {
            stdio: 'inherit',
            windowsHide: true,
          });
          console.log('[Admin] OpenCode 进程已终止');
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : 'Unknown error';
          console.error('[Admin] 终止 OpenCode 失败:', message);
        }

        // 3. 退出 Admin 进程
        console.log('[Admin] 服务已终止');
        process.exit(0);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('[Admin] 终止服务失败:', message);
        process.exit(1);
      }
    }, 500);
  });

  // ── POST /api/admin/repair（修复功能）
  router.post('/repair', async (_req, res) => {
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
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      results.push(`数据库初始化失败: ${message}`);
    }

    // 清理日志缓存
    try {
      logStore.clear();
      results.push('日志缓存已清理');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      results.push(`日志清理失败: ${message}`);
    }

    res.json({ ok: true, results });
  });

  // ── GET /api/admin/onboarding-status
  router.get('/onboarding-status', (_req, res) => {
    res.json({ completed: configStore.isOnboardingCompleted() });
  });

  // ── PUT /api/admin/onboarding-status
  router.put('/onboarding-status', (req, res) => {
    const completed = Boolean(req.body?.completed);
    configStore.setOnboardingCompleted(completed);
    res.json({ ok: true, completed });
  });

  // ── GET /api/admin/check-update
  router.get('/check-update', async (_req, res) => {
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  return router;
}