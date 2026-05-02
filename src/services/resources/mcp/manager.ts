/**
 * MCP Server 配置管理器
 *
 * 职责：
 *   1. 启动时扫描 project + user 两层 mcp 目录，读取 <name>.json 和 _index.json
 *   2. 提供 CRUD（list / get / create / update / delete / enable / disable）
 *   3. 通过 chokidar 监听两层目录的变更，去抖 200ms 后增量重载并 emit resource:changed
 *   4. 维护 _index.json（启用列表 + 顺序），每次变更自动同步
 *
 * 覆盖语义：项目级与用户级同名时，项目级 wins；两个版本都保留在 records 中。
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import chokidar, { type FSWatcher } from 'chokidar';

import {
  assertValidResourceName,
  ensureResourceDir,
  getResourceDir,
  getResourceDirs,
} from '../paths.js';
import { emitResourceChange } from '../events.js';
import type { ResourceScope } from '../types.js';
import {
  DEBOUNCE_MS,
  DEFAULT_ORDER,
  FILE_STABILITY_THRESHOLD_MS,
  FILE_POLL_INTERVAL_MS,
} from '../constants.js';
import type {
  LegacyMCPIndexContent,
  MCPIndexContent,
  MCPIndexEntry,
  MCPInput,
  MCPServerConfig,
  MCPServerConfigBase,
  MCPServerSummary,
  MCPServerRecord,
  MCPChangeEvent,
} from './types.js';

// Re-export types for CLI use
export type { MCPServerSummary };

const INDEX_FILENAME = '_index.json';

/** 内存记录：name -> record */
type MCPServerRecords = Map<string, MCPServerRecord>;

/** 注册表状态 */
interface MCPRegistryState {
  /** project 层记录 */
  projectRecords: MCPServerRecords;
  /** user 层记录 */
  userRecords: MCPServerRecords;
  /** 索引内容 */
  index: MCPIndexContent;
  /** chokidar watcher */
  watcher?: FSWatcher;
  /** 是否已释放 */
  disposed: boolean;
}

/** 默认索引内容 */
const DEFAULT_INDEX: MCPIndexContent = { enabled: [], disabled: [] };

/**
 * 检测索引格式是否为新版
 */
function isNewIndexFormat(parsed: unknown): parsed is MCPIndexContent {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const index = parsed as Record<string, unknown>;
  const enabled = index.enabled;
  if (!Array.isArray(enabled)) return false;
  // 检查第一个元素是否为对象（新格式）或字符串（旧格式）
  if (enabled.length === 0) return false; // 空数组无法判断，按旧格式处理
  const first = enabled[0];
  return typeof first === 'object' && first !== null && 'name' in first;
}

/**
 * 将旧版索引转换为新版格式
 */
function migrateLegacyIndex(legacy: LegacyMCPIndexContent): MCPIndexContent {
  const now = new Date().toISOString();
  return {
    enabled: legacy.enabled.map((name, order) => ({ name, order: order * 10, updatedAt: now })),
    disabled: legacy.disabled?.map((name, order) => ({ name, order: order * 10, updatedAt: now })),
  };
}

/**
 * 从新版索引中提取名称列表（用于兼容现有逻辑）
 */
function extractNames(entries: MCPIndexEntry[]): string[] {
  return entries.map((e) => e.name);
}

/**
 * 解析单个 MCP server 配置文件
 */
async function loadServerFile(
  filePath: string,
  scope: 'project' | 'user'
): Promise<MCPServerRecord> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const raw = JSON.parse(content) as unknown;

    // 基础校验
    if (typeof raw !== 'object' || raw === null) {
      return { kind: 'error', error: '配置不是有效的 JSON 对象', scope };
    }

    const config = raw as MCPServerConfig;

    // 校验必填字段
    if (typeof config.name !== 'string' || !config.name) {
      return { kind: 'error', error: 'name 字段缺失或不是字符串', scope };
    }
    if (typeof config.enabled !== 'boolean') {
      return { kind: 'error', error: 'enabled 字段必须是布尔值', scope };
    }
    if (typeof config.order !== 'number') {
      return { kind: 'error', error: 'order 字段必须是数字', scope };
    }

    // 校验 transport
    if (!['stdio', 'sse', 'http'].includes(config.transport)) {
      return { kind: 'error', error: `transport 必须是 stdio/sse/http 之一`, scope };
    }

    // transport 特定校验
    if (config.transport === 'stdio') {
      if (typeof config.command !== 'string' || !config.command) {
        return { kind: 'error', error: 'stdio 传输需要 command 字段', scope };
      }
    } else {
      if (typeof config.url !== 'string' || !config.url) {
        return { kind: 'error', error: `${config.transport} 传输需要 url 字段`, scope };
      }
    }

    // 校验 name 是否与文件名一致
    const expectedName = path.basename(filePath, '.json');
    if (config.name !== expectedName) {
      return {
        kind: 'error',
        error: `配置 name "${config.name}" 与文件名 "${expectedName}" 不一致`,
        scope,
      };
    }

    return { kind: 'ok', config, scope };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: 'error', error: `解析失败: ${msg}`, scope };
  }
}

/**
 * 加载索引文件 _index.json
 */
async function loadIndex(dir: string): Promise<MCPIndexContent> {
  const indexPath = path.join(dir, INDEX_FILENAME);
  try {
    const content = await fs.readFile(indexPath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as Record<string, unknown>).enabled)
    ) {
      // 检测是否为新版格式
      if (isNewIndexFormat(parsed)) {
        return parsed as MCPIndexContent;
      }
      // 旧版格式，迁移
      console.log('[MCP] 检测到旧版索引格式，自动迁移');
      return migrateLegacyIndex(parsed as LegacyMCPIndexContent);
    }
    return DEFAULT_INDEX;
  } catch {
    // 文件不存在或解析失败，返回默认
    return DEFAULT_INDEX;
  }
}

/**
 * 保存索引文件
 */
async function saveIndex(dir: string, index: MCPIndexContent): Promise<void> {
  const indexPath = path.join(dir, INDEX_FILENAME);
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

/**
 * 扫描单个 scope 目录，返回 records
 */
async function scanMCPServersInScope(
  scope: 'project' | 'user'
): Promise<MCPServerRecords> {
  const dir = getResourceDir('mcp', scope);
  const records: MCPServerRecords = new Map();

  try {
    const files = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of files) {
      if (!ent.isFile() || !ent.name.endsWith('.json') || ent.name === INDEX_FILENAME) {
        continue;
      }

      const filePath = path.join(dir, ent.name);
      const record = await loadServerFile(filePath, scope);
      const name = path.basename(ent.name, '.json');
      records.set(name, record);
    }
  } catch (err) {
    // 目录不存在或无权限，返回空
  }

  return records;
}

/**
 * MCP Server 注册表类
 */
export class MCPRegistry {
  private state: MCPRegistryState = {
    projectRecords: new Map(),
    userRecords: new Map(),
    index: DEFAULT_INDEX,
    disposed: false,
  };

  private reloadTimeout?: ReturnType<typeof setTimeout>;

  /**
   * 初始化：扫描两层目录 + 启动 watcher
   */
  async init(): Promise<void> {
    if (this.state.disposed) {
      throw new Error('MCPRegistry 已释放，不可重新初始化');
    }

    // 扫描两层目录
    await this.reload();

    // 启动 watcher
    const dirs = getResourceDirs('mcp');
    const watchPaths = [dirs.project];
    try {
      await fs.access(dirs.user);
      watchPaths.push(dirs.user);
    } catch {
      // user 目录不存在，只监听 project
    }

    this.state.watcher = chokidar
      .watch(watchPaths, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: FILE_STABILITY_THRESHOLD_MS, pollInterval: FILE_POLL_INTERVAL_MS },
      })
      .on('all', (event, filePath) => {
        this.scheduleReload();
      });

    console.log('[MCP] Registry 已就绪，监听:', watchPaths.join(', '));
  }

  /**
   * 释放 watcher
   */
  async dispose(): Promise<void> {
    this.state.disposed = true;
    if (this.reloadTimeout) {
      clearTimeout(this.reloadTimeout);
    }
    await this.state.watcher?.close();
    console.log('[MCP] Registry 已释放');
  }

  /**
   * 调度延迟重载（去抖）
   */
  private scheduleReload(): void {
    if (this.state.disposed) return;
    if (this.reloadTimeout) clearTimeout(this.reloadTimeout);
    this.reloadTimeout = setTimeout(() => {
      this.reload().catch((err) => {
        console.error('[MCP] 热载失败:', err);
      });
    }, DEBOUNCE_MS);
  }

  /**
   * 全量重载
   */
  private async reload(): Promise<void> {
    // 扫描两层
    this.state.projectRecords = await scanMCPServersInScope('project');
    this.state.userRecords = await scanMCPServersInScope('user');

    // 加载索引（project 层优先，user 层作为回退）
    const dirs = getResourceDirs('mcp');
    let index = await loadIndex(dirs.project);

    // 如果 project 层索引是空的，尝试从 user 层加载
    if (index.enabled.length === 0 && !index.disabled) {
      const userIndex = await loadIndex(dirs.user);
      if (userIndex.enabled.length > 0) {
        index = userIndex;
      }
    }

    this.state.index = index;
    emitResourceChange('mcp', 'reload');
    console.log('[MCP] 热载完成');
  }

  /**
   * 列出所有 server（合并两层，项目级 shadow 用户级）
   * 返回所有条目（包括被遮蔽的用户层条目），便于 UI 展示完整状态
   */
  list(): MCPServerSummary[] {
    const result: MCPServerSummary[] = [];
    const allNames = new Set<string>();

    // 收集所有 name
    for (const name of this.state.projectRecords.keys()) allNames.add(name);
    for (const name of this.state.userRecords.keys()) allNames.add(name);

    // 找出项目级 name 集合，用于判定 user 是否被 shadow
    const projectNames = new Set(this.state.projectRecords.keys());

    for (const name of allNames) {
      // 遍历两层 scope，分别生成摘要（这样被遮蔽的 user 条目也会出现在列表中）
      for (const scope of ['project', 'user'] as const) {
        const record = scope === 'project'
          ? this.state.projectRecords.get(name)
          : this.state.userRecords.get(name);

        if (!record) continue;

        if (record.kind === 'ok') {
          const cfg = record.config;
          result.push({
            name: cfg.name,
            scope: record.scope,
            transport: cfg.transport,
            description: cfg.description,
            enabled: cfg.enabled,
            order: cfg.order,
            valid: true,
            shadowed: record.scope === 'user' && projectNames.has(name),
          });
        } else {
          result.push({
            name,
            scope: record.scope,
            transport: 'stdio', // 占位
            enabled: false,
            order: DEFAULT_ORDER,
            valid: false,
            error: record.error,
            shadowed: false,
          });
        }
      }
    }

    // 按 order 排序
    return result.sort((a, b) => a.order - b.order);
  }

  /**
   * 获取单个 server 完整配置（winning 或指定 scope）
   */
  get(
    name: string,
    scope?: ResourceScope
  ): MCPServerConfig | null {
    if (scope === 'user') {
      const record = this.state.userRecords.get(name);
      if (record?.kind === 'ok') return record.config;
      return null;
    }
    if (scope === 'project') {
      const record = this.state.projectRecords.get(name);
      if (record?.kind === 'ok') return record.config;
      return null;
    }
    // 默认 winning
    const projRecord = this.state.projectRecords.get(name);
    const userRecord = this.state.userRecords.get(name);
    const record = projRecord || userRecord;
    if (record?.kind === 'ok') return record.config;
    return null;
  }

  /**
   * 创建新 server
   */
  async create(name: string, input: MCPInput, scope: ResourceScope = 'project'): Promise<MCPServerConfig> {
    assertValidResourceName(name);

    // 检查是否已存在
    const existing = this.get(name, scope);
    if (existing) {
      throw new Error(`MCP server "${name}" 已存在（${scope} 层）`);
    }

    // 计算 order
    const currentMax = Math.max(
      0,
      ...this.list().map((s) => s.order)
    );
    const order = input.order ?? currentMax + 10;

    const config: MCPServerConfig = {
      ...input,
      name,
      order,
    } as MCPServerConfig;

    // 写入文件
    const dir = getResourceDir('mcp', scope);
    await ensureResourceDir('mcp', scope);
    const filePath = path.join(dir, `${name}.json`);
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');

    // 更新索引
    const now = new Date().toISOString();
    const newIndex = { ...this.state.index };
    const entry: MCPIndexEntry = { name, order, updatedAt: now };
    if (config.enabled) {
      newIndex.enabled.push(entry);
    } else {
      (newIndex.disabled ??= []).push(entry);
    }
    this.state.index = newIndex;
    await this.syncIndex(scope, newIndex);

    // 触发重载
    await this.reload();

    emitResourceChange('mcp', 'add', { name, scope });

    console.log(`[MCP] 创建 server "${name}" 于 ${scope} 层`);
    return config;
  }

  /**
   * 更新 server
   */
  async update(
    name: string,
    input: Partial<MCPInput>,
    scope: ResourceScope = 'project'
  ): Promise<MCPServerConfig> {
    const existing = this.get(name, scope);
    if (!existing) {
      throw new Error(`MCP server "${name}" 不存在（${scope} 层）`);
    }

    const config: MCPServerConfig = {
      ...existing,
      ...input,
      name, // 确保 name 不变
    } as MCPServerConfig;

    // 写入文件
    const dir = getResourceDir('mcp', scope);
    const filePath = path.join(dir, `${name}.json`);
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');

    // 如果 enabled 状态变化，更新索引
    if (input.enabled !== undefined && input.enabled !== existing.enabled) {
      const newIndex = { ...this.state.index };
      this.updateIndexForServerInIndex(newIndex, name, config.enabled);
      this.state.index = newIndex;
      await this.syncIndex(scope, newIndex);
    }

    // 触发重载
    await this.reload();

    emitResourceChange('mcp', 'update', { name, scope });

    console.log(`[MCP] 更新 server "${name}" 于 ${scope} 层`);
    return config;
  }

  /**
   * 删除 server
   */
  async delete(name: string, scope: ResourceScope = 'project'): Promise<void> {
    const existing = this.get(name, scope);
    if (!existing) {
      throw new Error(`MCP server "${name}" 不存在（${scope} 层）`);
    }

    const dir = getResourceDir('mcp', scope);
    const filePath = path.join(dir, `${name}.json`);
    await fs.unlink(filePath);

    // 从索引中移除
    const newIndex = { ...this.state.index };
    this.removeFromIndexInIndex(newIndex, name);
    this.state.index = newIndex;
    await this.syncIndex(scope, newIndex);

    // 触发重载
    await this.reload();

    emitResourceChange('mcp', 'remove', { name, scope });

    console.log(`[MCP] 删除 server "${name}" 于 ${scope} 层`);
  }

  /**
   * 启用/禁用 server
   */
  async toggle(name: string, enabled: boolean, scope?: ResourceScope): Promise<MCPServerConfig> {
    // 如果未指定 scope，从 winning 推断
    let targetScope: ResourceScope = scope ?? 'project';
    if (!scope) {
      const projRecord = this.state.projectRecords.get(name);
      const userRecord = this.state.userRecords.get(name);
      if (projRecord) targetScope = 'project';
      else if (userRecord) targetScope = 'user';
      else throw new Error(`MCP server "${name}" 不存在`);
    }

    const config = await this.update(name, { enabled }, targetScope);
    return config;
  }

  /**
   * 更新索引中的单个 server 状态
   */
  private updateIndexForServerInIndex(index: MCPIndexContent, name: string, enabled: boolean): void {
    const now = new Date().toISOString();
    // 从两列表中移除
    index.enabled = index.enabled.filter((e) => e.name !== name);
    index.disabled = (index.disabled ?? []).filter((e) => e.name !== name);

    // 查找现有条目以保留 order
    const existingEntry = [...this.state.index.enabled, ...(this.state.index.disabled ?? [])]
      .find((e) => e.name === name);
    const order = existingEntry?.order ?? Math.max(...index.enabled.map((e) => e.order), 0) + 10;

    // 加入对应列表
    const entry: MCPIndexEntry = { name, order, updatedAt: now };
    if (enabled) {
      index.enabled.push(entry);
    } else {
      index.disabled!.push(entry);
    }
  }

  /**
   * 从索引中完全移除
   */
  private removeFromIndexInIndex(index: MCPIndexContent, name: string): void {
    index.enabled = index.enabled.filter((e) => e.name !== name);
    index.disabled = (index.disabled ?? []).filter((e) => e.name !== name);
  }

  /**
   * 同步索引到磁盘（写入指定 scope）
   */
  private async syncIndex(scope: ResourceScope, index: MCPIndexContent): Promise<void> {
    const dir = getResourceDir('mcp', scope);
    await saveIndex(dir, index);
  }

  /**
   * 导出为 opencode 兼容的配置格式（用于启动 MCP server）
   * 遍历所有 enabled 的 server，生成 opencode MCP 配置格式
   */
  exportForOpenCode(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const servers = this.list();

    for (const server of servers) {
      if (!server.enabled || server.shadowed || !server.valid) continue;

      const config = this.get(server.name);
      if (!config) continue;

      const serverConfig: Record<string, unknown> = {
        transport: config.transport,
      };

      if (config.transport === 'stdio') {
        serverConfig.command = config.command;
        if (config.args) serverConfig.args = config.args;
        if (config.cwd) serverConfig.cwd = config.cwd;
        if (config.env) serverConfig.env = config.env;
      } else if (config.transport === 'sse' || config.transport === 'http') {
        serverConfig.url = config.url;
        if (config.headers) serverConfig.headers = config.headers;
      }

      result[server.name] = serverConfig;
    }

    return result;
  }
}

// 单例
let globalMCPRegistry: MCPRegistry | null = null;

/**
 * 获取全局 MCP registry 单例
 */
export function getMCPRegistry(): MCPRegistry {
  if (!globalMCPRegistry) {
    globalMCPRegistry = new MCPRegistry();
  }
  return globalMCPRegistry;
}
