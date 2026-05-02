/**
 * Agent Manager 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AgentRegistry } from '../../../src/services/resources/agents/manager.js';
import type { AgentInput } from '../../../src/services/resources/agents/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '.fixtures-agents');

describe('Agent Manager', () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    // 清理并创建临时目录
    await fs.rm(FIXTURE_DIR, { recursive: true, force: true });
    await fs.mkdir(FIXTURE_DIR, { recursive: true });

    // 创建子目录
    await fs.mkdir(path.join(FIXTURE_DIR, 'project', 'agents'), { recursive: true });
    await fs.mkdir(path.join(FIXTURE_DIR, 'user', 'agents'), { recursive: true });

    // 设置环境变量指向临时目录（同时设置项目级和用户级）
    process.env.OPENCODE_BRIDGE_DATA_ROOT = path.join(FIXTURE_DIR, 'project');
    process.env.OPENCODE_BRIDGE_USER_DATA_ROOT = path.join(FIXTURE_DIR, 'user');

    registry = new AgentRegistry();
  });

  afterEach(async () => {
    await registry.dispose();
    await fs.rm(FIXTURE_DIR, { recursive: true, force: true });
    delete process.env.OPENCODE_BRIDGE_DATA_ROOT;
    delete process.env.OPENCODE_BRIDGE_USER_DATA_ROOT;
  });

  describe('Agent 配置解析', () => {
    it('应该正确解析有效的 agent 配置', async () => {
      const agentConfig: AgentInput = {
        description: '测试助手',
        mode: 'primary',
        prompt: '你是一个测试助手',
        tools: { bash: true, read: true },
        enabled: true,
      };

      await registry.init();
      const created = await registry.create('test-agent', agentConfig, 'project');

      expect(created.name).toBe('test-agent');
      expect(created.description).toBe('测试助手');
      expect(created.mode).toBe('primary');
      expect(created.prompt).toBe('你是一个测试助手');
      expect(created.tools).toEqual({ bash: true, read: true });
      expect(created.enabled).toBe(true);
    });

    it('应该正确解析最小配置（仅必填字段）', async () => {
      await registry.init();
      const created = await registry.create('minimal', {
        enabled: true,
      }, 'project');

      expect(created.name).toBe('minimal');
      expect(created.enabled).toBe(true);
      expect(created.description).toBeUndefined();
      expect(created.mode).toBeUndefined();
    });

    it('应该拒绝 name 与文件名不一致的配置', async () => {
      const filePath = path.join(FIXTURE_DIR, 'project', 'agents', 'bad-name.json');
      await fs.writeFile(filePath, JSON.stringify({
        name: 'different-name',
        enabled: true,
        order: 1,
      }), 'utf-8');

      await registry.init();
      const list = registry.list();

      const badAgent = list.find(a => a.name === 'bad-name');
      expect(badAgent?.valid).toBe(false);
      expect(badAgent?.error).toContain('不一致');
    });

    it('应该拒绝缺少必填字段的配置', async () => {
      const filePath = path.join(FIXTURE_DIR, 'project', 'agents', 'missing-fields.json');
      await fs.writeFile(filePath, JSON.stringify({
        name: 'missing-fields',
        // 缺少 enabled
        order: 1,
      }), 'utf-8');

      await registry.init();
      const list = registry.list();

      const badAgent = list.find(a => a.name === 'missing-fields');
      expect(badAgent?.valid).toBe(false);
      expect(badAgent?.error).toContain('enabled');
    });

    it('应该拒绝无效的 mode 值', async () => {
      const filePath = path.join(FIXTURE_DIR, 'project', 'agents', 'invalid-mode.json');
      await fs.writeFile(filePath, JSON.stringify({
        name: 'invalid-mode',
        enabled: true,
        mode: 'invalid',
        order: 1,
      }), 'utf-8');

      await registry.init();
      const list = registry.list();

      const badAgent = list.find(a => a.name === 'invalid-mode');
      expect(badAgent?.valid).toBe(false);
      expect(badAgent?.error).toContain('mode');
    });
  });

  describe('双层覆盖（project > user）', () => {
    it('项目级 agent 应该遮蔽用户级同名 agent', async () => {
      await registry.init();

      // 先创建 user 层
      await registry.create('shadow-test', {
        description: 'User layer',
        mode: 'primary',
        enabled: true,
      }, 'user');

      // 再创建 project 层
      await registry.create('shadow-test', {
        description: 'Project layer',
        mode: 'subagent',
        enabled: false,
      }, 'project');

      const list = registry.list();
      const shadowAgent = list.find(a => a.name === 'shadow-test' && a.scope === 'project');

      expect(shadowAgent).toBeDefined();
      expect(shadowAgent?.description).toBe('Project layer');
      expect(shadowAgent?.enabled).toBe(false);

      // user 层条目标记为 shadowed
      const userAgent = list.find(a => a.name === 'shadow-test' && a.scope === 'user');
      expect(userAgent?.shadowed).toBe(true);
    });

    it('get(name) 默认返回 winning（project 层）', async () => {
      await registry.init();

      await registry.create('override-test', {
        description: 'User layer',
        mode: 'primary',
        enabled: true,
      }, 'user');

      await registry.create('override-test', {
        description: 'Project layer',
        mode: 'subagent',
        enabled: false,
      }, 'project');

      const winning = registry.get('override-test');
      expect(winning?.description).toBe('Project layer');
    });

    it('get(name, scope) 可以显式获取指定 scope', async () => {
      await registry.init();

      await registry.create('scope-test', {
        description: 'User layer',
        mode: 'primary',
        enabled: true,
      }, 'user');

      await registry.create('scope-test', {
        description: 'Project layer',
        mode: 'subagent',
        enabled: false,
      }, 'project');

      const userConfig = registry.get('scope-test', 'user');
      const projectConfig = registry.get('scope-test', 'project');

      expect(userConfig?.description).toBe('User layer');
      expect(projectConfig?.description).toBe('Project layer');
    });
  });

  describe('CRUD 操作', () => {
    it('应该正确创建 agent', async () => {
      await registry.init();
      const input: AgentInput = {
        description: '新建助手',
        mode: 'subagent',
        enabled: true,
      };

      const created = await registry.create('new-agent', input, 'project');

      expect(created.name).toBe('new-agent');
      expect(created.description).toBe('新建助手');
      expect(created.mode).toBe('subagent');
      expect(created.order).toBeGreaterThan(0);
    });

    it('应该正确更新 agent', async () => {
      await registry.init();

      await registry.create('update-test', {
        description: '旧描述',
        mode: 'primary',
        enabled: false,
      }, 'project');

      const updated = await registry.update('update-test', {
        description: '新描述',
        mode: 'subagent',
      }, 'project');

      expect(updated.description).toBe('新描述');
      expect(updated.mode).toBe('subagent');
      expect(updated.enabled).toBe(false); // 保持不变
    });

    it('应该正确删除 agent', async () => {
      await registry.init();

      await registry.create('delete-test', {
        enabled: true,
      }, 'project');

      await registry.delete('delete-test', 'project');

      const list = registry.list();
      expect(list.find(a => a.name === 'delete-test')).toBeUndefined();
    });

    it('创建已存在的 agent 应该抛出错误', async () => {
      await registry.init();

      await registry.create('dup-test', {
        enabled: true,
      }, 'project');

      await expect(
        registry.create('dup-test', {
          enabled: true,
        }, 'project')
      ).rejects.toThrow('已存在');
    });

    it('更新不存在的 agent 应该抛出错误', async () => {
      await registry.init();

      await expect(
        registry.update('nonexistent', { enabled: true }, 'project')
      ).rejects.toThrow('不存在');
    });

    it('删除不存在的 agent 应该抛出错误', async () => {
      await registry.init();

      await expect(
        registry.delete('nonexistent', 'project')
      ).rejects.toThrow('不存在');
    });

    it('toggle 应该正确切换 enabled 状态', async () => {
      await registry.init();

      await registry.create('toggle-test', {
        enabled: true,
      }, 'project');

      const disabled = await registry.toggle('toggle-test', false);
      expect(disabled.enabled).toBe(false);

      const enabled = await registry.toggle('toggle-test', true);
      expect(enabled.enabled).toBe(true);
    });
  });

  describe('order 排序', () => {
    it('list 应该按 order 排序', async () => {
      await registry.init();

      await registry.create('agent-a', {
        enabled: true,
        order: 30,
      }, 'project');

      await registry.create('agent-b', {
        enabled: true,
        order: 10,
      }, 'project');

      await registry.create('agent-c', {
        enabled: true,
        order: 20,
      }, 'project');

      const list = registry.list();
      const enabledAgents = list.filter(a => a.enabled);

      expect(enabledAgents[0].name).toBe('agent-b');
      expect(enabledAgents[1].name).toBe('agent-c');
      expect(enabledAgents[2].name).toBe('agent-a');
    });

    it('新建 agent 时应该自动分配递增的 order', async () => {
      await registry.init();

      await registry.create('first', {
        enabled: true,
      }, 'project');

      await registry.create('second', {
        enabled: true,
      }, 'project');

      const list = registry.list();
      const first = list.find(a => a.name === 'first');
      const second = list.find(a => a.name === 'second');

      expect(second?.order).toBeGreaterThan(first?.order ?? 0);
    });
  });

  describe('热载', () => {
    it('文件变更后应该自动重载', async () => {
      await registry.init();

      const created = await registry.create('hot-test', {
        description: '原始描述',
        enabled: true,
      }, 'project');

      // 直接修改文件
      const filePath = path.join(FIXTURE_DIR, 'project', 'agents', 'hot-test.json');
      await fs.writeFile(filePath, JSON.stringify({
        ...created,
        description: '修改后描述',
      }, null, 2), 'utf-8');

      // 等待热载（去抖 200ms + 安全余量）
      await new Promise(resolve => setTimeout(resolve, 500));

      const updated = registry.get('hot-test');
      expect(updated?.description).toBe('修改后描述');
    });

    it('删除文件后应该自动从列表移除', async () => {
      await registry.init();

      await registry.create('hot-delete-test', {
        enabled: true,
      }, 'project');

      // 删除文件
      const filePath = path.join(FIXTURE_DIR, 'project', 'agents', 'hot-delete-test.json');
      await fs.unlink(filePath);

      // 等待热载
      await new Promise(resolve => setTimeout(resolve, 500));

      const list = registry.list();
      expect(list.find(a => a.name === 'hot-delete-test')).toBeUndefined();
    });
  });

  describe('name 校验', () => {
    it('应该拒绝包含非法字符的 name', async () => {
      await registry.init();

      await expect(
        registry.create('bad/name', {
          enabled: true,
        }, 'project')
      ).rejects.toThrow();
    });

    it('应该拒绝空 name', async () => {
      await registry.init();

      await expect(
        registry.create('', {
          enabled: true,
        }, 'project')
      ).rejects.toThrow();
    });
  });

  describe('导出为 OpenCode 格式', () => {
    it('应该正确导出 winning 且 enabled 的 agent', async () => {
      await registry.init();

      await registry.create('agent-1', {
        description: 'Agent 1',
        mode: 'primary',
        enabled: true,
      }, 'project');

      await registry.create('agent-2', {
        description: 'Agent 2',
        mode: 'subagent',
        enabled: false, // 禁用，不应导出
      }, 'project');

      await registry.create('agent-3', {
        description: 'Agent 3',
        mode: 'subagent',
        enabled: true,
      }, 'user');

      const exported = registry.exportForOpenCode();

      expect(Object.keys(exported)).toHaveLength(2);
      expect(exported['agent-1']).toEqual({
        description: 'Agent 1',
        mode: 'primary',
      });
      expect(exported['agent-3']).toEqual({
        description: 'Agent 3',
        mode: 'subagent',
      });
      expect(exported['agent-2']).toBeUndefined();
    });

    it('project 层 agent 应该覆盖 user 层', async () => {
      await registry.init();

      await registry.create('dup-agent', {
        description: 'User layer',
        mode: 'primary',
        enabled: true,
      }, 'user');

      await registry.create('dup-agent', {
        description: 'Project layer',
        mode: 'subagent',
        enabled: true,
      }, 'project');

      const exported = registry.exportForOpenCode();

      expect(Object.keys(exported)).toHaveLength(1);
      expect(exported['dup-agent']).toEqual({
        description: 'Project layer',
        mode: 'subagent',
      });
    });
  });
});
