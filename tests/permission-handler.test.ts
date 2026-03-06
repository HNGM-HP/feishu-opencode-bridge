import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { permissionHandler, PendingPermission } from '../src/permissions/handler.js';

describe('PermissionHandler idempotency', () => {
  const testChatId = 'test-chat-123';
  const testPermissionId1 = 'perm-001';
  const testPermissionId2 = 'perm-002';

  beforeEach(() => {
    // 清理测试数据
    permissionHandler.resolveForChat(testChatId, testPermissionId1);
    permissionHandler.resolveForChat(testChatId, testPermissionId2);
  });

  afterEach(() => {
    // 清理测试数据
    permissionHandler.resolveForChat(testChatId, testPermissionId1);
    permissionHandler.resolveForChat(testChatId, testPermissionId2);
  });

  it('首次入队权限请求应成功', () => {
    const result = permissionHandler.enqueueForChat(testChatId, {
      sessionId: 'session-001',
      permissionId: testPermissionId1,
      tool: 'Bash',
      description: '执行命令',
      risk: '可能执行危险操作',
      userId: 'user-001',
    });

    expect(result).toBeDefined();
    expect(result.permissionId).toBe(testPermissionId1);
    expect(result.tool).toBe('Bash');
    expect(result.chatId).toBe(testChatId);

    // 队列中应有 1 条
    expect(permissionHandler.getQueueSizeForChat(testChatId)).toBe(1);
  });

  it('相同 permissionId 重复入队应覆盖而非重复', () => {
    // 第一次入队
    permissionHandler.enqueueForChat(testChatId, {
      sessionId: 'session-001',
      permissionId: testPermissionId1,
      tool: 'Bash',
      description: '执行命令 v1',
      userId: 'user-001',
    });

    // 第二次入队相同 permissionId（不同描述）
    const result = permissionHandler.enqueueForChat(testChatId, {
      sessionId: 'session-001',
      permissionId: testPermissionId1,
      tool: 'Bash',
      description: '执行命令 v2',
      userId: 'user-001',
    });

    // 队列中仍只有 1 条
    expect(permissionHandler.getQueueSizeForChat(testChatId)).toBe(1);

    // 描述应为最新值
    expect(result.description).toBe('执行命令 v2');

    // peek 应返回最新的条目
    const peeked = permissionHandler.peekForChat(testChatId);
    expect(peeked?.description).toBe('执行命令 v2');
  });

  it('不同 permissionId 应独立存在不互相抑制', () => {
    // 入队第一个权限
    permissionHandler.enqueueForChat(testChatId, {
      sessionId: 'session-001',
      permissionId: testPermissionId1,
      tool: 'Bash',
      description: '执行 Bash 命令',
      userId: 'user-001',
    });

    // 入队第二个权限
    permissionHandler.enqueueForChat(testChatId, {
      sessionId: 'session-002',
      permissionId: testPermissionId2,
      tool: 'Write',
      description: '写入文件',
      userId: 'user-001',
    });

    // 队列中应有 2 条
    expect(permissionHandler.getQueueSizeForChat(testChatId)).toBe(2);

    // 两个权限都应该可被 peek 和 resolve
    const peeked = permissionHandler.peekForChat(testChatId);
    expect(peeked).toBeDefined();

    // 出队第一个
    const resolved1 = permissionHandler.resolveForChat(testChatId, testPermissionId1);
    expect(resolved1?.permissionId).toBe(testPermissionId1);
    expect(permissionHandler.getQueueSizeForChat(testChatId)).toBe(1);

    // 出队第二个
    const resolved2 = permissionHandler.resolveForChat(testChatId, testPermissionId2);
    expect(resolved2?.permissionId).toBe(testPermissionId2);
    expect(permissionHandler.getQueueSizeForChat(testChatId)).toBe(0);
  });

  it('覆盖后新条目时间戳应更新', async () => {
    // 第一次入队
    const first = permissionHandler.enqueueForChat(testChatId, {
      sessionId: 'session-001',
      permissionId: testPermissionId1,
      tool: 'Bash',
      description: '执行命令',
      userId: 'user-001',
    });

    // 等待 10ms 确保时间戳不同
    await new Promise(resolve => setTimeout(resolve, 10));

    // 第二次入队相同 permissionId
    const second = permissionHandler.enqueueForChat(testChatId, {
      sessionId: 'session-001',
      permissionId: testPermissionId1,
      tool: 'Bash',
      description: '执行命令',
      userId: 'user-001',
    });

    // 时间戳应该更新
    expect(second.createdAt).toBeGreaterThan(first.createdAt);
  });

  it('不同 chatId 的权限应独立管理', () => {
    const chatId1 = 'chat-001';
    const chatId2 = 'chat-002';

    // 在 chat1 入队权限
    permissionHandler.enqueueForChat(chatId1, {
      sessionId: 'session-001',
      permissionId: testPermissionId1,
      tool: 'Bash',
      description: 'Chat1 权限',
      userId: 'user-001',
    });

    // 在 chat2 入队相同 permissionId
    permissionHandler.enqueueForChat(chatId2, {
      sessionId: 'session-002',
      permissionId: testPermissionId1,
      tool: 'Bash',
      description: 'Chat2 权限',
      userId: 'user-002',
    });

    // 两个 chat 的队列应独立
    expect(permissionHandler.getQueueSizeForChat(chatId1)).toBe(1);
    expect(permissionHandler.getQueueSizeForChat(chatId2)).toBe(1);

    // 清理
    permissionHandler.resolveForChat(chatId1, testPermissionId1);
    permissionHandler.resolveForChat(chatId2, testPermissionId1);
  });
});

describe('PermissionHandler queue operations', () => {
  const testChatId = 'test-chat-queue';

  afterEach(() => {
    // 清理测试数据
    permissionHandler.resolveForChat(testChatId, 'perm-001');
    permissionHandler.resolveForChat(testChatId, 'perm-002');
    permissionHandler.resolveForChat(testChatId, 'perm-003');
  });

  it('peekForChat 应返回队首元素但不出队', () => {
    permissionHandler.enqueueForChat(testChatId, {
      sessionId: 'session-001',
      permissionId: 'perm-001',
      tool: 'Bash',
      description: '第一个权限',
      userId: 'user-001',
    });

    permissionHandler.enqueueForChat(testChatId, {
      sessionId: 'session-001',
      permissionId: 'perm-002',
      tool: 'Write',
      description: '第二个权限',
      userId: 'user-001',
    });

    // peek 应返回队首（第一个入队的）
    const peeked = permissionHandler.peekForChat(testChatId);
    expect(peeked?.permissionId).toBe('perm-001');

    // 队列大小不变
    expect(permissionHandler.getQueueSizeForChat(testChatId)).toBe(2);
  });

  it('resolveForChat 应按 permissionId 出队', () => {
    permissionHandler.enqueueForChat(testChatId, {
      sessionId: 'session-001',
      permissionId: 'perm-001',
      tool: 'Bash',
      description: '第一个权限',
      userId: 'user-001',
    });

    permissionHandler.enqueueForChat(testChatId, {
      sessionId: 'session-001',
      permissionId: 'perm-002',
      tool: 'Write',
      description: '第二个权限',
      userId: 'user-001',
    });

    // resolve 队首的权限
    const resolved = permissionHandler.resolveForChat(testChatId, 'perm-001');
    expect(resolved?.permissionId).toBe('perm-001');
    expect(permissionHandler.getQueueSizeForChat(testChatId)).toBe(1);

    // 队首应该是第二个权限
    const peeked = permissionHandler.peekForChat(testChatId);
    expect(peeked?.permissionId).toBe('perm-002');
  });

  it('resolve 不存在的 permissionId 应返回 undefined', () => {
    permissionHandler.enqueueForChat(testChatId, {
      sessionId: 'session-001',
      permissionId: 'perm-001',
      tool: 'Bash',
      description: '权限',
      userId: 'user-001',
    });

    const resolved = permissionHandler.resolveForChat(testChatId, 'non-existent');
    expect(resolved).toBeUndefined();
    expect(permissionHandler.getQueueSizeForChat(testChatId)).toBe(1);
  });

  it('空队列 peek 和 resolve 应返回 undefined', () => {
    const peeked = permissionHandler.peekForChat('empty-chat');
    expect(peeked).toBeUndefined();

    const resolved = permissionHandler.resolveForChat('empty-chat', 'perm-001');
    expect(resolved).toBeUndefined();

    expect(permissionHandler.getQueueSizeForChat('empty-chat')).toBe(0);
  });
});
