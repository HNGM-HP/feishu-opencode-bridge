// 飞书卡片动作处理器
// 处理 /panel 和 question 工具的卡片交互

import { opencodeClient } from '../opencode/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { commandHandler } from './command.js';
import type { FeishuCardActionEvent } from '../feishu/client.js';

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
    const selectedOption = this.extractSelectedOption((event.action as Record<string, unknown>).option) || this.extractSelectedOption(value.selected);

    if (!chatId || !selectedOption) {
      return { toast: { type: 'error', content: '参数错误' } };
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
}

export const cardActionHandler = new CardActionHandler();
