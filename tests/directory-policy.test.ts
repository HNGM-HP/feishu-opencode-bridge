import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DirectoryPolicy } from '../src/utils/directory-policy.js';
import {
  normalizePath,
  isDangerousPath,
  isPathAllowed,
} from './test-utils.js';

describe('DirectoryPolicy - Path Normalization and Security', () => {
  describe('normalizePath', () => {
    it('应该规范化相对路径为绝对路径', () => {
      const result = normalizePath('./test');
      // 跨平台：绝对路径以 / 或盘符开头
      expect(result).toMatch(/^\/|^[A-Za-z]:[\\\/]/);
      expect(result).not.toContain('./');
    });

    it('应该规范化包含 .. 的路径', () => {
      const result = normalizePath('/usr/local/../bin');
      // 在 Windows 上，这个路径会被转换为 Windows 格式
      expect(result).toMatch(/bin$/);
      expect(result).not.toContain('..');
    });

    it('应该规范化包含 . 的路径', () => {
      const result = normalizePath('/usr/./bin');
      expect(result).not.toContain('/./');
    });

    it('应该规范化重复的分隔符', () => {
      const result = normalizePath('/usr//bin///test');
      expect(result).not.toContain('//');
      expect(result).not.toContain('///');
    });
  });

  describe('isDangerousPath', () => {
    it('应该拦截 Windows UNC 设备路径（\\\\?\\）', () => {
      const result = isDangerousPath('\\\\?\\C:\\test');
      expect(result).toBe(true);
    });

    it('应该拦截 Windows UNC 设备路径（\\\\.\\）', () => {
      const result = isDangerousPath('\\\\.\\C:\\test');
      expect(result).toBe(true);
    });

    it('应该拦截 Windows UNC 路径（\\\\）', () => {
      const result = isDangerousPath('\\\\server\\share');
      expect(result).toBe(true);
    });

    it('在非 Windows 平台应该拦截 /etc', () => {
      if (process.platform !== 'win32') {
        const result = isDangerousPath('/etc');
        expect(result).toBe(true);
      }
    });

    it('在非 Windows 平台应该拦截 /proc', () => {
      if (process.platform !== 'win32') {
        const result = isDangerousPath('/proc');
        expect(result).toBe(true);
      }
    });

    it('在非 Windows 平台应该拦截 /dev', () => {
      if (process.platform !== 'win32') {
        const result = isDangerousPath('/dev');
        expect(result).toBe(true);
      }
    });

    it('在非 Windows 平台应该拦截 /sys', () => {
      if (process.platform !== 'win32') {
        const result = isDangerousPath('/sys');
        expect(result).toBe(true);
      }
    });

    it('在非 Windows 平台应该拦截 /boot', () => {
      if (process.platform !== 'win32') {
        const result = isDangerousPath('/boot');
        expect(result).toBe(true);
      }
    });

    it('在非 Windows 平台应该拦截 /bin', () => {
      if (process.platform !== 'win32') {
        const result = isDangerousPath('/bin');
        expect(result).toBe(true);
      }
    });

    it('应该允许普通用户目录', () => {
      const result = isDangerousPath('/home/user/project');
      expect(result).toBe(false);
    });

    it('应该允许 Windows 普通路径', () => {
      const result = isDangerousPath('C:\\Users\\user\\project');
      expect(result).toBe(false);
    });
  });

  describe('isPathAllowed', () => {
    it('应该匹配完全相同的路径', () => {
      const result = isPathAllowed(
        '/home/user/project',
        ['/home/user/project']
      );
      expect(result).toBe(true);
    });

    it('应该匹配子路径', () => {
      const result = isPathAllowed(
        '/home/user/project/src',
        ['/home/user/project']
      );
      expect(result).toBe(true);
    });

    it('应该拒绝不在允许范围内的路径', () => {
      const result = isPathAllowed(
        '/other/user/project',
        ['/home/user/project']
      );
      expect(result).toBe(false);
    });

    it('应该拒绝父路径', () => {
      const result = isPathAllowed(
        '/home/user',
        ['/home/user/project']
      );
      expect(result).toBe(false);
    });

    it('应该支持多个允许目录', () => {
      const result = isPathAllowed(
        '/home/user1/project',
        ['/home/user1/project', '/home/user2/project']
      );
      expect(result).toBe(true);
    });

    it('应该在 Windows 上忽略大小写', () => {
      if (process.platform === 'win32') {
        const result = isPathAllowed(
          'C:\\Users\\User\\Project',
          ['C:\\users\\user\\project']
        );
        expect(result).toBe(true);
      }
    });
  });

  describe('resolve - 基本优先级逻辑', () => {
    it('应该优先使用 explicit 目录', () => {
      const result = DirectoryPolicy.resolve({
        explicitDirectory: '/explicit',
        chatDefaultDirectory: '/chat',
        envDefaultDirectory: '/env',
        serverDefaultDirectory: '/server',
        allowedDirectories: ['/explicit', '/chat', '/env', '/server'],
      });

      if (result.ok) {
        expect(result.source).toBe('explicit');
        expect(result.directory).toBe('/explicit');
      }
    });

    it('应该在无 explicit 时使用别名', () => {
      const result = DirectoryPolicy.resolve({
        aliasName: 'myproject',
        projectAliases: { myproject: '/alias/path' },
        allowedDirectories: ['/alias/path'],
      });

      if (result.ok) {
        expect(result.source).toBe('alias');
        expect(result.directory).toBe('/alias/path');
        expect(result.projectName).toBe('myproject');
      }
    });

    it('应该在别名不存在时返回错误', () => {
      const result = DirectoryPolicy.resolve({
        aliasName: 'nonexistent',
        projectAliases: { myproject: '/alias/path' },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('alias_not_found');
      }
    });

    it('应该在无别名时使用 chat 默认目录', () => {
      const result = DirectoryPolicy.resolve({
        chatDefaultDirectory: '/chat',
        allowedDirectories: ['/chat'],
      });

      if (result.ok) {
        expect(result.source).toBe('chat_default');
        expect(result.directory).toBe('/chat');
      }
    });

    it('应该在无 chat 默认时使用 env 默认目录', () => {
      const result = DirectoryPolicy.resolve({
        envDefaultDirectory: '/env',
        allowedDirectories: ['/env'],
      });

      if (result.ok) {
        expect(result.source).toBe('env_default');
        expect(result.directory).toBe('/env');
      }
    });

    it('应该在无任何目录时返回 server 默认（空路径）', () => {
      const result = DirectoryPolicy.resolve();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.source).toBe('server_default');
        expect(result.directory).toBe('');
      }
    });
  });

  describe('resolve - 错误处理', () => {
    it('应该拒绝不在允许列表中的 explicit 路径', () => {
      const result = DirectoryPolicy.resolve({
        explicitDirectory: '/not/allowed',
        allowedDirectories: ['/allowed'],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('not_allowed');
        expect(result.userMessage).toContain('尝试目录：/not/allowed');
        expect(result.userMessage).toContain('配置来源');
        expect(result.userMessage).toContain('当前允许目录：/allowed');
        expect(result.userMessage).toContain('ALLOWED_DIRECTORIES');
        expect(result.userMessage).toContain('Web 管理面板');
        expect(result.userMessage).toContain('核心行为 -> 工作目录与项目');
        expect(result.userMessage).toContain('管理面板地址：http://localhost:4098');
      }
    });

    it('应该拒绝相对路径', () => {
      const result = DirectoryPolicy.resolve({
        explicitDirectory: './relative',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('not_absolute');
      }
    });

    it('应该拒绝过长的路径', () => {
      const longPath = '/a'.repeat(300);
      const result = DirectoryPolicy.resolve({
        explicitDirectory: longPath,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('path_too_long');
      }
    });

    it('应该拒绝危险路径', () => {
      if (process.platform !== 'win32') {
        const result = DirectoryPolicy.resolve({
          explicitDirectory: '/etc/test',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe('dangerous_path');
        }
      }
    });

    it('应该在无允许列表时拒绝 explicit 路径', () => {
      const result = DirectoryPolicy.resolve({
        explicitDirectory: '/explicit',
        allowedDirectories: [],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('explicit_requires_allowlist');
        expect(result.userMessage).toContain('尝试目录：/explicit');
        expect(result.userMessage).toContain('配置来源');
        expect(result.userMessage).toContain('当前允许目录：未配置');
        expect(result.userMessage).toContain('ALLOWED_DIRECTORIES');
        expect(result.userMessage).toContain('Web 管理面板');
        expect(result.userMessage).toContain('核心行为 -> 工作目录与项目');
        expect(result.userMessage).toContain('管理面板地址：http://localhost:4098');
      }
    });

    it('应该在使用 .env 配置时统一引导到 Web 管理面板', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-bridge-env-'));
      const envFile = path.join(tempDir, '.env');
      const previousEnvFile = process.env.OPENCODE_BRIDGE_ACTIVE_ENV_FILE;
      fs.writeFileSync(envFile, 'ALLOWED_DIRECTORIES=/tmp/project\n', 'utf-8');
      process.env.OPENCODE_BRIDGE_ACTIVE_ENV_FILE = envFile;

      try {
        const result = DirectoryPolicy.resolve({
          explicitDirectory: '/not/allowed',
          allowedDirectories: ['/allowed'],
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.userMessage).toMatch(/配置来源：\.env|配置来源：混合模式（当前 \.env 优先）/);
          expect(result.userMessage).toContain('尝试目录：/not/allowed');
          expect(result.userMessage).toContain('当前允许目录：/allowed');
          expect(result.userMessage).toContain('Web 管理面板');
          expect(result.userMessage).toContain('核心行为 -> 工作目录与项目 -> 允许的目录白名单（ALLOWED_DIRECTORIES）');
          expect(result.userMessage).toContain('管理面板地址：http://localhost:4098');
          expect(result.userMessage).not.toContain(envFile);
          expect(result.userMessage).not.toContain('重启服务');
        }
      } finally {
        if (previousEnvFile === undefined) {
          delete process.env.OPENCODE_BRIDGE_ACTIVE_ENV_FILE;
        } else {
          process.env.OPENCODE_BRIDGE_ACTIVE_ENV_FILE = previousEnvFile;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('resolve - AI 工作区脱钩白名单（scope: workspace）', () => {
    it('scope=workspace 时 explicit 路径不再要求白名单', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-bridge-ws-'));
      try {
        const result = DirectoryPolicy.resolve({
          explicitDirectory: tempDir,
          allowedDirectories: [],
          scope: 'workspace',
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.source).toBe('explicit');
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('scope=workspace 时 explicit 路径可在白名单之外', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-bridge-ws-'));
      try {
        const result = DirectoryPolicy.resolve({
          explicitDirectory: tempDir,
          allowedDirectories: ['/non/matching/allowlist'],
          scope: 'workspace',
        });

        expect(result.ok).toBe(true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('scope=workspace 仍应拦截危险路径', () => {
      if (process.platform !== 'win32') {
        const result = DirectoryPolicy.resolve({
          explicitDirectory: '/etc/test',
          scope: 'workspace',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe('dangerous_path');
        }
      }
    });

    it('scope=workspace 仍应拒绝相对路径', () => {
      const result = DirectoryPolicy.resolve({
        explicitDirectory: './relative',
        scope: 'workspace',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('not_absolute');
      }
    });

    it('scope=workspace 仍应拒绝不存在的目录', () => {
      const result = DirectoryPolicy.resolve({
        explicitDirectory: '/tmp/this-path-should-not-exist-xyz-opencode-test',
        scope: 'workspace',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(['not_found', 'not_accessible']).toContain(result.code);
      }
    });

    it('默认 scope=platform 保持原有强制行为（回归）', () => {
      const result = DirectoryPolicy.resolve({
        explicitDirectory: '/explicit',
        allowedDirectories: [],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('explicit_requires_allowlist');
      }
    });
  });

  describe('isAllowedPath', () => {
    it('应该返回 false 当允许目录列表为空', () => {
      const result = DirectoryPolicy.isAllowedPath('/any/path', []);
      expect(result).toBe(false);
    });

    it('应该正确判断路径是否在允许范围内', () => {
      const result = DirectoryPolicy.isAllowedPath(
        '/home/user/project',
        ['/home/user']
      );
      expect(result).toBe(true);
    });

    it('应该拒绝不在允许范围内的路径', () => {
      const result = DirectoryPolicy.isAllowedPath(
        '/other/path',
        ['/home/user']
      );
      expect(result).toBe(false);
    });
  });

  describe('project list empty message', () => {
    it('应该包含目录配置引导', () => {
      const result = DirectoryPolicy.buildProjectListEmptyMessage();
      expect(result).toContain('暂无可用项目');
      expect(result).toContain('配置来源');
      expect(result).toContain('当前允许目录');
      expect(result).toContain('Web 管理面板');
      expect(result).toContain('管理面板地址：http://localhost:4098');
      expect(result).toContain('PROJECT_ALIASES');
    });
  });
});
