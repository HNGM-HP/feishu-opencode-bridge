import { permissionConfig } from '../config.js';

// 待处理的权限请求
interface PendingPermission {
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
  // 待处理的权限请求（userId -> 权限请求）
  private pendingPermissions: Map<string, PendingPermission> = new Map();

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

  // 检查工具是否在白名单中
  isToolWhitelisted(toolName: unknown): boolean {
    const normalizedToolName = this.normalizeToolName(toolName);
    if (!normalizedToolName) return false;

    return permissionConfig.toolWhitelist.some(
      t => t.trim().toLowerCase() === normalizedToolName.toLowerCase()
    );
  }


  // 添加待处理的权限请求
  addPending(
    userId: string,
    data: Omit<PendingPermission, 'createdAt'>
  ): void {
    this.pendingPermissions.set(userId, {
      ...data,
      createdAt: Date.now(),
    });
  }

  // 获取用户的待处理权限请求
  getPending(userId: string): PendingPermission | undefined {
    const pending = this.pendingPermissions.get(userId);
    
    // 检查是否超时
    if (pending && Date.now() - pending.createdAt > permissionConfig.requestTimeout) {
      this.pendingPermissions.delete(userId);
      return undefined;
    }

    return pending;
  }

  // 移除待处理的权限请求
  removePending(userId: string): PendingPermission | undefined {
    const pending = this.pendingPermissions.get(userId);
    this.pendingPermissions.delete(userId);
    return pending;
  }

  // 清理超时的请求
  cleanupExpired(): void {
    const now = Date.now();
    for (const [userId, pending] of this.pendingPermissions) {
      if (now - pending.createdAt > permissionConfig.requestTimeout) {
        this.pendingPermissions.delete(userId);
      }
    }
  }
}

// 单例导出
export const permissionHandler = new PermissionHandler();
