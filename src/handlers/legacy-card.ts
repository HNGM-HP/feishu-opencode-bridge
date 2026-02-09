import { feishuClient, type FeishuCardActionEvent } from '../feishu/client.js';
import { opencodeClient } from '../opencode/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { commandHandler } from './command.js';
import { questionHandler } from '../opencode/question-handler.js';
import { buildQuestionCardV2, buildQuestionAnsweredCard } from '../feishu/cards.js';

// 旧版卡片动作处理器 - 直接迁移自旧项目
// 包含所有卡片交互的完整逻辑

type ActionType = 
  | 'permission_allow' 
  | 'permission_deny' 
  | 'stop' 
  | 'undo'
  | 'model_select'
  | 'agent_select'
  | 'question_skip'
  | 'question_select'
  | 'question_submit';

// 卡片动作值结构
interface CardActionValue {
  action: ActionType;
  sessionId?: string;
  permissionId?: string;
  remember?: boolean;
  conversationKey?: string;
  chatId?: string;
  chatType?: 'p2p' | 'group';
  requestId?: string;
  questionIndex?: number;
}

export class LegacyCardHandler {
  // 主处理函数
  async handle(event: FeishuCardActionEvent): Promise<{ msg: string } | object | undefined> {
    const { action, openId } = event;
    const rawValue = action.value as unknown as CardActionValue;
    const actionType = rawValue?.action;

    console.log(`[旧版卡片处理器] 收到动作: actionType=${actionType}, openId=${openId}`);

    // 根据动作类型分发处理
    switch (actionType) {
      case 'permission_allow':
      case 'permission_deny':
        return await this.handlePermissionResponse(rawValue);

      case 'stop':
        return await this.handleStop(rawValue);

      case 'undo':
        return await this.handleUndo(rawValue, event);

      case 'model_select':
        return await this.handleModelSelect(rawValue, event);

      case 'agent_select':
        return await this.handleAgentSelect(rawValue, event);

      case 'question_skip':
        return await this.handleQuestionSkip(rawValue, event);

      case 'question_select':
        return await this.handleQuestionSelect(rawValue, event);

      default:
        console.log(`[旧版卡片处理器] 未知动作: ${actionType}`);
        return { msg: 'ok' };
    }
  }

  // 处理权限确认
  private async handlePermissionResponse(value: CardActionValue): Promise<{ msg: string }> {
    const { sessionId, permissionId, remember } = value;

    if (!sessionId || !permissionId) {
      console.error('[旧版卡片处理器] 权限响应缺少必要参数');
      return { msg: 'ok' };
    }

    const allow = value.action === 'permission_allow';
    const success = await opencodeClient.respondToPermission(
      sessionId,
      permissionId,
      allow,
      remember
    );

    if (success) {
      console.log(`[旧版卡片处理器] 权限已${allow ? '允许' : '拒绝'}`);
    }

    return { msg: 'ok' };
  }

  // 处理停止
  private async handleStop(value: CardActionValue): Promise<{ msg: string }> {
    const { sessionId, conversationKey, chatId } = value;
    
    let targetSessionId = sessionId;
    
    // 如果没有直接提供 sessionId，从存储中获取
    if (!targetSessionId && conversationKey) {
      // 从 conversationKey 中提取 chatId (格式: chat:{chatId})
      const chatId = conversationKey.startsWith('chat:') ? conversationKey.slice(5) : conversationKey;
      const sessionId = chatSessionStore.getSessionId(chatId);
      if (sessionId) {
        targetSessionId = sessionId;
      }
    }

    if (!targetSessionId) {
      console.warn('[旧版卡片处理器] 停止操作: 未找到会话');
      return { msg: 'ok' };
    }

    const success = await opencodeClient.abortSession(targetSessionId);
    if (success) {
      console.log(`[旧版卡片处理器] 已中断会话: ${targetSessionId}`);
    } else {
      console.warn('[旧版卡片处理器] 中断会话失败');
    }

    return { msg: 'ok' };
  }

  // 处理撤回
  private async handleUndo(value: CardActionValue, event: FeishuCardActionEvent): Promise<{ msg: string }> {
    const { conversationKey, chatId: cardChatId } = value;
    
    // 获取 chatId，优先使用卡片中的，其次使用事件中的
    const targetChatId = cardChatId || event.chatId;
    
    if (!targetChatId) {
      console.warn('[旧版卡片处理器] 撤回操作: 缺少 chatId');
      return { msg: 'ok' };
    }

    // 调用撤回逻辑
    await commandHandler.handleUndo(targetChatId, event.messageId);

    return { msg: 'ok' };
  }

  // 处理模型选择
  private async handleModelSelect(value: CardActionValue, event: FeishuCardActionEvent): Promise<{ msg: string }> {
    const { chatId: cardChatId } = value;
    
    // 从事件中获取选中的值
    const selected = this.extractSelectedValue(event.rawEvent);
    
    if (!selected) {
      console.warn('[旧版卡片处理器] 模型选择: 未选中任何值');
      return { msg: 'ok' };
    }

    if (!cardChatId && !event.chatId) {
      console.warn('[旧版卡片处理器] 模型选择: 缺少 chatId');
      return { msg: 'ok' };
    }

    const targetChatId = cardChatId || event.chatId;
    if (!targetChatId) {
      return { msg: 'ok' };
    }

    // 验证模型格式
    if (!selected.includes('/') && !selected.includes(':')) {
      console.warn(`[旧版卡片处理器] 模型格式错误: ${selected}`);
      return { msg: 'ok' };
    }

    // 更新会话配置
    chatSessionStore.updateConfig(targetChatId, { preferredModel: selected });
    console.log(`[旧版卡片处理器] 已切换模型: ${selected}`);

    // 尝试发送确认消息
    if (event.messageId) {
      try {
        await feishuClient.reply(event.messageId, `✅ 已切换模型: ${selected}`);
      } catch (e) {
        console.error('[旧版卡片处理器] 发送模型切换确认失败:', e);
      }
    }

    // 尝试刷新面板
    try {
      await commandHandler.handlePanel(targetChatId, event.messageId!);
    } catch (e) {
      console.error('[旧版卡片处理器] 刷新面板失败:', e);
    }

    return { msg: 'ok' };
  }

  // 处理 Agent 选择
  private async handleAgentSelect(value: CardActionValue, event: FeishuCardActionEvent): Promise<{ msg: string }> {
    const { chatId: cardChatId } = value;
    
    // 从事件中获取选中的值
    const selected = this.extractSelectedValue(event.rawEvent);
    
    if (!selected) {
      console.warn('[旧版卡片处理器] Agent 选择: 未选中任何值');
      return { msg: 'ok' };
    }

    if (!cardChatId && !event.chatId) {
      console.warn('[旧版卡片处理器] Agent 选择: 缺少 chatId');
      return { msg: 'ok' };
    }

    const targetChatId = cardChatId || event.chatId;
    if (!targetChatId) {
      return { msg: 'ok' };
    }

    // 特殊处理: none 表示关闭 Agent
    const agentValue = selected === 'none' ? undefined : selected;

    // 更新会话配置
    chatSessionStore.updateConfig(targetChatId, { preferredAgent: agentValue });
    console.log(`[旧版卡片处理器] 已切换 Agent: ${agentValue || '无'}`);

    // 尝试发送确认消息
    if (event.messageId) {
      try {
        await feishuClient.reply(event.messageId, `✅ 已切换 Agent: ${agentValue || '无'}`);
      } catch (e) {
        console.error('[旧版卡片处理器] 发送 Agent 切换确认失败:', e);
      }
    }

    // 尝试刷新面板
    try {
      await commandHandler.handlePanel(targetChatId, event.messageId!);
    } catch (e) {
      console.error('[旧版卡片处理器] 刷新面板失败:', e);
    }

    return { msg: 'ok' };
  }

  // 处理问题跳过
  private async handleQuestionSkip(value: CardActionValue, event: FeishuCardActionEvent): Promise<{ msg: string }> {
    const { requestId } = value;

    if (!requestId) {
      console.warn('[旧版卡片处理器] 跳过问题: 缺少 requestId');
      return { msg: 'ok' };
    }

    const success = await opencodeClient.rejectQuestion(requestId);
    
    if (success) {
      console.log(`[旧版卡片处理器] 已跳过问题: ${requestId}`);
      
      // 尝试发送确认消息
      if (event.messageId) {
        try {
          await feishuClient.reply(event.messageId, '✅ 已跳过该问题');
        } catch (e) {
          console.error('[旧版卡片处理器] 发送跳过确认失败:', e);
        }
      }
      
      // 清理问题状态
      questionHandler.remove(requestId);
    } else {
      console.warn('[旧版卡片处理器] 跳过问题失败');
      
      if (event.messageId) {
        try {
          await feishuClient.reply(event.messageId, '❌ 跳过失败，请重试');
        } catch (e) {
          console.error('[旧版卡片处理器] 发送跳过失败确认失败:', e);
        }
      }
    }

    return { msg: 'ok' };
  }

  // 处理问题选项选择
  private async handleQuestionSelect(value: CardActionValue, event: FeishuCardActionEvent): Promise<{ msg: string }> {
    const { requestId, questionIndex } = value;

    if (!requestId) {
      console.warn('[旧版卡片处理器] 问题选择: 缺少 requestId');
      return { msg: 'ok' };
    }

    const pending = questionHandler.get(requestId);
    if (!pending) {
      console.warn(`[旧版卡片处理器] 问题选择: 未找到问题 ${requestId}`);
      return { msg: 'ok' };
    }

    // 从事件中提取选中的选项
    const selectedValues = this.extractQuestionSelectedValues(event.rawEvent);
    
    if (selectedValues.length === 0) {
      console.warn('[旧版卡片处理器] 问题选择: 未选中任何选项');
      return { msg: 'ok' };
    }

    // 更新草稿答案
    const qIndex = questionIndex !== undefined ? questionIndex : 0;
    questionHandler.setDraftAnswer(requestId, qIndex, selectedValues);

    // 刷新问题卡片
    await this.refreshQuestionCard(requestId);

    return { msg: 'ok' };
  }

  // 提取选中的值（用于模型/Agent选择）
  private extractSelectedValue(rawEvent: any): string | null {
    if (!rawEvent || typeof rawEvent !== 'object') {
      return null;
    }

    // 尝试多种可能的位置
    const event = rawEvent as Record<string, unknown>;

    // 检查 action.value
    const action = event.action as { value?: unknown } | undefined;
    if (action?.value && typeof action.value === 'string') {
      return action.value;
    }

    // 检查直接 value
    if (event.value && typeof event.value === 'string') {
      return event.value;
    }

    // 检查 option.value
    const option = event.option as { value?: unknown } | undefined;
    if (option?.value && typeof option.value === 'string') {
      return option.value;
    }

    // 深度搜索
    return this.deepSearchForValue(rawEvent);
  }

  // 深度搜索字符串值
  private deepSearchForValue(obj: any): string | null {
    if (!obj || typeof obj !== 'object') {
      if (typeof obj === 'string' && obj.length < 200) {
        return obj;
      }
      return null;
    }

    const visited = new Set<object>();
    const stack: unknown[] = [obj];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') {
        continue;
      }

      if (visited.has(current as object)) {
        continue;
      }
      visited.add(current as object);

      // 检查是否有 value 字段且是字符串
      const record = current as Record<string, unknown>;
      if (record.value && typeof record.value === 'string' && record.value.length < 200) {
        return record.value;
      }

      if (record.option && typeof record.option === 'object') {
        const optionRecord = record.option as Record<string, unknown>;
        if (optionRecord.value && typeof optionRecord.value === 'string') {
          return optionRecord.value;
        }
      }

      // 继续遍历
      if (Array.isArray(current)) {
        for (const item of current) {
          stack.push(item);
        }
      } else {
        for (const value of Object.values(record)) {
          stack.push(value);
        }
      }
    }

    return null;
  }

  // 提取问题选中的多个值
  private extractQuestionSelectedValues(rawEvent: any): string[] {
    const values: string[] = [];
    
    if (!rawEvent || typeof rawEvent !== 'object') {
      return values;
    }

    const event = rawEvent as Record<string, unknown>;

    // 检查 action.value 中的 selected_values
    const action = event.action as { value?: Record<string, unknown> } | undefined;
    if (action?.value && typeof action.value === 'object') {
      const actionValue = action.value as Record<string, unknown>;
      
      // 检查 selected_values 数组
      if (Array.isArray(actionValue.selected_values)) {
        for (const item of actionValue.selected_values) {
          if (typeof item === 'string') {
            values.push(item);
          }
        }
      }

      // 检查 selected_value 字符串
      if (typeof actionValue.selected_value === 'string') {
        values.push(actionValue.selected_value);
      }

      // 检查 value 字符串
      if (typeof actionValue.value === 'string') {
        values.push(actionValue.value);
      }
    }

    // 如果没有找到，尝试深度搜索
    if (values.length === 0) {
      const deepValue = this.deepSearchForValue(rawEvent);
      if (deepValue) {
        values.push(deepValue);
      }
    }

    return values;
  }

  // 刷新问题卡片
  private async refreshQuestionCard(requestId: string): Promise<void> {
    const pending = questionHandler.get(requestId);
    if (!pending) {
      console.warn(`[旧版卡片处理器] 刷新问题卡片: 未找到问题 ${requestId}`);
      return;
    }

    if (!pending.feishuCardMessageId) {
      console.warn(`[旧版卡片处理器] 刷新问题卡片: 无卡片消息 ID`);
      return;
    }

    console.log(`[旧版卡片处理器] 刷新问题卡片: ${requestId}`);

    const card = buildQuestionCardV2({
      requestId: pending.request.id,
      sessionId: pending.request.sessionID,
      questions: pending.request.questions,
      conversationKey: pending.conversationKey,
      chatId: pending.chatId,
      draftAnswers: pending.draftAnswers,
      draftCustomAnswers: pending.draftCustomAnswers,
      pendingCustomQuestionIndex: pending.pendingCustomQuestionIndex,
      currentQuestionIndex: pending.currentQuestionIndex,
      optionPageIndexes: pending.optionPageIndexes,
    });

    try {
      const success = await feishuClient.updateCard(pending.feishuCardMessageId || '', card);
      if (success) {
        console.log(`[旧版卡片处理器] 问题卡片刷新成功`);
      } else {
        console.warn(`[旧版卡片处理器] 问题卡片刷新失败`);
      }
    } catch (e) {
      console.error(`[旧版卡片处理器] 刷新问题卡片异常:`, e);
    }
  }
}

export const legacyCardHandler = new LegacyCardHandler();
