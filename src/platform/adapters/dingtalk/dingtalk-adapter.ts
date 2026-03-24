/**
 * 钉钉平台适配器
 *
 * 实现 PlatformAdapter 接口，使用 dingtalk-stream SDK 接收消息
 * 支持多账号，每个账号独立 WebSocket 连接
 *
 * ChatId 格式: dingtalk::<accountId>::<conversationId>
 * - 单聊: dingtalk::default::userStaffId
 * - 群聊: dingtalk::default::cidXXX
 */

import type {
  PlatformAdapter,
  PlatformSender,
  PlatformMessageEvent,
  PlatformActionEvent,
  PlatformAttachment,
} from '../../types.js';
import { configStore, type DingtalkAccountRow } from '../../../store/config-store.js';
import { dingtalkConfig } from '../../../config/platform.js';
import type { DingtalkConfig, DingtalkRawMessage } from './dingtalk-types.js';
import { DingtalkConnection } from './dingtalk-connection.js';
import { DingtalkSender } from './dingtalk-sender.js';
import {
  encodeDingtalkChatId,
  decodeDingtalkChatId,
  buildDingtalkConversationId,
  isDingtalkGroupChat,
} from './dingtalk-ids.js';

// ──────────────────────────────────────────────
// DingtalkAdapter 实现
// ──────────────────────────────────────────────

export class DingtalkAdapter implements PlatformAdapter {
  readonly platform = 'dingtalk' as const;

  private readonly sender: DingtalkSender;
  private readonly messageCallbacks: Array<(event: PlatformMessageEvent) => void> = [];
  private readonly actionCallbacks: Array<(event: PlatformActionEvent) => void> = [];
  private isActive = false;

  private readonly connections = new Map<string, DingtalkConnection>();
  private readonly abortControllers = new Map<string, AbortController>();

  constructor() {
    this.sender = new DingtalkSender();
  }

  async start(): Promise<void> {
    // 检查全局开关
    if (!dingtalkConfig.enabled) {
      console.log('[钉钉] 适配器未启用，跳过启动');
      return;
    }

    const accounts = configStore.getDingtalkAccounts().filter((a: DingtalkAccountRow) => a.enabled === 1);

    // 先设置 isActive，确保异步工作线程能正确检测状态
    this.isActive = true;

    if (accounts.length === 0) {
      console.log('[钉钉] 没有启用的账号，适配器已启动但处于空闲状态');
      return;
    }

    // 为每个账号启动连接
    for (const account of accounts) {
      await this.startAccountConnection(account);
    }

    console.log(`[钉钉] 已启动，共 ${accounts.length} 个账号`);
  }

  stop(): void {
    // 终止所有连接
    for (const [accountId, connection] of this.connections) {
      connection.stop();
      console.log(`[钉钉] 已停止账号 ${accountId} 的连接`);
    }

    // 终止所有 AbortController
    for (const [, controller] of this.abortControllers) {
      controller.abort();
    }

    this.connections.clear();
    this.abortControllers.clear();
    this.isActive = false;

    console.log('[钉钉] 已停止');
  }

  getSender(): PlatformSender {
    return this.sender;
  }

  onMessage(callback: (event: PlatformMessageEvent) => void): void {
    this.messageCallbacks.push(callback);
  }

  onAction(callback: (event: PlatformActionEvent) => void): void {
    this.actionCallbacks.push(callback);
  }

  isAdapterActive(): boolean {
    return this.isActive;
  }

  // ──────────────────────────────────────────────
  // 账号连接管理
  // ──────────────────────────────────────────────

  private async startAccountConnection(account: DingtalkAccountRow): Promise<void> {
    const { account_id: accountId } = account;

    // 检查是否已有连接
    if (this.connections.has(accountId)) {
      console.warn(`[钉钉] 账号 ${accountId} 已连接`);
      return;
    }

    const controller = new AbortController();
    this.abortControllers.set(accountId, controller);

    const config: DingtalkConfig = {
      clientId: account.client_id,
      clientSecret: account.client_secret,
      endpoint: account.endpoint,
    };

    const connection = new DingtalkConnection({
      accountId,
      config,
      messageHandler: async (params) => {
        await this.handleMessage(accountId, params.data, params.sessionWebhook);
      },
      abortSignal: controller.signal,
    });

    this.connections.set(accountId, connection);

    try {
      await connection.start();
      console.log(`[钉钉] 账号 ${accountId} 已连接`);
    } catch (error: any) {
      console.error(`[钉钉] 账号 ${accountId} 连接失败:`, error.message);
      this.connections.delete(accountId);
      this.abortControllers.delete(accountId);
    }
  }

  /**
   * 重启账号连接
   */
  async restartAccount(accountId: string): Promise<void> {
    // 停止现有连接
    const existing = this.connections.get(accountId);
    if (existing) {
      existing.stop();
      this.connections.delete(accountId);
    }

    const controller = this.abortControllers.get(accountId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(accountId);
    }

    // 重新启动
    const account = configStore.getDingtalkAccount(accountId);
    if (account && account.enabled === 1) {
      await this.startAccountConnection(account);
    }
  }

  /**
   * 停止账号连接
   */
  stopAccount(accountId: string): void {
    const existing = this.connections.get(accountId);
    if (existing) {
      existing.stop();
      this.connections.delete(accountId);
    }

    const controller = this.abortControllers.get(accountId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(accountId);
    }
  }

  /**
   * 获取账号状态
   */
  getAccountStatus(accountId: string): { active: boolean } {
    return {
      active: this.connections.has(accountId),
    };
  }

  // ──────────────────────────────────────────────
  // 消息处理
  // ──────────────────────────────────────────────

  private async handleMessage(
    accountId: string,
    data: DingtalkRawMessage,
    sessionWebhook: string
  ): Promise<void> {
    if (!data.senderId) return;

    // 构建 conversationId
    const rawConversationId = buildDingtalkConversationId(data);
    if (!rawConversationId) {
      console.warn(`[钉钉][${accountId}] 无法构建 conversationId`);
      return;
    }

    // 缓存 sessionWebhook
    this.sender.cacheSessionWebhook(rawConversationId, sessionWebhook);

    // 持久化 sessionWebhook（用于主动发送）
    if (data.sessionWebhookExpiredTime) {
      configStore.upsertDingtalkSessionWebhook(
        accountId,
        rawConversationId,
        sessionWebhook,
        data.sessionWebhookExpiredTime * 1000
      );
    }

    // 提取消息内容
    let content = '';
    if (data.text?.content) {
      content = data.text.content;
    } else if (data.content) {
      content = JSON.stringify(data.content);
    }

    // 构建 ChatId
    const chatId = encodeDingtalkChatId(accountId, rawConversationId);

    // 判断聊天类型
    const chatType = data.conversationType === '2' ? 'group' : 'p2p';

    // 构建事件
    const event: PlatformMessageEvent = {
      platform: 'dingtalk',
      conversationId: chatId,
      messageId: data.msgId || `dingtalk_${accountId}_${Date.now()}`,
      senderId: data.senderStaffId || data.senderId,
      senderType: 'user',
      content: content.trim(),
      msgType: data.msgtype || 'text',
      chatType,
      rawEvent: { accountId, originalMessage: data },
    };

    // 触发回调
    if (event.content) {
      for (const callback of this.messageCallbacks) {
        try {
          await Promise.resolve(callback(event));
        } catch (error) {
          console.error('[钉钉] 消息回调失败:', error);
        }
      }
    }
  }
}

// 单例导出
export const dingtalkAdapter = new DingtalkAdapter();