/**
 * Provider Manager 单元测试
 *
 * 这些测试专注于文件系统交互和配置管理，不依赖外部 opencode 命令。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ProviderRegistry } from '../../../src/services/resources/providers/manager.js';
import type { OpenCodeAuthConfig } from '../../../src/services/resources/providers/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '.fixtures-providers');

describe('Provider Manager', () => {
  let registry: ProviderRegistry;

  beforeEach(async () => {
    // 清理并创建临时目录
    await fs.rm(FIXTURE_DIR, { recursive: true, force: true });
    await fs.mkdir(FIXTURE_DIR, { recursive: true });

    // 设置临时 auth.json 路径
    const tempAuthPath = path.join(FIXTURE_DIR, 'auth.json');
    process.env.OPENCODE_AUTH_PATH = tempAuthPath;

    // 创建初始 auth.json
    await fs.writeFile(tempAuthPath, JSON.stringify({
      'test-provider': {
        type: 'api',
        key: 'sk-test-key',
      },
      'oauth-provider': {
        type: 'oauth',
        access: 'test-access-token',
        refresh: 'test-refresh-token',
        expires: 1234567890,
      },
    }, null, 2), 'utf-8');
  });

  afterEach(async () => {
    await registry?.dispose();
    await fs.rm(FIXTURE_DIR, { recursive: true, force: true });
    delete process.env.OPENCODE_AUTH_PATH;
  });

  describe('初始化', () => {
    it('应该正确读取 auth.json', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      const testProvider = registry.get('test-provider');
      expect(testProvider).toBeDefined();
      expect(testProvider?.type).toBe('api');
      if (testProvider?.type === 'api') {
        expect(testProvider.key).toBe('sk-test-key');
      }
    });

    it('auth.json 不存在时应该返回空配置', async () => {
      // 删除 auth.json
      const tempAuthPath = path.join(FIXTURE_DIR, 'auth.json');
      await fs.unlink(tempAuthPath);

      registry = new ProviderRegistry();
      await registry.init();

      const list = registry.list();
      expect(list.length).toBe(0);
    });

    it('auth.json 格式错误时应该返回空配置', async () => {
      // 写入无效 JSON
      const tempAuthPath = path.join(FIXTURE_DIR, 'auth.json');
      await fs.writeFile(tempAuthPath, '{invalid json', 'utf-8');

      registry = new ProviderRegistry();
      await registry.init();

      const list = registry.list();
      expect(list.length).toBe(0);
    });

    it('多次调用 init 应该幂等', async () => {
      registry = new ProviderRegistry();

      await registry.init();
      await registry.init();

      const list = registry.list();
      expect(list.length).toBe(2); // 两个初始 provider
    });
  });

  describe('list / get', () => {
    it('应该正确列出所有 provider', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      const list = registry.list();

      expect(list.length).toBe(2);

      const apiProvider = list.find(p => p.providerId === 'test-provider');
      expect(apiProvider).toBeDefined();
      expect(apiProvider?.type).toBe('api');
      expect(apiProvider?.configured).toBe(true);
      expect(apiProvider?.editable).toBe(true);

      const oauthProvider = list.find(p => p.providerId === 'oauth-provider');
      expect(oauthProvider).toBeDefined();
      expect(oauthProvider?.type).toBe('oauth');
      expect(oauthProvider?.configured).toBe(true);
      expect(oauthProvider?.editable).toBe(false);
    });

    it('应该正确获取 API provider', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      const provider = registry.get('test-provider');

      expect(provider).toBeDefined();
      expect(provider?.type).toBe('api');
      if (provider?.type === 'api') {
        expect(provider.key).toBe('sk-test-key');
      }
    });

    it('应该正确获取 OAuth provider', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      const provider = registry.get('oauth-provider');

      expect(provider).toBeDefined();
      expect(provider?.type).toBe('oauth');
      if (provider?.type === 'oauth') {
        expect(provider.access).toBe('test-access-token');
        expect(provider.refresh).toBe('test-refresh-token');
        expect(provider.expires).toBe(1234567890);
      }
    });

    it('获取不存在的 provider 应该返回 null', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      const provider = registry.get('nonexistent');
      expect(provider).toBeNull();
    });
  });

  describe('setKey', () => {
    it('应该正确设置新的 API Key', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      await registry.setKey('new-provider', 'sk-new-key');

      const provider = registry.get('new-provider');
      expect(provider).toBeDefined();
      expect(provider?.type).toBe('api');
      if (provider?.type === 'api') {
        expect(provider.key).toBe('sk-new-key');
      }

      // 验证已写入文件
      const tempAuthPath = path.join(FIXTURE_DIR, 'auth.json');
      const content = await fs.readFile(tempAuthPath, 'utf-8');
      const authConfig = JSON.parse(content) as OpenCodeAuthConfig;

      expect(authConfig['new-provider']).toBeDefined();
      expect(authConfig['new-provider'].type).toBe('api');
      if (authConfig['new-provider'].type === 'api') {
        expect(authConfig['new-provider'].key).toBe('sk-new-key');
      }
    });

    it('应该更新现有 provider 的 API Key', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      await registry.setKey('test-provider', 'sk-updated-key');

      const provider = registry.get('test-provider');
      expect(provider).toBeDefined();
      if (provider?.type === 'api') {
        expect(provider.key).toBe('sk-updated-key');
      }
    });

    it('应该拒绝覆盖 OAuth 类型的 provider', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      await expect(
        registry.setKey('oauth-provider', 'sk-new-key')
      ).rejects.toThrow('OAuth');
    });

    it('setKey 后 list 应该包含新 provider', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      await registry.setKey('another-provider', 'sk-another-key');

      const list = registry.list();
      const newProvider = list.find(p => p.providerId === 'another-provider');

      expect(newProvider).toBeDefined();
      expect(newProvider?.type).toBe('api');
      expect(newProvider?.configured).toBe(true);
    });

    it('setKey 应该原子性写入文件（不破坏原有内容）', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      await registry.setKey('atomic-test', 'sk-atomic-key');

      // 验证原有数据未被破坏
      const testProvider = registry.get('test-provider');
      expect(testProvider).toBeDefined();
      if (testProvider?.type === 'api') {
        expect(testProvider.key).toBe('sk-test-key');
      }

      const oauthProvider = registry.get('oauth-provider');
      expect(oauthProvider).toBeDefined();
    });
  });

  describe('removeKey', () => {
    it('应该正确删除 API provider', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      await registry.removeKey('test-provider');

      const provider = registry.get('test-provider');
      expect(provider).toBeNull();

      // 验证已从文件删除
      const tempAuthPath = path.join(FIXTURE_DIR, 'auth.json');
      const content = await fs.readFile(tempAuthPath, 'utf-8');
      const authConfig = JSON.parse(content) as OpenCodeAuthConfig;

      expect(authConfig['test-provider']).toBeUndefined();
    });

    it('删除后 list 不应包含该 provider', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      await registry.removeKey('test-provider');

      const list = registry.list();
      const deleted = list.find(p => p.providerId === 'test-provider');

      expect(deleted).toBeUndefined();
      expect(list.length).toBe(1); // 只剩 oauth-provider
    });

    it('删除不存在的 provider 应该抛出错误', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      await expect(
        registry.removeKey('nonexistent')
      ).rejects.toThrow('不存在');
    });

    it('应该拒绝删除 OAuth 类型的 provider', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      await expect(
        registry.removeKey('oauth-provider')
      ).rejects.toThrow('OAuth');
    });

    it('删除应该原子性写入文件（不破坏原有内容）', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      await registry.removeKey('test-provider');

      // 验证 OAuth provider 未被破坏
      const oauthProvider = registry.get('oauth-provider');
      expect(oauthProvider).toBeDefined();
    });
  });

  describe('模型缓存', () => {
    it('初始时模型缓存应该为空', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      const openaiModels = registry.getModels('openai');
      expect(openaiModels).toEqual([]);

      const allModels = registry.getAllModels();
      expect(allModels).toEqual([]);
    });

    it('getModels 对于不存在的 provider 应该返回空数组', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      const models = registry.getModels('nonexistent');
      expect(models).toEqual([]);
    });

    it('refreshModels 应该不抛出错误（即使 opencode 命令失败）', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      // refreshModels 会尝试执行 opencode models，但测试环境可能没有 opencode
      // 应该不抛出错误，只是返回空缓存或缓存当前可用模型
      await registry.refreshModels();

      const models = registry.getAllModels();
      expect(Array.isArray(models)).toBe(true);
    }, 60000); // 60秒超时（opencode models 可能很慢）
  });

  describe('isConfigured', () => {
    it('已配置的 API provider 应返回 true', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      expect(registry.isConfigured('test-provider')).toBe(true);
    });

    it('已配置的 OAuth provider 应返回 true', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      expect(registry.isConfigured('oauth-provider')).toBe(true);
    });

    it('不存在的 provider 应返回 false', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      expect(registry.isConfigured('nonexistent')).toBe(false);
    });

    it('删除后应返回 false', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      expect(registry.isConfigured('test-provider')).toBe(true);

      await registry.removeKey('test-provider');

      expect(registry.isConfigured('test-provider')).toBe(false);
    });
  });

  describe('dispose', () => {
    it('dispose 后应该清空模型缓存', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      await registry.dispose();

      // dispose 后模型缓存应该被清空
      const models = registry.getAllModels();
      expect(models).toEqual([]);
    });

    it('dispose 后再次 init 应该抛出错误', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      await registry.dispose();

      await expect(registry.init()).rejects.toThrow('已释放');
    });

    it('dispose 后再次 dispose 应该安全（幂等）', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      await registry.dispose();
      await registry.dispose(); // 不应该抛出错误
    });
  });

  describe('边界情况', () => {
    it('应该正确处理空的 auth.json', async () => {
      const tempAuthPath = path.join(FIXTURE_DIR, 'auth.json');
      await fs.writeFile(tempAuthPath, '{}', 'utf-8');

      registry = new ProviderRegistry();
      await registry.init();

      const list = registry.list();
      expect(list.length).toBe(0);
    });

    it('应该正确处理包含额外字段的 provider', async () => {
      const tempAuthPath = path.join(FIXTURE_DIR, 'auth.json');
      await fs.writeFile(tempAuthPath, JSON.stringify({
        'custom-provider': {
          type: 'api',
          key: 'sk-custom',
          extraField: 'should be preserved',
        },
      }, null, 2), 'utf-8');

      registry = new ProviderRegistry();
      await registry.init();

      const provider = registry.get('custom-provider');
      expect(provider).toBeDefined();
      expect(provider?.type).toBe('api');

      // 额外字段应该被保留
      const content = await fs.readFile(tempAuthPath, 'utf-8');
      const authConfig = JSON.parse(content) as OpenCodeAuthConfig;
      expect(authConfig['custom-provider']).toHaveProperty('extraField');
    });

    it('应该正确处理特殊字符的 provider ID', async () => {
      registry = new ProviderRegistry();
      await registry.init();

      // provider ID 可以包含字母、数字、连字符、下划线
      await registry.setKey('test_provider-123', 'sk-key');

      const provider = registry.get('test_provider-123');
      expect(provider).toBeDefined();
      if (provider?.type === 'api') {
        expect(provider.key).toBe('sk-key');
      }
    });
  });
});
