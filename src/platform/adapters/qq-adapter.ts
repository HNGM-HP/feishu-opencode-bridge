/**
 * QQ 平台适配器
 *
 * 支持两种协议：
 * 1. official - QQ 官方频道机器人 API（稳定可靠）
 * 2. onebot - OneBot 协议（NapCat/go-cqhttp，社区方案）
 */

import WebSocket from 'ws';
import http from 'node:http';
import crypto from 'node:crypto';
import axios from 'axios';
import type {
  PlatformAdapter,
  PlatformMessageEvent,
  PlatformActionEvent,
  PlatformSender,
  PlatformAttachment,
} from '../types.js';
import { qqConfig } from '../../config.js';
import { chatSessionStore } from '../../store/chat-session.js';

const QQ_MESSAGE_LIMIT = 3000;
const QQ_API_BASE = 'https://api.sgroup.qq.com';
const QQ_OAUTH_BASE = 'https://bots.qq.com/app/getAppAccessToken';

// ──────────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────────

type QQProtocol = 'official' | 'onebot';

type OneBotEvent = {
  post_type: string;
  message_type?: string;
  message_id?: number;
  user_id?: number;
  group_id?: number;
  message?: string | OneBotMessageSegment[];
  raw_message?: string;
  self_id?: number;
};

type OneBotMessageSegment = {
  type: string;
  data: Record<string, unknown>;
};

// OneBot 附件类型映射
type OneBotAttachmentData = {
  file?: string;       // 文件名或 URL
  url?: string;        // 文件 URL
  filename?: string;   // 文件名
  size?: number;       // 文件大小
  file_size?: number;  // 文件大小（备用字段）
};

type QQMessage = {
  id: string;
  chat_type: 'group' | 'c2c';
  group_openid?: string;
  openid?: string;
  content: string;
  author: {
    user_openid?: string;
    member_openid?: string;
  };
  attachments?: Array<{
    content_type?: string;
    filename?: string;
    url?: string;
    size?: number;
  }>;
};

type QQCardPayload = {
  qqText?: string;
  content?: string;
};

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

function removeMarkdownFormatting(text: string): string {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '$1')
    .replace(/^---+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitText(text: string, limit: number): string[] {
  if (!text.trim()) return [];
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    const candidate = remaining.slice(0, limit);
    const breakAt = Math.max(
      candidate.lastIndexOf('\n'),
      candidate.lastIndexOf('。'),
      candidate.lastIndexOf('，'),
      candidate.lastIndexOf(' ')
    );
    const cut = breakAt > Math.floor(limit * 0.5) ? breakAt : limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
}

// ──────────────────────────────────────────────
// QQ 官方 API 客户端
// ──────────────────────────────────────────────

class QQOfficialClient {
  private accessToken: string | null = null;
  private accessTokenExpiresAt: number = 0;
  private accessTokenPromise: Promise<string> | null = null;
  private httpServer: http.Server | null = null;

  constructor(
    private readonly appId: string,
    private readonly secret: string,
    private readonly callbackUrl?: string,
    private readonly encryptKey?: string,
  ) {}

  private async fetchAccessToken(): Promise<string> {
    console.log('[QQ Official] 获取 Access Token...');
    const response = await axios({
      method: 'POST',
      url: QQ_OAUTH_BASE,
      data: {
        appId: this.appId,
        clientSecret: this.secret,
      },
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });

    const { access_token, expires_in } = response.data;
    if (!access_token) {
      throw new Error('Access token not found in response');
    }

    const expiresIn = typeof expires_in === 'number' ? expires_in : 7200;
    this.accessTokenExpiresAt = Date.now() + (expiresIn - 300) * 1000;
    this.accessToken = access_token;

    console.log(`[QQ Official] Access Token 获取成功，有效期 ${expiresIn}s`);
    return access_token;
  }

  private async getValidAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }
    if (this.accessTokenPromise) {
      return await this.accessTokenPromise;
    }
    this.accessTokenPromise = this.fetchAccessToken().finally(() => {
      this.accessTokenPromise = null;
    });
    return await this.accessTokenPromise;
  }

  async sendMessage(chatId: string, text: string, msgId?: string): Promise<string | null> {
    try {
      const content = removeMarkdownFormatting(text);
      const accessToken = await this.getValidAccessToken();
      const isGroup = chatId.startsWith('group_');
      const targetId = chatId.replace(/^(group_|c2c_)/, '');

      const endpoint = isGroup
        ? `${QQ_API_BASE}/v2/groups/${targetId}/messages`
        : `${QQ_API_BASE}/v2/users/${targetId}/messages`;

      const requestData: Record<string, unknown> = {
        content,
        msg_type: 0,
      };

      if (isGroup && msgId) {
        requestData.msg_id = msgId;
      }

      const response = await axios.post(endpoint, requestData, {
        headers: {
          'Authorization': `QQBot ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      return response.data?.id || response.data?.msg_id || null;
    } catch (error) {
      console.error('[QQ Official] 发送消息失败:', error);
      return null;
    }
  }

  async startWebhook(
    onMessage: (chatId: string, text: string, messageId: string, senderId: string, attachments?: PlatformAttachment[]) => Promise<void>,
  ): Promise<void> {
    const port = this.callbackUrl ? this.extractPort(this.callbackUrl) : 8080;

    this.httpServer = http.createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          if (!rawBody) {
            res.end();
            return;
          }

          let body: Record<string, unknown> = JSON.parse(rawBody);

          // 处理加密消息
          const encrypted = typeof body.encrypt === 'string' ? body.encrypt : '';
          if (encrypted && this.encryptKey) {
            const decrypted = this.decryptEvent(encrypted, this.encryptKey);
            body = JSON.parse(decrypted);
          }

          // 回调验证
          if (body.op === 13) {
            const validationData = typeof body.d === 'string' ? JSON.parse(body.d) : body.d;
            const plainToken = validationData?.plain_token || '';
            const eventTs = validationData?.event_ts || '';

            const signature = this.validateCallbackEd25519(plainToken, eventTs);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ plain_token: plainToken, signature }));
            return;
          }

          // 处理消息事件
          if (body.op === 0 && body.d) {
            const eventType = body.t as string;
            if (eventType === 'C2C_MESSAGE_CREATE' || eventType === 'GROUP_AT_MESSAGE_CREATE') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ code: 0 }));

              const msg = body.d as QQMessage;
              const chatId = eventType === 'GROUP_AT_MESSAGE_CREATE'
                ? `group_${msg.group_openid || ''}`
                : `c2c_${msg.author.user_openid || ''}`;
              const messageId = msg.id;
              const senderId = msg.chat_type === 'group'
                ? msg.author?.member_openid || ''
                : msg.author?.user_openid || '';
              const content = msg.content || '';

              // 提取附件
              const attachments = this.extractOfficialAttachments(msg);

              if (content || attachments.length > 0) {
                console.log(`[QQ Official] 收到消息: chatId=${chatId}, sender=${senderId}, attachments=${attachments.length}`);
                await onMessage(chatId, content, messageId, senderId, attachments.length > 0 ? attachments : undefined);
              }
              return;
            }
          }

          res.writeHead(200);
          res.end('OK');
        } catch (error) {
          console.error('[QQ Official] Webhook 处理错误:', error);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end();
          }
        }
      });
    });

    this.httpServer.listen(port, () => {
      console.log(`[QQ Official] Webhook 服务已启动，端口 ${port}`);
    });
  }

  async stop(): Promise<void> {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }

  private extractPort(url: string): number {
    try {
      const parsed = new URL(url);
      return parsed.port ? parseInt(parsed.port, 10) : 80;
    } catch {
      return 8080;
    }
  }

  private decryptEvent(encrypted: string, encryptKey: string): string {
    const key = crypto.createHash('sha256').update(encryptKey).digest();
    const encryptedBuffer = Buffer.from(encrypted, 'base64');
    const iv = encryptedBuffer.subarray(0, 16);
    const ciphertext = encryptedBuffer.subarray(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private validateCallbackEd25519(plainToken: string, eventTs: string): string {
    // 简化实现，生产环境应使用 @noble/ed25519 或 tweetnacl
    const message = eventTs + plainToken;
    const keyMaterial = crypto.createHmac('sha256', this.secret).digest();
    return crypto.createHmac('sha256', keyMaterial).update(Buffer.from(message, 'utf8')).digest('hex');
  }

  /**
   * 从 QQ 官方消息中提取附件
   */
  private extractOfficialAttachments(msg: QQMessage): PlatformAttachment[] {
    const attachments: PlatformAttachment[] = [];

    if (!msg.attachments || msg.attachments.length === 0) {
      return attachments;
    }

    for (const att of msg.attachments) {
      const contentType = att.content_type || '';
      const url = att.url || '';

      if (!url) continue;

      // 判断附件类型
      let type: 'image' | 'file' = 'file';
      if (contentType.startsWith('image/')) {
        type = 'image';
      }

      attachments.push({
        type,
        fileKey: url,
        fileName: att.filename,
        fileType: contentType,
        fileSize: att.size,
      });
    }

    return attachments;
  }
}

// ──────────────────────────────────────────────
// OneBot 客户端
// ──────────────────────────────────────────────

class OneBotClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isActive = false;
  private selfId: number | null = null;

  constructor(
    private readonly wsUrl: string,
    private readonly messageHandler: (event: PlatformMessageEvent) => void,
  ) {}

  connect(): void {
    if (this.ws) return;

    console.log(`[QQ OneBot] 正在连接 WebSocket: ${this.wsUrl}`);
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      console.log('[QQ OneBot] WebSocket 已连接');
      this.isActive = true;
      this.clearReconnectTimer();
    });

    this.ws.on('message', data => {
      try {
        const event = JSON.parse(data.toString());
        this.handleEvent(event);
      } catch (error) {
        console.error('[QQ OneBot] 解析消息失败:', error);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[QQ OneBot] WebSocket 断开: code=${code}, reason=${reason}`);
      this.isActive = false;
      this.scheduleReconnect();
    });

    this.ws.on('error', error => {
      console.error('[QQ OneBot] WebSocket 错误:', error);
    });
  }

  disconnect(): void {
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isActive = false;
  }

  isActiveState(): boolean {
    return this.isActive;
  }

  async sendApi(action: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket 未连接'));
        return;
      }

      const echo = Date.now().toString();
      const payload = JSON.stringify({ action, params, echo });

      const handler = (data: WebSocket.Data) => {
        try {
          const resp = JSON.parse(data.toString());
          if (resp.echo === echo) {
            this.ws?.off('message', handler);
            if (resp.status === 'ok') {
              resolve(resp.data);
            } else {
              reject(new Error(`OneBot API 错误: ${resp.retcode}`));
            }
          }
        } catch {
          // 忽略解析错误
        }
      };

      this.ws.on('message', handler);
      this.ws.send(payload);

      setTimeout(() => {
        this.ws?.off('message', handler);
        reject(new Error('OneBot API 超时'));
      }, 10000);
    });
  }

  private handleEvent(event: OneBotEvent): void {
    if (event.self_id) {
      this.selfId = event.self_id;
    }

    if (event.post_type !== 'message') return;

    const content = this.parseMessageContent(event);
    const attachments = this.parseAttachments(event);
    if (!content.trim() && attachments.length === 0) return;

    const isGroup = event.message_type === 'group';
    const conversationId = isGroup
      ? `${event.group_id}_group_`
      : `${event.user_id}`;
    const messageId = event.message_id?.toString() || String(Date.now());

    const platformEvent: PlatformMessageEvent = {
      platform: 'qq',
      conversationId,
      messageId,
      senderId: event.user_id?.toString() || '',
      senderType: 'user',
      content,
      msgType: attachments.length > 0 && !content.trim() ? 'attachment' : 'text',
      chatType: isGroup ? 'group' : 'p2p',
      attachments: attachments.length > 0 ? attachments : undefined,
      rawEvent: event,
    };

    this.messageHandler(platformEvent);
  }

  private parseMessageContent(event: OneBotEvent): string {
    if (event.raw_message) {
      return this.parseCQCode(event.raw_message);
    }
    if (Array.isArray(event.message)) {
      return event.message
        .filter(seg => seg.type === 'text')
        .map(seg => (seg.data?.text as string) || '')
        .join('')
        .trim();
    }
    if (typeof event.message === 'string') {
      return this.parseCQCode(event.message);
    }
    return '';
  }

  private parseCQCode(raw: string): string {
    return raw
      .replace(/\[CQ:[^\]]+\]/g, match => {
        const qqMatch = match.match(/qq=(\d+)/);
        if (qqMatch && match.includes('at')) {
          return `@${qqMatch[1]}`;
        }
        return '';
      })
      .trim();
  }

  /**
   * 解析 OneBot 消息中的附件
   * 支持：image, file, video, record 等类型
   */
  private parseAttachments(event: OneBotEvent): PlatformAttachment[] {
    const attachments: PlatformAttachment[] = [];

    // 处理数组格式的消息段
    if (Array.isArray(event.message)) {
      for (const seg of event.message) {
        const att = this.parseMessageSegment(seg);
        if (att) {
          attachments.push(att);
        }
      }
    }

    // 处理字符串格式（CQ码）
    if (typeof event.message === 'string' || typeof event.raw_message === 'string') {
      const raw = (event.raw_message || event.message) as string;
      const cqAttachments = this.parseCQCodeAttachments(raw);
      attachments.push(...cqAttachments);
    }

    return attachments;
  }

  /**
   * 解析单个消息段
   */
  private parseMessageSegment(seg: OneBotMessageSegment): PlatformAttachment | null {
    const { type, data } = seg;

    if (type === 'image') {
      const imageData = data as OneBotAttachmentData;
      const fileKey = imageData.url || imageData.file || '';
      if (!fileKey) return null;

      return {
        type: 'image',
        fileKey,
        fileName: imageData.filename || this.extractFilename(fileKey),
        fileType: 'image',
        fileSize: imageData.size || imageData.file_size,
      };
    }

    if (type === 'file') {
      const fileData = data as OneBotAttachmentData;
      const fileKey = fileData.url || fileData.file || '';
      if (!fileKey) return null;

      return {
        type: 'file',
        fileKey,
        fileName: fileData.filename || this.extractFilename(fileKey),
        fileSize: fileData.size || fileData.file_size,
      };
    }

    // video 和 record 作为 file 处理
    if (type === 'video' || type === 'record') {
      const mediaData = data as OneBotAttachmentData;
      const fileKey = mediaData.url || mediaData.file || '';
      if (!fileKey) return null;

      return {
        type: 'file',
        fileKey,
        fileName: mediaData.filename || this.extractFilename(fileKey),
        fileType: type === 'video' ? 'video' : 'audio',
        fileSize: mediaData.size || mediaData.file_size,
      };
    }

    return null;
  }

  /**
   * 解析 CQ 码中的附件
   */
  private parseCQCodeAttachments(raw: string): PlatformAttachment[] {
    const attachments: PlatformAttachment[] = [];

    // 匹配 [CQ:image,file=xxx] 或 [CQ:file,url=xxx] 等
    const cqRegex = /\[CQ:(image|file|video|record),([^\]]+)\]/g;
    let match;

    while ((match = cqRegex.exec(raw)) !== null) {
      const type = match[1] as 'image' | 'file' | 'video' | 'record';
      const params = match[2];

      // 解析参数
      const urlMatch = params.match(/(?:file|url)=([^,\]]+)/);
      const filenameMatch = params.match(/filename=([^,\]]+)/);
      const sizeMatch = params.match(/size=(\d+)/);

      if (urlMatch) {
        const fileKey = urlMatch[1];
        attachments.push({
          type: type === 'image' ? 'image' : 'file',
          fileKey,
          fileName: filenameMatch?.[1] || this.extractFilename(fileKey),
          fileType: type === 'image' ? 'image' : type === 'video' ? 'video' : type === 'record' ? 'audio' : undefined,
          fileSize: sizeMatch ? parseInt(sizeMatch[1], 10) : undefined,
        });
      }
    }

    return attachments;
  }

  /**
   * 从 URL 或文件路径中提取文件名
   */
  private extractFilename(fileKey: string): string {
    try {
      const url = new URL(fileKey);
      const pathname = url.pathname;
      const parts = pathname.split('/');
      return parts[parts.length - 1] || 'attachment';
    } catch {
      // 不是 URL，尝试作为文件路径处理
      const parts = fileKey.split(/[/\\]/);
      return parts[parts.length - 1] || 'attachment';
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wsUrl) {
        console.log('[QQ OneBot] 尝试重新连接...');
        this.ws = null;
        this.connect();
      }
    }, 5000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

// ──────────────────────────────────────────────
// QQ Sender 实现
// ──────────────────────────────────────────────

class QQSender implements PlatformSender {
  constructor(
    private readonly adapter: QQAdapter,
    private readonly protocol: QQProtocol,
  ) {}

  async sendText(conversationId: string, text: string): Promise<string | null> {
    const chunks = splitText(text, QQ_MESSAGE_LIMIT);
    if (chunks.length === 0) return null;

    let firstMessageId: string | null = null;
    for (const chunk of chunks) {
      const messageId = await this.adapter.sendRawMessage(conversationId, chunk);
      if (messageId && !firstMessageId) {
        firstMessageId = messageId;
      }
      if (messageId) {
        this.adapter.rememberMessageConversation(messageId, conversationId);
      }
    }
    return firstMessageId;
  }

  async sendCard(conversationId: string, card: object): Promise<string | null> {
    const payload = card as QQCardPayload;
    const content = payload.qqText || payload.content || JSON.stringify(card);
    return this.sendText(conversationId, content);
  }

  async updateCard(_messageId: string, _card: object): Promise<boolean> {
    // QQ 不支持消息编辑
    return false;
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    return this.adapter.deleteMessage(messageId);
  }

  async reply(messageId: string, text: string): Promise<string | null> {
    const conversationId = this.adapter.getConversationByMessageId(messageId);
    if (!conversationId) return null;
    return this.sendText(conversationId, text);
  }

  async replyCard(messageId: string, card: object): Promise<string | null> {
    const conversationId = this.adapter.getConversationByMessageId(messageId);
    if (!conversationId) return null;
    return this.sendCard(conversationId, card);
  }
}

// ──────────────────────────────────────────────
// QQ 适配器主类
// ──────────────────────────────────────────────

export class QQAdapter implements PlatformAdapter {
  readonly platform = 'qq' as const;

  private readonly sender: QQSender;
  private readonly messageCallbacks: Array<(event: PlatformMessageEvent) => void> = [];
  private readonly actionCallbacks: Array<(event: PlatformActionEvent) => void> = [];
  private readonly messageConversationMap = new Map<string, string>();

  // 协议客户端
  private officialClient: QQOfficialClient | null = null;
  private onebotClient: OneBotClient | null = null;
  private isActive = false;

  constructor() {
    this.sender = new QQSender(this, qqConfig.protocol);
  }

  async start(): Promise<void> {
    if (!qqConfig.enabled) {
      console.log('[QQ] 适配器未启用，跳过启动');
      return;
    }

    const protocol = qqConfig.protocol;

    if (protocol === 'official') {
      await this.startOfficialProtocol();
    } else {
      await this.startOneBotProtocol();
    }
  }

  private async startOfficialProtocol(): Promise<void> {
    const { appId, secret, callbackUrl, encryptKey } = qqConfig;

    if (!appId || !secret) {
      console.warn('[QQ Official] 缺少 QQ_APP_ID 或 QQ_SECRET，适配器将保持不活跃状态');
      return;
    }

    this.officialClient = new QQOfficialClient(appId, secret, callbackUrl, encryptKey);

    await this.officialClient.startWebhook(async (chatId, text, messageId, senderId, attachments) => {
      const event: PlatformMessageEvent = {
        platform: 'qq',
        conversationId: chatId,
        messageId,
        senderId,
        senderType: 'user',
        content: text,
        msgType: attachments && attachments.length > 0 && !text.trim() ? 'attachment' : 'text',
        chatType: chatId.startsWith('group_') ? 'group' : 'p2p',
        attachments,
        rawEvent: {},
      };

      this.rememberMessageConversation(messageId, chatId);

      for (const callback of this.messageCallbacks) {
        try {
          callback(event);
        } catch (error) {
          console.error('[QQ Official] 消息回调执行失败:', error);
        }
      }
    });

    this.isActive = true;
    console.log('[QQ Official] 适配器已启动');
  }

  private async startOneBotProtocol(): Promise<void> {
    const { onebotWsUrl } = qqConfig;

    if (!onebotWsUrl) {
      console.warn('[QQ OneBot] 缺少 QQ_ONEBOT_WS_URL，适配器将保持不活跃状态');
      return;
    }

    this.onebotClient = new OneBotClient(onebotWsUrl, event => {
      this.rememberMessageConversation(event.messageId, event.conversationId);

      for (const callback of this.messageCallbacks) {
        try {
          callback(event);
        } catch (error) {
          console.error('[QQ OneBot] 消息回调执行失败:', error);
        }
      }
    });

    this.onebotClient.connect();
    this.isActive = true;
    console.log('[QQ OneBot] 适配器已启动');
  }

  stop(): void {
    if (this.officialClient) {
      this.officialClient.stop();
      this.officialClient = null;
    }
    if (this.onebotClient) {
      this.onebotClient.disconnect();
      this.onebotClient = null;
    }
    this.isActive = false;
    this.messageConversationMap.clear();
    console.log('[QQ] 适配器已停止');
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
    if (qqConfig.protocol === 'official') {
      return this.officialClient !== null;
    }
    return this.onebotClient?.isActiveState() ?? false;
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

  async sendRawMessage(conversationId: string, text: string): Promise<string | null> {
    if (qqConfig.protocol === 'official' && this.officialClient) {
      return this.officialClient.sendMessage(conversationId, text);
    }

    if (qqConfig.protocol === 'onebot' && this.onebotClient) {
      const isGroup = conversationId.includes('_group_');
      const targetId = conversationId.replace('_group_', '');

      try {
        const action = isGroup ? 'send_group_msg' : 'send_private_msg';
        const params = isGroup
          ? { group_id: parseInt(targetId, 10), message: text }
          : { user_id: parseInt(targetId, 10), message: text };

        const result = await this.onebotClient.sendApi(action, params) as { message_id: number } | null;
        return result?.message_id?.toString() || null;
      } catch (error) {
        console.error('[QQ OneBot] 发送消息失败:', error);
        return null;
      }
    }

    return null;
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    if (qqConfig.protocol === 'onebot' && this.onebotClient) {
      try {
        await this.onebotClient.sendApi('delete_msg', {
          message_id: parseInt(messageId, 10),
        });
        this.forgetMessageConversation(messageId);
        return true;
      } catch (error) {
        console.error('[QQ OneBot] 删除消息失败:', error);
        return false;
      }
    }
    // QQ 官方 API 不支持消息撤回
    return false;
  }

  bindSession(conversationId: string, sessionId: string, creatorId: string): void {
    chatSessionStore.setSessionByConversation('qq', conversationId, sessionId, creatorId);
    console.log(`[QQ] 会话绑定: qq:${conversationId} -> ${sessionId}`);
  }

  getSessionId(conversationId: string): string | null {
    return chatSessionStore.getSessionIdByConversation('qq', conversationId);
  }
}

export const qqAdapter = new QQAdapter();