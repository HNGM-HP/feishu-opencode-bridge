import { permissionConfig } from '../config.js';

// 待处理的权限请求
export interface PendingPermission {
  sessionId: string;
  permissionId: string;
  tool: string;
  description: string;
  risk?: string;
  chatId: string;
  userId: string;
  createdAt: number;
  cardMessageId?: string;
}

class PermissionHandler {
  // 待处理权限队列（按 chatId）
  private pendingByChat: Map<string, PendingPermission[]> = new Map();

  private normalizeToolName(toolName: unknown): string | null {
    if (typeof toolName === 'string') {
      const normalized = toolName.trim();
      return normalized ? normalized : null;
    }

    if (toolName && typeof toolName === 'object') {
      const toolObj = toolName as Record<string, unknown>;
      if (typeof toolObj.name === 'string') {
        const normalized = toolObj.name.trim();
        return normalized ? normalized : null;
      }
    }

    return null;
  }

  private removeExpired(chatId: string): void {
    const queue = this.pendingByChat.get(chatId);
    if (!queue || queue.length === 0) return;

    const now = Date.now();
    const remained = queue.filter(item => now - item.createdAt <= permissionConfig.requestTimeout);
    if (remained.length === 0) {
      this.pendingByChat.delete(chatId);
      return;
    }

    if (remained.length !== queue.length) {
      this.pendingByChat.set(chatId, remained);
    }
  }

  // 检查工具是否在白名单中
  isToolWhitelisted(toolName: unknown): boolean {
    const normalizedToolName = this.normalizeToolName(toolName);
    if (!normalizedToolName) return false;

    return permissionConfig.toolWhitelist.some(
      t => t.trim().toLowerCase() === normalizedToolName.toLowerCase()
    );
  }

  // 入队权限请求（同 permissionId 会覆盖）
  enqueueForChat(
    chatId: string,
    data: {
      sessionId: string;
      permissionId: string;
      tool: string;
      description: string;
      risk?: string;
      userId?: string;
      cardMessageId?: string;
    }
  ): PendingPermission {
    const queue = this.pendingByChat.get(chatId) || [];
    const next: PendingPermission = {
      sessionId: data.sessionId,
      permissionId: data.permissionId,
      tool: data.tool,
      description: data.description,
      risk: data.risk,
      chatId,
      userId: data.userId || '',
      createdAt: Date.now(),
      cardMessageId: data.cardMessageId,
    };

    const index = queue.findIndex(item => item.permissionId === data.permissionId);
    if (index >= 0) {
      queue[index] = next;
    } else {
      queue.push(next);
    }

    this.pendingByChat.set(chatId, queue);
    this.removeExpired(chatId);
    return next;
  }

  // 查看队首待确认权限
  peekForChat(chatId: string): PendingPermission | undefined {
    this.removeExpired(chatId);
    const queue = this.pendingByChat.get(chatId);
    if (!queue || queue.length === 0) return undefined;
    return queue[0];
  }

  // 获取队列长度
  getQueueSizeForChat(chatId: string): number {
    this.removeExpired(chatId);
    return this.pendingByChat.get(chatId)?.length || 0;
  }

  // 按 permissionId 出队
  resolveForChat(chatId: string, permissionId: string): PendingPermission | undefined {
    this.removeExpired(chatId);
    const queue = this.pendingByChat.get(chatId);
    if (!queue || queue.length === 0) return undefined;

    const index = queue.findIndex(item => item.permissionId === permissionId);
    if (index < 0) return undefined;
    const [removed] = queue.splice(index, 1);

    if (queue.length === 0) {
      this.pendingByChat.delete(chatId);
    } else {
      this.pendingByChat.set(chatId, queue);
    }

    return removed;
  }

  // 兼容旧方法：按 key 仅保留一条
  addPending(
    key: string,
    data: Omit<PendingPermission, 'createdAt'>
  ): void {
    this.enqueueForChat(key, {
      sessionId: data.sessionId,
      permissionId: data.permissionId,
      tool: data.tool,
      description: data.description,
      risk: data.risk,
      userId: data.userId,
      cardMessageId: data.cardMessageId,
    });
  }

  // 兼容旧方法：读取队首
  getPending(key: string): PendingPermission | undefined {
    return this.peekForChat(key);
  }

  // 兼容旧方法：移除队首
  removePending(key: string): PendingPermission | undefined {
    this.removeExpired(key);
    const queue = this.pendingByChat.get(key);
    if (!queue || queue.length === 0) return undefined;
    const removed = queue.shift();
    if (!removed) return undefined;

    if (queue.length === 0) {
      this.pendingByChat.delete(key);
    } else {
      this.pendingByChat.set(key, queue);
    }
    return removed;
  }

  // 清理全部超时请求
  cleanupExpired(): void {
    for (const chatId of this.pendingByChat.keys()) {
      this.removeExpired(chatId);
    }
  }
}

// 单例导出
export const permissionHandler = new PermissionHandler();
