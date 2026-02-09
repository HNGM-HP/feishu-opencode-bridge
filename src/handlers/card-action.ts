// 飞书卡片动作处理器
// 处理 /panel 和 question 工具的卡片交互

import { feishuClient } from '../feishu/client.js';
import { opencodeClient } from '../opencode/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { commandHandler } from './command.js';
import { questionHandler } from '../opencode/question-handler.js';
import { buildQuestionAnsweredCard, buildControlCard } from '../feishu/cards.js';
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
    const { conversationKey } = value;
    if (!conversationKey) return { msg: 'ok' };

    outputBuffer.abort(conversationKey);
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

    // 更新卡片显示当前模型
    const session = chatSessionStore.getSession(chatId);
    const currentModel = selectedOption;
    const currentAgent = session?.preferredAgent || '默认';

    // 获取模型和Agent列表以刷新卡片
    const { providers } = await opencodeClient.getProviders();
    const agents = await opencodeClient.getAgents();

    const modelOptions: { label: string; value: string }[] = [];
    const safeProviders = Array.isArray(providers) ? providers : [];

    for (const p of safeProviders) {
      const modelsRaw = (p as any).models;
      const models = Array.isArray(modelsRaw)
        ? modelsRaw
        : (modelsRaw && typeof modelsRaw === 'object' ? Object.values(modelsRaw) : []);

      for (const m of models) {
        const modelId = (m as any).id || (m as any).modelID || (m as any).name;
        const modelName = (m as any).name || modelId;
        const providerId = (p as any).id || (p as any).providerID;

        if (modelId && providerId) {
          modelOptions.push({ label: modelName, value: `${providerId}:${modelId}` });
        }
      }
    }

    const agentOptions = Array.isArray(agents)
      ? agents.map(a => ({ label: a.name, value: a.name }))
      : [];

    const card = buildControlCard({
      conversationKey: `chat:${chatId}`,
      chatId,
      chatType: 'group',
      currentModel,
      currentAgent,
      models: modelOptions.slice(0, 50),
      agents: agentOptions.length > 0 ? agentOptions : [{ label: '无', value: 'none' }]
    });

    return {
      toast: {
        type: 'success',
        content: `已切换模型: ${selectedOption}`,
        i18n_content: { zh_cn: `已切换模型: ${selectedOption}`, en_us: `Model changed: ${selectedOption}` }
      },
      card
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

    // 更新卡片
    const session = chatSessionStore.getSession(chatId);
    const currentModel = session?.preferredModel || '默认';
    const currentAgent = agentName || '默认';

    const { providers } = await opencodeClient.getProviders();
    const agents = await opencodeClient.getAgents();

    const modelOptions: { label: string; value: string }[] = [];
    const safeProviders = Array.isArray(providers) ? providers : [];

    for (const p of safeProviders) {
      const modelsRaw = (p as any).models;
      const models = Array.isArray(modelsRaw)
        ? modelsRaw
        : (modelsRaw && typeof modelsRaw === 'object' ? Object.values(modelsRaw) : []);

      for (const m of models) {
        const modelId = (m as any).id || (m as any).modelID || (m as any).name;
        const modelName = (m as any).name || modelId;
        const providerId = (p as any).id || (p as any).providerID;

        if (modelId && providerId) {
          modelOptions.push({ label: modelName, value: `${providerId}:${modelId}` });
        }
      }
    }

    const agentOptions = Array.isArray(agents)
      ? agents.map(a => ({ label: a.name, value: a.name }))
      : [];

    const card = buildControlCard({
      conversationKey: `chat:${chatId}`,
      chatId,
      chatType: 'group',
      currentModel,
      currentAgent,
      models: modelOptions.slice(0, 50),
      agents: agentOptions.length > 0 ? agentOptions : [{ label: '无', value: 'none' }]
    });

    return {
      toast: {
        type: 'success',
        content: agentName ? `已切换Agent: ${agentName}` : '已关闭Agent',
        i18n_content: { zh_cn: agentName ? `已切换Agent: ${agentName}` : '已关闭Agent', en_us: agentName ? `Agent changed: ${agentName}` : 'Agent disabled' }
      },
      card
    };
  }

  private async handleQuestionSkip(value: any, event: FeishuCardActionEvent): Promise<object> {
    const { requestId, conversationKey, questionIndex } = value;
    const messageId = event.messageId;

    if (!requestId || questionIndex === undefined) {
      return { toast: { type: 'error', content: '参数错误' } };
    }

    const pending = questionHandler.get(requestId);
    if (!pending) {
      return { toast: { type: 'error', content: '问题已过期或不存在' } };
    }

    // 设置当前问题索引
    questionHandler.setCurrentQuestionIndex(requestId, questionIndex);

    // 设置为跳过（空答案）
    questionHandler.setDraftAnswer(requestId, questionIndex, ['']);
    questionHandler.setDraftCustomAnswer(requestId, questionIndex, '');

    // 检查是否还有更多问题
    const totalQuestions = pending.request.questions.length;
    const nextIndex = questionIndex + 1;

    if (nextIndex < totalQuestions) {
      // 还有更多问题，更新卡片到下一个问题
      questionHandler.setCurrentQuestionIndex(requestId, nextIndex);
      questionHandler.setOptionPageIndex(requestId, nextIndex, 0);

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

      return { card };
    } else {
      // 所有问题回答完毕，提交答案
      const draftAnswers = questionHandler.getDraftAnswers(requestId);
      if (draftAnswers) {
        await opencodeClient.replyQuestion(requestId, draftAnswers);
        questionHandler.remove(requestId);
      }

      // 更新卡片为已回答状态
      const card = buildQuestionAnsweredCard(draftAnswers || [[]]);
      return { card };
    }
  }
}

export const cardActionHandler = new CardActionHandler();
