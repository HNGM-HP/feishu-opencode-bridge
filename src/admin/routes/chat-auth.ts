/**
 * Chat Auth 中间件
 *
 * 历史上：根据管理员密码（Bearer / ?token=）校验请求。
 * 现状：管理后台已彻底移除账号 / 密码鉴权，所有请求直接放行；
 *       本文件仅保留导出符号以避免破坏外部 import 路径。
 */
import type { Request, Response, NextFunction } from 'express';

export function isChatAuthorized(_req: Request): boolean {
  return true;
}

export function chatAuthMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
