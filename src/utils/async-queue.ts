// 通用异步队列 - 保证任务串行执行

type QueueTask<T> = () => Promise<T>;

interface QueueItem<T> {
  task: QueueTask<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export class AsyncQueue {
  private queue: QueueItem<unknown>[] = [];
  private processing = false;

  // 入队并等待执行结果
  async enqueue<T>(task: QueueTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        task: task as QueueTask<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.processNext();
    });
  }

  // 处理下一个任务
  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const item = this.queue.shift()!;

    try {
      const result = await item.task();
      item.resolve(result);
    } catch (error) {
      item.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.processing = false;
      this.processNext();
    }
  }

  // 获取队列长度
  get length(): number {
    return this.queue.length;
  }

  // 是否正在处理
  get isProcessing(): boolean {
    return this.processing;
  }

  // 清空队列（不影响正在执行的任务）
  clear(): void {
    const items = this.queue.splice(0);
    for (const item of items) {
      item.reject(new Error('队列已清空'));
    }
  }
}
