/**
 * MCP Server 配置类型定义
 *
 * 存储格式：
 *   data/mcp/<name>.json      单个 server 配置
 *   data/mcp/_index.json      启用列表 + 顺序
 */

/** MCP 传输协议类型 */
export type MCPTransport = 'stdio' | 'sse' | 'http';

/** 基础配置（所有 transport 共有） */
export interface MCPServerConfigBase {
  /** 唯一标识符（必须与文件名 <name>.json 一致） */
  name: string;
  /** 人类可读描述 */
  description?: string;
  /** 是否启用 */
  enabled: boolean;
  /** 显示顺序（数值越小越靠前，仅用于 UI 排序） */
  order: number;
  /** 传输协议 */
  transport: MCPTransport;
}

/** stdio 传输配置 */
export interface MCPStdioConfig extends MCPServerConfigBase {
  transport: 'stdio';
  /** 启动命令（如 'npx', 'node', '/path/to/server'） */
  command: string;
  /** 命令参数数组 */
  args?: string[];
  /** 工作目录（可选，默认当前目录） */
  cwd?: string;
  /** 环境变量（可选，key-value 对） */
  env?: Record<string, string>;
}

/** sse 传输配置 */
export interface MCPSSEConfig extends MCPServerConfigBase {
  transport: 'sse';
  /** SSE 端点 URL */
  url: string;
  /** 可选的请求头（如 Authorization） */
  headers?: Record<string, string>;
}

/** http 传输配置 */
export interface MCPHTTPConfig extends MCPServerConfigBase {
  transport: 'http';
  /** HTTP 端点 URL */
  url: string;
  /** 可选的请求头 */
  headers?: Record<string, string>;
}

/** 联合类型：任一 transport 的完整配置 */
export type MCPServerConfig = MCPStdioConfig | MCPSSEConfig | MCPHTTPConfig;

/** 索引中单个 server 的元数据 */
export interface MCPIndexEntry {
  /** server 名称 */
  name: string;
  /** 显示顺序（数值越小越靠前） */
  order: number;
  /** 最后更新时间（ISO 8601 字符串） */
  updatedAt: string;
}

/** 旧版索引格式（向后兼容） */
export interface LegacyMCPIndexContent {
  /** 启用的 server 名称列表（按显示顺序） */
  enabled: string[];
  /** 禁用的 server 名称列表（按显示顺序，可选） */
  disabled?: string[];
}

/** _index.json 索引文件内容（新格式） */
export interface MCPIndexContent {
  /** 启用的 server 列表（含顺序和更新时间） */
  enabled: MCPIndexEntry[];
  /** 禁用的 server 列表（含顺序和更新时间，可选） */
  disabled?: MCPIndexEntry[];
}

/** 公开的 server 摘要（list 用） */
export interface MCPServerSummary {
  name: string;
  scope: 'project' | 'user';
  transport: MCPTransport;
  description?: string;
  enabled: boolean;
  order: number;
  /** 配置是否有效（JSON 格式、必填字段） */
  valid: boolean;
  /** 解析错误信息（valid=false 时有值） */
  error?: string;
  /** 被同名项目级 server 遮蔽时为 true（仅 user 层条目可能为 true） */
  shadowed: boolean;
}

/** 加载结果（内部使用） */
export type MCPServerRecord =
  | { kind: 'ok'; config: MCPServerConfig; scope: 'project' | 'user' }
  | { kind: 'error'; error: string; scope: 'project' | 'user' };

/** 创建/更新时的输入（不需要 name，从路径推导；order 可选） */
export type MCPInput = Omit<MCPServerConfig, 'name' | 'order'> & {
  order?: number;
};

/** 热载变更事件类型 */
export type MCPChangeEvent =
  | { type: 'add'; name: string; scope: 'project' | 'user' }
  | { type: 'update'; name: string; scope: 'project' | 'user' }
  | { type: 'delete'; name: string; scope: 'project' | 'user' }
  | { type: 'reload'; reason: 'index-changed' | 'dir-scan' };
