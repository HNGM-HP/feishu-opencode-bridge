import { feishuClient } from '../feishu/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { opencodeClient } from '../opencode/client.js';
import { chatLifecycleConfig } from '../config.js';

export interface CleanupStats {
  scannedChats: number;
  disbandedChats: number;
  deletedSessions: number;
  skippedProtectedSessions: number;
  removedOrphanMappings: number;
  deferredEmptyChats: number; // 新增：推迟清理的空群数
}

export class LifecycleHandler {
  // 启动时清理无效群
  async cleanUpOnStart(): Promise<void> {
    console.log('[Lifecycle] 正在检查无效群聊...');
    const stats = await this.runCleanupScan();
    console.log(
      `[Lifecycle] 清理统计: scanned=${stats.scannedChats}, disbanded=${stats.disbandedChats}, deletedSession=${stats.deletedSessions}, skippedProtected=${stats.skippedProtectedSessions}, removedOrphanMappings=${stats.removedOrphanMappings}, deferredEmpty=${stats.deferredEmptyChats}`
    );
    console.log('[Lifecycle] 清理完成');
  }

  async runCleanupScan(): Promise<CleanupStats> {
    const stats: CleanupStats = {
      scannedChats: 0,
      disbandedChats: 0,
      deletedSessions: 0,
      skippedProtectedSessions: 0,
      removedOrphanMappings: 0,
      deferredEmptyChats: 0,
    };
    
    const now = Date.now();

    const chats = await feishuClient.getUserChats();
    const activeChatIdSet = new Set(chats);

    if (chats.length === 0) {
      console.log('[Lifecycle] 当前未检索到任何群聊，跳过孤儿映射清理');
    } else {
      for (const mappedChatId of chatSessionStore.getAllChatIds()) {
        if (activeChatIdSet.has(mappedChatId)) continue;
        if (!chatSessionStore.isGroupChatSession(mappedChatId)) {
          continue;
        }
        chatSessionStore.removeSession(mappedChatId);
        stats.removedOrphanMappings += 1;
        console.log(`[Lifecycle] 已移除孤儿映射: chat=${mappedChatId}`);
      }
    }

    for (const chatId of chats) {
      stats.scannedChats += 1;
      await this.evaluateChatLifecycle(chatId, stats, now);
    }

    return stats;
  }

  // 处理用户退群事件
  async handleMemberLeft(chatId: string, memberId: string): Promise<void> {
    console.log(`[Lifecycle] 用户 ${memberId} 退出群 ${chatId}`);
    // 不再立即检查，让定期扫描处理，避免临时退群导致误删
    // 如果配置了立即清理模式(0ms)，则延迟检查
    if (chatLifecycleConfig.emptyChatRetentionMs === 0) {
      const stats: CleanupStats = {
        scannedChats: 0,
        disbandedChats: 0,
        deletedSessions: 0,
        skippedProtectedSessions: 0,
        removedOrphanMappings: 0,
        deferredEmptyChats: 0,
      };
      await this.evaluateChatLifecycle(chatId, stats, Date.now());
    }
  }

  // 评估群生命周期状态
  private async evaluateChatLifecycle(chatId: string, stats: CleanupStats, now: number): Promise<void> {
    const members = await feishuClient.getChatMembers(chatId);
    const sessionData = chatSessionStore.getSession(chatId);

    console.log(`[Lifecycle] 检查群 ${chatId} 成员数: ${members.length}`);

    // 判断群是否为空（严格只有机器人或无人）
    // 注意：getChatMembers 返回的成员列表不包含机器人自身
    const isEmpty = members.length === 0;

    if (!isEmpty) {
      // 群不为空，清空 becameEmptyAt
      chatSessionStore.updateConfig(chatId, { becameEmptyAt: undefined });
      return;
    }

    // 群为空，执行清理策略
    await this.handleEmptyChat(chatId, stats, now, sessionData);
  }

  // 处理空群的清理逻辑
  private async handleEmptyChat(
    chatId: string,
    stats: CleanupStats,
    now: number,
    sessionData: ReturnType<typeof chatSessionStore.getSession>
  ): Promise<void> {
    // 检查是否启用自动清理
    if (!chatLifecycleConfig.enableEmptyChatCleanup) {
      console.log(`[Lifecycle] 群 ${chatId} 为空但自动清理已禁用，跳过`);
      return;
    }

    // 永久保留模式
    if (chatLifecycleConfig.emptyChatRetentionMs === -1) {
      console.log(`[Lifecycle] 群 ${chatId} 为空但设置了永久保留，跳过`);
      return;
    }

    // 立即清理模式
    if (chatLifecycleConfig.emptyChatRetentionMs === 0) {
      console.log(`[Lifecycle] 群 ${chatId} 为空且设置为立即清理，准备解散...`);
      await this.cleanupAndDisband(chatId, stats);
      return;
    }

    // 宽限期模式
    const becameEmptyAt = sessionData?.becameEmptyAt;

    // 第一次发现为空，记录时间
    if (!becameEmptyAt) {
      chatSessionStore.updateConfig(chatId, { becameEmptyAt: now });
      const remainingMs = chatLifecycleConfig.emptyChatRetentionMs;
      console.log(`[Lifecycle] 群 ${chatId} 首次发现为空，设置宽限期 ${remainingMs}ms`);
      stats.deferredEmptyChats += 1;
      return;
    }

    // 检查宽限期是否已过
    const elapsedMs = now - becameEmptyAt;
    const remainingMs = chatLifecycleConfig.emptyChatRetentionMs - elapsedMs;

    if (remainingMs > 0) {
      console.log(`[Lifecycle] 群 ${chatId} 为空，宽限期还剩 ${remainingMs}ms`);
      stats.deferredEmptyChats += 1;
      return;
    }

    // 宽限期已过，执行清理
    console.log(`[Lifecycle] 群 ${chatId} 宽限期已过，准备解散...`);
    await this.cleanupAndDisband(chatId, stats);
  }

  private async cleanupAndDisband(chatId: string, stats?: CleanupStats): Promise<void> {
    // 1. 清理 OpenCode 会话
    const sessionId = chatSessionStore.getSessionId(chatId);
    if (sessionId) {
      const deleteProtected = chatSessionStore.isSessionDeleteProtected(chatId);
      if (deleteProtected) {
        console.log(`[Lifecycle] 会话删除受保护，跳过删除: ${sessionId}`);
        if (stats) stats.skippedProtectedSessions += 1;
      } else {
        // 尝试删除会话（如果 API 支持）
        try {
          const deleted = await opencodeClient.deleteSession(sessionId);
          if (deleted && stats) {
            stats.deletedSessions += 1;
          }
        } catch (e) {
          console.warn(`[Lifecycle] 删除 OpenCode 会话 ${sessionId} 失败:`, e);
        }
      }
      chatSessionStore.removeSession(chatId);
    }

    // 2. 解散飞书群
    const disbanded = await feishuClient.disbandChat(chatId);
    if (disbanded && stats) {
      stats.disbandedChats += 1;
    }
  }
}

export const lifecycleHandler = new LifecycleHandler();
