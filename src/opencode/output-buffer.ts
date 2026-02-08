import { outputConfig } from '../config.js';

// 输出缓冲区（用于聚合输出后定时发送）
interface BufferedOutput {
  key: string;
  chatId: string;
  messageId: string | null;
  replyMessageId: string | null;
  sessionId: string;
  content: string[];
  lastUpdate: number;
  timer: NodeJS.Timeout | null;
  status: 'running' | 'completed' | 'failed' | 'aborted';
}

class OutputBuffer {
  private buffers: Map<string, BufferedOutput> = new Map();
  private updateCallback: ((buffer: BufferedOutput) => Promise<void>) | null = null;

  // 设置更新回调
  setUpdateCallback(callback: (buffer: BufferedOutput) => Promise<void>): void {
    this.updateCallback = callback;
  }

  // 创建或获取缓冲区
  getOrCreate(key: string, chatId: string, sessionId: string, replyMessageId: string | null): BufferedOutput {
    let buffer = this.buffers.get(key);

    if (!buffer) {
      buffer = {
        key,
        chatId,
        messageId: null,
        replyMessageId,
        sessionId,
        content: [],
        lastUpdate: Date.now(),
        timer: null,
        status: 'running',
      };
      this.buffers.set(key, buffer);
    }

    return buffer;
  }

  // 追加内容
  append(key: string, text: string): void {
    const buffer = this.buffers.get(key);
    if (!buffer) return;

    buffer.content.push(text);
    this.scheduleUpdate(key);
  }

  // 设置消息ID（用于更新消息）
  setMessageId(key: string, messageId: string): void {
    const buffer = this.buffers.get(key);
    if (buffer) {
      buffer.messageId = messageId;
    }
  }

  // 设置状态
  setStatus(key: string, status: BufferedOutput['status']): void {
    const buffer = this.buffers.get(key);
    if (buffer) {
      buffer.status = status;
      // 状态变化时立即触发更新
      this.triggerUpdate(key);
    }
  }

  // 调度更新
  private scheduleUpdate(key: string): void {
    const buffer = this.buffers.get(key);
    if (!buffer || buffer.timer) return;

    buffer.timer = setTimeout(() => {
      this.triggerUpdate(key);
    }, outputConfig.updateInterval);
  }

  // 触发更新
  private async triggerUpdate(key: string): Promise<void> {
    const buffer = this.buffers.get(key);
    if (!buffer) return;

    // 清除定时器
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }

    buffer.lastUpdate = Date.now();

    // 调用回调
    if (this.updateCallback && buffer.content.length > 0) {
      await this.updateCallback(buffer);
    }
  }

  // 获取并清空内容
  getAndClear(key: string): string {
    const buffer = this.buffers.get(key);
    if (!buffer) return '';

    const content = buffer.content.join('\n');
    buffer.content = [];
    return content;
  }

  // 清理缓冲区
  clear(key: string): void {
    const buffer = this.buffers.get(key);
    if (buffer) {
      if (buffer.timer) {
        clearTimeout(buffer.timer);
      }
      this.buffers.delete(key);
    }
  }

  // 获取缓冲区
  get(key: string): BufferedOutput | undefined {
    return this.buffers.get(key);
  }
}

// 单例导出
export const outputBuffer = new OutputBuffer();
