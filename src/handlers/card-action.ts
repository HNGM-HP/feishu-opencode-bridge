// 飞书卡片动作处理器
// 处理 /panel 和 question 工具的卡片交互

import { opencodeClient } from '../opencode/client.js';
import { feishuClient } from '../feishu/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { commandHandler } from './command.js';
import { buildStreamCard, type StreamCardData } from '../feishu/cards-stream.js';
import type { FeishuCardActionEvent } from '../feishu/client.js';

export class CardActionHandler {
  private toggleUpdateQueue: Map<string, Promise<void>> = new Map();

  private enqueueToggleCardUpdate(messageId: string, updater: () => Promise<void>): void {
    const prev = this.toggleUpdateQueue.get(messageId) || Promise.resolve();
    const next = prev
      .then(async () => {
        await updater();
      })
      .catch(error => {
        console.error(`[CardAction] 思考卡片更新队列失败: msgId=${messageId}`, error);
      })
      .finally(() => {
        if (this.toggleUpdateQueue.get(messageId) === next) {
          this.toggleUpdateQueue.delete(messageId);
        }
      });

    this.toggleUpdateQueue.set(messageId, next);
  }

  private findChatIdByBotMessageId(messageId: string): string | null {
    const allChatIds = chatSessionStore.getAllChatIds();
    for (const chatId of allChatIds) {
      const interaction = chatSessionStore.findInteractionByBotMsgId(chatId, messageId);
      if (interaction) {
        return chatId;
      }
    }
    return null;
  }

  private findLatestCardTarget(): { chatId: string; messageId: string } | null {
    const allChatIds = chatSessionStore.getAllChatIds();
    let latest: { chatId: string; messageId: string; timestamp: number } | null = null;

    for (const chatId of allChatIds) {
      const interaction = chatSessionStore.getLastInteraction(chatId);
      if (!interaction?.cardData) continue;
      if (!interaction.botFeishuMsgIds || interaction.botFeishuMsgIds.length === 0) continue;

      const target = {
        chatId,
        messageId: interaction.botFeishuMsgIds[interaction.botFeishuMsgIds.length - 1],
        timestamp: interaction.timestamp,
      };

      if (!latest || target.timestamp > latest.timestamp) {
        latest = target;
      }
    }

    if (!latest) return null;
    return { chatId: latest.chatId, messageId: latest.messageId };
  }

  private findLatestCardMessageInChat(chatId: string): string | null {
    const interaction = chatSessionStore.getLastInteraction(chatId);
    if (!interaction?.cardData) return null;
    if (!interaction.botFeishuMsgIds || interaction.botFeishuMsgIds.length === 0) return null;
    return interaction.botFeishuMsgIds[interaction.botFeishuMsgIds.length - 1];
  }

  async handle(event: FeishuCardActionEvent): Promise<object | void> {
    const actionValue = event.action.value as any;
    const action = actionValue?.action;

    console.log(`[CardAction] 收到动作: ${action}, value:`, JSON.stringify(actionValue));

    switch (action) {
      case 'stop':
        return this.handleStop(actionValue);
      case 'undo':
        return this.handleUndo(actionValue);
      case 'model_select':
        return this.handleModelSelect(actionValue, event);
      case 'agent_select':
        return this.handleAgentSelect(actionValue, event);
      case 'toggle_thinking':
        return this.handleToggleThinking(actionValue, event);
      case 'create_chat':
        // P2P 创建会话，由 p2pHandler 处理
        return;
      case 'permission_allow':
      case 'permission_deny':
        // 权限确认，由 index.ts 直接处理
        return;
      default:
        console.warn(`[CardAction] 未知动作: ${action}`);
        return;
    }
  }

  private async handleStop(value: any): Promise<object> {
    const { conversationKey, chatId } = value;
    if (!conversationKey) return { msg: 'ok' };

    // 1. 中断本地输出缓冲
    outputBuffer.abort(conversationKey);

    // 2. 获取会话ID并中断OpenCode会话
    const session = chatId ? chatSessionStore.getSession(chatId) : null;
    if (session?.sessionId) {
      try {
        await opencodeClient.abortSession(session.sessionId);
        console.log(`[CardAction] 已中断会话: ${session.sessionId}`);
      } catch (e) {
        console.error('[CardAction] 中断会话失败:', e);
      }
    }

    return {
      toast: {
        type: 'success',
        content: '已停止',
        i18n_content: { zh_cn: '已停止', en_us: 'Stopped' }
      }
    };
  }

  private async handleUndo(value: any): Promise<object> {
    const { chatId } = value;
    if (!chatId) return { msg: 'ok' };

    try {
      await commandHandler.handleUndo(chatId);
      return {
        toast: {
          type: 'success',
          content: '已撤回',
          i18n_content: { zh_cn: '已撤回', en_us: 'Undone' }
        }
      };
    } catch (error) {
      console.error('[CardAction] Undo failed:', error);
      return {
        toast: {
          type: 'error',
          content: '撤回失败',
          i18n_content: { zh_cn: '撤回失败', en_us: 'Undo failed' }
        }
      };
    }
  }

  private async handleModelSelect(value: any, event: FeishuCardActionEvent): Promise<object> {
    const { chatId } = value;
    const selectedOption = (event.action as any).option || value.selected;

    if (!chatId || !selectedOption) {
      return { toast: { type: 'error', content: '参数错误' } };
    }

    // 更新配置
    chatSessionStore.updateConfig(chatId, { preferredModel: selectedOption });
    console.log(`[CardAction] 已切换模型: ${selectedOption}`);

    // 只返回toast，不更新卡片
    // 卡片更新可能失败（错误码200672），所以只返回toast确保用户知道操作成功
    return {
      toast: {
        type: 'success',
        content: `已切换模型: ${selectedOption}`,
        i18n_content: { zh_cn: `已切换模型: ${selectedOption}`, en_us: `Model changed: ${selectedOption}` }
      }
    };
  }

  private async handleAgentSelect(value: any, event: FeishuCardActionEvent): Promise<object> {
    const { chatId } = value;
    const selectedOption = (event.action as any).option || value.selected;

    if (!chatId) {
      return { toast: { type: 'error', content: '参数错误' } };
    }

    const agentName = selectedOption === 'none' ? undefined : selectedOption;
    chatSessionStore.updateConfig(chatId, { preferredAgent: agentName });
    console.log(`[CardAction] 已切换Agent: ${agentName || '默认'}`);

    // 只返回toast，不更新卡片
    return {
      toast: {
        type: 'success',
        content: agentName ? `已切换Agent: ${agentName}` : '已关闭Agent',
        i18n_content: { zh_cn: agentName ? `已切换Agent: ${agentName}` : '已关闭Agent', en_us: agentName ? `Agent changed: ${agentName}` : 'Agent disabled' }
      }
    };
  }

  private async handleToggleThinking(value: any, event: FeishuCardActionEvent): Promise<object> {
      let messageId = (typeof value.messageId === 'string' && value.messageId) ? value.messageId : event.messageId;
      let chatId = value.chatId || event.chatId || (messageId ? this.findChatIdByBotMessageId(messageId) : null);

      if (chatId && !messageId) {
        messageId = this.findLatestCardMessageInChat(chatId) || undefined;
      }

      if (!chatId || !messageId) {
        const latest = this.findLatestCardTarget();
        if (latest) {
          chatId = chatId || latest.chatId;
          messageId = messageId || latest.messageId;
        }
      }

      if (!chatId || !messageId) {
        return { toast: { type: 'error', content: '无法定位思考卡片，请重试' } };
      }

      // Find interaction
      const interaction = chatSessionStore.findInteractionByBotMsgId(chatId, messageId);
      if (!interaction || !interaction.cardData) {
          // If interaction not found (maybe old message or restarted), try to parse from card?
          // But we don't have the thinking content in the action value.
          // So we can't really toggle if we don't have the data.
          return { toast: { type: 'error', content: '无法加载思考内容 (可能是历史消息)' } };
      }
      
      // Toggle
      const cardData = interaction.cardData as StreamCardData;
      const toggleMode = typeof value.toggleMode === 'string' ? value.toggleMode : '';
      const desiredState = toggleMode === 'expand'
        ? true
        : toggleMode === 'collapse'
          ? false
          : typeof value.nextShowThinking === 'boolean'
            ? value.nextShowThinking
            : value.nextShowThinking === 'true'
              ? true
              : value.nextShowThinking === 'false'
                ? false
                : !cardData.showThinking;
      cardData.showThinking = desiredState;

      if (!cardData.messageId) {
        cardData.messageId = messageId;
      }

      // 展开/折叠操作只作用于已产出的卡片，不应把完成态打回处理中
      cardData.status = 'completed';

      // 仅更新内存状态，避免频繁同步写文件导致卡片回调超时
      interaction.cardData = cardData;

      const targetMsgId = messageId as string;
      this.enqueueToggleCardUpdate(targetMsgId, async () => {
        const latest = chatSessionStore.findInteractionByBotMsgId(chatId as string, targetMsgId);
        const latestCardData = (latest?.cardData as StreamCardData | undefined) || cardData;
        latestCardData.status = 'completed';
        latestCardData.messageId = targetMsgId;

        const newCard = buildStreamCard(latestCardData);
        const updated = await feishuClient.updateCard(targetMsgId, newCard);
        if (!updated) {
          console.warn(`[CardAction] 刷新思考卡片失败: msgId=${targetMsgId}`);
        }
      });

      return { msg: 'ok' };
  }
}

export const cardActionHandler = new CardActionHandler();
