/**
 * ChatEventBus — 按 sessionId 分发归一化后的 ChatEvent
 *
 * 职责：
 * - 维护每个 sessionId 的订阅者列表
 * - 维护每个 sessionId 的最近 N 条事件快照，供新客户端 replay
 * - 简单单进程内存实现，足够覆盖 Bridge 单机场景
 *
 * 见 plan-v2.md 第四节 `chat/event-bus.ts`。
 */

import { EventEmitter } from 'node:events';
import type { AddressedChatEvent, ChatEvent } from './types.js';

const DEFAULT_BUFFER_PER_SESSION = 500;

export type ChatEventSubscriber = (evt: AddressedChatEvent) => void;

export class ChatEventBus extends EventEmitter {
  private readonly subscribers = new Map<string, Set<ChatEventSubscriber>>();
  private readonly buffers = new Map<string, AddressedChatEvent[]>();
  private readonly bufferSize: number;
  private seqCounter = 0;

  constructor(options: { bufferPerSession?: number } = {}) {
    super();
    this.setMaxListeners(0);
    this.bufferSize = Math.max(1, options.bufferPerSession ?? DEFAULT_BUFFER_PER_SESSION);
  }

  /** 发布一个事件到 sessionId 对应的订阅者 */
  publish(sessionId: string, event: ChatEvent): AddressedChatEvent {
    const addressed: AddressedChatEvent = {
      sessionId,
      event,
      seq: ++this.seqCounter,
      timestamp: Date.now(),
    };

    // 写缓冲
    let buffer = this.buffers.get(sessionId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(sessionId, buffer);
    }
    buffer.push(addressed);
    if (buffer.length > this.bufferSize) {
      buffer.splice(0, buffer.length - this.bufferSize);
    }

    // 分发
    const subs = this.subscribers.get(sessionId);
    if (subs && subs.size > 0) {
      for (const sub of subs) {
        try {
          sub(addressed);
        } catch (err) {
          console.error('[ChatEventBus] 订阅者回调异常:', err);
        }
      }
    }

    // 全局事件（供诊断 / 日志）
    this.emit('publish', addressed);

    return addressed;
  }

  /** 订阅指定 sessionId 的事件 */
  subscribe(sessionId: string, subscriber: ChatEventSubscriber): () => void {
    let set = this.subscribers.get(sessionId);
    if (!set) {
      set = new Set();
      this.subscribers.set(sessionId, set);
    }
    set.add(subscriber);

    return () => {
      const current = this.subscribers.get(sessionId);
      if (!current) return;
      current.delete(subscriber);
      if (current.size === 0) {
        this.subscribers.delete(sessionId);
      }
    };
  }

  /** 获取最近的事件快照（默认返回全部缓冲） */
  snapshot(sessionId: string, sinceSeq?: number): AddressedChatEvent[] {
    const buffer = this.buffers.get(sessionId);
    if (!buffer || buffer.length === 0) return [];
    if (typeof sinceSeq === 'number') {
      return buffer.filter(e => e.seq > sinceSeq);
    }
    return buffer.slice();
  }

  /** 清空指定 session 缓冲（会话被删除时调用） */
  clearSession(sessionId: string): void {
    this.buffers.delete(sessionId);
    this.subscribers.delete(sessionId);
  }

  /** 统计信息（调试用） */
  stats(): { sessions: number; totalSubscribers: number; totalBuffered: number } {
    let totalSubs = 0;
    for (const set of this.subscribers.values()) totalSubs += set.size;
    let totalBuf = 0;
    for (const buf of this.buffers.values()) totalBuf += buf.length;
    return {
      sessions: this.subscribers.size,
      totalSubscribers: totalSubs,
      totalBuffered: totalBuf,
    };
  }
}

/** 单例 bus */
export const chatEventBus = new ChatEventBus();
