/**
 * Resources API REST End-to-End Tests
 *
 * 测试 REST API 端点的 HTTP 状态码和请求/响应格式。
 * 由于这些是集成测试，需要 mock 底层 registry 以避免文件系统依赖。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createResourcesRoutes } from '../../src/admin/routes/resources.js';

// Mock registries
vi.mock('../../src/services/resources/skills/registry.js', () => ({
  skillRegistry: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    toggle: vi.fn(),
    listSlashCommands: vi.fn(),
  },
}));

vi.mock('../../src/services/resources/mcp/manager.js', () => ({
  getMCPRegistry: vi.fn(() => ({
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    toggle: vi.fn(),
  })),
}));

vi.mock('../../src/services/resources/agents/manager.js', () => ({
  getAgentRegistry: vi.fn(() => ({
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    toggle: vi.fn(),
  })),
}));

vi.mock('../../src/services/resources/providers/manager.js', () => ({
  getProviderRegistry: vi.fn(() => ({
    list: vi.fn(),
    get: vi.fn(),
    setKey: vi.fn(),
    removeKey: vi.fn(),
    refreshModels: vi.fn(),
    getModels: vi.fn(),
    getAllModels: vi.fn(),
  })),
}));

vi.mock('../../src/services/resources/events.js', () => ({
  onResourceChange: vi.fn(() => vi.fn()),
}));

import { skillRegistry } from '../../src/services/resources/skills/registry.js';
import { getMCPRegistry } from '../../src/services/resources/mcp/manager.js';
import { getAgentRegistry } from '../../src/services/resources/agents/manager.js';
import { getProviderRegistry } from '../../src/services/resources/providers/manager.js';

describe('Resources API - Skills Endpoints', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/resources', createResourcesRoutes());
    vi.clearAllMocks();
  });

  describe('GET /api/resources/skills', () => {
    it('应返回 200 和技能列表', async () => {
      const mockSkills = [
        { name: 'test-skill', description: 'Test', enabled: true },
      ];
      vi.mocked(skillRegistry.list).mockReturnValue(mockSkills);

      const response = await request(app)
        .get('/api/resources/skills')
        .expect(200);

      expect(response.body).toEqual({ resources: mockSkills });
      expect(skillRegistry.list).toHaveBeenCalledTimes(1);
    });

    it('应在 registry 抛错时返回 500', async () => {
      vi.mocked(skillRegistry.list).mockImplementation(() => {
        throw new Error('Registry error');
      });

      const response = await request(app)
        .get('/api/resources/skills')
        .expect(500);

      expect(response.body.error).toContain('Registry error');
    });
  });

  describe('GET /api/resources/skills/:name', () => {
    it('应返回 200 和技能详情', async () => {
      const mockSkill = { name: 'test-skill', description: 'Test', enabled: true };
      vi.mocked(skillRegistry.get).mockReturnValue(mockSkill);

      const response = await request(app)
        .get('/api/resources/skills/test-skill')
        .expect(200);

      expect(response.body).toEqual({ skill: mockSkill });
    });

    it('应在不存在的技能时返回 404', async () => {
      vi.mocked(skillRegistry.get).mockReturnValue(null);

      const response = await request(app)
        .get('/api/resources/skills/nonexistent')
        .expect(404);

      expect(response.body.error).toContain('not found');
    });
  });

  describe('POST /api/resources/skills', () => {
    it('应在缺少 name 时返回 400', async () => {
      const response = await request(app)
        .post('/api/resources/skills')
        .send({ markdown: '# Test' })
        .expect(400);

      expect(response.body.error).toContain('name');
    });

    it('应在缺少 markdown 时返回 400', async () => {
      const response = await request(app)
        .post('/api/resources/skills')
        .send({ name: 'test' })
        .expect(400);

      expect(response.body.error).toContain('markdown');
    });

    it('应在成功创建时返回 201', async () => {
      const mockSkill = { name: 'test-skill', description: 'Test', enabled: true };
      vi.mocked(skillRegistry.create).mockReturnValue(mockSkill);

      const response = await request(app)
        .post('/api/resources/skills')
        .send({
          name: 'test-skill',
          markdown: '# Test',
        })
        .expect(201);

      expect(response.body).toEqual({ skill: mockSkill });
    });
  });

  describe('PUT /api/resources/skills/:name', () => {
    it('应在缺少 markdown 时返回 400', async () => {
      const response = await request(app)
        .put('/api/resources/skills/test')
        .send({})
        .expect(400);

      expect(response.body.error).toContain('markdown');
    });

    it('应在成功更新时返回 200', async () => {
      const mockSkill = { name: 'test', description: 'Updated', enabled: true };
      vi.mocked(skillRegistry.update).mockReturnValue(mockSkill);

      const response = await request(app)
        .put('/api/resources/skills/test')
        .send({ markdown: '# Updated' })
        .expect(200);

      expect(response.body).toEqual({ skill: mockSkill });
    });
  });

  describe('DELETE /api/resources/skills/:name', () => {
    it('应在成功删除时返回 200', async () => {
      vi.mocked(skillRegistry.delete).mockImplementation(() => {});

      const response = await request(app)
        .delete('/api/resources/skills/test')
        .expect(200);

      expect(response.body.ok).toBe(true);
      expect(response.body.message).toContain('deleted');
    });
  });

  describe('POST /api/resources/skills/:name/toggle', () => {
    it('应在缺少 enabled 时返回 400', async () => {
      const response = await request(app)
        .post('/api/resources/skills/test/toggle')
        .send({})
        .expect(400);

      expect(response.body.error).toContain('enabled');
    });

    it('应在成功切换时返回 200', async () => {
      const mockSkill = { name: 'test', description: 'Test', enabled: false };
      vi.mocked(skillRegistry.toggle).mockReturnValue(mockSkill);

      const response = await request(app)
        .post('/api/resources/skills/test/toggle')
        .send({ enabled: false })
        .expect(200);

      expect(response.body).toEqual({
        skill: mockSkill,
        message: 'Skill "test" disabled',
      });
    });
  });

  describe('GET /api/resources/skills/slash', () => {
    it('应返回 200 和 slash 命令列表', async () => {
      const mockCommands = [
        { name: 'test', description: 'Test command' },
      ];
      vi.mocked(skillRegistry.listSlashCommands).mockReturnValue(mockCommands);

      const response = await request(app)
        .get('/api/resources/skills/slash')
        .expect(200);

      expect(response.body).toEqual({ commands: mockCommands });
    });
  });
});

describe('Resources API - MCP Endpoints', () => {
  let app: express.Express;
  let mockMCPRegistry: any;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/resources', createResourcesRoutes());
    vi.clearAllMocks();

    mockMCPRegistry = {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      toggle: vi.fn(),
    };
    vi.mocked(getMCPRegistry).mockReturnValue(mockMCPRegistry);
  });

  describe('GET /api/resources/mcp', () => {
    it('应返回 200 和 MCP 服务器列表', async () => {
      const mockServers = [
        { name: 'test-server', transport: 'stdio', enabled: true, order: 100 },
      ];
      mockMCPRegistry.list.mockReturnValue(mockServers);

      const response = await request(app)
        .get('/api/resources/mcp')
        .expect(200);

      expect(response.body).toEqual({ resources: mockServers });
    });
  });

  describe('GET /api/resources/mcp/:name', () => {
    it('应返回 200 和服务器详情', async () => {
      const mockServer = {
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        enabled: true,
        order: 100,
      };
      mockMCPRegistry.get.mockReturnValue(mockServer);

      const response = await request(app)
        .get('/api/resources/mcp/test-server')
        .expect(200);

      expect(response.body).toEqual({ server: mockServer });
    });

    it('应在不存在的服务器时返回 404', async () => {
      mockMCPRegistry.get.mockReturnValue(null);

      await request(app)
        .get('/api/resources/mcp/nonexistent')
        .expect(404);
    });
  });

  describe('POST /api/resources/mcp', () => {
    it('应在缺少 name 时返回 400', async () => {
      const response = await request(app)
        .post('/api/resources/mcp')
        .send({ transport: 'stdio' })
        .expect(400);

      expect(response.body.error).toContain('name');
    });

    it('应在无效 transport 时返回 400', async () => {
      const response = await request(app)
        .post('/api/resources/mcp')
        .send({ name: 'test', transport: 'invalid' })
        .expect(400);

      expect(response.body.error).toContain('transport');
    });

    it('应在 stdio 缺少 command 时返回 400', async () => {
      const response = await request(app)
        .post('/api/resources/mcp')
        .send({ name: 'test', transport: 'stdio' })
        .expect(400);

      expect(response.body.error).toContain('command');
    });

    it('应在成功创建时返回 201', async () => {
      const mockServer = {
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        enabled: true,
        order: 100,
      };
      mockMCPRegistry.create.mockResolvedValue(mockServer);

      const response = await request(app)
        .post('/api/resources/mcp')
        .send({
          name: 'test-server',
          transport: 'stdio',
          command: 'node',
        })
        .expect(201);

      expect(response.body).toEqual({ server: mockServer });
    });
  });

  describe('DELETE /api/resources/mcp/:name', () => {
    it('应在成功删除时返回 200', async () => {
      mockMCPRegistry.delete.mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/api/resources/mcp/test')
        .expect(200);

      expect(response.body.ok).toBe(true);
    });
  });
});

describe('Resources API - Agents Endpoints', () => {
  let app: express.Express;
  let mockAgentRegistry: any;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/resources', createResourcesRoutes());
    vi.clearAllMocks();

    mockAgentRegistry = {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      toggle: vi.fn(),
    };
    vi.mocked(getAgentRegistry).mockReturnValue(mockAgentRegistry);
  });

  describe('GET /api/resources/agents', () => {
    it('应返回 200 和 Agent 列表', async () => {
      const mockAgents = [
        { name: 'test-agent', description: 'Test', enabled: true, order: 100 },
      ];
      mockAgentRegistry.list.mockReturnValue(mockAgents);

      const response = await request(app)
        .get('/api/resources/agents')
        .expect(200);

      expect(response.body).toEqual({ resources: mockAgents });
    });
  });

  describe('POST /api/resources/agents', () => {
    it('应在缺少 name 时返回 400', async () => {
      const response = await request(app)
        .post('/api/resources/agents')
        .send({})
        .expect(400);

      expect(response.body.error).toContain('name');
    });

    it('应在成功创建时返回 201', async () => {
      const mockAgent = {
        name: 'test-agent',
        description: 'Test',
        enabled: true,
        order: 100,
      };
      mockAgentRegistry.create.mockResolvedValue(mockAgent);

      const response = await request(app)
        .post('/api/resources/agents')
        .send({ name: 'test-agent' })
        .expect(201);

      expect(response.body).toEqual({ agent: mockAgent });
    });
  });
});

describe('Resources API - Providers Endpoints', () => {
  let app: express.Express;
  let mockProviderRegistry: any;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/resources', createResourcesRoutes());
    vi.clearAllMocks();

    mockProviderRegistry = {
      list: vi.fn(),
      get: vi.fn(),
      setKey: vi.fn(),
      removeKey: vi.fn(),
      refreshModels: vi.fn(),
      getModels: vi.fn(),
      getAllModels: vi.fn(),
    };
    vi.mocked(getProviderRegistry).mockReturnValue(mockProviderRegistry);
  });

  describe('GET /api/resources/providers', () => {
    it('应返回 200 和 Provider 列表', async () => {
      const mockProviders = [
        { providerId: 'openai', type: 'api', configured: true },
      ];
      mockProviderRegistry.list.mockReturnValue(mockProviders);

      const response = await request(app)
        .get('/api/resources/providers')
        .expect(200);

      expect(response.body).toEqual({ resources: mockProviders });
    });
  });

  describe('GET /api/resources/providers/:id', () => {
    it('应返回 200 和 Provider 详情', async () => {
      const mockProvider = { type: 'api', key: 'sk-test' };
      mockProviderRegistry.get.mockReturnValue(mockProvider);

      const response = await request(app)
        .get('/api/resources/providers/openai')
        .expect(200);

      // API key 应该被脱敏
      expect(response.body.provider.key).toBe('••••••••');
    });

    it('应在不存在的 provider 时返回 404', async () => {
      mockProviderRegistry.get.mockReturnValue(null);

      await request(app)
        .get('/api/resources/providers/nonexistent')
        .expect(404);
    });
  });

  describe('PUT /api/resources/providers/:id', () => {
    it('应在缺少 key 时返回 400', async () => {
      const response = await request(app)
        .put('/api/resources/providers/openai')
        .send({})
        .expect(400);

      expect(response.body.error).toContain('key');
    });

    it('应在成功设置时返回 200', async () => {
      mockProviderRegistry.setKey.mockResolvedValue(undefined);

      const response = await request(app)
        .put('/api/resources/providers/openai')
        .send({ key: 'sk-test' })
        .expect(200);

      expect(response.body.ok).toBe(true);
    });
  });

  describe('GET /api/resources/providers/:id/models', () => {
    it('应返回 200 和模型列表', async () => {
      const mockModels = ['gpt-4', 'gpt-3.5-turbo'];
      mockProviderRegistry.getModels.mockReturnValue(mockModels);

      const response = await request(app)
        .get('/api/resources/providers/openai/models')
        .expect(200);

      expect(response.body).toEqual({
        providerId: 'openai',
        models: mockModels,
      });
    });
  });
});

describe('Resources API - Stats Endpoint', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/resources', createResourcesRoutes());
    vi.clearAllMocks();

    vi.mocked(skillRegistry.list).mockReturnValue([]);
    vi.mocked(getMCPRegistry).mockReturnValue({ list: vi.fn(() => []) });
    vi.mocked(getAgentRegistry).mockReturnValue({ list: vi.fn(() => []) });
    vi.mocked(getProviderRegistry).mockReturnValue({ list: vi.fn(() => []) });
  });

  describe('GET /api/resources/stats', () => {
    it('应返回 200 和资源统计', async () => {
      const response = await request(app)
        .get('/api/resources/stats')
        .expect(200);

      expect(response.body).toMatchObject({
        skills: expect.any(Number),
        mcp: expect.any(Number),
        agents: expect.any(Number),
        providers: expect.any(Number),
      });
    });
  });
});
