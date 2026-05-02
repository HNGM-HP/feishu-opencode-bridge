/**
 * Agent 配置映射为 Slash 命令
 *
 * 职责：
 *   1. 读取 enabled agents
 *   2. 将每个 agent 映射成 `/agent:<name>` 格式的 slash 命令
 *   3. 提供 `listSlashCommands()` 方法供 chat-meta.ts 调用
 *
 * 设计说明：
 *   - Agent 命令格式：`/agent:<name>`
 *   - 只返回 enabled 的 agents
 *   - 与 opencode 的 agent 概念对齐
 */

import { getAgentRegistry } from './manager.js';
import type { AgentSummary } from './types.js';

/** Agent Slash 命令项 */
export interface AgentSlashCommand {
  /** 命令名称（格式：/agent:<name>） */
  name: string;
  /** Agent 名称 */
  agent: string;
  /** 描述（可选） */
  description?: string;
}

/**
 * 列出所有 Agent slash 命令
 *
 * @returns Agent slash 命令列表
 */
export function listSlashCommands(): AgentSlashCommand[] {
  const registry = getAgentRegistry();
  const agents = registry.list();

  // 只返回 enabled 的 agents
  const enabledAgents = agents.filter(a => a.enabled && a.valid);

  return enabledAgents.map(agent => ({
    name: `/agent:${agent.name}`,
    agent: agent.name,
    description: agent.description,
  }));
}

/**
 * 为 chat-meta.ts 提供的命令格式化函数
 *
 * 将 Agent slash 命令转换为 OpencodeCommandInfo 格式
 *
 * @param commands - Agent slash 命令列表
 * @returns OpencodeCommandInfo 格式的命令列表
 */
export function toCommandItems(commands: AgentSlashCommand[]): Array<{
  name: string;
  description?: string;
  source: 'agent';
  template: string;
  hints: string[];
}> {
  return commands.map(cmd => ({
    name: cmd.name,
    description: cmd.description,
    source: 'agent' as const,
    template: cmd.name,
    hints: [],
  }));
}
