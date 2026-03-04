// 延迟响应处理器 - 处理超时后通过 SSE 收到的迟到响应

import type { Message, Part } from '@opencode-ai/sdk';

// 延迟响应回调类型
export type DelayedResponseCallback = (result: {
  info: Message;
  parts: Part[];
}) => Promise<void>;

// 待处理请求信息
export interface PendingRequest {
  conversationKey: string;
  chatId: string;
  sessionId: string;
  messageId: string;
  feishuMessageId: string;
  createdAt: number;
  lastReminderAt?: number;
  callback: DelayedResponseCallback;
}

class DelayedResponseHandler {
  // 按 messageId 索引待处理请求
  private pending = new Map<string, PendingRequest>();

  // 注册延迟响应处理器
  register(request: PendingRequest): void {
    this.pending.set(request.messageId, request);
    console.log(`[延迟处理] 注册: message=${request.messageId.slice(0, 8)}...`);
  }

  // 获取待处理请求
  get(messageId: string): PendingRequest | undefined {
    return this.pending.get(messageId);
  }

  // 移除待处理请求
  remove(messageId: string): PendingRequest | undefined {
    const request = this.pending.get(messageId);
    if (request) {
      this.pending.delete(messageId);
      console.log(`[延迟处理] 移除: message=${messageId.slice(0, 8)}...`);
    }
    return request;
  }

  // 处理收到的响应
  async handleResponse(
    messageId: string,
    result: { info: Message; parts: Part[] }
  ): Promise<boolean> {
    const request = this.pending.get(messageId);
    if (!request) {
      return false;
    }

    try {
      await request.callback(result);
      this.pending.delete(messageId);
      console.log(`[延迟处理] 成功处理: message=${messageId.slice(0, 8)}...`);
      return true;
    } catch (error) {
      console.error(`[延迟处理] 回调失败:`, error);
      this.pending.delete(messageId);
      return false;
    }
  }

  // 清理超时请求
  cleanupExpired(timeoutMs: number): PendingRequest[] {
    const now = Date.now();
    const expired: PendingRequest[] = [];

    for (const [sessionId, request] of this.pending.entries()) {
      if (now - request.createdAt > timeoutMs) {
        expired.push(request);
        this.pending.delete(sessionId);
      }
    }

    if (expired.length > 0) {
      console.log(`[延迟处理] 清理过期请求: ${expired.length} 个`);
    }

    return expired;
  }

  // 获取所有待处理请求
  getAll(): PendingRequest[] {
    return Array.from(this.pending.values());
  }

  // 获取待处理数量
  get size(): number {
    return this.pending.size;
  }

  // 按会话 ID 检查是否有待处理
  has(messageId: string): boolean {
    return this.pending.has(messageId);
  }

  getBySession(sessionId: string): PendingRequest[] {
    return Array.from(this.pending.values()).filter(item => item.sessionId === sessionId);
  }
}

// 单例导出
export const delayedResponseHandler = new DelayedResponseHandler();
