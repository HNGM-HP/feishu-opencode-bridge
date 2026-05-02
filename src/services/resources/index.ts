/**
 * 资源系统启动入口
 *
 * 由 admin-server 在启动时调用 initResourceSystem()，完成：
 *   1. 确保 ./data/{skills,mcp,agents,providers} 目录存在
 *   2. 初始化各 manager 的内存缓存（懒加载，首次请求时再扫盘）
 *   3. 启动 chokidar 文件监听（在后续 step 中由各 manager 自行启动）
 *   4. 执行 agent 迁移（如果 data/agents/ 为空）
 *
 * 当前 step 1 仅完成目录骨架与公共导出。Skill/MCP/Agent/Provider manager
 * 在后续 step 中按序接入 init()/dispose()。
 */

import { ensureAllProjectDirs, getProjectDataRoot, getUserDataRoot } from './paths.js';
import { skillRegistry } from './skills/registry.js';
import { getMCPRegistry } from './mcp/manager.js';
import { getAgentRegistry } from './agents/manager.js';
import { getProviderRegistry } from './providers/manager.js';
import { migrateAgentsFromOpenCode } from './agents/migration.js';

export * from './types.js';
export * from './paths.js';
export * from './events.js';
export { skillRegistry } from './skills/registry.js';
export { getMCPRegistry } from './mcp/manager.js';
export { getAgentRegistry } from './agents/manager.js';
export { getProviderRegistry } from './providers/manager.js';
export type { SkillSummary, SkillSlashCommand } from './skills/registry.js';
export type { ParsedSkill, SkillFrontmatter } from './skills/loader.js';
export type { MCPServerConfig, MCPServerSummary, MCPInput } from './mcp/types.js';
export type { AgentConfig, AgentSummary, AgentInput } from './agents/types.js';
export type { ProviderConfig, ProviderSummary, ModelInfo } from './providers/types.js';

let initialized = false;

/** 启动资源系统。多次调用安全（幂等）。 */
export async function initResourceSystem(): Promise<void> {
  if (initialized) return;
  initialized = true;

  ensureAllProjectDirs();

  // 仅打印一次启动横幅，便于排查
  // 用 console 而非 logger 是因为本模块在多种入口（admin/cli/test）下都会被加载
  // eslint-disable-next-line no-console
  console.log(
    `[Resources] 资源系统已就绪 project=${getProjectDataRoot()} user=${getUserDataRoot()}`,
  );

  await skillRegistry.init();
  await getMCPRegistry().init();
  await getAgentRegistry().init();

  // Agent 迁移：在 agent registry 初始化后执行
  // 仅在 data/agents/ 为空时执行一次
  // eslint-disable-next-line no-console
  console.log('[Resources] 检查 agent 迁移...');
  const migrationResult = await migrateAgentsFromOpenCode();
  if (migrationResult.migratedCount > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[Resources] Agent 迁移完成: 成功 ${migrationResult.migratedCount} 个, 跳过 ${migrationResult.skippedCount} 个`
    );
  }

  // Provider manager 在后台初始化，不阻塞启动
  getProviderRegistry().init().catch((err) => {
    console.error('[Resources] Provider manager 初始化失败:', err);
  });
}

/** 关闭资源系统（关闭 chokidar 监听等）。多次调用安全。 */
export async function disposeResourceSystem(): Promise<void> {
  if (!initialized) return;
  initialized = false;
  await skillRegistry.dispose();
  await getMCPRegistry().dispose();
  await getAgentRegistry().dispose();
  await getProviderRegistry().dispose();
}

export function isResourceSystemInitialized(): boolean {
  return initialized;
}
