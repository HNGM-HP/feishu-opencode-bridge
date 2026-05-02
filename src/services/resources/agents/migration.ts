/**
 * Agent Migration Script
 *
 * 职责：
 *   1. 从 OpenCode 配置中读取现有 agent 定义
 *   2. 检查 data/agents/ 目录是否为空
 *   3. 如果为空，将 OpenCode agent 配置导入为 JSON 文件
 *   4. 记录迁移结果日志
 *
 * 设计原则：
 *   - 仅在首次启动时执行一次（data/agents/ 为空时）
 *   - 不删除 OpenCode 配置（只读）
 *   - 保留现有 agent 数据
 *   - 清晰的日志输出
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { opencodeClient, type OpencodeAgentConfig } from '../../../opencode/client.js';
import { getResourceDir, ensureResourceDir } from '../paths.js';
import type { AgentConfig } from './types.js';

interface MigrationResult {
  success: boolean;
  migratedCount: number;
  skippedCount: number;
  errors: string[];
}

/**
 * 将 OpenCode agent 配置转换为新的 AgentConfig 格式
 */
function convertOpencodeAgentToAgentConfig(
  name: string,
  opencodeConfig: OpencodeAgentConfig,
  order: number
): AgentConfig {
  return {
    name,
    description: opencodeConfig.description,
    mode: opencodeConfig.mode,
    prompt: opencodeConfig.prompt,
    tools: opencodeConfig.tools,
    enabled: true, // 默认启用
    order,
  };
}

/**
 * 检查 agents 目录是否为空（或不存在）
 */
async function isAgentsDirectoryEmpty(): Promise<boolean> {
  const agentsDir = getResourceDir('agents', 'project');

  try {
    const files = await fs.readdir(agentsDir, { withFileTypes: true });
    // 检查是否有 .json 文件
    for (const ent of files) {
      if (ent.isFile() && ent.name.endsWith('.json')) {
        return false; // 有文件，非空
      }
    }
    return true; // 无 JSON 文件，视为空
  } catch {
    // 目录不存在，视为空
    return true;
  }
}

/**
 * 从 OpenCode 配置中读取 agent 定义
 */
async function fetchAgentsFromOpenCode(): Promise<Map<string, OpencodeAgentConfig>> {
  try {
    const config = await opencodeClient.getConfig();
    const agentMap = config.agent || {};

    const result = new Map<string, OpencodeAgentConfig>();
    for (const [name, agentConfig] of Object.entries(agentMap)) {
      if (agentConfig && typeof agentConfig === 'object') {
        result.set(name, agentConfig as OpencodeAgentConfig);
      }
    }

    return result;
  } catch (error) {
    console.error('[Migration] 从 OpenCode 读取 agent 配置失败:', error);
    return new Map();
  }
}

/**
 * 过滤内置 agent（不需要迁移的）
 */
function shouldMigrateAgent(name: string): boolean {
  // 跳过内置 agent
  const internalAgents = new Set([
    'build',
    'default',
    'plan',
    'general',
    'explore',
    'compaction',
    'title',
    'summary',
  ]);

  if (internalAgents.has(name)) {
    return false;
  }

  return true;
}

/**
 * 执行迁移
 */
export async function migrateAgentsFromOpenCode(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: true,
    migratedCount: 0,
    skippedCount: 0,
    errors: [],
  };

  try {
    // 1. 检查是否需要迁移
    const isEmpty = await isAgentsDirectoryEmpty();
    if (!isEmpty) {
      console.log('[Migration] data/agents/ 目录非空，跳过迁移');
      result.skippedCount = 0;
      return result;
    }

    console.log('[Migration] 开始从 OpenCode 迁移 agent 配置...');

    // 2. 从 OpenCode 读取配置
    const opencodeAgents = await fetchAgentsFromOpenCode();
    if (opencodeAgents.size === 0) {
      console.log('[Migration] OpenCode 中无 agent 配置，跳过迁移');
      return result;
    }

    console.log(`[Migration] 从 OpenCode 读取到 ${opencodeAgents.size} 个 agent 配置`);

    // 3. 确保 agents 目录存在
    await ensureResourceDir('agents', 'project');
    const agentsDir = getResourceDir('agents', 'project');

    // 4. 迁移符合条件的 agent
    let order = 100;
    for (const [name, opencodeConfig] of opencodeAgents.entries()) {
      if (!shouldMigrateAgent(name)) {
        console.log(`[Migration] 跳过内置 agent: ${name}`);
        result.skippedCount++;
        continue;
      }

      try {
        const agentConfig = convertOpencodeAgentToAgentConfig(name, opencodeConfig, order);
        const filePath = path.join(agentsDir, `${name}.json`);
        const content = JSON.stringify(agentConfig, null, 2);
        await fs.writeFile(filePath, content, 'utf-8');

        console.log(`[Migration] ✅ 已迁移 agent: ${name}`);
        result.migratedCount++;
        order += 10;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const errorMsg = `迁移 agent "${name}" 失败: ${msg}`;
        console.error(`[Migration] ❌ ${errorMsg}`);
        result.errors.push(errorMsg);
        result.success = false;
      }
    }

    // 5. 打印总结
    console.log(
      `[Migration] 迁移完成: 成功 ${result.migratedCount} 个, 跳过 ${result.skippedCount} 个, 失败 ${result.errors.length} 个`
    );

    if (result.errors.length > 0) {
      console.error('[Migration] 迁移错误详情:');
      for (const error of result.errors) {
        console.error(`  - ${error}`);
      }
    }

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const errorMsg = `迁移过程出错: ${msg}`;
    console.error(`[Migration] ❌ ${errorMsg}`);
    result.errors.push(errorMsg);
    result.success = false;
    return result;
  }
}
