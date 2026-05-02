/**
 * 资源变更事件总线
 *
 * 所有 manager（skill/mcp/agent/provider）在增删改或热载完成后调用 emitResourceChange()。
 * 订阅方：
 *   1. /api/resources/events 的 SSE 端点（推送给 Web 前端，触发 slash cache 失效与列表刷新）
 *   2. src/admin/routes/chat-meta.ts 的 listCommands 缓存层
 *   3. opencode 配置桥（MCP 变更时重启 opencode 端 mcp client）—— 后续 step 接入
 *
 * 设计原则：
 *   - 单进程内的轻量 EventEmitter；不持久化、不跨进程。跨进程同步靠 SSE。
 *   - 事件聚合：高频写入（如批量编辑）用 200ms 去抖合并成一次 reload，由各 manager 自行控制。
 */

import { EventEmitter } from 'node:events';
import type { ResourceChangeEvent, ResourceKind, ResourceScope } from './types.js';

const emitter = new EventEmitter();
emitter.setMaxListeners(64);

const EVENT = 'resource:changed';

/** 订阅资源变更事件。返回一个取消函数。 */
export function onResourceChange(
  listener: (event: ResourceChangeEvent) => void,
): () => void {
  emitter.on(EVENT, listener);
  return () => emitter.off(EVENT, listener);
}

/** 发布一次资源变更事件。 */
export function emitResourceChange(
  kind: ResourceKind,
  action: ResourceChangeEvent['action'],
  options: { name?: string | null; scope?: ResourceScope } = {},
): void {
  const event: ResourceChangeEvent = {
    kind,
    action,
    name: options.name ?? null,
    scope: options.scope,
    at: Date.now(),
  };
  emitter.emit(EVENT, event);
}

/** 测试与拆卸：移除全部监听器。 */
export function clearResourceListeners(): void {
  emitter.removeAllListeners(EVENT);
}
