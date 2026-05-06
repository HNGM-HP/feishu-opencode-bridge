import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { directoryConfig } from '../config.js';
import { configStore } from '../store/config-store.js';

export type DirectorySource = 'explicit' | 'alias' | 'chat_default' | 'env_default' | 'server_default';

export type DirectoryErrorCode =
  | 'empty'
  | 'not_absolute'
  | 'path_too_long'
  | 'dangerous_path'
  | 'not_allowed'
  | 'explicit_requires_allowlist'
  | 'alias_not_found'
  | 'not_found'
  | 'not_directory'
  | 'not_accessible'
  | 'realpath_not_allowed'
  | 'git_root_not_allowed'
  | 'git_root_invalid';

export interface DirectoryResolved {
  ok: true;
  directory: string;
  source: DirectorySource;
  raw: string;
  normalized: string;
  realpath: string;
  gitRoot?: string;
  projectName?: string;
}

export interface DirectoryResolveError {
  ok: false;
  code: DirectoryErrorCode;
  userMessage: string;
  internalDetail?: string;
  source?: DirectorySource;
  raw?: string;
}

export type DirectoryResolveResult = DirectoryResolved | DirectoryResolveError;

/**
 * 约束作用域：
 * - 'platform'（默认）：平台接入（telegram/discord/qq/wecom/weixin/whatsapp/dingtalk/feishu/group/p2p
 *   以及 /send 文件下发）必须强制 ALLOWED_DIRECTORIES 白名单，因为路径来自外部消息输入，不可信。
 * - 'workspace'：AI 工作区（Web 管理面板内的文件树 / Git / 终端 / 新建项目对话框）。
 *   调用方已通过管理面板身份认证，白名单和默认工作目录对其不适用 —— 只保留
 *   格式校验、危险路径拦截、存在性/可访问性检查以及 realpath 规范化。
 *
 * 变更点：白名单与默认工作目录仅约束平台接入，与 AI 工作区权限脱钩。
 */
export type DirectoryPolicyScope = 'platform' | 'workspace';

interface DirectoryResolveOptions {
  explicitDirectory?: string;
  aliasName?: string;
  chatDefaultDirectory?: string;
  envDefaultDirectory?: string;
  serverDefaultDirectory?: string;
  projectAliases?: Record<string, string>;
  allowedDirectories?: string[];
  gitRootNormalization?: boolean;
  maxPathLength?: number;
  /**
   * 作用域，默认 'platform'。AI 工作区请传 'workspace' 以脱钩白名单约束。
   */
  scope?: DirectoryPolicyScope;
}

const isWindows = process.platform === 'win32';

export class DirectoryPolicy {
  private static detectAllowlistConfigMode(): {
    mode: 'env' | 'db' | 'mixed' | 'unknown';
    envFile?: string;
  } {
    const envFile = process.env.OPENCODE_BRIDGE_ACTIVE_ENV_FILE?.trim();
    const migrated = configStore.isMigrated();

    let envHasAllowlist = false;
    if (envFile) {
      try {
        const content = fs.readFileSync(envFile, 'utf-8');
        const parsed = dotenv.parse(content);
        envHasAllowlist = typeof parsed.ALLOWED_DIRECTORIES === 'string'
          && parsed.ALLOWED_DIRECTORIES.trim().length > 0;
      } catch {
        // ignore
      }
    }

    if (envHasAllowlist && migrated) {
      return { mode: 'mixed', envFile };
    }

    if (envHasAllowlist) {
      return { mode: 'env', envFile };
    }

    if (migrated) {
      return { mode: 'db' };
    }

    if (envFile) {
      return { mode: 'env', envFile };
    }

    return { mode: 'unknown' };
  }

  private static buildAllowlistGuidance(): string {
    return '请在 Web 管理面板的“核心行为 -> 工作目录与项目 -> 允许的目录白名单（ALLOWED_DIRECTORIES）”中添加或修改目录\n管理面板地址：http://localhost:4098';
  }

  private static buildAllowlistUserMessage(
    rawPath: string,
    variant: 'not_allowed' | 'missing_allowlist',
    allowedDirectories: string[]
  ): string {
    const detected = this.detectAllowlistConfigMode();
    const sourceText =
      detected.mode === 'env' ? '配置来源：.env' :
      detected.mode === 'db' ? '配置来源：Web 管理面板 / SQLite' :
      detected.mode === 'mixed' ? '配置来源：混合模式（当前 .env 优先）' :
      '配置来源：未识别';
    const allowlistText = allowedDirectories.length > 0
      ? `当前允许目录：${allowedDirectories.join(' | ')}`
      : '当前允许目录：未配置';
    const title = variant === 'missing_allowlist'
      ? '未配置允许目录，禁止使用用户输入路径'
      : '目录不在允许范围内';

    return `${title}\n尝试目录：${rawPath}\n${sourceText}\n${allowlistText}\n${this.buildAllowlistGuidance()}`;
  }

  static buildProjectListEmptyMessage(): string {
    const detected = this.detectAllowlistConfigMode();
    const allowlist = directoryConfig.allowedDirectories;
    const sourceText =
      detected.mode === 'env' ? '配置来源：.env' :
      detected.mode === 'db' ? '配置来源：Web 管理面板 / SQLite' :
      detected.mode === 'mixed' ? '配置来源：混合模式（当前 .env 优先）' :
      '配置来源：未识别';
    const allowlistText = allowlist.length > 0
      ? `当前允许目录：${allowlist.join(' | ')}`
      : '当前允许目录：未配置';

    return `暂无可用项目\n${sourceText}\n${allowlistText}\n${this.buildAllowlistGuidance()}\n也可通过 PROJECT_ALIASES 配置项目别名`;
  }

  // 解析并校验目录（九阶段）
  static resolve(options?: DirectoryResolveOptions): DirectoryResolveResult {
    const explicitDirectory = options?.explicitDirectory?.trim();
    const aliasName = options?.aliasName?.trim();
    const chatDefaultDirectory = options?.chatDefaultDirectory?.trim();
    const envDefaultDirectory = options?.envDefaultDirectory ?? directoryConfig.defaultWorkDirectory;
    const serverDefaultDirectory = options?.serverDefaultDirectory?.trim();
    const aliases = options?.projectAliases ?? directoryConfig.projectAliases;
    const allowedDirectories = options?.allowedDirectories ?? directoryConfig.allowedDirectories;
    const gitRootNormalization = options?.gitRootNormalization ?? directoryConfig.gitRootNormalization;
    const maxPathLength = options?.maxPathLength ?? directoryConfig.maxPathLength;
    const scope: DirectoryPolicyScope = options?.scope ?? 'platform';
    // AI 工作区脱钩白名单：Web 管理面板已做过身份认证，允许浏览服务进程可访问的任意目录。
    const enforceAllowlist = scope !== 'workspace';

    // 1) 优先级合并
    let raw = '';
    let source: DirectorySource | undefined;
    let projectName: string | undefined;

    if (explicitDirectory) {
      raw = explicitDirectory;
      source = 'explicit';
    } else if (aliasName && typeof aliases[aliasName] === 'string') {
      raw = aliases[aliasName];
      source = 'alias';
      projectName = aliasName;
    } else if (aliasName) {
      // 别名不存在，直接报错（不静默回退）
      return {
        ok: false,
        code: 'alias_not_found' as DirectoryErrorCode,
        userMessage: `❌ 未知的项目别名: ${aliasName}\n使用 /project list 查看可用项目`,
        internalDetail: `别名未找到: ${aliasName}`,
        raw: aliasName,
      };
    } else if (chatDefaultDirectory) {
      raw = chatDefaultDirectory;
      source = 'chat_default';
    } else if (envDefaultDirectory && envDefaultDirectory.trim()) {
      raw = envDefaultDirectory.trim();
      source = 'env_default';
    } else if (serverDefaultDirectory) {
      raw = serverDefaultDirectory;
      source = 'server_default';
    } else {
      // 无任何目录来源 → 跟随 OpenCode 服务端默认目录（向后兼容）
      return {
        ok: true,
        directory: '',
        source: 'server_default',
        raw: '',
        normalized: '',
        realpath: '',
      };
    }

    // 2) 格式校验
    if (!raw || !raw.trim()) {
      return {
        ok: false,
        code: 'empty',
        userMessage: '目录不能为空',
        internalDetail: 'raw 为空',
        ...(source ? { source } : {}),
      };
    }

    if (raw.length > maxPathLength) {
      return {
        ok: false,
        code: 'path_too_long',
        userMessage: '目录路径过长',
        internalDetail: `路径长度 ${raw.length} 超过限制 ${maxPathLength}`,
        ...(source ? { source } : {}),
        raw,
      };
    }

    if (!path.isAbsolute(raw)) {
      return {
        ok: false,
        code: 'not_absolute',
        userMessage: '目录必须是绝对路径',
        internalDetail: `非绝对路径: ${raw}`,
        ...(source ? { source } : {}),
        raw,
      };
    }

    // 3) 规范化路径
    const normalized = this.normalizePath(raw);

    // 4) 危险路径拦截
    if (this.isDangerousPath(normalized)) {
      return {
        ok: false,
        code: 'dangerous_path',
        userMessage: '不允许使用危险路径',
        internalDetail: `危险路径: ${normalized}`,
        ...(source ? { source } : {}),
        raw,
      };
    }

    // 5) 允许目录校验（仅平台接入作用域生效；AI 工作区脱钩）
    const normalizedAllowed = this.normalizeAllowedDirectories(allowedDirectories);
    if (enforceAllowlist) {
      if (normalizedAllowed.length > 0) {
        if (!this.isPathAllowed(normalized, normalizedAllowed)) {
          return {
            ok: false,
            code: 'not_allowed',
            userMessage: this.buildAllowlistUserMessage(raw, 'not_allowed', allowedDirectories),
            internalDetail: `不在允许范围: ${normalized}`,
            ...(source ? { source } : {}),
            raw,
          };
        }
      } else if (source === 'explicit') {
        return {
          ok: false,
          code: 'explicit_requires_allowlist',
          userMessage: this.buildAllowlistUserMessage(raw, 'missing_allowlist', allowedDirectories),
          internalDetail: 'explicit 输入需要 ALLOWED_DIRECTORIES',
          raw,
        };
      }
    }

    // 6) 存在性与可访问性
    try {
      const stat = fs.statSync(normalized);
      if (!stat.isDirectory()) {
        return {
          ok: false,
          code: 'not_directory',
          userMessage: '指定的路径不是目录',
          internalDetail: `非目录: ${normalized}`,
          ...(source ? { source } : {}),
          raw,
        };
      }
    } catch (error) {
      return {
        ok: false,
        code: 'not_found',
        userMessage: '目录不存在或无法访问',
        internalDetail: `stat 失败: ${error instanceof Error ? error.message : String(error)}`,
        ...(source ? { source } : {}),
        raw,
      };
    }

    try {
      fs.accessSync(normalized, fs.constants.R_OK);
    } catch (error) {
      return {
        ok: false,
        code: 'not_accessible',
        userMessage: '目录不可读或无权限访问',
        internalDetail: `access 失败: ${error instanceof Error ? error.message : String(error)}`,
        ...(source ? { source } : {}),
        raw,
      };
    }

    // 7) 真实路径解析
    let realpath = normalized;
    try {
      realpath = this.normalizePath(fs.realpathSync(normalized));
    } catch (error) {
      return {
        ok: false,
        code: 'not_accessible',
        userMessage: '目录无法解析真实路径',
        internalDetail: `realpath 失败: ${error instanceof Error ? error.message : String(error)}`,
        ...(source ? { source } : {}),
        raw,
      };
    }

    if (enforceAllowlist && normalizedAllowed.length > 0 && realpath !== normalized) {
      if (!this.isPathAllowed(realpath, normalizedAllowed)) {
        return {
          ok: false,
          code: 'realpath_not_allowed',
          userMessage: this.buildAllowlistUserMessage(raw, 'not_allowed', allowedDirectories),
          internalDetail: `realpath 超出允许范围: ${realpath}`,
          ...(source ? { source } : {}),
          raw,
        };
      }
    }

    // 8) Git 根目录检测
    let gitRoot: string | undefined;
    if (gitRootNormalization) {
      gitRoot = this.detectGitRoot(realpath);
      if (gitRoot && !path.isAbsolute(gitRoot)) {
        return {
          ok: false,
          code: 'git_root_invalid',
          userMessage: '无法解析 Git 根目录',
          internalDetail: `git 根目录非绝对路径: ${gitRoot}`,
          ...(source ? { source } : {}),
          raw,
        };
      }
    }

    // 9) Git 根目录归一化后的允许目录复检（仅平台接入作用域生效）
    if (enforceAllowlist && gitRoot && gitRoot !== realpath) {
      if (normalizedAllowed.length > 0 && !this.isPathAllowed(gitRoot, normalizedAllowed)) {
        return {
          ok: false,
          code: 'git_root_not_allowed',
          userMessage: this.buildAllowlistUserMessage(raw, 'not_allowed', allowedDirectories),
          internalDetail: `git 根目录超出允许范围: ${gitRoot}`,
          ...(source ? { source } : {}),
          raw,
        };
      }
    }

    const finalDirectory = gitRoot || realpath;

    return {
      ok: true,
      directory: finalDirectory,
      source: source!,
      raw,
      normalized,
      realpath,
      ...(gitRoot ? { gitRoot } : {}),
      ...(projectName ? { projectName } : {}),
    };
  }

  // 列出可用项目目录
  static listAvailableProjects(knownDirectories: string[]): Array<{ name: string; directory: string; source: DirectorySource }> {
    const results: Array<{ name: string; directory: string; source: DirectorySource }> = [];
    const seen = new Set<string>();
    const aliases = directoryConfig.projectAliases;
    const normalizedAllowed = this.normalizeAllowedDirectories(directoryConfig.allowedDirectories);
    const allowlistEnforced = normalizedAllowed.length > 0;

    const pushCandidate = (name: string, directory: string, source: DirectorySource): void => {
      const trimmed = directory.trim();
      if (!trimmed || !path.isAbsolute(trimmed)) {
        return;
      }

      const normalized = this.normalizePath(trimmed);
      if (this.isDangerousPath(normalized)) {
        return;
      }

      if (allowlistEnforced && !this.isPathAllowed(normalized, normalizedAllowed)) {
        return;
      }

      if (!this.ensureAccessible(normalized)) {
        return;
      }

      const key = this.getComparablePath(normalized);
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      results.push({ name, directory: normalized, source });
    };

    for (const [alias, directory] of Object.entries(aliases)) {
      if (typeof directory === 'string' && directory.trim()) {
        pushCandidate(alias, directory, 'alias');
      }
    }

    for (const directory of knownDirectories) {
      const name = path.basename(directory) || directory;
      pushCandidate(name, directory, 'server_default');
    }

    return results;
  }

  // 判断目标路径是否位于允许目录范围内
  static isAllowedPath(targetPath: string, allowedDirectories?: string[]): boolean {
    const normalizedAllowed = this.normalizeAllowedDirectories(allowedDirectories ?? directoryConfig.allowedDirectories);
    if (normalizedAllowed.length === 0) {
      return false;
    }
    const normalizedTarget = this.normalizePath(targetPath);
    return this.isPathAllowed(normalizedTarget, normalizedAllowed);
  }

  private static normalizePath(value: string): string {
    return path.resolve(path.normalize(value));
  }

  private static getComparablePath(value: string): string {
    const normalized = this.normalizePath(value);
    return isWindows ? normalized.toLowerCase() : normalized;
  }

  private static normalizeAllowedDirectories(allowedDirectories: string[]): string[] {
    const results: string[] = [];
    const seen = new Set<string>();

    for (const item of allowedDirectories) {
      const trimmed = item.trim();
      if (!trimmed) {
        continue;
      }
      const normalized = this.normalizePath(trimmed);
      const key = this.getComparablePath(normalized);
      if (!seen.has(key)) {
        seen.add(key);
        results.push(normalized);
      }
    }

    return results;
  }

  private static isDangerousPath(value: string): boolean {
    // Windows UNC 设备路径
    if (value.startsWith('\\\\?\\') || value.startsWith('\\\\.\\')) {
      return true;
    }
    if (value.startsWith('\\\\')) {
      return true;
    }

    // Linux 系统敏感路径（仅在非 Windows 平台拦截）
    if (!isWindows) {
      const normalized = value.toLowerCase();
      const dangerousPrefixes = [
        '/etc', '/proc', '/dev', '/sys', '/boot',
        '/bin', '/sbin', '/usr/bin', '/usr/sbin',
      ];
      for (const prefix of dangerousPrefixes) {
        if (normalized === prefix || normalized.startsWith(prefix + '/')) {
          return true;
        }
      }
    }

    return false;
  }

  private static isPathAllowed(target: string, allowedDirectories: string[]): boolean {
    const targetComparable = this.getComparablePath(target);

    for (const allowed of allowedDirectories) {
      const allowedComparable = this.getComparablePath(allowed);
      if (targetComparable === allowedComparable) {
        return true;
      }

      const prefix = allowedComparable.endsWith(path.sep)
        ? allowedComparable
        : `${allowedComparable}${path.sep}`;
      if (targetComparable.startsWith(prefix)) {
        return true;
      }
    }

    return false;
  }

  private static ensureAccessible(directory: string): boolean {
    try {
      fs.statSync(directory);
      fs.accessSync(directory, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  private static detectGitRoot(startDir: string): string | undefined {
    let current = startDir;
    const root = path.parse(current).root;

    // 向上遍历查找 .git 目录或文件（worktree/submodule 用 .git 文件）
    for (let depth = 0; depth < 100; depth++) {
      const gitPath = path.join(current, '.git');
      try {
        const stat = fs.statSync(gitPath);
        if (stat.isDirectory() || stat.isFile()) {
          return this.normalizePath(current);
        }
      } catch {
        // .git 不存在，继续向上
      }

      const parent = path.dirname(current);
      if (parent === current || parent === root) {
        break; // 到达文件系统根目录
      }
      current = parent;
    }
    return undefined;
  }
}
