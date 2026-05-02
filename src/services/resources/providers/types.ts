/**
 * Provider 配置类型定义
 *
 * 管理模型供应商的 API Key 配置：
 *   - 读写 ~/.local/share/opencode/auth.json（仅 type=api 的增删改，OAuth 只读）
 *   - 缓存 opencode models 命令输出（按 provider 分组）
 *   - 提供列表、获取、设置、删除 API Key 的功能
 */

import path from 'node:path';
import os from 'node:os';

/** Provider 认证类型 */
export type ProviderAuthType = 'api' | 'oauth';

/** API 类型 Provider 配置（可读写） */
export interface ApiProviderConfig {
  type: 'api';
  key: string;
  [key: string]: unknown; // 允许未知字段
}

/** OAuth 类型 Provider 配置（只读） */
export interface OAuthProviderConfig {
  type: 'oauth';
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  [key: string]: unknown; // 允许未知字段
}

/** Provider 配置联合类型 */
export type ProviderConfig = ApiProviderConfig | OAuthProviderConfig;

/** Provider 信息摘要 */
export interface ProviderSummary {
  providerId: string;
  type: ProviderAuthType;
  /** 是否已配置（type=api 有 key，type=oauth 有 access token） */
  configured: boolean;
  /** 是否可编辑（仅 type=api 可编辑） */
  editable: boolean;
  /** 供应商显示名称（从 opename 映射，可选） */
  displayName?: string;
}

/** 模型信息 */
export interface ModelInfo {
  providerId: string;
  modelId: string;
  /** 完整模型标识符（provider/model） */
  fullName: string;
}

/** 模型缓存（按 provider 分组） */
export type ModelsCache = Map<string, string[]>;

/** OpenCode auth.json 文件内容 */
export type OpenCodeAuthConfig = Record<string, ProviderConfig>;

/**
 * 解析 ~/.local/share/opencode/auth.json 路径
 * 可通过环境变量 OPENCODE_AUTH_PATH 覆盖（用于测试）
 */
export function getOpenCodeAuthPath(): string {
  const fromEnv = process.env.OPENCODE_AUTH_PATH?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  const homeDir = os.homedir();
  return path.join(homeDir, '.local', 'share', 'opencode', 'auth.json');
}

/**
 * 常见 Provider ID 到显示名称的映射
 */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'google': 'Google',
  'custom-gemini': 'Custom Gemini',
  'nvidia': 'NVIDIA',
  'deepseek': 'DeepSeek',
  'zhipuai': '智谱 AI',
  'minimax': 'MiniMax',
  'moonshot': 'Moonshot',
  'antigravity': 'Antigravity',
};

/**
 * 内置 Provider 列表（opencode 原生支持的供应商）
 * 这些供应商可以通过 opencode providers login 进行 OAuth 登录
 */
export const BUILTIN_PROVIDERS: string[] = [
  'openai',
  'anthropic',
  'google',
  'nvidia',
  'deepseek',
];

/**
 * 判断 provider 是否可编辑（仅 type=api 可编辑）
 */
export function isProviderEditable(config: ProviderConfig): boolean {
  return config.type === 'api';
}
