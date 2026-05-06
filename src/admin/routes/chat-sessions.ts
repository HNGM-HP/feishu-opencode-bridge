/**
 * chat-sessions.ts — 会话 CRUD + 消息历史
 *
 * REST 路由（挂载于 /api/chat）：
 *   GET    /sessions                        列表（跨项目聚合）
 *   POST   /sessions                        创建 { title?, directory? }
 *   GET    /sessions/:id                    详情
 *   PATCH  /sessions/:id                    重命名 { title }
 *   DELETE /sessions/:id                    删除 { directory? as query }
 *   GET    /sessions/:id/messages           历史消息（info + parts）
 *   POST   /sessions/:id/revert             回退到指定消息（删除该消息及之后消息）
 *   POST   /sessions/:id/undo               回退上一轮对话
 *   POST   /sessions/:id/summarize          触发总结（可选）
 *
 * 所有路由只是 opencodeClient 的薄封装，不引入本地持久化。
 * 见 plan-v2.md 第四节。
 */

import express, { type Request, type Response, type Application } from 'express';
import { opencodeClient } from '../../opencode/client.js';
import { chatEventBus } from '../chat/event-bus.js';
import type { Session } from '@opencode-ai/sdk';
import { chatAuthMiddleware } from './chat-auth.js';

const MESSAGE_PAGE_LIMIT_DEFAULT = 10;
const MESSAGE_PAGE_LIMIT_MAX = 100;

function errorMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

function paramStr(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] ?? '' : '';
}

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function isTodoWriteTool(name: unknown): boolean {
  if (typeof name !== 'string') {
    return false;
  }

  const normalized = name.trim().toLowerCase();
  return normalized === 'todowrite' || normalized === 'todo_write' || normalized === 'todo-write';
}

function toTodoItems(raw: unknown): Array<{ id: string; content: string; status: string; priority?: string }> {
  if (!Array.isArray(raw)) {
    return [];
  }

  const tasks: Array<{ id: string; content: string; status: string; priority?: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const contentValue = record.content ?? record.title ?? record.text;
    const content = typeof contentValue === 'string' ? contentValue.trim() : '';
    const status = typeof record.status === 'string' && record.status.trim()
      ? record.status.trim()
      : 'pending';

    if (!id || !content) {
      continue;
    }

    tasks.push({
      id,
      content,
      status,
      ...(typeof record.priority === 'string' ? { priority: record.priority } : {}),
    });
  }

  return tasks;
}

function extractLatestTasks(messages: Array<{ parts?: unknown[] }>): Array<{ id: string; content: string; status: string; priority?: string }> {
  let latestTasks: Array<{ id: string; content: string; status: string; priority?: string }> = [];

  for (const message of messages) {
    const parts = Array.isArray(message.parts) ? message.parts : [];
    for (const part of parts) {
      if (!part || typeof part !== 'object') {
        continue;
      }

      const record = part as Record<string, unknown>;
      if (record.type !== 'tool' || !isTodoWriteTool(record.tool)) {
        continue;
      }

      const state = record.state && typeof record.state === 'object'
        ? record.state as Record<string, unknown>
        : undefined;
      const metadata = state?.metadata && typeof state.metadata === 'object'
        ? state.metadata as Record<string, unknown>
        : undefined;
      const inputTodos = state?.input && typeof state.input === 'object'
        ? (state.input as Record<string, unknown>).todos
        : undefined;
      const tasks = toTodoItems(metadata?.todos ?? inputTodos);

      if (tasks.length > 0) {
        latestTasks = tasks;
      }
    }
  }

  return latestTasks;
}

function toSessionItem(s: Session): {
  id: string;
  title: string;
  projectId: string;
  directory: string;
  parentId?: string;
  createdAt: number;
  updatedAt: number;
  version: string;
  summary?: Session['summary'];
  share?: Session['share'];
} {
  return {
    id: s.id,
    title: s.title,
    projectId: s.projectID,
    directory: s.directory,
    parentId: s.parentID,
    createdAt: s.time?.created ?? 0,
    updatedAt: s.time?.updated ?? s.time?.created ?? 0,
    version: s.version,
    summary: s.summary,
    share: s.share,
  };
}

function findUndoTargetMessageId(messages: Array<{ info?: { id?: string; role?: string } }>): string | undefined {
  // 从后往前找最后一条 user 消息作为回退目标
  // 不再 fallback 到任意消息，避免误回退 assistant 消息
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const messageId = typeof message?.info?.id === 'string' ? message.info.id.trim() : '';
    if (!messageId) {
      continue;
    }

    if (message.info?.role === 'user') {
      return messageId;
    }
  }

  return undefined;
}

export function registerChatSessionsRoutes(app: Application): void {
  const router = express.Router();
  router.use(chatAuthMiddleware);

  // ── GET /sessions — 列表
  router.get('/sessions', async (req: Request, res: Response) => {
    try {
      const directory = typeof req.query.directory === 'string' ? req.query.directory : undefined;
      const sessions = directory
        ? await opencodeClient.listSessions({ directory })
        : await opencodeClient.listSessionsAcrossProjects();

      const items = sessions
        .map(toSessionItem)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      res.json({ sessions: items });
    } catch (e) {
      console.error('[Chat API] 获取会话列表失败:', e);
      res.status(502).json({ error: errorMsg(e) });
    }
  });

  // ── POST /sessions — 创建
  router.post('/sessions', async (req: Request, res: Response) => {
    try {
      const { title, directory } = (req.body ?? {}) as { title?: string; directory?: string };
      const session = await opencodeClient.createSession(title, directory);
      res.json({ session: toSessionItem(session) });
    } catch (e) {
      console.error('[Chat API] 创建会话失败:', e);
      res.status(502).json({ error: errorMsg(e) });
    }
  });

  // ── GET /sessions/:id — 详情
  router.get('/sessions/:id', async (req: Request, res: Response) => {
    try {
      const directory = typeof req.query.directory === 'string' ? req.query.directory : undefined;
      const session = directory
        ? await opencodeClient.getSessionById(paramStr(req.params.id), { directory })
        : await opencodeClient.findSessionAcrossProjects(paramStr(req.params.id));

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      res.json({ session: toSessionItem(session) });
    } catch (e) {
      console.error('[Chat API] 获取会话详情失败:', e);
      res.status(502).json({ error: errorMsg(e) });
    }
  });

  // ── PATCH /sessions/:id — 重命名
  router.patch('/sessions/:id', async (req: Request, res: Response) => {
    try {
      const { title } = (req.body ?? {}) as { title?: string };
      if (!title || !title.trim()) {
        res.status(400).json({ error: '缺少 title' });
        return;
      }

      const ok = await opencodeClient.updateSession(paramStr(req.params.id), title.trim());
      if (!ok) {
        res.status(502).json({ error: '重命名失败' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[Chat API] 重命名会话失败:', e);
      res.status(502).json({ error: errorMsg(e) });
    }
  });

  // ── DELETE /sessions/:id
  router.delete('/sessions/:id', async (req: Request, res: Response) => {
    try {
      const directory = typeof req.query.directory === 'string' ? req.query.directory : undefined;
      const ok = await opencodeClient.deleteSession(paramStr(req.params.id), directory ? { directory } : undefined);
      if (!ok) {
        res.status(502).json({ error: '删除失败' });
        return;
      }
      chatEventBus.clearSession(paramStr(req.params.id));
      res.json({ ok: true });
    } catch (e) {
      console.error('[Chat API] 删除会话失败:', e);
      res.status(502).json({ error: errorMsg(e) });
    }
  });

  // ── GET /sessions/:id/messages — 历史消息
  router.get('/sessions/:id/messages', async (req: Request, res: Response) => {
    try {
      const messages = await opencodeClient.getSessionMessages(paramStr(req.params.id));
      const total = messages.length;
      const limit = Math.min(
        parsePositiveInt(req.query.limit, MESSAGE_PAGE_LIMIT_DEFAULT),
        MESSAGE_PAGE_LIMIT_MAX
      );
      const requestedCursor = parsePositiveInt(req.query.cursor, total);
      const cursor = Math.min(requestedCursor, total);
      const start = Math.max(cursor - limit, 0);
      const page = messages.slice(start, cursor);

      res.json({
        messages: page,
        tasks: extractLatestTasks(messages),
        total,
        hasMore: start > 0,
        nextCursor: start > 0 ? String(start) : null,
      });
    } catch (e) {
      console.error('[Chat API] 获取会话消息失败:', e);
      res.status(502).json({ error: errorMsg(e) });
    }
  });

  // ── POST /sessions/:id/summarize — 触发总结
  router.post('/sessions/:id/summarize', async (req: Request, res: Response) => {
    try {
      const { providerId, modelId } = (req.body ?? {}) as { providerId?: string; modelId?: string };
      if (!providerId || !modelId) {
        res.status(400).json({ error: '缺少 providerId / modelId' });
        return;
      }
      const ok = await opencodeClient.summarizeSession(paramStr(req.params.id), providerId, modelId);
      res.json({ ok });
    } catch (e) {
      console.error('[Chat API] 总结会话失败:', e);
      res.status(502).json({ error: errorMsg(e) });
    }
  });

  // ── POST /sessions/:id/revert — 回退到指定消息
  router.post('/sessions/:id/revert', async (req: Request, res: Response) => {
    try {
      const sessionId = paramStr(req.params.id);
      const messageId = typeof req.body?.messageId === 'string' ? req.body.messageId.trim() : '';

      if (!sessionId) {
        res.status(400).json({ error: '缺少 sessionId' });
        return;
      }

      if (!messageId) {
        res.status(400).json({ error: '缺少 messageId' });
        return;
      }

      const ok = await opencodeClient.revertMessage(sessionId, messageId);
      if (!ok) {
        res.status(502).json({ error: '回退失败' });
        return;
      }

      res.json({ ok: true });
    } catch (e) {
      console.error('[Chat API] 回退会话失败:', e);
      res.status(502).json({ error: errorMsg(e) });
    }
  });

  // ── POST /sessions/:id/undo — 回退上一轮对话
  router.post('/sessions/:id/undo', async (req: Request, res: Response) => {
    try {
      const sessionId = paramStr(req.params.id);
      if (!sessionId) {
        res.status(400).json({ error: '缺少 sessionId' });
        return;
      }

      const messages = await opencodeClient.getSessionMessages(sessionId);
      const targetMessageId = findUndoTargetMessageId(messages);
      if (!targetMessageId) {
        res.status(409).json({ error: '当前没有可回退的对话' });
        return;
      }

      const ok = await opencodeClient.revertMessage(sessionId, targetMessageId);
      if (!ok) {
        res.status(502).json({ error: '回退失败' });
        return;
      }

      res.json({ ok: true, messageId: targetMessageId });
    } catch (e) {
      console.error('[Chat API] 回退上一轮失败:', e);
      res.status(502).json({ error: errorMsg(e) });
    }
  });

  app.use('/api/chat', router);
}
