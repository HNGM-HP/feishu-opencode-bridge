/**
 * Agent 配置管理器
 *
 * 职责：
 *   1. 启动时扫描 project + user 两层 agents 目录，读取 <name>.json
 *   2. 提供 CRUD（list / get / create / update / delete / enable / disable）
 *   3. 通过 chokidar 监听两层目录的变更，去抖 200ms 后增量重载并 emit resource:changed
 *   4. 导出为 OpenCode 兼容格式（用于同步到 opencode 配置）
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
  AgentConfig,
  AgentInput,
  AgentSummary,
  AgentRecord,
} from './types.js';

// Re-export types for CLI use
export type { AgentSummary };

/** 内存记录：name -> record */
type AgentRecords = Map<string, AgentRecord>;

/** 注册表状态 */
interface AgentRegistryState {
  /** project 层记录 */
  projectRecords: AgentRecords;
  /** user 层记录 */
  userRecords: AgentRecords;
  /** chokidar watcher */
  watcher?: FSWatcher;
  /** 是否已释放 */
  disposed: boolean;
}

/**
 * 解析单个 Agent 配置文件
 */
async function loadAgentFile(
  filePath: string,
  scope: 'project' | 'user'
): Promise<AgentRecord> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const raw = JSON.parse(content) as unknown;

    // 基础校验
    if (typeof raw !== 'object' || raw === null) {
      return { kind: 'error', error: '配置不是有效的 JSON 对象', scope };
    }

    const config = raw as AgentConfig;

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

    // 校验 mode（如果存在）
    if (config.mode && !['primary', 'subagent', 'all'].includes(config.mode)) {
      return { kind: 'error', error: `mode 必须是 primary/subagent/all 之一`, scope };
    }

    // 校验 tools（如果存在）
    if (config.tools && typeof config.tools !== 'object') {
      return { kind: 'error', error: 'tools 字段必须是对象', scope };
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
 * 扫描单个 scope 目录，返回 records
 */
async function scanAgentsInScope(
  scope: 'project' | 'user'
): Promise<AgentRecords> {
  const dir = getResourceDir('agents', scope);
  const records: AgentRecords = new Map();

  try {
    const files = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of files) {
      if (!ent.isFile() || !ent.name.endsWith('.json')) {
        continue;
      }

      const filePath = path.join(dir, ent.name);
      const record = await loadAgentFile(filePath, scope);
      const name = path.basename(ent.name, '.json');
      records.set(name, record);
    }
  } catch (err) {
    // 目录不存在或无权限，返回空
  }

  return records;
}

/**
 * Agent Registry 类
 */
export class AgentRegistry {
  private state: AgentRegistryState = {
    projectRecords: new Map(),
    userRecords: new Map(),
    disposed: false,
  };

  private reloadTimeout?: ReturnType<typeof setTimeout>;

  /**
   * 初始化：扫描两层目录 + 启动 watcher
   */
  async init(): Promise<void> {
    if (this.state.disposed) {
      throw new Error('AgentRegistry 已释放，不可重新初始化');
    }

    // 扫描两层目录
    await this.reload();

    // 启动 watcher
    const dirs = getResourceDirs('agents');
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

    console.log('[Agents] Registry 已就绪，监听:', watchPaths.join(', '));
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
    console.log('[Agents] Registry 已释放');
  }

  /**
   * 调度延迟重载（去抖）
   */
  private scheduleReload(): void {
    if (this.state.disposed) return;
    if (this.reloadTimeout) clearTimeout(this.reloadTimeout);
    this.reloadTimeout = setTimeout(() => {
      this.reload().catch((err) => {
        console.error('[Agents] 热载失败:', err);
      });
    }, DEBOUNCE_MS);
  }

  /**
   * 全量重载
   */
  private async reload(): Promise<void> {
    // 扫描两层
    this.state.projectRecords = await scanAgentsInScope('project');
    this.state.userRecords = await scanAgentsInScope('user');

    emitResourceChange('agents', 'reload');
    console.log('[Agents] 热载完成');
  }

  /**
   * 列出所有 agent（合并两层，项目级 shadow 用户级）
   * 返回所有条目（包括被遮蔽的用户层条目），便于 UI 展示完整状态
   */
  list(): AgentSummary[] {
    const result: AgentSummary[] = [];
    const allNames = new Set<string>();

    // 收集所有 name
    for (const name of this.state.projectRecords.keys()) allNames.add(name);
    for (const name of this.state.userRecords.keys()) allNames.add(name);

    // 找出项目级 name 集合，用于判定 user 是否被 shadow
    const projectNames = new Set(this.state.projectRecords.keys());

    for (const name of allNames) {
      // 遍历两层 scope，分别生成摘要
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
            description: cfg.description,
            mode: cfg.mode,
            enabled: cfg.enabled,
            order: cfg.order,
            valid: true,
            shadowed: record.scope === 'user' && projectNames.has(name),
          });
        } else {
          result.push({
            name,
            scope: record.scope,
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
   * 获取单个 agent 完整配置（winning 或指定 scope）
   */
  get(
    name: string,
    scope?: ResourceScope
  ): AgentConfig | null {
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
   * 创建新 agent
   */
  async create(name: string, input: AgentInput, scope: ResourceScope = 'project'): Promise<AgentConfig> {
    assertValidResourceName(name);

    // 检查是否已存在
    const existing = this.get(name, scope);
    if (existing) {
      throw new Error(`Agent "${name}" 已存在（${scope} 层）`);
    }

    // 计算 order
    const currentMax = Math.max(
      0,
      ...this.list().map((a) => a.order)
    );
    const order = input.order ?? currentMax + 10;

    const config: AgentConfig = {
      ...input,
      name,
      order,
    };

    // 写入文件
    const dir = getResourceDir('agents', scope);
    await ensureResourceDir('agents', scope);
    const filePath = path.join(dir, `${name}.json`);
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');

    // 触发重载
    await this.reload();

    emitResourceChange('agents', 'add', { name, scope });

    console.log(`[Agents] 创建 agent "${name}" 于 ${scope} 层`);
    return config;
  }

  /**
   * 更新 agent
   */
  async update(
    name: string,
    input: Partial<AgentInput>,
    scope: ResourceScope = 'project'
  ): Promise<AgentConfig> {
    const existing = this.get(name, scope);
    if (!existing) {
      throw new Error(`Agent "${name}" 不存在（${scope} 层）`);
    }

    const config: AgentConfig = {
      ...existing,
      ...input,
      name, // 确保 name 不变
    };

    // 写入文件
    const dir = getResourceDir('agents', scope);
    const filePath = path.join(dir, `${name}.json`);
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');

    // 触发重载
    await this.reload();

    emitResourceChange('agents', 'update', { name, scope });

    console.log(`[Agents] 更新 agent "${name}" 于 ${scope} 层`);
    return config;
  }

  /**
   * 删除 agent
   */
  async delete(name: string, scope: ResourceScope = 'project'): Promise<void> {
    const existing = this.get(name, scope);
    if (!existing) {
      throw new Error(`Agent "${name}" 不存在（${scope} 层）`);
    }

    const dir = getResourceDir('agents', scope);
    const filePath = path.join(dir, `${name}.json`);
    await fs.unlink(filePath);

    // 触发重载
    await this.reload();

    emitResourceChange('agents', 'remove', { name, scope });

    console.log(`[Agents] 删除 agent "${name}" 于 ${scope} 层`);
  }

  /**
   * 启用/禁用 agent
   */
  async toggle(name: string, enabled: boolean, scope?: ResourceScope): Promise<AgentConfig> {
    // 如果未指定 scope，从 winning 推断
    let targetScope: ResourceScope = scope ?? 'project';
    if (!scope) {
      const projRecord = this.state.projectRecords.get(name);
      const userRecord = this.state.userRecords.get(name);
      if (projRecord) targetScope = 'project';
      else if (userRecord) targetScope = 'user';
      else throw new Error(`Agent "${name}" 不存在`);
    }

    const config = await this.update(name, { enabled }, targetScope);
    return config;
  }

  /**
   * 导出为 OpenCode 兼容格式（用于同步到 opencode 配置）
   * 返回 Record<name, OpencodeAgentConfig>
   */
  exportForOpenCode(): Record<string, {
    description?: string;
    mode?: 'primary' | 'subagent' | 'all';
    prompt?: string;
    tools?: Record<string, boolean>;
  }> {
    const result: Record<string, {
      description?: string;
      mode?: 'primary' | 'subagent' | 'all';
      prompt?: string;
      tools?: Record<string, boolean>;
    }> = {};

    // 只导出 winning 且 enabled 的 agent
    for (const [name, projRecord] of this.state.projectRecords) {
      if (projRecord.kind === 'ok' && projRecord.config.enabled) {
        result[name] = {
          description: projRecord.config.description,
          mode: projRecord.config.mode,
          prompt: projRecord.config.prompt,
          tools: projRecord.config.tools,
        };
      }
    }

    // 导出 user 层独有的 agent（未被 project 遮蔽）
    for (const [name, userRecord] of this.state.userRecords) {
      if (this.state.projectRecords.has(name)) continue; // 被 project 遮蔽，跳过
      if (userRecord.kind === 'ok' && userRecord.config.enabled) {
        result[name] = {
          description: userRecord.config.description,
          mode: userRecord.config.mode,
          prompt: userRecord.config.prompt,
          tools: userRecord.config.tools,
        };
      }
    }

    return result;
  }
}

// 单例
let globalAgentRegistry: AgentRegistry | null = null;

/**
 * 获取全局 Agent registry 单例
 */
export function getAgentRegistry(): AgentRegistry {
  if (!globalAgentRegistry) {
    globalAgentRegistry = new AgentRegistry();
  }
  return globalAgentRegistry;
}
