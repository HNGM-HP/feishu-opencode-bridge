/**
 * 资源路径解析器
 *
 * 提供两层路径：
 *   - 项目级： <repoRoot>/data/<kind>/   （高优先级，启动时检测）
 *   - 用户级： ~/.opencode-bridge/<kind>/（低优先级，跨项目共享）
 *
 * 列表 / 读取时按 “项目级覆盖用户级”合并；写入时默认落在项目级，前端可显式选择 scope。
 *
 * Electron 打包后 process.cwd() 不可靠，因此项目根目录通过环境变量 OPENCODE_BRIDGE_DATA_ROOT
 * 显式指定优先；否则回退到 process.cwd()，并保证目录存在。
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { ResourceKind, ResourceScope } from './types.js';

/** 资源 kind 与目录名的映射。 */
const KIND_DIR: Record<ResourceKind, string> = {
  skill: 'skills',
  mcp: 'mcp',
  agents: 'agents',
  provider: 'providers',
};

/** 解析项目级数据根目录（绝对路径）。 */
export function getProjectDataRoot(): string {
  const fromEnv = process.env.OPENCODE_BRIDGE_DATA_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), 'data');
}

/** 解析用户级数据根目录（绝对路径）。 */
export function getUserDataRoot(): string {
  const fromEnv = process.env.OPENCODE_BRIDGE_USER_DATA_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(os.homedir(), '.opencode-bridge');
}

/** 给定 scope 的资源目录绝对路径（含 kind 子目录）。 */
export function getResourceDir(kind: ResourceKind, scope: ResourceScope): string {
  const root = scope === 'project' ? getProjectDataRoot() : getUserDataRoot();
  return path.join(root, KIND_DIR[kind]);
}

/** 同时返回 project + user 两个目录（用于扫描合并）。 */
export function getResourceDirs(kind: ResourceKind): Record<ResourceScope, string> {
  return {
    project: getResourceDir(kind, 'project'),
    user: getResourceDir(kind, 'user'),
  };
}

/** 确保资源目录存在；返回是否新建。 */
export function ensureResourceDir(kind: ResourceKind, scope: ResourceScope): boolean {
  const dir = getResourceDir(kind, scope);
  if (fs.existsSync(dir)) return false;
  fs.mkdirSync(dir, { recursive: true });
  return true;
}

/** 启动时一次性确保所有 kind 的项目级目录存在（用户级目录按需创建，避免污染 HOME）。 */
export function ensureAllProjectDirs(): void {
  const projectDirs: ResourceKind[] = ['skill', 'mcp', 'agents', 'provider'];
  projectDirs.forEach((kind) => {
    ensureResourceDir(kind, 'project');
  });
}

/**
 * 解析单个资源的 scope：若项目级文件/目录存在则 project，否则若用户级存在则 user，否则 null。
 * 用于按 name 读单个资源时定位它住在哪一层。
 *
 * @param entry 相对路径（文件名或目录名），如 "my-skill" 或 "github.json"
 */
export function locateResource(
  kind: ResourceKind,
  entry: string,
): { scope: ResourceScope; absPath: string } | null {
  const dirs = getResourceDirs(kind);
  const projectPath = path.join(dirs.project, entry);
  if (fs.existsSync(projectPath)) return { scope: 'project', absPath: projectPath };
  const userPath = path.join(dirs.user, entry);
  if (fs.existsSync(userPath)) return { scope: 'user', absPath: userPath };
  return null;
}

/** 资源名安全校验：仅允许 a-z 0-9 - _，长度 1-64。 */
export function isValidResourceName(name: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}

/** 抛错版校验，便于路由层使用。 */
export function assertValidResourceName(name: string): void {
  if (!isValidResourceName(name)) {
    throw new Error(
      `Invalid resource name: ${JSON.stringify(name)} (allowed: a-zA-Z0-9_-, length 1-64)`,
    );
  }
}
