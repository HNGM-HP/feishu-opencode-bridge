import { feishuClient, type FeishuMessageEvent, type FeishuCardActionEvent } from '../feishu/client.js';
import { opencodeClient } from '../opencode/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { buildWelcomeCard } from '../feishu/cards.js';
import { parseCommand } from '../commands/parser.js';
import { commandHandler } from './command.js';

export class P2PHandler {
  // 处理私聊消息
  async handleMessage(event: FeishuMessageEvent): Promise<void> {
    const { chatId, content, senderId, messageId } = event;

    // 1. 检查命令
    const command = parseCommand(content);
    if (command.type !== 'prompt') {
      console.log(`[P2P] 收到命令: ${command.type}`);
      await commandHandler.handle(command, {
        chatId,
        messageId,
        senderId,
        chatType: 'p2p'
      });
      return;
    }

    // 否则默认发送欢迎卡片
    console.log(`[P2P] 收到私聊消息: user=${senderId}, content=${content.slice(0, 20)}...`);

    // 获取发送者名字（暂时无法获取，除非有API，这里用OpenID或默认称呼）
    // TODO: 可以调用API获取用户信息，这里暂时用 "你"
    const card = buildWelcomeCard('你');
    await feishuClient.sendCard(chatId, card);
  }

  // 处理私聊中的卡片动作
  async handleCardAction(event: FeishuCardActionEvent): Promise<void> {
    const { action, openId, chatId, messageId } = event;
    const actionTag = action.value?.action as string;

    if (actionTag === 'create_chat') {
      console.log(`[P2P] 用户 ${openId} 请求创建新会话`);

      // 1. 创建飞书群
      const chatName = `OpenCode会话-${Date.now().toString().slice(-4)}`;
      const newChatId = await feishuClient.createChat(chatName, [openId], '由 OpenCode 自动创建的会话群');

      if (!newChatId) {
        await feishuClient.reply(messageId!, '❌ 创建群聊失败，请重试');
        return;
      }

      // 1.5 验证用户是否进群（修复用户未进群且未解散的 Bug）
      let members = await feishuClient.getChatMembers(newChatId);
      if (!members.includes(openId)) {
        console.log(`[P2P] 用户 ${openId} 未在新建群 ${newChatId} 中，尝试手动拉取...`);
        const added = await feishuClient.addChatMembers(newChatId, [openId]);
        if (!added) {
          console.error(`[P2P] 无法拉取用户 ${openId} 进群，回滚操作`);
          await feishuClient.disbandChat(newChatId);
          await feishuClient.reply(messageId!, '❌ 无法将您添加到群聊，请确保您已授权机器人获取群组信息权限，或联系管理员。');
          return;
        }
        // 再次确认
        members = await feishuClient.getChatMembers(newChatId);
        if (!members.includes(openId)) {
           console.error(`[P2P] 再次确认失败，用户仍不在群中`);
           await feishuClient.disbandChat(newChatId);
           await feishuClient.reply(messageId!, '❌ 创建群聊异常：无法确认成员状态。');
           return;
        }
      }

      // 2. 创建 OpenCode 会话
      const sessionTitle = `飞书群聊: ${chatName}`;
      const session = await opencodeClient.createSession(sessionTitle);
      
      if (!session) {
        await feishuClient.reply(messageId!, '❌ 创建 OpenCode 会话失败，请重试');
        // TODO: 应该解散刚创建的群以回滚
        await feishuClient.disbandChat(newChatId);
        return;
      }

      // 3. 绑定关系
      chatSessionStore.setSession(newChatId, session.id, openId, sessionTitle);

      // 4. 回复用户
      // 更新原卡片为成功状态，或发送新消息
      // 这里简单回复文字
      await feishuClient.reply(messageId!, `✅ 会话群已创建！\n正在为您跳转...`);
      // 发送群名片或链接（飞书会自动把群显示在列表里）
      
      // 在新群里发一条欢迎消息
      await feishuClient.sendText(newChatId, '👋 会话已就绪，请直接在这里发送消息与 AI 对话。');
    }
  }
}

export const p2pHandler = new P2PHandler();
