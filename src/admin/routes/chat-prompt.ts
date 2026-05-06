/**
 * chat-prompt.ts — 发送消息（异步，前端通过 SSE 收取增量）
 *
 * POST /api/chat/prompt
 * Body:
 *   {
 *     sessionId: string,
 *     parts: Array<{ type: 'text', text: string } | { type: 'file', mime: string, url: string, filename?: string }>,
 *     providerId?: string,
 *     modelId?: string,
 *     agent?: string,
 *     variant?: string,
 *     directory?: string
 *   }
 *
 * 成功返回 { ok: true }，模型输出由 /api/chat/events SSE 推送。
 *
 * 见 plan-v2.md 第四节。
 */

import express, { type Request, type Response, type Application } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { opencodeClient } from '../../opencode/client.js';
import { preprocessVisionParts, type VisionPart } from '../../services/vision-ocr.js';
import { chatAuthMiddleware } from './chat-auth.js';

type ChatPart = VisionPart;

interface PromptRequestBody {
  sessionId?: string;
  parts?: ChatPart[];
  providerId?: string;
  modelId?: string;
  agent?: string;
  variant?: string;
  directory?: string;
}

const UPLOAD_DIR = path.resolve(process.cwd(), 'data', 'uploads');

function errorMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

function validateParts(parts: unknown): parts is PromptRequestBody['parts'] {
  if (!Array.isArray(parts) || parts.length === 0) return false;
  for (const p of parts) {
    if (!p || typeof p !== 'object') return false;
    const rec = p as Record<string, unknown>;
    if (rec.type === 'text') {
      if (typeof rec.text !== 'string') return false;
    } else if (rec.type === 'file') {
      if (typeof rec.mime !== 'string' || typeof rec.url !== 'string') return false;
    } else {
      return false;
    }
  }
  return true;
}

function extractUploadFilename(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  let pathname = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      pathname = new URL(trimmed).pathname;
    } catch {
      return null;
    }
  }

  if (!pathname.startsWith('/uploads/')) {
    return null;
  }

  const filename = path.basename(pathname);
  return filename && filename !== '.' && filename !== '..' ? filename : null;
}

async function inlineUploadParts(parts: ChatPart[]): Promise<ChatPart[]> {
  const resolved = await Promise.all(parts.map(async (part): Promise<ChatPart> => {
    if (part.type !== 'file') {
      return part;
    }

    const filename = extractUploadFilename(part.url);
    if (!filename) {
      return part;
    }

    const filePath = path.join(UPLOAD_DIR, filename);
    const buffer = await fs.readFile(filePath);
    const mime = part.mime || 'application/octet-stream';

    return {
      ...part,
      url: `data:${mime};base64,${buffer.toString('base64')}`,
    };
  }));

  return resolved;
}

export function registerChatPromptRoutes(app: Application): void {
  const router = express.Router();
  router.use(chatAuthMiddleware);

  router.post('/prompt', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as PromptRequestBody;
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      if (!sessionId) {
        res.status(400).json({ error: '缺少 sessionId' });
        return;
      }
      if (!validateParts(body.parts)) {
        res.status(400).json({ error: 'parts 必须为非空数组，仅支持 text / file 两种类型' });
        return;
      }

      const inlinedParts = await inlineUploadParts(body.parts!);
      const resolvedParts = await preprocessVisionParts(
        inlinedParts,
        {
          providerId: body.providerId,
          modelId: body.modelId,
          directory: body.directory,
        },
        'Chat API',
      );

      await opencodeClient.sendMessagePartsAsync(sessionId, resolvedParts, {
        providerId: body.providerId,
        modelId: body.modelId,
        agent: body.agent,
        variant: body.variant,
        directory: body.directory,
      });

      res.json({ ok: true });
    } catch (e) {
      console.error('[Chat API] 发送消息失败:', e);
      res.status(502).json({ error: errorMsg(e) });
    }
  });

  app.use('/api/chat', router);
}
