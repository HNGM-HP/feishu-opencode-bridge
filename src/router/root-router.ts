/**
 * 根路由器 - 平台事件统一调度入口
 *
 * 职责：
 * - 接收来自各平台适配器的事件
 * - 根据事件类型路由到对应处理器
 * - 保持 Feishu 现有行为不变（pass-through 模式）
 *
 * 设计原则：
 * - 仅编排，不包含业务逻辑
 * - 通过回调注入实现业务逻辑委托
 * - 现阶段保持 legacy 兼容行为
 */

import type { FeishuMessageEvent, FeishuCardActionEvent } from '../feishu/client.js';
import type { PlatformMessageEvent, PlatformActionEvent } from '../platform/types.js';
import { p2pHandler } from '../handlers/p2p.js';
import { groupHandler } from '../handlers/group.js';
import { cardActionHandler } from '../handlers/card-action.js';
import { groupConfig, routerConfig } from '../config.js';
import { chatSessionStore } from '../store/chat-session.js';

/**
 * 卡片动作处理结果
 */
export interface CardActionResponse {
  toast?: {
    type: 'success' | 'error';
    content: string;
    i18n_content?: { zh_cn: string; en_us: string };
  };
  msg?: string;
}

/**
 * Timeline 回调接口（由 index.ts 注入）
 */
export interface TimelineCallbacks {
  upsertTimelineNote: (
    bufferKey: string,
    noteKey: string,
    text: string,
    variant?: 'retry' | 'compaction' | 'question' | 'error' | 'permission'
  ) => void;
}

/**
 * 权限动作回调接口（由 index.ts 注入）
 */
export interface PermissionActionCallbacks {
  /**
   * 处理权限确认动作（卡片按钮点击）
   * @returns 处理结果，包含 toast 信息
   */
  handlePermissionAction: (
    actionValue: Record<string, unknown>,
    action: 'permission_allow' | 'permission_deny'
  ) => Promise<CardActionResponse>;

  /**
   * 处理群聊文本消息中的待确认权限
   * @returns 是否已处理（已处理则跳过后续消息处理）
   */
  tryHandlePendingPermissionByText: (
    event: FeishuMessageEvent
  ) => Promise<boolean>;
}

/**
 * 问题动作回调接口（由 index.ts 注入）
 */
export interface QuestionActionCallbacks {
  /**
   * 处理问题跳过动作
   * @returns 处理结果，包含 toast 信息
   */
  handleQuestionSkipAction: (
    event: FeishuCardActionEvent,
    actionValue: Record<string, unknown>
  ) => Promise<CardActionResponse>;
}

/**
 * 根路由器类
 */
export class RootRouter {
  private permissionCallbacks: PermissionActionCallbacks | null = null;
  private questionCallbacks: QuestionActionCallbacks | null = null;

  private shouldSkipGroupMessage(event: FeishuMessageEvent): boolean {
    if (event.chatType !== 'group') {
      return false;
    }
    if (!groupConfig.requireMentionInGroup) {
      return false;
    }
    return !Array.isArray(event.mentions) || event.mentions.length === 0;
  }

  /**
   * 设置权限动作回调（由 index.ts 注入）
   */
  setPermissionCallbacks(callbacks: PermissionActionCallbacks): void {
    this.permissionCallbacks = callbacks;
  }

  /**
   * 设置问题动作回调（由 index.ts 注入）
   */
  setQuestionCallbacks(callbacks: QuestionActionCallbacks): void {
    this.questionCallbacks = callbacks;
  }

  /**
   * 处理平台消息事件（入站消息）
   */
  async onMessage(event: FeishuMessageEvent | PlatformMessageEvent): Promise<void> {
    const feishuEvent = event as FeishuMessageEvent;

    if (this.shouldSkipGroupMessage(feishuEvent)) {
      if (routerConfig.mode === 'dual') {
        const sessionId = chatSessionStore.getSessionId(feishuEvent.chatId) ?? 'none';
        const conversationKey = `feishu:${feishuEvent.chatId}`;
        console.log(JSON.stringify({
          type: '[Router][dual]',
          event: 'onMessage',
          platform: 'feishu',
          conversationKey,
          sessionId,
          routeDecision: 'group_skip_no_mention',
          chatType: feishuEvent.chatType,
          chatId: feishuEvent.chatId,
        }));
      }
      return;
    }

    if (routerConfig.mode === 'dual') {
      const sessionId = chatSessionStore.getSessionId(feishuEvent.chatId) ?? 'none';
      const conversationKey = `feishu:${feishuEvent.chatId}`;
      const routeDecision = feishuEvent.chatType === 'p2p' ? 'p2p' : 'group';
      console.log(JSON.stringify({
        type: '[Router][dual]',
        event: 'onMessage',
        platform: 'feishu',
        conversationKey,
        sessionId,
        routeDecision,
        chatType: feishuEvent.chatType,
        chatId: feishuEvent.chatId
      }));
    }

    try {
      if (feishuEvent.chatType === 'p2p') {
        await p2pHandler.handleMessage(feishuEvent);
      } else if (feishuEvent.chatType === 'group') {
        // 权限文本处理委托给回调
        if (this.permissionCallbacks) {
          const handled = await this.permissionCallbacks.tryHandlePendingPermissionByText(feishuEvent);
          if (handled) return;
        }
        await groupHandler.handleMessage(feishuEvent);
      }
    } catch (error) {
      console.error('[Router] 消息处理异常:', error);
    }
  }

  /**
   * 处理平台动作事件（卡片/按钮交互）
   */
  async onAction(event: FeishuCardActionEvent | PlatformActionEvent): Promise<CardActionResponse | void> {
    const feishuEvent = event as FeishuCardActionEvent;

    if (routerConfig.mode === 'dual') {
      const sessionId = feishuEvent.chatId ? (chatSessionStore.getSessionId(feishuEvent.chatId) ?? 'none') : 'none';
      const conversationKey = feishuEvent.chatId ? `feishu:${feishuEvent.chatId}` : 'feishu:unknown';
      const routeDecision = 'card_action';
      console.log(JSON.stringify({
        type: '[Router][dual]',
        event: 'onAction',
        platform: 'feishu',
        conversationKey,
        sessionId,
        routeDecision,
        messageId: feishuEvent.messageId ?? 'unknown'
      }));
    }

    try {
      return await this.handleFeishuCardAction(feishuEvent);
    } catch (error) {
      console.error('[Router] 卡片动作处理异常:', error);
      return {
        toast: {
          type: 'error',
          content: '处理失败',
          i18n_content: { zh_cn: '处理失败', en_us: 'Failed' },
        },
      };
    }
  }

  /**
   * 处理 OpenCode 事件（内部事件）
   */
  async onOpenCodeEvent(event: { type: string; payload: unknown }): Promise<void> {
    if (routerConfig.mode === 'dual') {
      const routeDecision = 'opencode_event';
      console.log(JSON.stringify({
        type: '[Router][dual]',
        event: 'onOpenCodeEvent',
        platform: 'opencode',
        conversationKey: 'internal',
        sessionId: 'none',
        routeDecision,
        eventType: event.type
      }));
    }
    // 当前阶段：仅记录日志，实际处理仍在 index.ts
  }

  // ==================== 私有方法 ====================

  private async handleFeishuCardAction(event: FeishuCardActionEvent): Promise<CardActionResponse | void> {
    const actionValue = event.action.value && typeof event.action.value === 'object'
      ? event.action.value as Record<string, unknown>
      : {};
    const action = typeof actionValue.action === 'string' ? actionValue.action : '';

    // 私聊建群 - 委托给 p2pHandler
    if (action === 'create_chat' || action === 'create_chat_select' || action === 'create_chat_submit') {
      return await p2pHandler.handleCardAction(event);
    }

    // 权限确认 - 委托给注入的回调
    if (action === 'permission_allow' || action === 'permission_deny') {
      if (this.permissionCallbacks) {
        return await this.permissionCallbacks.handlePermissionAction(actionValue, action);
      }
      // 回调未注入时返回错误
      return {
        toast: {
          type: 'error',
          content: '权限处理未初始化',
          i18n_content: { zh_cn: '权限处理未初始化', en_us: 'Permission handler not initialized' },
        },
      };
    }

    // 问题跳过 - 委托给注入的回调
    if (action === 'question_skip') {
      if (this.questionCallbacks) {
        return await this.questionCallbacks.handleQuestionSkipAction(event, actionValue);
      }
      // 回调未注入时返回错误
      return {
        toast: {
          type: 'error',
          content: '问题处理未初始化',
          i18n_content: { zh_cn: '问题处理未初始化', en_us: 'Question handler not initialized' },
        },
      };
    }

    // 其他动作 - 委托给 cardActionHandler
    return await cardActionHandler.handle(event);
  }
}

export const rootRouter = new RootRouter();
