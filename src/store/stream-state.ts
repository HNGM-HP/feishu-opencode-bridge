/**
 * 流状态管理器
 *
 * 统一管理流式响应相关的所有状态，包括：
 * - 内容快照
 * - 工具状态
 * - 时间线
 * - 关联缓存
 */

export type ToolRuntimeState = {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: string;
  kind?: 'tool' | 'subtask';
};

export type TimelineSegment =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'reasoning';
      text: string;
    }
  | {
      type: 'tool';
      name: string;
      status: ToolRuntimeState['status'];
      output?: string;
      kind?: 'tool' | 'subtask';
    }
  | {
      type: 'note';
      text: string;
      variant?: 'retry' | 'compaction' | 'question' | 'error' | 'permission';
    };

export type StreamTimelineState = {
  order: string[];
  segments: Map<string, TimelineSegment>;
};

type CorrelationChatRef = {
  chatId: string;
  expiresAt: number;
};

type ContentSnapshot = {
  text: string;
  thinking: string;
};

export const CORRELATION_CACHE_TTL_MS = 10 * 60 * 1000;
const TIMELINE_LIMIT = 80;

export class StreamStateManager {
  // 内容快照
  private streamContentMap = new Map<string, ContentSnapshot>();
  private reasoningSnapshotMap = new Map<string, string>();
  private textSnapshotMap = new Map<string, string>();

  // 通知状态
  private retryNoticeMap = new Map<string, string>();
  private errorNoticeMap = new Map<string, string>();

  // 卡片消息 ID
  private streamCardMessageIdsMap = new Map<string, string[]>();

  // 关联缓存
  private toolCallChatMap = new Map<string, CorrelationChatRef>();
  private messageChatMap = new Map<string, CorrelationChatRef>();

  // 工具状态和时间线
  private streamToolStateMap = new Map<string, Map<string, ToolRuntimeState>>();
  private streamTimelineMap = new Map<string, StreamTimelineState>();

  // ── 内容快照方法 ────────────────────────────────

  getContent(bufferKey: string): ContentSnapshot | undefined {
    return this.streamContentMap.get(bufferKey);
  }

  setContent(bufferKey: string, content: ContentSnapshot): void {
    this.streamContentMap.set(bufferKey, content);
  }

  getReasoningSnapshot(bufferKey: string): string | undefined {
    return this.reasoningSnapshotMap.get(bufferKey);
  }

  setReasoningSnapshot(bufferKey: string, snapshot: string): void {
    this.reasoningSnapshotMap.set(bufferKey, snapshot);
  }

  getTextSnapshot(bufferKey: string): string | undefined {
    return this.textSnapshotMap.get(bufferKey);
  }

  setTextSnapshot(bufferKey: string, snapshot: string): void {
    this.textSnapshotMap.set(bufferKey, snapshot);
  }

  // ── 通知状态方法 ────────────────────────────────

  getRetryNotice(bufferKey: string): string | undefined {
    return this.retryNoticeMap.get(bufferKey);
  }

  setRetryNotice(bufferKey: string, notice: string): void {
    this.retryNoticeMap.set(bufferKey, notice);
  }

  getErrorNotice(bufferKey: string): string | undefined {
    return this.errorNoticeMap.get(bufferKey);
  }

  setErrorNotice(bufferKey: string, notice: string): void {
    this.errorNoticeMap.set(bufferKey, notice);
  }

  // ── 卡片消息 ID 方法 ────────────────────────────

  getCardMessageIds(bufferKey: string): string[] | undefined {
    return this.streamCardMessageIdsMap.get(bufferKey);
  }

  setCardMessageIds(bufferKey: string, ids: string[]): void {
    this.streamCardMessageIdsMap.set(bufferKey, ids);
  }

  // ── 关联缓存方法 ────────────────────────────────

  getChatIdByToolCall(toolCallId: string): string | undefined {
    const ref = this.toolCallChatMap.get(toolCallId);
    if (!ref) return undefined;
    if (Date.now() > ref.expiresAt) {
      this.toolCallChatMap.delete(toolCallId);
      return undefined;
    }
    return ref.chatId;
  }

  setToolCallChat(toolCallId: string, chatId: string): void {
    this.toolCallChatMap.set(toolCallId, {
      chatId,
      expiresAt: Date.now() + CORRELATION_CACHE_TTL_MS,
    });
  }

  getChatIdByMessage(messageId: string): string | undefined {
    const ref = this.messageChatMap.get(messageId);
    if (!ref) return undefined;
    if (Date.now() > ref.expiresAt) {
      this.messageChatMap.delete(messageId);
      return undefined;
    }
    return ref.chatId;
  }

  setMessageChat(messageId: string, chatId: string): void {
    this.messageChatMap.set(messageId, {
      chatId,
      expiresAt: Date.now() + CORRELATION_CACHE_TTL_MS,
    });
  }

  // ── 工具状态方法 ────────────────────────────────

  getToolStates(bufferKey: string): Map<string, ToolRuntimeState> | undefined {
    return this.streamToolStateMap.get(bufferKey);
  }

  setToolStates(bufferKey: string, states: Map<string, ToolRuntimeState>): void {
    this.streamToolStateMap.set(bufferKey, states);
  }

  // ── 时间线方法 ──────────────────────────────────

  getTimeline(bufferKey: string): StreamTimelineState | undefined {
    return this.streamTimelineMap.get(bufferKey);
  }

  getOrCreateTimeline(bufferKey: string): StreamTimelineState {
    let timeline = this.streamTimelineMap.get(bufferKey);
    if (!timeline) {
      timeline = {
        order: [],
        segments: new Map(),
      };
      this.streamTimelineMap.set(bufferKey, timeline);
    }
    return timeline;
  }

  trimTimeline(timeline: StreamTimelineState): void {
    while (timeline.order.length > TIMELINE_LIMIT) {
      const removedKey = timeline.order.shift();
      if (removedKey) {
        timeline.segments.delete(removedKey);
      }
    }
  }

  upsertTimelineSegment(bufferKey: string, segmentKey: string, segment: TimelineSegment): void {
    const timeline = this.getOrCreateTimeline(bufferKey);
    if (!timeline.order.includes(segmentKey)) {
      timeline.order.push(segmentKey);
    }
    timeline.segments.set(segmentKey, segment);
    this.trimTimeline(timeline);
  }

  // ── 清理方法 ────────────────────────────────────

  clear(bufferKey: string): void {
    this.streamContentMap.delete(bufferKey);
    this.reasoningSnapshotMap.delete(bufferKey);
    this.textSnapshotMap.delete(bufferKey);
    this.retryNoticeMap.delete(bufferKey);
    this.errorNoticeMap.delete(bufferKey);
    this.streamCardMessageIdsMap.delete(bufferKey);
    this.streamToolStateMap.delete(bufferKey);
    this.streamTimelineMap.delete(bufferKey);
  }

  clearAll(): void {
    this.streamContentMap.clear();
    this.reasoningSnapshotMap.clear();
    this.textSnapshotMap.clear();
    this.retryNoticeMap.clear();
    this.errorNoticeMap.clear();
    this.streamCardMessageIdsMap.clear();
    this.toolCallChatMap.clear();
    this.messageChatMap.clear();
    this.streamToolStateMap.clear();
    this.streamTimelineMap.clear();
  }

  // 清理过期的关联缓存
  cleanupExpiredCorrelations(): void {
    const now = Date.now();
    for (const [key, ref] of this.toolCallChatMap.entries()) {
      if (now > ref.expiresAt) {
        this.toolCallChatMap.delete(key);
      }
    }
    for (const [key, ref] of this.messageChatMap.entries()) {
      if (now > ref.expiresAt) {
        this.messageChatMap.delete(key);
      }
    }
  }
}

// 单例导出
export const streamStateManager = new StreamStateManager();