// 会话请求队列管理 - 每个会话一个队列，保证同会话消息串行处理

import { AsyncQueue } from '../utils/async-queue.js';

class SessionQueueManager {
  private queues = new Map<string, AsyncQueue>();

  // 获取或创建会话队列
  getOrCreate(sessionId: string): AsyncQueue {
    let queue = this.queues.get(sessionId);
    if (!queue) {
      queue = new AsyncQueue();
      this.queues.set(sessionId, queue);
    }
    return queue;
  }

  // 获取队列（不创建）
  get(sessionId: string): AsyncQueue | undefined {
    return this.queues.get(sessionId);
  }

  // 删除队列
  remove(sessionId: string): void {
    const queue = this.queues.get(sessionId);
    if (queue) {
      queue.clear();
      this.queues.delete(sessionId);
    }
  }

  // 获取所有会话 ID
  getSessionIds(): string[] {
    return Array.from(this.queues.keys());
  }

  // 获取队列状态
  getStatus(): Array<{ sessionId: string; pending: number; processing: boolean }> {
    return Array.from(this.queues.entries()).map(([sessionId, queue]) => ({
      sessionId,
      pending: queue.length,
      processing: queue.isProcessing,
    }));
  }
}

// 单例导出
export const sessionQueueManager = new SessionQueueManager();
