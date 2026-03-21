/**
 * Feishu 平台适配器
 *
 * 将现有 feishuClient 包装为 PlatformAdapter 接口，
 * 提供事件映射和行为透传，不修改原有行为。
 */

import { feishuClient, type FeishuMessageEvent, type FeishuCardActionEvent } from '../../feishu/client.js';
import { feishuConfig } from '../../config.js';
import type {
  PlatformAdapter,
  PlatformSender,
  PlatformMessageEvent,
  PlatformActionEvent,
  PlatformAttachment,
  PlatformMention,
} from '../types.js';

/**
 * Feishu 平台发送器实现
 *
 * 委托给 feishuClient 的发送方法
 */
class FeishuSender implements PlatformSender {
  async sendText(conversationId: string, text: string): Promise<string | null> {
    return feishuClient.sendText(conversationId, text);
  }

  async sendCard(conversationId: string, card: object): Promise<string | null> {
    return feishuClient.sendCard(conversationId, card);
  }

  async updateCard(messageId: string, card: object): Promise<boolean> {
    return feishuClient.updateCard(messageId, card);
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    return feishuClient.deleteMessage(messageId);
  }

  async reply(messageId: string, text: string): Promise<string | null> {
    return feishuClient.reply(messageId, text);
  }

  async replyCard(messageId: string, card: object): Promise<string | null> {
    return feishuClient.replyCard(messageId, card);
  }
}

/**
 * 将 Feishu 消息事件映射为平台通用事件
 */
function mapMessageEvent(event: FeishuMessageEvent): PlatformMessageEvent {
  // 映射附件
  let attachments: PlatformAttachment[] | undefined;
  if (event.attachments && event.attachments.length > 0) {
    attachments = event.attachments.map(att => ({
      type: att.type,
      fileKey: att.fileKey,
      fileName: att.fileName,
      fileType: att.fileType,
      fileSize: att.fileSize,
    }));
  }

  // 映射提及
  let mentions: PlatformMention[] | undefined;
  if (event.mentions && event.mentions.length > 0) {
    mentions = event.mentions.map(m => ({
      key: m.key,
      id: m.id,
      name: m.name,
    }));
  }

  return {
    platform: 'feishu',
    // chatId -> conversationId
    conversationId: event.chatId,
    messageId: event.messageId,
    // openId -> senderId (已在 FeishuMessageEvent 中提取)
    senderId: event.senderId,
    senderType: event.senderType,
    content: event.content,
    msgType: event.msgType,
    threadId: event.threadId,
    chatType: event.chatType,
    attachments,
    mentions,
    rawEvent: event.rawEvent,
  };
}

/**
 * 将 Feishu 卡片动作事件映射为平台通用事件
 */
function mapActionEvent(event: FeishuCardActionEvent): PlatformActionEvent {
  return {
    platform: 'feishu',
    // openId -> senderId
    senderId: event.openId,
    action: event.action,
    token: event.token,
    messageId: event.messageId,
    // chatId -> conversationId
    conversationId: event.chatId,
    threadId: event.threadId,
    rawEvent: event.rawEvent,
  };
}

/**
 * Feishu 平台适配器实现
 *
 * 通过包装 feishuClient 实现 PlatformAdapter 接口。
 * 所有行为透传到底层客户端，不做额外处理。
 */
export class FeishuAdapter implements PlatformAdapter {
  readonly platform = 'feishu' as const;

  private sender: FeishuSender;

  constructor() {
    this.sender = new FeishuSender();
  }

  async start(): Promise<void> {
    // 检查飞书是否启用
    if (!feishuConfig.enabled) {
      console.log('[Feishu] 飞书已禁用 (FEISHU_ENABLED=false)，跳过启动');
      return;
    }
    // 检查飞书配置是否完整
    if (!feishuConfig.appId || !feishuConfig.appSecret) {
      console.log('[Feishu] 适配器未配置，跳过启动');
      console.log('[Feishu] 如需启用飞书，请配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
      return;
    }
    await feishuClient.start();
  }

  stop(): void {
    feishuClient.stop();
  }

  getSender(): PlatformSender {
    return this.sender;
  }

  onMessage(callback: (event: PlatformMessageEvent) => void): void {
    feishuClient.on('message', (feishuEvent: FeishuMessageEvent) => {
      const platformEvent = mapMessageEvent(feishuEvent);
      callback(platformEvent);
    });
  }

  onAction(callback: (event: PlatformActionEvent) => void): void {
    feishuClient.setCardActionHandler(async (feishuEvent: FeishuCardActionEvent) => {
      const platformEvent = mapActionEvent(feishuEvent);
      callback(platformEvent);
      // 卡片处理器不需要返回值时返回 void
      return;
    });
  }

  onChatUnavailable(callback: (conversationId: string) => void): void {
    feishuClient.on('chatUnavailable', (chatId: string) => {
      // chatId -> conversationId
      callback(chatId);
    });
  }

  onMessageRecalled(callback: (event: unknown) => void): void {
    feishuClient.onMessageRecalled(callback);
  }

  onMemberLeft(callback: (conversationId: string, memberId: string) => void): void {
    feishuClient.onMemberLeft((chatId: string, memberId: string) => {
      // chatId -> conversationId
      callback(chatId, memberId);
    });
  }

  onChatDisbanded(callback: (conversationId: string) => void): void {
    feishuClient.onChatDisbanded((chatId: string) => {
      // chatId -> conversationId
      callback(chatId);
    });
  }
}

// 单例导出
export const feishuAdapter = new FeishuAdapter();