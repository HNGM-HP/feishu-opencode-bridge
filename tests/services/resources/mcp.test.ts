/**
 * MCP Manager 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MCPRegistry } from '../../../src/services/resources/mcp/manager.js';
import type { MCPInput } from '../../../src/services/resources/mcp/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '.fixtures-mcp');

describe('MCP Manager', () => {
  let registry: MCPRegistry;

  beforeEach(async () => {
    // 清理并创建临时目录
    await fs.rm(FIXTURE_DIR, { recursive: true, force: true });
    await fs.mkdir(FIXTURE_DIR, { recursive: true });

    // 创建子目录
    await fs.mkdir(path.join(FIXTURE_DIR, 'project', 'mcp'), { recursive: true });
    await fs.mkdir(path.join(FIXTURE_DIR, 'user', 'mcp'), { recursive: true });

    // 设置环境变量指向临时目录（同时设置项目级和用户级）
    process.env.OPENCODE_BRIDGE_DATA_ROOT = path.join(FIXTURE_DIR, 'project');
    process.env.OPENCODE_BRIDGE_USER_DATA_ROOT = path.join(FIXTURE_DIR, 'user');

    registry = new MCPRegistry();
  });

  afterEach(async () => {
    await registry.dispose();
    await fs.rm(FIXTURE_DIR, { recursive: true, force: true });
    delete process.env.OPENCODE_BRIDGE_DATA_ROOT;
    delete process.env.OPENCODE_BRIDGE_USER_DATA_ROOT;
  });

  describe('MCP 配置解析', () => {
    it('应该正确解析有效的 stdio 配置', async () => {
      const serverConfig: MCPInput = {
        transport: 'stdio',
        command: 'npx',
        args: ['@modelcontextprotocol/server-filesystem', '/path'],
        enabled: true,
        description: 'Filesystem MCP',
      };

      await registry.init();
      const created = await registry.create('fs-test', serverConfig, 'project');

      expect(created.name).toBe('fs-test');
      expect(created.transport).toBe('stdio');
      expect(created.command).toBe('npx');
      expect(created.args).toEqual(['@modelcontextprotocol/server-filesystem', '/path']);
      expect(created.enabled).toBe(true);
      expect(created.description).toBe('Filesystem MCP');
    });

    it('应该正确解析有效的 sse 配置', async () => {
      const serverConfig: MCPInput = {
        transport: 'sse',
        url: 'https://example.com/mcp',
        enabled: true,
        description: 'SSE MCP',
      };

      await registry.init();
      const created = await registry.create('sse-test', serverConfig, 'project');

      expect(created.transport).toBe('sse');
      expect(created.url).toBe('https://example.com/mcp');
      expect(created.enabled).toBe(true);
    });

    it('应该正确解析有效的 http 配置', async () => {
      const serverConfig: MCPInput = {
        transport: 'http',
        url: 'https://example.com/mcp',
        enabled: false,
        headers: { Authorization: 'Bearer token' },
      };

      await registry.init();
      const created = await registry.create('http-test', serverConfig, 'project');

      expect(created.transport).toBe('http');
      expect(created.url).toBe('https://example.com/mcp');
      expect(created.enabled).toBe(false);
      expect(created.headers).toEqual({ Authorization: 'Bearer token' });
    });

    it('应该拒绝 name 与文件名不一致的配置', async () => {
      const filePath = path.join(FIXTURE_DIR, 'project', 'mcp', 'bad-name.json');
      await fs.writeFile(filePath, JSON.stringify({
        name: 'different-name',
        transport: 'stdio',
        command: 'test',
        enabled: true,
        order: 1,
      }), 'utf-8');

      await registry.init();
      const list = registry.list();

      const badServer = list.find(s => s.name === 'bad-name');
      expect(badServer?.valid).toBe(false);
      expect(badServer?.error).toContain('不一致');
    });

    it('应该拒绝缺少必填字段的配置', async () => {
      const filePath = path.join(FIXTURE_DIR, 'project', 'mcp', 'missing-fields.json');
      await fs.writeFile(filePath, JSON.stringify({
        name: 'missing-fields',
        transport: 'stdio',
        // 缺少 command
        enabled: true,
        order: 1,
      }), 'utf-8');

      await registry.init();
      const list = registry.list();

      const badServer = list.find(s => s.name === 'missing-fields');
      expect(badServer?.valid).toBe(false);
      expect(badServer?.error).toContain('command');
    });
  });

  describe('索引管理', () => {
    it('创建 server 时应该自动更新索引', async () => {
      await registry.init();

      await registry.create('server1', {
        transport: 'stdio',
        command: 'test1',
        enabled: true,
      }, 'project');

      await registry.create('server2', {
        transport: 'stdio',
        command: 'test2',
        enabled: false,
      }, 'project');

      // 读取索引文件
      const indexPath = path.join(FIXTURE_DIR, 'project', 'mcp', '_index.json');
      const indexContent = JSON.parse(await fs.readFile(indexPath, 'utf-8'));

      expect(indexContent.enabled).toContain('server1');
      expect(indexContent.disabled).toContain('server2');
    });

    it('切换 enabled 状态时应该更新索引', async () => {
      await registry.init();

      await registry.create('toggle-test', {
        transport: 'stdio',
        command: 'test',
        enabled: true,
      }, 'project');

      // 禁用
      await registry.toggle('toggle-test', false);

      const indexPath = path.join(FIXTURE_DIR, 'project', 'mcp', '_index.json');
      const indexContent = JSON.parse(await fs.readFile(indexPath, 'utf-8'));

      expect(indexContent.enabled).not.toContain('toggle-test');
      expect(indexContent.disabled).toContain('toggle-test');
    });

    it('删除 server 时应该从索引移除', async () => {
      await registry.init();

      await registry.create('delete-test', {
        transport: 'stdio',
        command: 'test',
        enabled: true,
      }, 'project');

      await registry.delete('delete-test', 'project');

      const indexPath = path.join(FIXTURE_DIR, 'project', 'mcp', '_index.json');
      const indexContent = JSON.parse(await fs.readFile(indexPath, 'utf-8'));

      expect(indexContent.enabled).not.toContain('delete-test');
      expect(indexContent.disabled).not.toContain('delete-test');
    });
  });

  describe('双层覆盖（project > user）', () => {
    it('项目级 server 应该遮蔽用户级同名 server', async () => {
      await registry.init();

      // 先创建 user 层
      await registry.create('shadow-test', {
        transport: 'stdio',
        command: 'user-command',
        enabled: true,
        description: 'User layer',
      }, 'user');

      // 再创建 project 层
      await registry.create('shadow-test', {
        transport: 'stdio',
        command: 'project-command',
        enabled: false,
        description: 'Project layer',
      }, 'project');

      const list = registry.list();
      const shadowServer = list.find(s => s.name === 'shadow-test' && s.scope === 'project');

      expect(shadowServer).toBeDefined();
      expect(shadowServer?.description).toBe('Project layer');
      expect(shadowServer?.enabled).toBe(false);

      // user 层条目标记为 shadowed
      const userServer = list.find(s => s.name === 'shadow-test' && s.scope === 'user');
      expect(userServer?.shadowed).toBe(true);
    });

    it('get(name) 默认返回 winning（project 层）', async () => {
      await registry.init();

      await registry.create('override-test', {
        transport: 'stdio',
        command: 'user-command',
        enabled: true,
      }, 'user');

      await registry.create('override-test', {
        transport: 'stdio',
        command: 'project-command',
        enabled: false,
      }, 'project');

      const winning = registry.get('override-test');
      expect(winning?.command).toBe('project-command');
    });

    it('get(name, scope) 可以显式获取指定 scope', async () => {
      await registry.init();

      await registry.create('scope-test', {
        transport: 'stdio',
        command: 'user-command',
        enabled: true,
      }, 'user');

      await registry.create('scope-test', {
        transport: 'stdio',
        command: 'project-command',
        enabled: false,
      }, 'project');

      const userConfig = registry.get('scope-test', 'user');
      const projectConfig = registry.get('scope-test', 'project');

      expect(userConfig?.command).toBe('user-command');
      expect(projectConfig?.command).toBe('project-command');
    });
  });

  describe('CRUD 操作', () => {
    it('应该正确创建 server', async () => {
      await registry.init();
      const input: MCPInput = {
        transport: 'stdio',
        command: 'new-server',
        enabled: true,
        description: 'New server',
      };

      const created = await registry.create('new-server', input, 'project');

      expect(created.name).toBe('new-server');
      expect(created.description).toBe('New server');
      expect(created.order).toBeGreaterThan(0);
    });

    it('应该正确更新 server', async () => {
      await registry.init();

      await registry.create('update-test', {
        transport: 'stdio',
        command: 'old-command',
        enabled: false,
      }, 'project');

      const updated = await registry.update('update-test', {
        command: 'new-command',
        enabled: true,
      }, 'project');

      expect(updated.command).toBe('new-command');
      expect(updated.enabled).toBe(true);
    });

    it('应该正确删除 server', async () => {
      await registry.init();

      await registry.create('delete-test', {
        transport: 'stdio',
        command: 'test',
        enabled: true,
      }, 'project');

      await registry.delete('delete-test', 'project');

      const list = registry.list();
      expect(list.find(s => s.name === 'delete-test')).toBeUndefined();
    });

    it('创建已存在的 server 应该抛出错误', async () => {
      await registry.init();

      await registry.create('dup-test', {
        transport: 'stdio',
        command: 'test',
        enabled: true,
      }, 'project');

      await expect(
        registry.create('dup-test', {
          transport: 'stdio',
          command: 'test2',
          enabled: true,
        }, 'project')
      ).rejects.toThrow('已存在');
    });

    it('更新不存在的 server 应该抛出错误', async () => {
      await registry.init();

      await expect(
        registry.update('nonexistent', { enabled: true }, 'project')
      ).rejects.toThrow('不存在');
    });

    it('删除不存在的 server 应该抛出错误', async () => {
      await registry.init();

      await expect(
        registry.delete('nonexistent', 'project')
      ).rejects.toThrow('不存在');
    });
  });

  describe('order 排序', () => {
    it('list 应该按 order 排序', async () => {
      await registry.init();

      await registry.create('server-a', {
        transport: 'stdio',
        command: 'a',
        enabled: true,
        order: 30,
      }, 'project');

      await registry.create('server-b', {
        transport: 'stdio',
        command: 'b',
        enabled: true,
        order: 10,
      }, 'project');

      await registry.create('server-c', {
        transport: 'stdio',
        command: 'c',
        enabled: true,
        order: 20,
      }, 'project');

      const list = registry.list();
      const enabledServers = list.filter(s => s.enabled);

      expect(enabledServers[0].name).toBe('server-b');
      expect(enabledServers[1].name).toBe('server-c');
      expect(enabledServers[2].name).toBe('server-a');
    });

    it('新建 server 时应该自动分配递增的 order', async () => {
      await registry.init();

      await registry.create('first', {
        transport: 'stdio',
        command: 'first',
        enabled: true,
      }, 'project');

      await registry.create('second', {
        transport: 'stdio',
        command: 'second',
        enabled: true,
      }, 'project');

      const list = registry.list();
      const first = list.find(s => s.name === 'first');
      const second = list.find(s => s.name === 'second');

      expect(second?.order).toBeGreaterThan(first?.order ?? 0);
    });
  });

  describe('热载', () => {
    it('文件变更后应该自动重载', async () => {
      await registry.init();

      const created = await registry.create('hot-test', {
        transport: 'stdio',
        command: 'original',
        enabled: true,
      }, 'project');

      // 直接修改文件
      const filePath = path.join(FIXTURE_DIR, 'project', 'mcp', 'hot-test.json');
      await fs.writeFile(filePath, JSON.stringify({
        ...created,
        command: 'modified',
      }, null, 2), 'utf-8');

      // 等待热载（去抖 200ms + 安全余量）
      await new Promise(resolve => setTimeout(resolve, 800));

      const updated = registry.get('hot-test');
      expect(updated?.command).toBe('modified');
    });

    it('删除文件后应该自动从列表移除', async () => {
      await registry.init();

      await registry.create('hot-delete-test', {
        transport: 'stdio',
        command: 'test',
        enabled: true,
      }, 'project');

      // 删除文件
      const filePath = path.join(FIXTURE_DIR, 'project', 'mcp', 'hot-delete-test.json');
      await fs.unlink(filePath);

      // 等待热载
      await new Promise(resolve => setTimeout(resolve, 800));

      const list = registry.list();
      expect(list.find(s => s.name === 'hot-delete-test')).toBeUndefined();
    });
  });

  describe('name 校验', () => {
    it('应该拒绝包含非法字符的 name', async () => {
      await registry.init();

      await expect(
        registry.create('bad/name', {
          transport: 'stdio',
          command: 'test',
          enabled: true,
        }, 'project')
      ).rejects.toThrow();
    });

    it('应该拒绝空 name', async () => {
      await registry.init();

      await expect(
        registry.create('', {
          transport: 'stdio',
          command: 'test',
          enabled: true,
        }, 'project')
      ).rejects.toThrow();
    });
  });

  describe('环境变量与工作目录', () => {
    it('应该正确保存 stdio 的 env 和 cwd', async () => {
      await registry.init();

      const created = await registry.create('env-test', {
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        cwd: '/workspace',
        env: { API_KEY: 'secret', NODE_ENV: 'production' },
        enabled: true,
      }, 'project');

      expect(created.cwd).toBe('/workspace');
      expect(created.env).toEqual({ API_KEY: 'secret', NODE_ENV: 'production' });
    });
  });
});
