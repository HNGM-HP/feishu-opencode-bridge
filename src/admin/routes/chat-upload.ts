/**
 * chat-upload.ts — 文件上传 API
 *
 * POST /api/chat/upload
 *
 * 支持的文件类型：对齐 OpenCode 能力（所有 MIME 类型）
 * 文件大小限制：使用 ATTACHMENT_MAX_SIZE 配置（默认 50MB）
 *
 * 成功返回：
 * {
 *   ok: true,
 *   file: {
 *     url: string,        // 文件访问 URL
 *     filename: string,   // 原始文件名
 *     mime: string,       // MIME 类型
 *     size: number        // 文件大小（字节）
 *   }
 * }
 */

import express, { type Request, type Response, type Application } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { chatAuthMiddleware } from './chat-auth.js';

// 生成文件存储目录
const UPLOAD_DIR = path.resolve(process.cwd(), 'data', 'uploads');

// 确保上传目录存在
async function ensureUploadDir(): Promise<void> {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch (error) {
    console.error('[Upload] 创建上传目录失败:', error);
    throw error;
  }
}

// 生成唯一文件名
function generateFilename(originalName: string): string {
  const ext = path.extname(originalName);
  const hash = crypto.randomBytes(16).toString('hex');
  const basename = path.basename(originalName, ext).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
  return `${basename}_${hash}${ext}`;
}

// MIME 类型映射
const MIME_TYPE_MAP: Record<string, string> = {
  // 图片
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',

  // 文档
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',

  // 代码
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.py': 'text/x-python',
  '.java': 'text/x-java-source',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++',
  '.rs': 'text/x-rust',
  '.go': 'text/x-go',
  '.php': 'text/x-php',
  '.rb': 'text/x-ruby',
  '.sh': 'text/x-shellscript',
  '.sql': 'application/sql',

  // 压缩文件
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',

  // 视频
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',

  // 音频
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
};

// 获取 MIME 类型
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPE_MAP[ext] || 'application/octet-stream';
}

// 获取文件大小限制（从配置读取，默认 50MB）
function getMaxFileSize(): number {
  const maxSize = process.env.ATTACHMENT_MAX_SIZE || '52428800';
  return parseInt(maxSize, 10) || 52428800;
}

// 配置 multer 存储
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await ensureUploadDir();
      cb(null, UPLOAD_DIR);
    } catch (error) {
      cb(error as Error, UPLOAD_DIR);
    }
  },
  filename: (_req, file, cb) => {
    const safeName = generateFilename(file.originalname);
    cb(null, safeName);
  },
});

// multer 配置（不限制文件类型，仅限制大小）
const upload = multer({
  storage,
  limits: {
    fileSize: getMaxFileSize(),
  },
});

export function registerChatUploadRoutes(app: Application): void {
  const router = express.Router();
  router.use(chatAuthMiddleware);

  // 单文件上传
  router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: '未找到上传的文件' });
        return;
      }

      const file = req.file;
      const mime = getMimeType(file.originalname);

      // 返回相对路径，避免代理问题
      // 浏览器会自动从当前域名加载，不经过代理
      const fileUrl = `/uploads/${file.filename}`;

      // 返回文件信息
      res.json({
        ok: true,
        file: {
          url: fileUrl,
          filename: file.originalname,
          mime,
          size: file.size,
        },
      });
    } catch (error) {
      console.error('[Upload] 文件上传失败:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : '文件上传失败',
      });
    }
  });

  // 多文件上传（可选，暂不暴露）
  // router.post('/upload/multiple', upload.array('files', 10), async (req: Request, res: Response) => {
  //   // TODO: 实现多文件上传
  // });

  app.use('/api/chat', router);

  // 注册静态文件服务（用于访问上传的文件）
  app.use('/uploads', express.static(UPLOAD_DIR));
}
