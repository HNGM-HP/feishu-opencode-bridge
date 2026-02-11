import { feishuClient } from '../feishu/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { opencodeClient } from '../opencode/client.js';
import { userConfig } from '../config.js';

export class LifecycleHandler {
  // 启动时清理无效群
  async cleanUpOnStart(): Promise<void> {
    console.log('[Lifecycle] 正在检查无效群聊...');
    const chats = await feishuClient.getUserChats();
    for (const chatId of chats) {
      await this.checkAndDisbandIfEmpty(chatId);
    }
    console.log('[Lifecycle] 清理完成');
  }

  // 处理用户退群事件
  async handleMemberLeft(chatId: string, memberId: string): Promise<void> {
    console.log(`[Lifecycle] 用户 ${memberId} 退出群 ${chatId}`);
    await this.checkAndDisbandIfEmpty(chatId);
  }

  // 检查群是否为空，为空则解散
  private async checkAndDisbandIfEmpty(chatId: string): Promise<void> {
    const members = await feishuClient.getChatMembers(chatId);

    console.log(`[Lifecycle] 检查群 ${chatId} 成员数: ${members.length}`);

    // 未配置白名单时：只要群里还有任意成员，就不自动解散
    // 仅在成员数为 0 时才执行清理，避免误删仅剩 1 名用户的群
    if (!userConfig.isWhitelistEnabled) {
      if (members.length > 0) {
        console.log(`[Lifecycle] 群 ${chatId} 未启用白名单且仍有成员，跳过解散`);
        return;
      }

      console.log(`[Lifecycle] 群 ${chatId} 未启用白名单且成员为 0，准备解散...`);
      await this.cleanupAndDisband(chatId);
      return;
    }

    // 检查是否有白名单用户在群内
    const hasAllowedUser = members.some(memberId => userConfig.allowedUsers.includes(memberId));
    
    if (hasAllowedUser) {
      console.log(`[Lifecycle] 群 ${chatId} 包含白名单用户，跳过解散检查`);
      return;
    }

    // 二次确认：检查群主是否在白名单中（防止成员列表获取失败导致误删）
    const chatInfo = await feishuClient.getChat(chatId);
    if (chatInfo && userConfig.allowedUsers.includes(chatInfo.ownerId)) {
      console.log(`[Lifecycle] 群 ${chatId} 群主(${chatInfo.ownerId})在白名单中，跳过解散检查`);
      return;
    }
    
    // 如果成员数 <= 1，认为群为空（只有机器人或无人）
    if (members.length <= 1) {
      console.log(`[Lifecycle] 群 ${chatId} 成员不足且无白名单用户，准备解散...`);
      await this.cleanupAndDisband(chatId);
    }
  }

  private async cleanupAndDisband(chatId: string): Promise<void> {
    // 1. 清理 OpenCode 会话
    const sessionId = chatSessionStore.getSessionId(chatId);
    if (sessionId) {
      // 尝试删除会话（如果 API 支持）
      try {
        await opencodeClient.deleteSession(sessionId);
      } catch (e) {
        console.warn(`[Lifecycle] 删除 OpenCode 会话 ${sessionId} 失败:`, e);
      }
      chatSessionStore.removeSession(chatId);
    }

    // 2. 解散飞书群
    await feishuClient.disbandChat(chatId);
  }
}

export const lifecycleHandler = new LifecycleHandler();
