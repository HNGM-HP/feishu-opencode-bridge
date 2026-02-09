// 飞书卡片动作处理器
// 处理 /panel 和 question 工具的卡片交互

import { opencodeClient } from '../opencode/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { commandHandler } from './command.js';
import { questionHandler } from '../opencode/question-handler.js';
import { buildQuestionAnsweredCard } from '../feishu/cards.js';
import type { FeishuCardActionEvent } from '../feishu/client.js';

export class CardActionHandler {
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
      case 'question_skip':
        return this.handleQuestionSkip(actionValue, event);
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

  private async handleQuestionSkip(value: any, event: FeishuCardActionEvent): Promise<object> {
    const { requestId, conversationKey, questionIndex } = value;
    const messageId = event.messageId;

    console.log(`[CardAction] Question skip: requestId=${requestId}, currentIndex=${questionIndex}`);

    if (!requestId || questionIndex === undefined) {
      return { toast: { type: 'error', content: '参数错误' } };
    }

    const pending = questionHandler.get(requestId);
    if (!pending) {
      console.log(`[CardAction] Question skip failed: pending not found for ${requestId}`);
      return { toast: { type: 'error', content: '问题已过期或不存在' } };
    }

    const totalQuestions = pending.request.questions.length;
    console.log(`[CardAction] Question skip: total=${totalQuestions}, current=${questionIndex}`);

    // 设置为跳过（空答案）
    questionHandler.setDraftAnswer(requestId, questionIndex, ['']);
    questionHandler.setDraftCustomAnswer(requestId, questionIndex, '');

    // 计算下一个问题索引
    const nextIndex = questionIndex + 1;

    if (nextIndex < totalQuestions) {
      // 还有更多问题，更新卡片到下一个问题
      questionHandler.setCurrentQuestionIndex(requestId, nextIndex);
      questionHandler.setOptionPageIndex(requestId, nextIndex, 0);

      console.log(`[CardAction] Building card for next question: ${nextIndex}`);

      const { buildQuestionCardV2 } = await import('../feishu/cards.js');
      const card = buildQuestionCardV2({
        requestId,
        sessionId: pending.request.sessionID,
        questions: pending.request.questions,
        conversationKey,
        chatId: pending.chatId,
        draftAnswers: questionHandler.getDraftAnswers(requestId) || undefined,
        draftCustomAnswers: questionHandler.getDraftCustomAnswers(requestId) || undefined,
        currentQuestionIndex: nextIndex,
        optionPageIndexes: pending.optionPageIndexes
      });

      console.log(`[CardAction] Returning card for question ${nextIndex}`);
      return { card };
    } else {
      // 所有问题回答完毕，提交答案
      console.log(`[CardAction] All questions skipped, submitting answers`);
      const draftAnswers = questionHandler.getDraftAnswers(requestId);
      if (draftAnswers) {
        const success = await opencodeClient.replyQuestion(requestId, draftAnswers);
        if (success) {
          questionHandler.remove(requestId);
          console.log(`[CardAction] Answers submitted successfully`);
        } else {
          console.error(`[CardAction] Failed to submit answers`);
          return { toast: { type: 'error', content: '提交答案失败' } };
        }
      }

      // 更新卡片为已回答状态
      const card = buildQuestionAnsweredCard(draftAnswers || [[]]);
      return { card };
    }
  }
}

export const cardActionHandler = new CardActionHandler();
