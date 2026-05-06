/**
 * event-normalizer.ts — 把 opencodeClient 的事件映射成干净的 ChatEvent 流
 *
 * 输入：opencodeClient EventEmitter 发出的事件
 *   - permissionRequest
 *   - messageUpdated  (Message info)
 *   - messagePartUpdated  (Part, optional delta)
 *   - sessionIdle / sessionError / sessionStatus
 *   - questionAsked
 *
 * 输出：按 sessionId 发布到 ChatEventBus 的 ChatEvent
 *
 * 见 plan-v2.md 第三节事件协议、第四节架构说明。
 */

import type { Message, Part } from '@opencode-ai/sdk';
import { opencodeClient } from '../../opencode/client.js';
import { chatEventBus, type ChatEventBus } from './event-bus.js';
import type { ChatEvent, ChatTodoItem, ChatTokenUsage } from './types.js';

// ── OpenCode 内部事件 payload 形状（与 client.ts handleEvent 对齐）

interface MessagePartUpdatedPayload {
  part: Part;
  delta?: string;
}

interface PermissionRequestPayload {
  sessionId: string;
  permissionId: string;
  tool: string;
  description: string;
  risk?: string;
  messageId?: string;
  callId?: string;
}

interface SessionIdlePayload {
  sessionID?: string;
}

interface SessionErrorPayload {
  sessionID?: string;
  error?: { name?: string; data?: { message?: string } };
}

interface SessionStatusPayload {
  sessionID?: string;
  status?: { type?: string };
}

// ── 辅助工具

function clampString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function toTokenUsage(info: Message): ChatTokenUsage | undefined {
  if (info.role !== 'assistant') return undefined;
  const t = info.tokens;
  if (!t) return undefined;
  return {
    input: t.input ?? 0,
    output: t.output ?? 0,
    reasoning: t.reasoning ?? 0,
    cacheRead: t.cache?.read ?? 0,
    cacheWrite: t.cache?.write ?? 0,
    cost: info.cost,
  };
}

function toMessageMeta(info: Message): Extract<ChatEvent, { type: 'message_start' }>['msg'] {
  return {
    id: info.id,
    role: info.role,
    createdAt: (info.time?.created ?? Math.floor(Date.now() / 1000)) * 1000,
    ...(info.role === 'assistant' && info.parentID ? { parentId: info.parentID } : {}),
    ...(info.role === 'user' && info.model?.providerID && info.model?.modelID
      ? {
          model: {
            providerId: info.model.providerID,
            modelId: info.model.modelID,
          },
        }
      : {}),
    ...(info.role === 'assistant' && info.providerID && info.modelID
      ? {
          model: {
            providerId: info.providerID,
            modelId: info.modelID,
          },
        }
      : {}),
    ...(info.role === 'assistant' && info.mode ? { agent: info.mode } : {}),
    ...(info.role === 'user' && info.agent ? { agent: info.agent } : {}),
  };
}

function toTodos(raw: unknown): ChatTodoItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ChatTodoItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = clampString(r.id);
    const content = clampString(r.content ?? r.title ?? r.text);
    const status = clampString(r.status ?? 'pending');
    if (!id || !content) continue;
    out.push({
      id,
      content,
      status,
      priority: typeof r.priority === 'string' ? r.priority : undefined,
    });
  }
  return out.length > 0 ? out : undefined;
}

function diffText(prev: string, next: string): string {
  if (!prev) return next;
  if (next.startsWith(prev)) return next.slice(prev.length);
  // 内容被重写，回退为全量
  return next;
}

// ── 单个 session 的归一化状态

interface MessageState {
  msgId: string;
  role?: 'user' | 'assistant';
  started: boolean;
  finishedEmitted: boolean;
  textByPartId: Map<string, string>;
  reasoningByPartId: Map<string, string>;
  toolStarted: Set<string>; // callID 集合
  pendingParts: Map<string, MessagePartUpdatedPayload>;
}

interface SessionState {
  messages: Map<string, MessageState>;
  lastActivity: number;
}

// ── 归一化器

/** 会话状态过期时间（5 分钟无新事件则清理） */
const SESSION_STATE_TTL_MS = 5 * 60 * 1000;
/** 清理检查间隔（2 分钟） */
const CLEANUP_INTERVAL_MS = 2 * 60 * 1000;

export class ChatEventNormalizer {
  private readonly bus: ChatEventBus;
  private readonly sessionStates = new Map<string, SessionState>();
  private installed = false;
  private readonly handlers: Array<{ event: string; fn: (payload: any) => void }> = [];
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(bus: ChatEventBus = chatEventBus) {
    this.bus = bus;
  }

  /** 挂接到 opencodeClient 事件源 */
  install(): void {
    if (this.installed) return;
    this.installed = true;

    const bind = <T>(event: string, fn: (payload: T) => void): void => {
      const wrapped = (payload: T) => {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[ChatEventNormalizer] 处理 ${event} 异常:`, err);
        }
      };
      opencodeClient.on(event, wrapped);
      this.handlers.push({ event, fn: wrapped });
    };

    bind<{ info: Message }>('messageUpdated', p => this.onMessageUpdated(p?.info));
    bind<MessagePartUpdatedPayload>('messagePartUpdated', p => this.onPartUpdated(p));
    bind<SessionIdlePayload>('sessionIdle', p => this.onSessionIdle(p));
    bind<SessionErrorPayload>('sessionError', p => this.onSessionError(p));
    bind<SessionStatusPayload>('sessionStatus', p => this.onSessionStatus(p));
    bind<PermissionRequestPayload>('permissionRequest', p => this.onPermissionRequest(p));

    // Periodic cleanup of stale session states
    this.cleanupTimer = setInterval(() => this.cleanupStaleSessions(), CLEANUP_INTERVAL_MS);
  }

  /** 从事件源解绑（测试或热重载时用） */
  uninstall(): void {
    if (!this.installed) return;
    for (const h of this.handlers) {
      opencodeClient.off(h.event, h.fn as (...args: unknown[]) => void);
    }
    this.handlers.length = 0;
    this.installed = false;
    this.sessionStates.clear();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ── 内部：状态管理

  private getSessionState(sessionId: string): SessionState {
    let s = this.sessionStates.get(sessionId);
    if (!s) {
      s = { messages: new Map(), lastActivity: Date.now() };
      this.sessionStates.set(sessionId, s);
    }
    s.lastActivity = Date.now();
    return s;
  }

  private getMessageState(sessionId: string, msgId: string): MessageState {
    const s = this.getSessionState(sessionId);
    let m = s.messages.get(msgId);
    if (!m) {
      m = {
        msgId,
        role: undefined,
        started: false,
        finishedEmitted: false,
        textByPartId: new Map(),
        reasoningByPartId: new Map(),
        toolStarted: new Set(),
        pendingParts: new Map(),
      };
      s.messages.set(msgId, m);
    }
    return m;
  }

  private publish(sessionId: string, evt: ChatEvent): void {
    this.bus.publish(sessionId, evt);
  }

  // ── 事件处理

  private onMessageUpdated(info: Message | undefined): void {
    if (!info) return;
    const sessionId = info.sessionID;
    const msgId = info.id;
    if (!sessionId || !msgId) return;

    const state = this.getMessageState(sessionId, msgId);
    state.role = info.role;

    // 首次见到消息 → message_start
    if (!state.started) {
      state.started = true;
      this.publish(sessionId, {
        type: 'message_start',
        msg: toMessageMeta(info),
      });
    }

    if (info.role === 'assistant' && state.pendingParts.size > 0) {
      const pendingParts = Array.from(state.pendingParts.values());
      state.pendingParts.clear();
      for (const pending of pendingParts) {
        this.processAssistantPartUpdate(sessionId, state, pending);
      }
    } else if (info.role === 'user' && state.pendingParts.size > 0) {
      state.pendingParts.clear();
    }

    // 完成 → message_end
    if (info.role === 'assistant' && !state.finishedEmitted && info.time?.completed) {
      state.finishedEmitted = true;
      const errMsg = info.error?.data && typeof (info.error.data as { message?: string }).message === 'string'
        ? (info.error.data as { message?: string }).message
        : undefined;
      this.publish(sessionId, {
        type: 'message_end',
        msgId,
        usage: toTokenUsage(info),
        finish: info.finish,
        error: errMsg,
      });
    }
  }

  private onPartUpdated(payload: MessagePartUpdatedPayload | undefined): void {
    if (!payload?.part) return;
    const part = payload.part;
    const sessionId = part.sessionID;
    const msgId = part.messageID;
    if (!sessionId || !msgId) return;

    const state = this.getMessageState(sessionId, msgId);
    if (state.role === 'user') {
      return;
    }

    if (state.role !== 'assistant') {
      state.pendingParts.set(part.id, payload);
      return;
    }

    this.processAssistantPartUpdate(sessionId, state, payload);
  }

  private processAssistantPartUpdate(
    sessionId: string,
    state: MessageState,
    payload: MessagePartUpdatedPayload
  ): void {
    const part = payload.part;
    const msgId = part.messageID;
    if (!msgId) return;
    switch (part.type) {
      case 'text': {
        // 优先用 OpenCode 提供的 delta；缺失时自行 diff
        const prev = state.textByPartId.get(part.id) ?? '';
        const deltaText = typeof payload.delta === 'string' && payload.delta.length > 0
          ? payload.delta
          : diffText(prev, part.text ?? '');
        state.textByPartId.set(part.id, part.text ?? '');
        if (deltaText.length > 0) {
          this.publish(sessionId, { type: 'text_delta', msgId, text: deltaText });
        }
        break;
      }

      case 'reasoning': {
        const prev = state.reasoningByPartId.get(part.id) ?? '';
        const deltaText = typeof payload.delta === 'string' && payload.delta.length > 0
          ? payload.delta
          : diffText(prev, part.text ?? '');
        state.reasoningByPartId.set(part.id, part.text ?? '');
        if (deltaText.length > 0) {
          this.publish(sessionId, { type: 'reasoning_delta', msgId, text: deltaText });
        }
        break;
      }

      case 'tool': {
        const callId = part.callID;
        const toolName = part.tool;
        const st = part.state;

        // 首次 → tool_start
        if (!state.toolStarted.has(callId)) {
          state.toolStarted.add(callId);
          const input = st && (st.status === 'pending' || st.status === 'running' || st.status === 'completed' || st.status === 'error')
            ? st.input
            : undefined;
          const title = st && st.status === 'running' ? st.title : undefined;
          this.publish(sessionId, {
            type: 'tool_start',
            msgId,
            tool: { id: part.id, callId, name: toolName, input, title },
          });
        }

        // TodoWrite 的 todos 在 running 阶段就已经写在 state.input.todos 里了。
        // 只在 completed 时再 emit task_update 会导致看板"等执行完才出现"，
        // 体感上像没显示任务。这里只要任意状态拿得到 todos 数组就立刻广播，
        // 同状态下重复的快照在前端会被覆盖式替换，无副作用。
        if (isTodoWriteTool(toolName) && st && st.status !== 'pending') {
          const stateRecord = st as unknown as Record<string, unknown>;
          const liveInput = stateRecord.input;
          const liveMetadata = stateRecord.metadata && typeof stateRecord.metadata === 'object'
            ? stateRecord.metadata as Record<string, unknown>
            : undefined;
          const todos = extractTodosFromTodoWrite(liveInput, liveMetadata);
          if (todos) this.publish(sessionId, { type: 'task_update', todos });
        }

        // 完成 / 错误 → tool_end
        if (st?.status === 'completed') {
          const title = st.title;
          const output = typeof st.output === 'string' ? st.output : '';
          this.publish(sessionId, {
            type: 'tool_end',
            msgId,
            toolId: part.id,
            callId,
            name: toolName,
            result: output,
            isError: false,
            title,
            durationMs: st.time?.end && st.time?.start ? st.time.end - st.time.start : undefined,
          });
        } else if (st?.status === 'error') {
          this.publish(sessionId, {
            type: 'tool_end',
            msgId,
            toolId: part.id,
            callId,
            name: toolName,
            result: st.error ?? 'tool error',
            isError: true,
            durationMs: st.time?.end && st.time?.start ? st.time.end - st.time.start : undefined,
          });
        }
        break;
      }

      case 'step-finish': {
        // step-finish 不直接映射，message 完成会有独立 message_end
        break;
      }

      default:
        // 其它 Part 类型（file / step-start / snapshot / patch / agent / retry / compaction）
        // 目前前端渲染器不需要，忽略。后续需要时再扩展。
        break;
    }
  }

  private onSessionIdle(payload: SessionIdlePayload | undefined): void {
    const sessionId = payload?.sessionID;
    if (!sessionId) return;
    this.publish(sessionId, { type: 'session_idle', sessionId });
    // Session is idle — clear its message state (will be rebuilt if it resumes)
    this.sessionStates.delete(sessionId);
  }

  /** Remove session states that haven't received events for SESSION_STATE_TTL_MS */
  private cleanupStaleSessions(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [sessionId, state] of this.sessionStates) {
      if (now - state.lastActivity > SESSION_STATE_TTL_MS) {
        this.sessionStates.delete(sessionId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[ChatEventNormalizer] 清理了 ${cleaned} 个过期会话状态，剩余 ${this.sessionStates.size}`);
    }
  }

  private onSessionError(payload: SessionErrorPayload | undefined): void {
    const sessionId = payload?.sessionID;
    if (!sessionId) return;
    const msg = payload?.error?.data?.message || payload?.error?.name || '会话错误';
    this.publish(sessionId, { type: 'error', message: msg });
  }

  private onSessionStatus(payload: SessionStatusPayload | undefined): void {
    const sessionId = payload?.sessionID;
    if (!sessionId) return;
    const status = payload?.status?.type;
    if (!status) return;
    this.publish(sessionId, { type: 'session_status', sessionId, status });
  }

  private onPermissionRequest(payload: PermissionRequestPayload | undefined): void {
    if (!payload?.sessionId || !payload.permissionId) return;
    this.publish(payload.sessionId, {
      type: 'permission_ask',
      req: {
        id: payload.permissionId,
        sessionId: payload.sessionId,
        tool: payload.tool || 'unknown',
        description: payload.description || '',
        risk: payload.risk,
        messageId: payload.messageId,
        callId: payload.callId,
      },
    });
  }
}

// ── TodoWrite 解析

function isTodoWriteTool(name: string): boolean {
  const n = name.toLowerCase();
  return n === 'todowrite' || n === 'todo_write' || n === 'todo-write';
}

function extractTodosFromTodoWrite(
  input: unknown,
  metadata: Record<string, unknown> | undefined
): ChatTodoItem[] | undefined {
  const fromMeta = metadata && toTodos((metadata as Record<string, unknown>).todos);
  if (fromMeta) return fromMeta;
  if (input && typeof input === 'object') {
    const rec = input as Record<string, unknown>;
    return toTodos(rec.todos);
  }
  return undefined;
}

/** 单例（在 admin-server 启动时 install） */
export const chatEventNormalizer = new ChatEventNormalizer();
