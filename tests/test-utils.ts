import { chatSessionStore } from '../src/store/chat-session.js';
import { DirectoryPolicy } from '../src/utils/directory-policy.js';

/**
 * 测试辅助函数：访问 ChatSessionStore 私有成员（类型安全）
 */

// 设置测试存储文件
export function setChatSessionStoreTestFile(filePath: string): void {
  const store = chatSessionStore as unknown as ChatSessionStoreTestAccess;
  store.STORE_FILE = filePath;
}

// 清空数据
export function clearChatSessionStoreData(): void {
  const store = chatSessionStore as unknown as ChatSessionStoreTestAccess;
  store.data.clear();
  store.sessionAliases.clear();
}

// 直接设置会话数据（绕过 setSession）
export function setChatSessionDataDirectly(
  chatId: string,
  data: {
    chatId: string;
    sessionId: string;
    creatorId: string;
    createdAt: number;
    interactionHistory: unknown[];
  }
): void {
  const store = chatSessionStore as unknown as ChatSessionStoreTestAccess;
  store.data.set(chatId, data as never);
}

// 设置会话别名
export function setChatSessionAlias(
  sessionId: string,
  alias: { chatId: string; expiresAt: number }
): void {
  const store = chatSessionStore as unknown as ChatSessionStoreTestAccess;
  store.sessionAliases.set(sessionId, alias);
}

// 删除会话数据
export function deleteChatSessionData(chatId: string): void {
  const store = chatSessionStore as unknown as ChatSessionStoreTestAccess;
  store.data.delete(chatId);
}

/**
 * 测试辅助函数：访问 DirectoryPolicy 私有方法（类型安全）
 */

// 规范化路径
export function normalizePath(path: string): string {
  return (DirectoryPolicy as unknown as DirectoryPolicyTestAccess).normalizePath(path);
}

// 判断是否为危险路径
export function isDangerousPath(path: string): boolean {
  return (DirectoryPolicy as unknown as DirectoryPolicyTestAccess).isDangerousPath(path);
}

// 判断路径是否被允许
export function isPathAllowed(
  target: string,
  allowedDirectories: string[]
): boolean {
  return (DirectoryPolicy as unknown as DirectoryPolicyTestAccess).isPathAllowed(
    target,
    allowedDirectories
  );
}

/**
 * 测试专用接口（不用于生产代码）
 */
interface ChatSessionStoreTestAccess {
  STORE_FILE: string;
  data: Map<string, unknown>;
  sessionAliases: Map<string, unknown>;
}

interface DirectoryPolicyTestAccess {
  normalizePath(path: string): string;
  isDangerousPath(path: string): boolean;
  isPathAllowed(target: string, allowedDirectories: string[]): boolean;
}