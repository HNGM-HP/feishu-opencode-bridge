/**
 * 资源系统共享类型定义
 *
 * 资源（Resource）= Skill / MCP Server / Agent / Provider 之统称。
 * 每种资源都遵循“项目级（./data/...）优先、用户级（~/.opencode-bridge/...）兜底”的两层覆盖语义。
 */

/** 资源种类。 */
export type ResourceKind = 'skill' | 'mcp' | 'agents' | 'provider';

/** 配置作用域。project = 项目级（./data/）；user = 用户级（~/.opencode-bridge/）。 */
export type ResourceScope = 'project' | 'user';

/** 资源加载/运行状态。 */
export type ResourceStatus =
  | 'loaded'      // 解析成功且启用
  | 'disabled'    // 解析成功但被显式禁用
  | 'error'       // 解析失败
  | 'unloaded';   // 尚未尝试加载

/** 资源公共元信息（所有 kind 共用的字段集合）。 */
export interface ResourceMeta {
  kind: ResourceKind;
  name: string;
  scope: ResourceScope;
  status: ResourceStatus;
  description?: string;
  /** 最近一次成功加载/写入时间（ISO 字符串）。 */
  lastReloadAt?: string;
  /** 解析失败时的错误信息。 */
  error?: string;
}

/** 资源变更事件载荷。 */
export interface ResourceChangeEvent {
  kind: ResourceKind;
  /** 受影响资源名；批量重载时可能为 null。 */
  name: string | null;
  /** add | update | remove | reload。 */
  action: 'add' | 'update' | 'remove' | 'reload';
  scope?: ResourceScope;
  /** 触发时间（毫秒时间戳）。 */
  at: number;
}
