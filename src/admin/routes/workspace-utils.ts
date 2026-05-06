import path from 'node:path';
import type { Request } from 'express';
import { DirectoryPolicy, type DirectoryErrorCode } from '../../utils/directory-policy.js';

export type WorkspaceDirectoryResult =
  | { ok: true; directory: string }
  | { ok: false; status: number; error: string };

export type WorkspacePathResult =
  | { ok: true; relativePath: string; absolutePath: string }
  | { ok: false; status: number; error: string };

function mapDirectoryErrorStatus(code: DirectoryErrorCode): number {
  switch (code) {
    case 'not_found':
    case 'not_directory':
      return 404;
    case 'not_accessible':
    case 'not_allowed':
    case 'dangerous_path':
    case 'realpath_not_allowed':
    case 'git_root_not_allowed':
    case 'explicit_requires_allowlist':
      return 403;
    default:
      return 400;
  }
}

export function getWorkspaceDirectoryInput(req: Request): unknown {
  if (typeof req.query.directory === 'string') {
    return req.query.directory;
  }

  if (req.body && typeof req.body === 'object' && 'directory' in req.body) {
    return (req.body as Record<string, unknown>).directory;
  }

  return undefined;
}

export function resolveWorkspaceDirectory(rawDirectory: unknown): WorkspaceDirectoryResult {
  const explicitDirectory =
    typeof rawDirectory === 'string' && rawDirectory.trim()
      ? rawDirectory.trim()
      : undefined;

  // AI 工作区脱钩 ALLOWED_DIRECTORIES 白名单：Web 管理面板已认证，
  // 白名单仅约束平台接入（telegram/discord/qq/wecom 等外部消息入口）。
  // 这里仍保留格式校验、危险路径拦截、存在性/可访问性与 realpath 规范化。
  const resolved = DirectoryPolicy.resolve(
    explicitDirectory
      ? { explicitDirectory, scope: 'workspace' }
      : { scope: 'workspace' }
  );

  if (!resolved.ok) {
    return {
      ok: false,
      status: mapDirectoryErrorStatus(resolved.code),
      error: resolved.userMessage,
    };
  }

  if (!resolved.directory) {
    return {
      ok: false,
      status: 400,
      error: '缺少工作目录，请先为会话绑定目录，或在配置中设置 DEFAULT_WORK_DIRECTORY。',
    };
  }

  return {
    ok: true,
    directory: resolved.directory,
  };
}

export function resolveWorkspacePath(rootDirectory: string, rawPath: unknown): WorkspacePathResult {
  if (rawPath === undefined || rawPath === null || rawPath === '') {
    return {
      ok: true,
      relativePath: '',
      absolutePath: rootDirectory,
    };
  }

  if (typeof rawPath !== 'string') {
    return {
      ok: false,
      status: 400,
      error: 'path 参数必须是字符串。',
    };
  }

  const trimmedPath = rawPath.trim();
  if (!trimmedPath) {
    return {
      ok: true,
      relativePath: '',
      absolutePath: rootDirectory,
    };
  }

  if (path.isAbsolute(trimmedPath)) {
    return {
      ok: false,
      status: 400,
      error: 'path 必须是相对路径。',
    };
  }

  const absolutePath = path.resolve(rootDirectory, trimmedPath);
  const relativePath = path.relative(rootDirectory, absolutePath);
  const escapesRoot =
    relativePath.startsWith('..')
    || path.isAbsolute(relativePath);

  if (escapesRoot) {
    return {
      ok: false,
      status: 400,
      error: '路径超出工作目录范围。',
    };
  }

  return {
    ok: true,
    relativePath: relativePath.split(path.sep).join('/'),
    absolutePath,
  };
}
