/**
 * Cron API 路由
 *
 * 处理定时任务相关的 API 端点
 */

import express from 'express';
import type { RuntimeCronManager } from '../../reliability/runtime-cron.js';

export interface CronRoutesOptions {
  cronManager: RuntimeCronManager | undefined;
}

export function createCronRoutes(options: CronRoutesOptions): express.Router {
  const router = express.Router();
  const { cronManager } = options;

  // ── GET /api/cron
  router.get('/', (_req, res) => {
    if (!cronManager) {
      res.json({ jobs: [] });
      return;
    }
    res.json({ jobs: cronManager.listJobs() });
  });

  // ── POST /api/cron/create
  router.post('/create', (req, res) => {
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create job';
      res.status(400).json({ error: message });
    }
  });

  // ── POST /api/cron/:id/toggle
  router.post('/:id/toggle', (req, res) => {
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
  router.delete('/:id', (req, res) => {
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

  return router;
}