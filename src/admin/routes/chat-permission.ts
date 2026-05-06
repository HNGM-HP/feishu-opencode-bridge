import express, { type Request, type Response, type Application } from 'express';
import { opencodeClient } from '../../opencode/client.js';
import { chatEventBus } from '../chat/event-bus.js';
import { chatAuthMiddleware } from './chat-auth.js';

function errorMsg(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export function registerChatPermissionRoutes(app: Application): void {
  const router = express.Router();
  router.use(chatAuthMiddleware);

  router.post('/permissions/:id', async (req: Request, res: Response) => {
    try {
      const permissionId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
      const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
      const decision = typeof req.body?.decision === 'string' ? req.body.decision.trim() : '';

      if (!permissionId || !sessionId) {
        res.status(400).json({ error: '缺少 permissionId / sessionId' });
        return;
      }

      if (!['allow', 'reject', 'always'].includes(decision)) {
        res.status(400).json({ error: 'decision 必须为 allow / reject / always' });
        return;
      }

      const result = await opencodeClient.respondToPermission(
        sessionId,
        permissionId,
        decision !== 'reject',
        decision === 'always',
      );

      if (!result.ok) {
        res.status(result.expired ? 410 : 502).json({
          error: result.expired ? '权限请求已过期' : '权限响应失败',
          expired: result.expired === true,
        });
        return;
      }

      chatEventBus.publish(sessionId, {
        type: 'permission_resolved',
        reqId: permissionId,
        decision: decision as 'allow' | 'reject' | 'always',
      });

      res.json({ ok: true });
    } catch (error) {
      console.error('[Chat API] 处理权限请求失败:', error);
      res.status(502).json({ error: errorMsg(error) });
    }
  });

  app.use('/api/chat', router);
}
