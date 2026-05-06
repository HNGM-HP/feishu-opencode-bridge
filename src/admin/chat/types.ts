/**
 * ChatEvent 协议（前后端契约）
 *
 * 后端把 OpenCode 的复杂 Part / Event 协议归一化成简单线性事件流，
 * 前端只消费这一种协议，不用管 OpenCode 的内部结构。
 *
 * 见 plan-v2.md 第三节。
 */

export interface ChatTokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost?: number;
}

export interface ChatTodoItem {
  id: string;
  content: string;
  status: string;
  priority?: string;
}

export interface ChatMessageMeta {
  id: string;
  role: 'user' | 'assistant';
  createdAt: number;
  parentId?: string;
  model?: { providerId: string; modelId: string };
  agent?: string;
}

export interface ChatPermissionRequest {
  id: string;
  sessionId: string;
  tool: string;
  description: string;
  risk?: string;
  messageId?: string;
  callId?: string;
  metadata?: Record<string, unknown>;
}

export type ChatEvent =
  | { type: 'message_start'; msg: ChatMessageMeta }
  | { type: 'text_delta'; msgId: string; text: string }
  | { type: 'reasoning_delta'; msgId: string; text: string }
  | {
      type: 'tool_start';
      msgId: string;
      tool: { id: string; callId: string; name: string; input: unknown; title?: string };
    }
  | { type: 'tool_delta'; msgId: string; toolId: string; output: string }
  | {
      type: 'tool_end';
      msgId: string;
      toolId: string;
      callId: string;
      name: string;
      result: string;
      isError: boolean;
      title?: string;
      durationMs?: number;
    }
  | { type: 'message_end'; msgId: string; usage?: ChatTokenUsage; finish?: string; error?: string }
  | { type: 'permission_ask'; req: ChatPermissionRequest }
  | { type: 'permission_resolved'; reqId: string; decision: 'allow' | 'reject' | 'always' }
  | { type: 'task_update'; todos: ChatTodoItem[] }
  | { type: 'session_idle'; sessionId: string }
  | { type: 'session_status'; sessionId: string; status: string }
  | { type: 'error'; message: string }
  | { type: 'keepalive' };

export type ChatEventType = ChatEvent['type'];

/** 带 sessionId 定位的事件（bus 内部使用） */
export type AddressedChatEvent = {
  sessionId: string;
  event: ChatEvent;
  /** 单调递增序号，用于客户端断线重连时做 replay */
  seq: number;
  /** 事件归一化时间戳（毫秒） */
  timestamp: number;
};
