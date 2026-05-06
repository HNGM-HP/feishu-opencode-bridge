/**
 * MCP Server Prompts 协议映射为 Slash 命令
 *
 * 职责：
 *   1. 读取 enabled MCP servers 的 prompts 协议（通过 opencode client）
 *   2. 将每个 prompt 映射成 `/mcp:<server>:<prompt>` 格式的 slash 命令
 *   3. 提供 `listSlashCommands()` 函数供 chat-meta.ts 调用
 *
 * 设计说明：
 *   - MCP prompts 是 MCP 协议的一部分，需要通过 opencode client 获取
 *   - 由于 prompts 内容可能较多，这里只返回命令列表，不包含 prompt 详细内容
 *   - 命令格式：`/mcp:<server-name>:<prompt-name>`
 */

import type { OpencodeCommandInfo } from '../../../opencode/client.js';
import { opencodeClient } from '../../../opencode/client.js';

/** MCP Slash 命令项 */
export interface MCPSlashCommand {
  /** 命令名称（格式：/mcp:<server>:<prompt>） */
  name: string;
  /** MCP 服务器名称 */
  server: string;
  /** Prompt 名称 */
  prompt: string;
  /** 描述（可选） */
  description?: string;
  /** 参数提示（可选） */
  args?: string[];
}

/**
 * 从 opencode client 获取 MCP prompts 并映射为 slash 命令
 *
 * @param opencodeCommands - 从 opencode client 获取的命令列表（包含 mcp 类型的命令）
 * @returns MCP slash 命令列表
 */
export function mapMCPCommandsToSlash(
  opencodeCommands: OpencodeCommandInfo[]
): MCPSlashCommand[] {
  const result: MCPSlashCommand[] = [];

  for (const cmd of opencodeCommands) {
    // 检查是否为 MCP 命令（source === 'mcp'）
    if (cmd.source !== 'mcp') {
      continue;
    }

    // opencode 返回的 MCP 命令格式可能是 `/mcp:<server>:<prompt>`
    // 我们需要解析出 server 和 prompt 名称
    const match = cmd.name.match(/^\/?mcp:([^:]+):(.+)$/);
    if (!match) {
      continue;
    }

    const [, server, prompt] = match;

    result.push({
      name: cmd.name.startsWith('/') ? cmd.name : `/${cmd.name}`,
      server,
      prompt,
      description: cmd.description,
      args: cmd.hints,
    });
  }

  return result;
}

/**
 * 列出所有 MCP slash 命令
 *
 * 实现步骤：
 *   1. 调用 opencodeClient.getCommands() 获取所有命令（包括 MCP prompts）
 *   2. 过滤出 source === 'mcp' 的命令
 *   3. 将这些命令映射为 MCPSlashCommand 格式
 *
 * 注意：
 *   - 此函数需要在 opencode client 可用后调用
 *   - opencode client 会自动从启用的 MCP servers 获取 prompts
 *   - 返回的命令格式为 /mcp:<server>:<prompt>
 *
 * @returns MCP slash 命令列表
 */
export async function listSlashCommands(): Promise<MCPSlashCommand[]> {
  try {
    // 从 opencode client 获取所有命令
    const commands = await opencodeClient.getCommands();

    // 过滤并映射 MCP 命令
    return mapMCPCommandsToSlash(commands);
  } catch (error) {
    console.error('[MCP Slash] 获取命令列表失败:', error);
    // 失败时返回空数组
    return [];
  }
}

/**
 * 为 chat-meta.ts 提供的命令格式化函数
 *
 * 将 MCP slash 命令转换为 OpencodeCommandInfo 格式
 *
 * @param commands - MCP slash 命令列表
 * @returns OpencodeCommandInfo 格式的命令列表
 */
export function toCommandItems(commands: MCPSlashCommand[]): Array<{
  name: string;
  description?: string;
  source: 'mcp';
  template: string;
  hints: string[];
}> {
  return commands.map(cmd => ({
    name: cmd.name,
    description: cmd.description,
    source: 'mcp' as const,
    template: cmd.name,
    hints: cmd.args || [],
  }));
}
