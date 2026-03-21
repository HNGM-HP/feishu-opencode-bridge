/**
 * WhatsApp 平台适配器
 *
 * 支持双模式：
 * - personal: 使用 baileys (WhatsApp Web 协议)
 * - business: 使用 WhatsApp Business API (HTTP API)
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
  type WAMessage,
  type ConnectionState,
} from '@whiskeysockets/baileys';
import type {
  PlatformAdapter,
  PlatformSender,
  PlatformMessageEvent,
  PlatformActionEvent,
} from '../types.js';
import { whatsappConfig } from '../../config.js';
import path from 'node:path';
import fs from 'node:fs';
import { Boom } from '@hapi/boom';

const WHATSAPP_MESSAGE_LIMIT = 4096;

/**
 * WhatsApp Personal 模式发送器实现 (baileys)
 */
class WhatsAppPersonalSender implements PlatformSender {
  constructor(private adapter: WhatsAppAdapter) {}

  private splitText(text: string): string[] {
    if (!text.trim()) {
      return [];
    }
    if (text.length <= WHATSAPP_MESSAGE_LIMIT) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > WHATSAPP_MESSAGE_LIMIT) {
      const candidate = remaining.slice(0, WHATSAPP_MESSAGE_LIMIT);
      const breakAt = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
      const cut = breakAt > Math.floor(WHATSAPP_MESSAGE_LIMIT * 0.5) ? breakAt : WHATSAPP_MESSAGE_LIMIT;
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    if (remaining.length > 0) {
      chunks.push(remaining);
    }
    return chunks;
  }

  async sendText(conversationId: string, text: string): Promise<string | null> {
    const socket = this.adapter.getSocket();
    if (!socket) {
      console.warn('[WhatsApp] Socket 未连接，无法发送文本消息');
      return null;
    }

    try {
      const chunks = this.splitText(text);
      let firstMessageId: string | null = null;

      for (const chunk of chunks) {
        const sent = await socket.sendMessage(conversationId, { text: chunk });
        if (sent?.key?.id) {
          if (!firstMessageId) {
            firstMessageId = sent.key.id;
          }
          this.adapter.rememberMessageConversation(sent.key.id, conversationId);
        }
      }
      return firstMessageId;
    } catch (error) {
      console.error('[WhatsApp] 发送文本消息失败:', error);
      return null;
    }
  }

  async sendCard(conversationId: string, card: object): Promise<string | null> {
    const socket = this.adapter.getSocket();
    if (!socket) {
      console.warn('[WhatsApp] Socket 未连接，无法发送卡片消息');
      return null;
    }

    try {
      // WhatsApp 支持多种消息类型，这里使用文本格式
      const cardPayload = card as { text?: string; content?: string; whatsappText?: string };
      const text = cardPayload.whatsappText || cardPayload.text || cardPayload.content || JSON.stringify(card, null, 2);

      const sent = await socket.sendMessage(conversationId, { text });
      if (sent?.key?.id) {
        this.adapter.rememberMessageConversation(sent.key.id, conversationId);
        return sent.key.id;
      }
      return null;
    } catch (error) {
      console.error('[WhatsApp] 发送卡片消息失败:', error);
      return null;
    }
  }

  async updateCard(messageId: string, card: object): Promise<boolean> {
    // WhatsApp 不支持直接更新消息
    console.warn('[WhatsApp] 不支持更新消息');
    return false;
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    const socket = this.adapter.getSocket();
    if (!socket) {
      console.warn('[WhatsApp] Socket 未连接，无法删除消息');
      return false;
    }

    const conversationId = this.adapter.getConversationByMessageId(messageId);
    if (!conversationId) {
      return false;
    }

    try {
      await socket.sendMessage(conversationId, {
        delete: {
          remoteJid: conversationId,
          fromMe: true,
          id: messageId,
        },
      });
      this.adapter.forgetMessageConversation(messageId);
      return true;
    } catch (error) {
      console.error('[WhatsApp] 删除消息失败:', error);
      return false;
    }
  }

  async reply(messageId: string, text: string): Promise<string | null> {
    const socket = this.adapter.getSocket();
    if (!socket) {
      console.warn('[WhatsApp] Socket 未连接，无法回复消息');
      return null;
    }

    const conversationId = this.adapter.getConversationByMessageId(messageId);
    if (!conversationId) {
      return null;
    }

    try {
      const chunks = this.splitText(text);
      let firstMessageId: string | null = null;

      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        if (!chunk) continue;

        // 第一条消息作为回复发送
        const sent = index === 0
          ? await socket.sendMessage(
              conversationId,
              { text: chunk },
              {
                quoted: {
                  key: {
                    remoteJid: conversationId,
                    fromMe: false,
                    id: messageId,
                  },
                  message: { conversation: '' },
                },
              }
            )
          : await socket.sendMessage(conversationId, { text: chunk });

        if (sent?.key?.id) {
          if (!firstMessageId) {
            firstMessageId = sent.key.id;
          }
          this.adapter.rememberMessageConversation(sent.key.id, conversationId);
        }
      }
      return firstMessageId;
    } catch (error) {
      console.error('[WhatsApp] 回复消息失败:', error);
      return null;
    }
  }

  async replyCard(messageId: string, card: object): Promise<string | null> {
    const conversationId = this.adapter.getConversationByMessageId(messageId);
    if (!conversationId) {
      return null;
    }
    return this.sendCard(conversationId, card);
  }
}

/**
 * WhatsApp Business API 发送器实现
 */
class WhatsAppBusinessSender implements PlatformSender {
  private phoneId: string;
  private accessToken: string;
  private baseUrl = 'https://graph.facebook.com/v18.0';

  constructor() {
    this.phoneId = whatsappConfig.businessPhoneId || '';
    this.accessToken = whatsappConfig.businessAccessToken || '';
  }

  private checkConfig(): boolean {
    if (!this.phoneId || !this.accessToken) {
      console.warn('[WhatsApp Business] 缺少配置 WHATSAPP_BUSINESS_PHONE_ID 或 WHATSAPP_BUSINESS_ACCESS_TOKEN');
      return false;
    }
    return true;
  }

  async sendText(conversationId: string, text: string): Promise<string | null> {
    if (!this.checkConfig()) return null;

    // 移除 @s.whatsapp.net 后缀，只保留电话号码
    const to = conversationId.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '');

    try {
      const response = await fetch(`${this.baseUrl}/${this.phoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      });

      const data = await response.json() as { messages?: Array<{ id: string }>; error?: { message: string } };
      if (data.error) {
        console.error('[WhatsApp Business] 发送失败:', data.error.message);
        return null;
      }
      return data.messages?.[0]?.id || null;
    } catch (error) {
      console.error('[WhatsApp Business] 发送文本消息失败:', error);
      return null;
    }
  }

  async sendCard(conversationId: string, card: object): Promise<string | null> {
    if (!this.checkConfig()) return null;

    const to = conversationId.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '');
    const cardPayload = card as {
      whatsappText?: string;
      text?: string;
      body?: string;
      buttons?: Array<{ id: string; title: string }>;
    };

    // 如果有按钮，使用 interactive 消息
    if (cardPayload.buttons && cardPayload.buttons.length > 0) {
      try {
        const response = await fetch(`${this.baseUrl}/${this.phoneId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'interactive',
            interactive: {
              type: 'button',
              body: { text: cardPayload.whatsappText || cardPayload.text || cardPayload.body || '请选择操作' },
              action: {
                buttons: cardPayload.buttons.slice(0, 3).map(btn => ({
                  type: 'reply',
                  reply: { id: btn.id, title: btn.title.slice(0, 20) },
                })),
              },
            },
          }),
        });

        const data = await response.json() as { messages?: Array<{ id: string }>; error?: { message: string } };
        if (data.error) {
          console.error('[WhatsApp Business] 发送交互消息失败:', data.error.message);
          return null;
        }
        return data.messages?.[0]?.id || null;
      } catch (error) {
        console.error('[WhatsApp Business] 发送交互消息失败:', error);
        return null;
      }
    }

    // 普通文本消息
    return this.sendText(conversationId, cardPayload.whatsappText || cardPayload.text || cardPayload.body || JSON.stringify(card, null, 2));
  }

  async updateCard(messageId: string, card: object): Promise<boolean> {
    console.warn('[WhatsApp Business] 不支持更新消息');
    return false;
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    if (!this.checkConfig()) return false;

    try {
      const response = await fetch(`${this.baseUrl}/${this.phoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          message_id: messageId,
          status: 'read',
        }),
      });

      const data = await response.json() as { success?: boolean; error?: { message: string } };
      return data.success === true;
    } catch (error) {
      console.error('[WhatsApp Business] 删除消息失败:', error);
      return false;
    }
  }
}

/**
 * WhatsApp 平台适配器实现
 */
export class WhatsAppAdapter implements PlatformAdapter {
  readonly platform = 'whatsapp' as const;

  private socket: WASocket | null = null;
  private qrCode: string | null = null;
  private isActive = false;
  private personalSender: WhatsAppPersonalSender | null = null;
  private businessSender: WhatsAppBusinessSender | null = null;
  private messageCallbacks: Array<(event: PlatformMessageEvent) => void> = [];
  private actionCallbacks: Array<(event: PlatformActionEvent) => void> = [];
  private readonly messageConversationMap = new Map<string, string>();

  constructor() {
    if (whatsappConfig.mode === 'personal') {
      this.personalSender = new WhatsAppPersonalSender(this);
    } else {
      this.businessSender = new WhatsAppBusinessSender();
    }
  }

  getSocket(): WASocket | null {
    return this.socket;
  }

  getConversationByMessageId(messageId: string): string | undefined {
    return this.messageConversationMap.get(messageId);
  }

  rememberMessageConversation(messageId: string, conversationId: string): void {
    this.messageConversationMap.set(messageId, conversationId);
  }

  forgetMessageConversation(messageId: string): void {
    this.messageConversationMap.delete(messageId);
  }

  async start(): Promise<void> {
    if (!whatsappConfig.enabled) {
      console.log('[WhatsApp] 适配器未启用，跳过启动');
      return;
    }

    if (whatsappConfig.mode === 'business') {
      await this.startBusinessMode();
    } else {
      await this.startPersonalMode();
    }
  }

  private async startPersonalMode(): Promise<void> {
    console.log('[WhatsApp] 启动 Personal 模式 (baileys)');

    const sessionPath = whatsappConfig.sessionPath || path.join(process.cwd(), 'data', 'whatsapp-session');

    // 确保目录存在
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }

    try {
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

      this.socket = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
      });

      // 连接状态更新
      this.socket.ev.on('connection.update', (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCode = qr;
          console.log('[WhatsApp] 请扫描二维码登录');
          console.log('[WhatsApp] 二维码已生成，可通过 getQrCode() 方法获取');
        }

        if (connection === 'close') {
          this.isActive = false;
          this.qrCode = null;

          const shouldReconnect = lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
            : true;

          console.log('[WhatsApp] 连接已关闭，原因:', lastDisconnect?.error?.message);

          if (shouldReconnect) {
            console.log('[WhatsApp] 尝试重新连接...');
            setTimeout(() => {
              this.startPersonalMode().catch(error => {
                console.error('[WhatsApp] 重连失败:', error);
              });
            }, 5000);
          } else {
            console.log('[WhatsApp] 账号已登出，需要重新扫码登录');
          }
        }

        if (connection === 'open') {
          this.isActive = true;
          this.qrCode = null;
          console.log('[WhatsApp] 已连接');
        }
      });

      // 凭证更新
      this.socket.ev.on('creds.update', saveCreds);

      // 消息接收
      this.socket.ev.on('messages.upsert', ({ messages, type }) => {
        if (type === 'notify') {
          for (const message of messages) {
            this.handleMessage(message);
          }
        }
      });

      console.log('[WhatsApp] Socket 初始化完成，等待连接');
    } catch (error) {
      console.error('[WhatsApp] 启动失败:', error);
      throw error;
    }
  }

  private async startBusinessMode(): Promise<void> {
    console.log('[WhatsApp] 启动 Business API 模式');

    if (!whatsappConfig.businessPhoneId || !whatsappConfig.businessAccessToken) {
      console.warn('[WhatsApp Business] 缺少必要配置:');
      console.warn('  - WHATSAPP_BUSINESS_PHONE_ID');
      console.warn('  - WHATSAPP_BUSINESS_ACCESS_TOKEN');
      return;
    }

    // Business API 模式需要配置 Webhook 接收消息
    // 这里只标记为活跃状态，实际消息接收需要通过 HTTP 服务
    this.isActive = true;
    console.log('[WhatsApp Business] 模式已启用');
    console.log('[WhatsApp Business] 注意：需要配置 Webhook 以接收消息');
  }

  stop(): void {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
    this.isActive = false;
    this.qrCode = null;
    this.messageConversationMap.clear();
    console.log('[WhatsApp] 适配器已停止');
  }

  getSender(): PlatformSender {
    if (whatsappConfig.mode === 'business' && this.businessSender) {
      return this.businessSender;
    }
    if (this.personalSender) {
      return this.personalSender;
    }
    // 返回一个空实现的 sender
    return {
      sendText: async () => null,
      sendCard: async () => null,
      updateCard: async () => false,
      deleteMessage: async () => false,
    };
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

  /**
   * 获取二维码（用于扫码登录）
   */
  async getQrCode(): Promise<string | null> {
    return this.qrCode;
  }

  private handleMessage(message: WAMessage): void {
    if (!message.key || message.key.fromMe) {
      return;
    }

    // 提取消息内容
    const content = this.extractMessageContent(message);
    if (!content) {
      return;
    }

    const conversationId = message.key.remoteJid;
    if (!conversationId) {
      return;
    }

    // 判断聊天类型
    const chatType = conversationId.endsWith('@g.us') ? 'group' : 'p2p';

    // 构建平台消息事件
    const event: PlatformMessageEvent = {
      platform: 'whatsapp',
      conversationId,
      messageId: message.key.id || '',
      senderId: message.key.participant || message.key.remoteJid || '',
      senderType: 'user',
      content,
      msgType: 'text',
      chatType,
      rawEvent: message,
    };

    // 记录消息与会话的映射
    if (message.key.id) {
      this.messageConversationMap.set(message.key.id, conversationId);
    }

    // 触发回调
    for (const callback of this.messageCallbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error('[WhatsApp] 消息回调执行失败:', error);
      }
    }
  }

  private extractMessageContent(message: WAMessage): string | null {
    if (!message.message) {
      return null;
    }

    const msg = message.message;

    // 文本消息
    if (msg.conversation) {
      return msg.conversation;
    }

    // 扩展文本消息（含链接预览等）
    if (msg.extendedTextMessage?.text) {
      return msg.extendedTextMessage.text;
    }

    // 图片消息
    if (msg.imageMessage?.caption) {
      return msg.imageMessage.caption;
    }

    // 视频消息
    if (msg.videoMessage?.caption) {
      return msg.videoMessage.caption;
    }

    // 文档消息
    if (msg.documentMessage?.caption) {
      return msg.documentMessage.caption;
    }

    // 位置消息
    if (msg.locationMessage) {
      const lat = msg.locationMessage.degreesLatitude;
      const lng = msg.locationMessage.degreesLongitude;
      return `[位置] ${lat}, ${lng}`;
    }

    // 联系人消息
    if (msg.contactMessage?.displayName) {
      return `[联系人] ${msg.contactMessage.displayName}`;
    }

    // 其他消息类型返回类型标识
    const messageType = Object.keys(msg)[0];
    return messageType ? `[${messageType}]` : null;
  }
}

// 单例导出
export const whatsappAdapter = new WhatsAppAdapter();