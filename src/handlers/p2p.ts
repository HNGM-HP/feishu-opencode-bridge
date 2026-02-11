import { feishuClient, type FeishuMessageEvent, type FeishuCardActionEvent } from '../feishu/client.js';
import { opencodeClient } from '../opencode/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { buildWelcomeCard } from '../feishu/cards.js';
import { parseCommand, getHelpText, type ParsedCommand } from '../commands/parser.js';
import { commandHandler } from './command.js';
import { groupHandler } from './group.js';

interface EnsurePrivateSessionResult {
  firstBinding: boolean;
}

export class P2PHandler {
  private async safeReply(
    messageId: string | undefined,
    chatId: string | undefined,
    text: string
  ): Promise<boolean> {
    if (messageId) {
      await feishuClient.reply(messageId, text);
      return true;
    }

    if (chatId) {
      await feishuClient.sendText(chatId, text);
      return true;
    }

    return false;
  }

  private getPrivateSessionShortId(openId: string): string {
    const normalized = openId.startsWith('ou_') ? openId.slice(3) : openId;
    return normalized.slice(0, 4);
  }

  private getPrivateSessionTitle(openId: string): string {
    const shortOpenId = this.getPrivateSessionShortId(openId);
    return `飞书私聊${shortOpenId || '用户'}`;
  }

  private isCreateGroupCommand(text: string): boolean {
    const trimmed = text.trim();
    const lowered = trimmed.toLowerCase();
    return (
      lowered === '/create_chat' ||
      lowered === '/create-chat' ||
      lowered === '/chat new' ||
      lowered === '/group new' ||
      trimmed === '/建群' ||
      trimmed === '建群'
    );
  }

  private async isSessionMissingInOpenCode(sessionId: string): Promise<boolean> {
    try {
      const sessions = await opencodeClient.listSessions();
      return !sessions.some(session => session.id === sessionId);
    } catch (error) {
      console.warn('[P2P] 校验会话存在性失败，保持当前绑定:', error);
      return false;
    }
  }

  private async ensurePrivateSession(chatId: string, senderId: string): Promise<EnsurePrivateSessionResult | null> {
    const current = chatSessionStore.getSession(chatId);
    if (current?.sessionId) {
      const missing = await this.isSessionMissingInOpenCode(current.sessionId);
      if (!missing) {
        return {
          firstBinding: false,
        };
      }

      console.log(`[P2P] 检测到绑定会话已删除，重新初始化: chat=${chatId}, session=${current.sessionId}`);
      chatSessionStore.removeSession(chatId);
    }

    try {
      const sessionTitle = this.getPrivateSessionTitle(senderId);
      const session = await opencodeClient.createSession(sessionTitle);
      chatSessionStore.setSession(chatId, session.id, senderId, sessionTitle);
      return {
        firstBinding: true,
      };
    } catch (error) {
      console.error('[P2P] 初始化私聊会话失败:', error);
      return null;
    }
  }

  private shouldSkipImmediateCommand(command: ParsedCommand): boolean {
    if (command.type === 'help' || command.type === 'panel') {
      return true;
    }

    return command.type === 'session' && command.sessionAction === 'new';
  }

  private async pushFirstContactGuidance(chatId: string, senderId: string, messageId: string): Promise<void> {
    const card = buildWelcomeCard(senderId);
    await feishuClient.sendCard(chatId, card);
    await this.safeReply(messageId, chatId, getHelpText());

    try {
      await commandHandler.pushPanelCard(chatId, 'p2p');
    } catch (error) {
      console.warn('[P2P] 发送私聊控制面板失败:', error);
    }
  }

  // 处理私聊消息
  async handleMessage(event: FeishuMessageEvent): Promise<void> {
    const { chatId, content, senderId, messageId } = event;
    const trimmedContent = content.trim();

    // 1. 检查命令
    const command = parseCommand(content);

    // 2. 首次私聊（或绑定会话在 OpenCode 中已被删除）时，自动初始化并推送引导
    const ensured = await this.ensurePrivateSession(chatId, senderId);
    if (!ensured) {
      await this.safeReply(messageId, chatId, '❌ 初始化私聊会话失败，请稍后重试');
      return;
    }

    if (ensured.firstBinding) {
      await this.pushFirstContactGuidance(chatId, senderId, messageId);
      if (this.shouldSkipImmediateCommand(command)) {
        return;
      }
    }

    // 3.1 私聊专属建群快捷命令
    if (this.isCreateGroupCommand(trimmedContent)) {
      await this.handleCardAction({
        openId: senderId,
        action: { tag: 'button', value: { action: 'create_chat' } },
        token: '',
        chatId,
        messageId,
        rawEvent: event.rawEvent,
      });
      return;
    }

    // 3. 私聊命令
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

    // 4. 私聊普通消息：按群聊同样逻辑转发到 OpenCode
    console.log(`[P2P] 收到私聊消息: user=${senderId}, content=${content.slice(0, 20)}...`);
    await groupHandler.handleMessage(event);
  }

  // 处理私聊中的卡片动作
  async handleCardAction(event: FeishuCardActionEvent): Promise<object | void> {
    const { action, openId, chatId, messageId } = event;
    const actionTag = action.value?.action as string;

    if (actionTag === 'create_chat') {
      console.log(`[P2P] 用户 ${openId} 请求创建新会话`);

      // 1. 创建飞书群
      const chatName = `OpenCode会话-${Date.now().toString().slice(-4)}`;
      const createResult = await feishuClient.createChat(chatName, [openId], '由 OpenCode 自动创建的会话群');

      if (!createResult.chatId) {
        const sent = await this.safeReply(messageId, chatId, '❌ 创建群聊失败，请重试');
        if (!sent) {
          return {
            toast: {
              type: 'error',
              content: '创建群聊失败，请重试',
              i18n_content: { zh_cn: '创建群聊失败，请重试', en_us: 'Failed to create chat' }
            }
          };
        }
        return;
      }

      const newChatId = createResult.chatId;
      console.log(`[P2P] 群聊已创建，ID: ${newChatId}`);

      // 1.5 验证用户是否进群
      // 检查 API 返回的 invalid_id_list
      const userInvalidOnCreate = createResult.invalidUserIds.includes(openId);
      let userInGroup = !userInvalidOnCreate;
      
      if (userInvalidOnCreate) {
        console.warn(`[P2P] 用户 ${openId} 在创建群时被标记为无效，尝试手动拉取...`);
      }

      // 再通过 getChatMembers 二次确认
      let members = await feishuClient.getChatMembers(newChatId);
      userInGroup = members.includes(openId);

      if (!userInGroup) {
        console.warn(`[P2P] 用户 ${openId} 未在新建群 ${newChatId} 中，尝试手动拉取...`);
        const added = await feishuClient.addChatMembers(newChatId, [openId]);
        
        if (!added) {
          console.error(`[P2P] 无法拉取用户 ${openId} 进群，正在回滚（解散群）...`);
          await feishuClient.disbandChat(newChatId);
          const sent = await this.safeReply(messageId, chatId, '❌ 无法将您添加到群聊。请确保机器人具有"获取群组信息"和"更新群组信息"权限，且您在机器人的可见范围内。');
          if (!sent) {
            return {
              toast: {
                type: 'error',
                content: '无法将你添加到群聊',
                i18n_content: { zh_cn: '无法将你添加到群聊', en_us: 'Failed to add you to chat' }
              }
            };
          }
          return;
        }

        // 再次确认
        members = await feishuClient.getChatMembers(newChatId);
        if (!members.includes(openId)) {
           console.error(`[P2P] 手动拉取后用户仍不在群中，回滚（解散群）...`);
           await feishuClient.disbandChat(newChatId);
           const sent = await this.safeReply(messageId, chatId, '❌ 创建群聊异常：无法确认成员状态，已自动清理无效群。');
           if (!sent) {
             return {
               toast: {
                 type: 'error',
                 content: '创建群聊异常，已回滚',
                 i18n_content: { zh_cn: '创建群聊异常，已回滚', en_us: 'Chat creation failed and rolled back' }
               }
             };
           }
           return;
        }
      }
      
      console.log(`[P2P] 用户 ${openId} 已确认在群 ${newChatId} 中`);

      // 2. 创建 OpenCode 会话
      const sessionTitle = `飞书群聊: ${chatName}`;
      const session = await opencodeClient.createSession(sessionTitle);
      
      if (!session) {
        const sent = await this.safeReply(messageId, chatId, '❌ 创建 OpenCode 会话失败，请重试');
        // TODO: 应该解散刚创建的群以回滚
        await feishuClient.disbandChat(newChatId);
        if (!sent) {
          return {
            toast: {
              type: 'error',
              content: '创建 OpenCode 会话失败',
              i18n_content: { zh_cn: '创建 OpenCode 会话失败', en_us: 'Failed to create OpenCode session' }
            }
          };
        }
        return;
      }

      // 3. 绑定关系
      chatSessionStore.setSession(newChatId, session.id, openId, sessionTitle);
      console.log(`[P2P] 已绑定会话: Chat=${newChatId}, Session=${session.id}`);

      // 4. 回复用户
      // 更新原卡片为成功状态，或发送新消息
      // 这里简单回复文字
      const sent = await this.safeReply(messageId, chatId, '✅ 会话群已创建！\n正在为您跳转...');
      // 发送群名片或链接（飞书会自动把群显示在列表里）
      
      // 在新群里发送开场说明
      const onboardingText = [
        '👋 会话已就绪，直接发送需求即可开始。',
        '🎭 使用 /panel 选择角色，使用 /help 查看完整命令。',
        '🧩 可创建自定义角色：创建角色 名称=旅行助手; 描述=擅长规划行程; 类型=主; 工具=webfetch',
      ].join('\n');
      await feishuClient.sendText(newChatId, onboardingText);
      try {
        await commandHandler.pushPanelCard(newChatId);
      } catch (error) {
        console.warn('[P2P] 发送开场控制面板失败:', error);
      }

      if (!sent) {
        return {
          toast: {
            type: 'success',
            content: '会话群已创建，请到新群继续',
            i18n_content: { zh_cn: '会话群已创建，请到新群继续', en_us: 'Chat created, continue in new group' }
          }
        };
      }
    }
  }
}

export const p2pHandler = new P2PHandler();
