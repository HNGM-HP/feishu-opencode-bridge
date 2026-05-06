import express, { type Request, type Response, type Application } from 'express';
import { opencodeClient } from '../../opencode/client.js';
import { chatAuthMiddleware } from './chat-auth.js';

function errorMsg(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export function registerChatAbortRoutes(app: Application): void {
  const router = express.Router();
  router.use(chatAuthMiddleware);

  router.post('/sessions/:id/abort', async (req: Request, res: Response) => {
    try {
      const sessionId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
      if (!sessionId) {
        res.status(400).json({ error: '缺少 sessionId' });
        return;
      }

      const ok = await opencodeClient.abortSession(sessionId);
      if (!ok) {
        res.status(502).json({ error: '中断会话失败' });
        return;
      }

      res.json({ ok: true });
    } catch (error) {
      console.error('[Chat API] 中断会话失败:', error);
      res.status(502).json({ error: errorMsg(error) });
    }
  });

  app.use('/api/chat', router);
}
