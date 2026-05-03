// 飞书卡片动作处理器
// 处理 /panel 和 question 工具的卡片交互

import { opencodeClient } from '../opencode/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { commandHandler } from './command.js';
import type { FeishuCardActionEvent } from '../feishu/client.js';
import { isCompletionNotFoundError } from '../feishu/client.js';
import { isChatModelAllowed, parseChatModelReference } from '../utils/chat-model-whitelist.js';
import { parseCommand } from '../commands/parser.js';
import { p2pHandler } from './p2p.js';

export class CardActionHandler {
  private extractSelectedOption(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const normalized = value.trim();
      return normalized.length > 0 ? normalized : undefined;
    }

    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const candidates = [record.value, record.key, record.label];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') {
        continue;
      }
      const normalized = candidate.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }

    return undefined;
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
      case 'help_run_command':
        return this.handleHelpRunCommand(actionValue, event);
      case 'session_ctl_submit':
        return this.handleSessionCtlSubmit(actionValue, event);
      case 'session_list_switch':
        return this.handleSessionListSwitch(actionValue, event);
      case 'create_chat':
        return this.handleCreateChatAction(event);
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
        const aborted = await opencodeClient.abortSession(session.sessionId);
        if (aborted) {
          console.log(`[CardAction] 已中断会话: ${session.sessionId}`);
        } else {
          console.log(`[CardAction] 会话可能已结束: ${session.sessionId}`);
        }
      } catch (e) {
        // 检查是否为过期操作
        const errorData = typeof e === 'object' && e !== null && 'response' in e
          ? (e as { response?: { data?: unknown } }).response?.data
          : undefined;
        if (isCompletionNotFoundError(errorData)) {
          console.log(`[CardAction] 会话已过期: ${session.sessionId}`);
        } else {
          console.error('[CardAction] 中断会话失败:', e);
        }
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
      // 检查是否为过期操作
      const errorData = typeof error === 'object' && error !== null && 'response' in error
        ? (error as { response?: { data?: unknown } }).response?.data
        : undefined;
      if (isCompletionNotFoundError(errorData)) {
        return {
          toast: {
            type: 'error',
            content: '操作已过期，请重新发起',
            i18n_content: { zh_cn: '操作已过期，请重新发起', en_us: 'Operation expired, please try again' }
          }
        };
      }
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
    const selectedOption = this.extractSelectedOption((event.action as Record<string, unknown>).option) || this.extractSelectedOption(value.selected);

    if (!chatId || !selectedOption) {
      return { toast: { type: 'error', content: '参数错误' } };
    }

    const parsedModel = parseChatModelReference(selectedOption);
    if (parsedModel && !isChatModelAllowed(parsedModel.providerId, parsedModel.modelId)) {
      return {
        toast: {
          type: 'error',
          content: '该模型不在当前允许列表中',
          i18n_content: { zh_cn: '该模型不在当前允许列表中', en_us: 'This model is not allowed by the current whitelist' }
        }
      };
    }

    // 更新配置
    chatSessionStore.updateConfig(chatId, { preferredModel: selectedOption });
    console.log(`[CardAction] 已切换模型: ${selectedOption}`);

    const reconciled = await commandHandler.reconcilePreferredEffort(chatId);
    const effortNotice = reconciled.clearedEffort
      ? `；强度 ${reconciled.clearedEffort} 不兼容，已回退为默认`
      : '';
    const toastText = `已切换模型: ${selectedOption}${effortNotice}`;

    // 只返回toast，不更新卡片
    // 卡片更新可能失败（错误码200672），所以只返回toast确保用户知道操作成功
    return {
      toast: {
        type: 'success',
        content: toastText,
        i18n_content: { zh_cn: toastText, en_us: `Model changed: ${selectedOption}` }
      }
    };
  }

  private async handleAgentSelect(value: any, event: FeishuCardActionEvent): Promise<object> {
    const { chatId } = value;
    const selectedOption = this.extractSelectedOption((event.action as Record<string, unknown>).option) || this.extractSelectedOption(value.selected);

    if (!chatId) {
      return { toast: { type: 'error', content: '参数错误' } };
    }

    const agentName = selectedOption === 'none' ? undefined : selectedOption;
    chatSessionStore.updateConfig(chatId, { preferredAgent: agentName });
    console.log(`[CardAction] 已切换角色: ${agentName || '默认'}`);

    // 只返回toast，不更新卡片
    return {
      toast: {
        type: 'success',
        content: agentName ? `已切换角色: ${agentName}` : '已切换为默认角色',
        i18n_content: { zh_cn: agentName ? `已切换角色: ${agentName}` : '已切换为默认角色', en_us: agentName ? `Role changed: ${agentName}` : 'Role reset to default' }
      }
    };
  }

  private async handleToggleThinking(_value: any, _event: FeishuCardActionEvent): Promise<object> {
      // 兼容历史卡片按钮：思考展开已改为飞书原生折叠面板，无需回调更新。
      return { msg: 'ok' };
  }

  private async handleHelpRunCommand(value: any, event: FeishuCardActionEvent): Promise<object> {
    const chatId = typeof value?.chatId === 'string' ? value.chatId : event.chatId;
    const commandText = typeof value?.command === 'string' ? value.command.trim() : '';
    const chatType = value?.chatType === 'p2p' ? 'p2p' : 'group';
    const messageId = event.messageId;

    if (!chatId || !commandText || !messageId) {
      return {
        toast: {
          type: 'error',
          content: '命令参数缺失',
          i18n_content: { zh_cn: '命令参数缺失', en_us: 'Missing command parameters' }
        }
      };
    }

    if (commandText === '/compact') {
      commandHandler.startCompactInBackground(chatId, messageId);
      return {
        toast: {
          type: 'success',
          content: '已开始压缩上下文，完成后会通过新消息通知',
          i18n_content: { zh_cn: '已开始压缩上下文，完成后会通过新消息通知', en_us: 'Compaction started and will notify when done' }
        }
      };
    }

    const command = parseCommand(commandText);
    try {
      await commandHandler.handle(command, {
        chatId,
        messageId,
        senderId: event.openId,
        chatType,
      });
      return {
        toast: {
          type: 'success',
          content: `已执行 ${commandText}`,
          i18n_content: { zh_cn: `已执行 ${commandText}`, en_us: `Executed ${commandText}` }
        }
      };
    } catch (error) {
      console.error('[CardAction] Help shortcut execution failed:', error);
      return {
        toast: {
          type: 'error',
          content: `执行失败: ${commandText}`,
          i18n_content: { zh_cn: `执行失败: ${commandText}`, en_us: `Failed: ${commandText}` }
        }
      };
    }
  }

  private async handleSessionCtlSubmit(value: any, event: FeishuCardActionEvent): Promise<object> {
    const chatId = typeof value?.chatId === 'string' ? value.chatId : event.chatId;
    const chatType = value?.chatType === 'p2p' ? 'p2p' : 'group';
    const messageId = event.messageId;
    const eventAny = event as unknown as { action?: { form_value?: Record<string, string> } };
    const formValue = eventAny.action?.form_value;
    const selectedSessionId = formValue?.session_target?.trim()
      || this.extractSelectedOption(value.selectedSessionId)
      || '';
    const sessionName = formValue?.session_name?.trim() || '';

    if (!chatId || !messageId || !selectedSessionId) {
      return {
        toast: {
          type: 'error',
          content: '提交参数缺失',
          i18n_content: { zh_cn: '提交参数缺失', en_us: 'Missing submit parameters' }
        }
      };
    }

    try {
      await commandHandler.handleSessionControlSubmit(
        chatId,
        messageId,
        event.openId,
        chatType,
        selectedSessionId,
        sessionName
      );
      return {
        toast: {
          type: 'success',
          content: '会话操作已执行',
          i18n_content: { zh_cn: '会话操作已执行', en_us: 'Session operation completed' }
        }
      };
    } catch (error) {
      console.error('[CardAction] Session control submit failed:', error);
      const message = error instanceof Error ? error.message : '会话操作失败';
      return {
        toast: {
          type: 'error',
          content: message,
          i18n_content: { zh_cn: message, en_us: message }
        }
      };
    }
  }

  private async handleSessionListSwitch(value: any, event: FeishuCardActionEvent): Promise<object> {
    const chatId = typeof value?.chatId === 'string' ? value.chatId : event.chatId;
    const chatType = value?.chatType === 'p2p' ? 'p2p' : 'group';
    const targetSessionId = this.extractSelectedOption(value.sessionId) || '';

    if (!chatId || !event.messageId || !targetSessionId) {
      return {
        toast: {
          type: 'error',
          content: '切换参数缺失',
          i18n_content: { zh_cn: '切换参数缺失', en_us: 'Missing switch parameters' }
        }
      };
    }

    await commandHandler.switchSessionFromCard(
      chatId,
      event.messageId,
      event.openId,
      targetSessionId,
      chatType
    );

    return {
      toast: {
        type: 'success',
        content: '已执行会话切换',
        i18n_content: { zh_cn: '已执行会话切换', en_us: 'Session switch requested' }
      }
    };
  }

  private async handleCreateChatAction(event: FeishuCardActionEvent): Promise<object> {
    const result = await p2pHandler.handleCardAction(event);
    return result || { msg: 'ok' };
  }
}

export const cardActionHandler = new CardActionHandler();
