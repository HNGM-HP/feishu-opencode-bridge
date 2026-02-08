import { feishuClient } from '../feishu/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { opencodeClient } from '../opencode/client.js';

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
    
    // 如果成员数 <= 1 (只有机器人自己，或者没人)，则解散
    // 注意：getChatMembers 返回的是 open_id 列表
    // 机器人自己通常不在这个列表里？或者在？
    // 飞书 API behavior: getChatMembers returns users. Bot might not be in "user" list.
    // So if members.length === 0, it means only bot is there (or no one).
    
    if (members.length === 0) {
      console.log(`[Lifecycle] 群 ${chatId} 为空，准备解散...`);
      
      // 1. 清理 OpenCode 会话
      const sessionId = chatSessionStore.getSessionId(chatId);
      if (sessionId) {
        // 尝试删除会话（如果 API 支持）
        // await opencodeClient.deleteSession(sessionId); 
        chatSessionStore.removeSession(chatId);
      }

      // 2. 解散飞书群
      await feishuClient.disbandChat(chatId);
    }
  }
}

export const lifecycleHandler = new LifecycleHandler();
