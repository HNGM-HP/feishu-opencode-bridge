/**
 * QQ 平台适配器
 *
 * 支持两种协议：
 * 1. official - QQ 官方频道机器人 API（稳定可靠）
 * 2. onebot - OneBot 协议（NapCat/go-cqhttp，社区方案）
 */

import WebSocket from 'ws';
import axios, { AxiosError } from 'axios';
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
const QQ_GATEWAY_URL = 'https://api.sgroup.qq.com/gateway/bot';

// WebSocket OpCode
const OpCode = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

// Intent 位掩码
const Intents = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C: 1 << 25,
  AUDIO_ACTION: 1 << 29,
  AT_MESSAGES: 1 << 30,
};

// 完整权限（群聊 + 私信 + 频道）
const FULL_INTENTS = Intents.AT_MESSAGES | Intents.DIRECT_MESSAGE | Intents.GROUP_AND_C2C;

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

type QQCardPayload = {
  qqText?: string;
  content?: string;
  text?: string;
  markdown?: string;
  forcePlainText?: boolean;
};

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

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

function splitMarkdownText(text: string, limit: number): string[] {
  if (!text.trim()) return [];
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  const lines = text.split('\n');
  const safeLimit = Math.max(256, limit - 8);
  let current = '';
  let openFence: string | null = null;

  const getLastFenceLine = (value: string): string | null => {
    const matches = value.match(/(^|\n)(```[^\n]*)/g);
    if (!matches || matches.length === 0) return null;
    return matches[matches.length - 1].replace(/^\n/, '');
  };

  const fenceCount = (value: string): number => (value.match(/```/g) || []).length;

  const pushCurrent = (): void => {
    if (!current.trim()) return;
    let chunk = current;
    if (fenceCount(chunk) % 2 === 1) {
      openFence = getLastFenceLine(chunk) || '```';
      chunk = `${chunk}\n\`\`\``;
    } else {
      openFence = null;
    }
    chunks.push(chunk);
    current = openFence ? `${openFence}\n` : '';
  };

  for (const line of lines) {
    const candidate = current
      ? `${current}${current.endsWith('\n') ? '' : '\n'}${line}`
      : line;
    if (candidate.length <= safeLimit) {
      current = candidate;
      continue;
    }

    if (current) {
      pushCurrent();
    }

    if (line.length <= safeLimit) {
      current = line;
      continue;
    }

    const pieces = splitText(line, safeLimit);
    for (let i = 0; i < pieces.length - 1; i += 1) {
      current = pieces[i];
      pushCurrent();
    }
    current = pieces[pieces.length - 1] || '';
  }

  if (current.trim()) {
    pushCurrent();
  }

  return chunks;
}

// ──────────────────────────────────────────────
// QQ 官方 API 客户端 (WebSocket 方式)
// ──────────────────────────────────────────────

type QQWSMessage = {
  op: number;
  s?: number;
  t?: string;
  d?: unknown;
};

type QQGatewayResponse = {
  url: string;
  shards?: number;
  session_start_limit?: {
    total: number;
    remaining: number;
    reset_after: number;
  };
};

type QQDispatchData = {
  id?: string;
  session_id?: string;
  content?: string;
  timestamp?: string;
  author?: {
    id?: string;
    user_openid?: string;
    member_openid?: string;
  };
  group_id?: string;
  channel_id?: string;
  guild_id?: string;
  attachments?: Array<{
    content_type?: string;
    filename?: string;
    url?: string;
    size?: number;
  }>;
};

class QQOfficialClient {
  private ws: WebSocket | null = null;
  private accessToken: string | null = null;
  private accessTokenExpiresAt: number = 0;
  private accessTokenPromise: Promise<string> | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs: number = 41250;
  private seq: number = 0;
  private sessionId: string | null = null;
  private isReconnect = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly appId: string,
    private readonly secret: string,
  ) {}

  private resetAccessToken(): void {
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.accessTokenPromise = null;
  }

  private isAccessTokenExpiredError(error: unknown): boolean {
    if (!(error instanceof AxiosError)) {
      return false;
    }

    const responseData = error.response?.data as {
      code?: number | string;
      err_code?: number | string;
      message?: string;
    } | undefined;

    const errorCode = responseData?.err_code ?? responseData?.code;
    const normalizedCode = typeof errorCode === 'string' ? Number(errorCode) : errorCode;
    if (normalizedCode === 11244) {
      return true;
    }

    const message = responseData?.message?.toLowerCase();
    return typeof message === 'string' && message.includes('token not exist or expire');
  }

  private async postMessage(
    endpoint: string,
    requestData: Record<string, unknown>,
    accessToken: string,
  ): Promise<string | null> {
    const response = await axios.post(endpoint, requestData, {
      headers: {
        'Authorization': `QQBot ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    return response.data?.id || response.data?.msg_id || null;
  }

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

  async connect(
    onMessage: (chatId: string, text: string, messageId: string, senderId: string, attachments?: PlatformAttachment[]) => Promise<void>,
  ): Promise<void> {
    try {
      const accessToken = await this.getValidAccessToken();

      // 获取 WebSocket Gateway URL
      console.log('[QQ Official] 获取 WebSocket Gateway...');
      const gatewayResponse = await axios.get<QQGatewayResponse>(QQ_GATEWAY_URL, {
        headers: {
          'Authorization': `QQBot ${accessToken}`,
        },
        timeout: 10000,
      });

      const wsUrl = gatewayResponse.data.url;
      if (!wsUrl) {
        throw new Error('无法获取 WebSocket Gateway URL');
      }

      console.log(`[QQ Official] 连接 WebSocket: ${wsUrl}`);
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log('[QQ Official] WebSocket 已连接');
        this.clearReconnectTimer();
      });

      this.ws.on('message', async (data) => {
        try {
          const msg: QQWSMessage = JSON.parse(data.toString());
          await this.handleWSMessage(msg, onMessage);
        } catch (error) {
          console.error('[QQ Official] 解析消息失败:', error);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[QQ Official] WebSocket 断开: code=${code}, reason=${reason}`);
        this.stopHeartbeat();
        this.scheduleReconnect(onMessage);
      });

      this.ws.on('error', (error) => {
        console.error('[QQ Official] WebSocket 错误:', error);
      });
    } catch (error) {
      console.error('[QQ Official] 连接失败:', error);
      this.scheduleReconnect(onMessage);
    }
  }

  private async handleWSMessage(
    msg: QQWSMessage,
    onMessage: (chatId: string, text: string, messageId: string, senderId: string, attachments?: PlatformAttachment[]) => Promise<void>,
  ): Promise<void> {
    // 更新序列号
    if (msg.s !== undefined) {
      this.seq = msg.s;
    }

    // HELLO - 连接成功，开始鉴权
    if (msg.op === OpCode.HELLO && msg.d) {
      const d = msg.d as { heartbeat_interval?: number };
      if (d.heartbeat_interval) {
        this.heartbeatIntervalMs = d.heartbeat_interval;
      }
      console.log(`[QQ Official] 收到 HELLO，心跳间隔 ${this.heartbeatIntervalMs}ms`);

      if (this.isReconnect && this.sessionId) {
        this.sendResume();
      } else {
        this.sendIdentify();
      }
      return;
    }

    // HEARTBEAT_ACK - 心跳响应
    if (msg.op === OpCode.HEARTBEAT_ACK) {
      this.startHeartbeat();
      return;
    }

    // RECONNECT - 需要重连
    if (msg.op === OpCode.RECONNECT) {
      console.log('[QQ Official] 收到 RECONNECT，准备重连');
      this.isReconnect = true;
      this.ws?.close();
      return;
    }

    // DISPATCH - 事件推送
    if (msg.op === OpCode.DISPATCH && msg.t) {
      await this.handleDispatch(msg.t, msg.d as QQDispatchData, onMessage);
    }
  }

  private sendIdentify(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.accessToken) {
      console.error('[QQ Official] 没有有效的 accessToken，无法鉴权');
      return;
    }

    // WebSocket 鉴权使用 QQBot {accessToken} 格式
    const token = `QQBot ${this.accessToken}`;

    const payload = {
      op: OpCode.IDENTIFY,
      d: {
        token,
        intents: FULL_INTENTS,
        shard: [0, 1],
      },
    };

    console.log('[QQ Official] 发送鉴权请求，intents:', FULL_INTENTS);
    this.ws.send(JSON.stringify(payload));
  }

  private sendResume(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.accessToken) {
      console.error('[QQ Official] 没有有效的 accessToken，无法重连');
      return;
    }

    const token = `QQBot ${this.accessToken}`;

    const payload = {
      op: OpCode.RESUME,
      d: {
        token,
        session_id: this.sessionId,
        seq: this.seq,
      },
    };

    console.log('[QQ Official] 发送 RESUME 请求');
    this.ws.send(JSON.stringify(payload));
  }

  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const payload = {
      op: OpCode.HEARTBEAT,
      d: this.seq,
    };

    this.ws.send(JSON.stringify(payload));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private scheduleReconnect(
    onMessage: (chatId: string, text: string, messageId: string, senderId: string, attachments?: PlatformAttachment[]) => Promise<void>,
  ): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.isReconnect = true;
      this.connect(onMessage);
    }, 5000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async handleDispatch(
    eventType: string,
    data: QQDispatchData,
    onMessage: (chatId: string, text: string, messageId: string, senderId: string, attachments?: PlatformAttachment[]) => Promise<void>,
  ): Promise<void> {
    // READY - 鉴权成功
    if (eventType === 'READY') {
      this.sessionId = data.session_id || null;
      console.log('[QQ Official] 鉴权成功，session_id:', this.sessionId);
      this.sendHeartbeat();
      return;
    }

    // RESUMED - 重连成功
    if (eventType === 'RESUMED') {
      console.log('[QQ Official] 重连成功');
      this.isReconnect = false;
      this.sendHeartbeat();
      return;
    }

    // 群聊 @ 消息
    if (eventType === 'AT_MESSAGE_CREATE' || eventType === 'GROUP_AT_MESSAGE_CREATE') {
      const chatId = `group_${data.group_id || data.channel_id || ''}`;
      const messageId = data.id || '';
      const senderId = data.author?.member_openid || data.author?.id || '';
      const content = data.content || '';

      // 提取附件
      const attachments = this.extractAttachments(data);

      if (content || attachments.length > 0) {
        console.log(`[QQ Official] 收到群消息: chatId=${chatId}, sender=${senderId}`);
        await onMessage(chatId, content, messageId, senderId, attachments.length > 0 ? attachments : undefined);
      }
      return;
    }

    // 私聊消息
    if (eventType === 'DIRECT_MESSAGE_CREATE' || eventType === 'C2C_MESSAGE_CREATE') {
      const chatId = `c2c_${data.author?.user_openid || data.author?.id || ''}`;
      const messageId = data.id || '';
      const senderId = data.author?.user_openid || data.author?.id || '';
      const content = data.content || '';

      // 提取附件
      const attachments = this.extractAttachments(data);

      if (content || attachments.length > 0) {
        console.log(`[QQ Official] 收到私聊消息: chatId=${chatId}, sender=${senderId}`);
        await onMessage(chatId, content, messageId, senderId, attachments.length > 0 ? attachments : undefined);
      }
      return;
    }

    // 其他事件类型记录日志
    console.log(`[QQ Official] 收到事件: ${eventType}`);
  }

  private extractAttachments(data: QQDispatchData): PlatformAttachment[] {
    const attachments: PlatformAttachment[] = [];

    if (!data.attachments || data.attachments.length === 0) {
      return attachments;
    }

    for (const att of data.attachments) {
      const contentType = att.content_type || '';
      const url = att.url || '';

      if (!url) continue;

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

  async sendMessage(chatId: string, text: string, msgId?: string): Promise<string | null> {
    return this.sendMarkdownMessage(chatId, text, msgId);
  }

  async sendPlainTextMessage(chatId: string, text: string, msgId?: string): Promise<string | null> {
    try {
      const isGroup = chatId.startsWith('group_');
      const targetId = chatId.replace(/^(group_|c2c_)/, '');

      const endpoint = isGroup
        ? `${QQ_API_BASE}/v2/groups/${targetId}/messages`
        : `${QQ_API_BASE}/v2/users/${targetId}/messages`;

      const requestData: Record<string, unknown> = {
        content: text,
        msg_type: 0,
      };

      if (isGroup && msgId) {
        requestData.msg_id = msgId;
      }

      try {
        const accessToken = await this.getValidAccessToken();
        return await this.postMessage(endpoint, requestData, accessToken);
      } catch (error) {
        if (!this.isAccessTokenExpiredError(error)) {
          throw error;
        }

        console.warn('[QQ Official] 发送纯文本消息时 Access Token 已失效，刷新后重试一次');
        this.resetAccessToken();
        const refreshedAccessToken = await this.getValidAccessToken();
        return await this.postMessage(endpoint, requestData, refreshedAccessToken);
      }
    } catch (error) {
      console.error('[QQ Official] 发送纯文本消息失败:', error);
      return null;
    }
  }

  async sendMarkdownMessage(chatId: string, markdown: string, msgId?: string): Promise<string | null> {
    try {
      const isGroup = chatId.startsWith('group_');
      const targetId = chatId.replace(/^(group_|c2c_)/, '');

      const endpoint = isGroup
        ? `${QQ_API_BASE}/v2/groups/${targetId}/messages`
        : `${QQ_API_BASE}/v2/users/${targetId}/messages`;

      const requestData: Record<string, unknown> = {
        markdown: {
          content: markdown,
        },
        msg_type: 2,
      };

      if (isGroup && msgId) {
        requestData.msg_id = msgId;
      }

      try {
        const accessToken = await this.getValidAccessToken();
        return await this.postMessage(endpoint, requestData, accessToken);
      } catch (error) {
        if (!this.isAccessTokenExpiredError(error)) {
          throw error;
        }

        console.warn('[QQ Official] 发送 Markdown 消息时 Access Token 已失效，刷新后重试一次');
        this.resetAccessToken();
        const refreshedAccessToken = await this.getValidAccessToken();
        return await this.postMessage(endpoint, requestData, refreshedAccessToken);
      }
    } catch (error) {
      console.error('[QQ Official] 发送 Markdown 消息失败:', error);
      return null;
    }
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
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
    const chunks = this.protocol === 'official'
      ? splitMarkdownText(text, QQ_MESSAGE_LIMIT)
      : splitText(text, QQ_MESSAGE_LIMIT);
    if (chunks.length === 0) return null;

    let firstMessageId: string | null = null;
    for (const chunk of chunks) {
      const messageId = this.protocol === 'official'
        ? await this.adapter.sendRawMarkdownMessage(conversationId, chunk)
        : await this.adapter.sendRawMessage(conversationId, chunk);
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
    if (this.protocol === 'official' && payload.forcePlainText) {
      const content = payload.qqText || payload.text || payload.content || payload.markdown || JSON.stringify(card);
      const chunks = splitText(content, QQ_MESSAGE_LIMIT);
      if (chunks.length === 0) return null;

      let firstMessageId: string | null = null;
      for (const chunk of chunks) {
        const messageId = await this.adapter.sendRawPlainTextMessage(conversationId, chunk);
        if (messageId && !firstMessageId) {
          firstMessageId = messageId;
        }
        if (messageId) {
          this.adapter.rememberMessageConversation(messageId, conversationId);
        }
      }
      return firstMessageId;
    }

    if (this.protocol === 'official' && payload.markdown) {
      const messageId = await this.adapter.sendRawMarkdownMessage(conversationId, payload.markdown);
      if (messageId) {
        this.adapter.rememberMessageConversation(messageId, conversationId);
      }
      return messageId;
    }

    const content = payload.qqText || payload.text || payload.markdown || payload.content || JSON.stringify(card);
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
    const { appId, secret } = qqConfig;

    if (!appId || !secret) {
      console.warn('[QQ Official] 缺少 QQ_APP_ID 或 QQ_SECRET，适配器将保持不活跃状态');
      return;
    }

    this.officialClient = new QQOfficialClient(appId, secret);

    await this.officialClient.connect(async (chatId, text, messageId, senderId, attachments) => {
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
      this.officialClient.disconnect();
      this.officialClient = null;
    }
    if (this.onebotClient) {
      this.onebotClient.disconnect();
      this.onebotClient = null;
    }
    this.isActive = false;
    this.messageConversationMap.clear();
    this.messageCallbacks.length = 0;
    this.actionCallbacks.length = 0;
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
      return this.officialClient.sendMarkdownMessage(conversationId, text);
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

  async sendRawMarkdownMessage(conversationId: string, markdown: string): Promise<string | null> {
    if (qqConfig.protocol === 'official' && this.officialClient) {
      return this.officialClient.sendMarkdownMessage(conversationId, markdown);
    }

    return this.sendRawMessage(conversationId, markdown);
  }

  async sendRawPlainTextMessage(conversationId: string, text: string): Promise<string | null> {
    if (qqConfig.protocol === 'official' && this.officialClient) {
      return this.officialClient.sendPlainTextMessage(conversationId, text);
    }

    return this.sendRawMessage(conversationId, text);
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
