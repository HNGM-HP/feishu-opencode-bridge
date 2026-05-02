/**
 * Provider 管理器
 *
 * 职责：
 *   1. 读写 ~/.local/share/opencode/auth.json（仅 type=api 的增删改，OAuth 只读）
 *   2. 缓存 opencode models 输出（按 provider 分组）
 *   3. 提供 list / get / setKey / removeKey / refreshModels 接口
 *
 * 注意：
 *   - OAuth 类型的 provider 只能通过 opencode providers login 命令在终端登录
 *   - Web 端只能管理 type=api 的 provider
 */

import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import {
  emitResourceChange,
} from '../events.js';
import { PROVIDER_REFRESH_INTERVAL_MS } from '../constants.js';
import type {
  ApiProviderConfig,
  ModelsCache,
  ModelInfo,
  OpenCodeAuthConfig,
  ProviderConfig,
  ProviderSummary,
} from './types.js';

// Re-export types for CLI use
export type { ProviderSummary, ModelInfo };
import {
  getOpenCodeAuthPath,
  isProviderEditable,
  PROVIDER_DISPLAY_NAMES,
} from './types.js';

/** 注册表状态 */
interface ProviderRegistryState {
  /** auth.json 内容缓存 */
  authConfig: OpenCodeAuthConfig;
  /** 模型列表缓存 */
  modelsCache: ModelsCache;
  /** 是否已初始化 */
  initialized: boolean;
  /** 是否已释放 */
  disposed: boolean;
}

/**
 * 读取 auth.json 文件
 */
async function readAuthConfig(): Promise<OpenCodeAuthConfig> {
  const authPath = getOpenCodeAuthPath();
  try {
    const content = await fs.readFile(authPath, 'utf-8');
    const parsed = JSON.parse(content) as OpenCodeAuthConfig;
    return parsed || {};
  } catch (err) {
    // 文件不存在或解析失败，返回空对象
    return {};
  }
}

/**
 * 写入 auth.json 文件（原子性写入）
 */
async function writeAuthConfig(config: OpenCodeAuthConfig): Promise<void> {
  const authPath = getOpenCodeAuthPath();
  const tempPath = authPath + '.tmp';
  const content = JSON.stringify(config, null, 2);

  // 原子性写入：先写临时文件，再重命名
  await fs.writeFile(tempPath, content, 'utf-8');
  await fs.rename(tempPath, authPath);
}

/**
 * 执行 opencode models 命令并解析输出
 */
async function fetchModelsFromOpenCode(): Promise<Map<string, string[]>> {
  return new Promise((resolve) => {
    const models = new Map<string, string[]>();
    const child = spawn('opencode', ['models'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error('[Providers] opencode models 失败:', stderr);
        // 即使失败也返回空缓存，不阻塞启动
        resolve(new Map());
        return;
      }

      // 解析输出：每行格式为 "provider/model"
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const slashIndex = trimmed.indexOf('/');
        if (slashIndex === -1) {
          // 没有 / 的行，归入 unknown provider
          const unknown = models.get('unknown') || [];
          unknown.push(trimmed);
          models.set('unknown', unknown);
          continue;
        }

        const providerId = trimmed.slice(0, slashIndex);
        const modelId = trimmed.slice(slashIndex + 1);

        const providerModels = models.get(providerId) || [];
        providerModels.push(modelId);
        models.set(providerId, providerModels);
      }

      resolve(models);
    });

    // 30 秒超时
    setTimeout(() => {
      child.kill();
      console.error('[Providers] opencode models 超时');
      resolve(models);
    }, 30000);
  });
}

/**
 * Provider Registry 类
 */
export class ProviderRegistry {
  private state: ProviderRegistryState = {
    authConfig: {},
    modelsCache: new Map(),
    initialized: false,
    disposed: false,
  };
  private refreshInterval: NodeJS.Timeout | null = null;

  /**
   * 初始化：读取 auth.json + 缓存 models
   */
  async init(): Promise<void> {
    if (this.state.disposed) {
      throw new Error('ProviderRegistry 已释放，不可重新初始化');
    }
    if (this.state.initialized) {
      return; // 幂等
    }

    // 读取 auth.json
    this.state.authConfig = await readAuthConfig();

    // 缓存 models（后台执行，不阻塞初始化）
    this.refreshModels().catch((err) => {
      console.error('[Providers] 缓存 models 失败:', err);
    });

    // 设置定期刷新（每30分钟）
    this.startPeriodicRefresh();

    this.state.initialized = true;
    console.log('[Providers] Registry 已就绪');
  }

  /**
   * 启动定期刷新
   */
  private startPeriodicRefresh(): void {
    if (this.refreshInterval) {
      return;
    }

    this.refreshInterval = setInterval(() => {
      if (!this.state.disposed) {
        this.refreshModels().catch((err) => {
          console.error('[Providers] 定期刷新 models 失败:', err);
        });
      }
    }, PROVIDER_REFRESH_INTERVAL_MS);

    console.log(`[Providers] 已设置定期刷新，间隔 ${PROVIDER_REFRESH_INTERVAL_MS / 60000} 分钟`);
  }

  /**
   * 释放
   */
  async dispose(): Promise<void> {
    this.state.disposed = true;
    this.state.modelsCache.clear();
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    console.log('[Providers] Registry 已释放');
  }

  /**
   * 列出所有 provider（摘要信息）
   */
  list(): ProviderSummary[] {
    const result: ProviderSummary[] = [];

    for (const [providerId, config] of Object.entries(this.state.authConfig)) {
      const configured = config.type === 'api'
        ? !!config.key
        : !!config.access;

      result.push({
        providerId,
        type: config.type,
        configured,
        editable: isProviderEditable(config),
        displayName: PROVIDER_DISPLAY_NAMES[providerId],
      });
    }

    // 按 providerId 排序
    return result.sort((a, b) => a.providerId.localeCompare(b.providerId));
  }

  /**
   * 获取单个 provider 配置
   */
  get(providerId: string): ProviderConfig | null {
    return this.state.authConfig[providerId] || null;
  }

  /**
   * 设置 API Key（仅适用于 type=api 的 provider）
   */
  async setKey(providerId: string, apiKey: string): Promise<void> {
    if (this.state.disposed) {
      throw new Error('ProviderRegistry 已释放');
    }

    const existing = this.state.authConfig[providerId];

    // 如果已存在且是 OAuth 类型，拒绝覆盖
    if (existing && existing.type === 'oauth') {
      throw new Error(`Provider "${providerId}" 是 OAuth 类型，无法设置 API Key`);
    }

    // 更新配置，保留未知字段
    let newConfig: ApiProviderConfig;
    if (existing && existing.type === 'api') {
      // 合并现有配置，保留未知字段
      newConfig = {
        ...existing,
        type: 'api',
        key: apiKey,
      };
    } else {
      // 创建新配置
      newConfig = {
        type: 'api',
        key: apiKey,
      };
    }

    this.state.authConfig[providerId] = newConfig;
    await writeAuthConfig(this.state.authConfig);

    emitResourceChange('provider', 'update', { name: providerId });

    console.log(`[Providers] 已设置 provider "${providerId}" 的 API Key`);
  }

  /**
   * 删除 provider 配置
   */
  async removeKey(providerId: string): Promise<void> {
    if (this.state.disposed) {
      throw new Error('ProviderRegistry 已释放');
    }

    const existing = this.state.authConfig[providerId];
    if (!existing) {
      throw new Error(`Provider "${providerId}" 不存在`);
    }

    // OAuth 类型不允许删除（建议用户通过 opencode providers logout 删除）
    if (existing.type === 'oauth') {
      throw new Error(`Provider "${providerId}" 是 OAuth 类型，请通过命令行删除：opencode providers logout ${providerId}`);
    }

    delete this.state.authConfig[providerId];
    await writeAuthConfig(this.state.authConfig);

    emitResourceChange('provider', 'remove', { name: providerId });

    console.log(`[Providers] 已删除 provider "${providerId}"`);
  }

  /**
   * 刷新模型缓存（重新执行 opencode models）
   */
  async refreshModels(): Promise<void> {
    if (this.state.disposed) {
      return;
    }

    console.log('[Providers] 正在刷新模型列表...');
    const newCache = await fetchModelsFromOpenCode();
    this.state.modelsCache = newCache;

    const totalModels = Array.from(newCache.values()).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`[Providers] 模型列表已刷新，共 ${newCache.size} 个 provider、${totalModels} 个模型`);

    emitResourceChange('provider', 'reload');
  }

  /**
   * 获取指定 provider 的模型列表
   */
  getModels(providerId: string): string[] {
    return this.state.modelsCache.get(providerId) || [];
  }

  /**
   * 获取所有模型信息（扁平化列表）
   */
  getAllModels(): ModelInfo[] {
    const result: ModelInfo[] = [];

    for (const [providerId, modelIds] of this.state.modelsCache.entries()) {
      for (const modelId of modelIds) {
        result.push({
          providerId,
          modelId,
          fullName: `${providerId}/${modelId}`,
        });
      }
    }

    return result;
  }

  /**
   * 检查 provider 是否已配置
   */
  isConfigured(providerId: string): boolean {
    const config = this.state.authConfig[providerId];
    if (!config) return false;
    return config.type === 'api' ? !!config.key : !!config.access;
  }
}

// 单例
let globalProviderRegistry: ProviderRegistry | null = null;

/**
 * 获取全局 Provider registry 单例
 */
export function getProviderRegistry(): ProviderRegistry {
  if (!globalProviderRegistry) {
    globalProviderRegistry = new ProviderRegistry();
  }
  return globalProviderRegistry;
}
