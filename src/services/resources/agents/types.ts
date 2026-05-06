/**
 * Agent 配置类型定义
 *
 * 存储格式：
 *   data/agents/<name>.json      单个 agent 配置
 *
 * 与 OpenCode OpencodeAgentConfig 对齐，支持独立文件存储便于热载与版本控制。
 */

/** Agent 模式 */
export type AgentMode = 'primary' | 'subagent' | 'all';

/** 基础配置（所有字段可选，与 OpenCode 兼容） */
export interface AgentConfig {
  /** 唯一标识符（必须与文件名 <name>.json 一致） */
  name: string;
  /** 人类可读描述 */
  description?: string;
  /** Agent 模式：primary=主模型独立思考，subagent=子代理受限工具，all=两者混合 */
  mode?: AgentMode;
  /** 系统提示词（可选，覆盖默认行为） */
  prompt?: string;
  /** 工具权限映射（工具名 -> 是否启用） */
  tools?: Record<string, boolean>;
  /** 是否启用（本地管理字段，OpenCode 无此字段） */
  enabled: boolean;
  /** 显示顺序（数值越小越靠前，仅用于 UI 排序） */
  order: number;
  /** 模型配置（可选，指定使用的模型） */
  model?: {
    provider?: string;
    model?: string;
  };
}

/** 公开的 agent 摘要（list 用） */
export interface AgentSummary {
  name: string;
  scope: 'project' | 'user';
  description?: string;
  mode?: AgentMode;
  enabled: boolean;
  order: number;
  /** 配置是否有效（JSON 格式、必填字段） */
  valid: boolean;
  /** 解析错误信息（valid=false 时有值） */
  error?: string;
  /** 被同名项目级 agent 遮蔽时为 true（仅 user 层条目可能为 true） */
  shadowed: boolean;
}

/** 加载结果（内部使用） */
export type AgentRecord =
  | { kind: 'ok'; config: AgentConfig; scope: 'project' | 'user' }
  | { kind: 'error'; error: string; scope: 'project' | 'user' };

/** 创建/更新时的输入（不需要 name，从路径推导；order 可选） */
export type AgentInput = Omit<AgentConfig, 'name' | 'order'> & {
  order?: number;
};

/** 热载变更事件类型 */
export type AgentChangeEvent =
  | { type: 'add'; name: string; scope: 'project' | 'user' }
  | { type: 'update'; name: string; scope: 'project' | 'user' }
  | { type: 'delete'; name: string; scope: 'project' | 'user' }
  | { type: 'reload'; reason: 'dir-scan' };

/** 工具权限默认值（默认启用的工具列表） */
export const DEFAULT_ENABLED_TOOLS = [
  'read',
  'write',
  'edit',
  'bash',
  'list',
  'glob',
  'grep',
] as const;

/** 所有支持的工具名称 */
export const SUPPORTED_TOOLS = [
  'bash',
  'read',
  'write',
  'edit',
  'list',
  'glob',
  'grep',
  'webfetch',
  'task',
  'todowrite',
  'todoread',
] as const;
