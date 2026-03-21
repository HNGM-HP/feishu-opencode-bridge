/**
 * 企业微信 (WeCom) 平台适配器
 *
 * 使用企业微信官方 SDK 实现 PlatformAdapter 接口
 * SDK: @wecom/aibot-node-sdk
 */

import { WSClient } from '@wecom/aibot-node-sdk';
import type { WsFrame, BaseMessage } from '@wecom/aibot-node-sdk';
import type {
  PlatformAdapter,
  PlatformSender,
  PlatformMessageEvent,
  PlatformActionEvent,
  PlatformAttachment,
} from '../types.js';
import { wecomConfig } from '../../config.js';

// 企业微信消息扩展类型（SDK BaseMessage 的扩展字段）
interface WeComMessageExt {
  text?: { content: string };
  image?: { url?: string; aeskey?: string };
  file?: {
    url?: string;
    aeskey?: string;
    name?: string;
    size?: number;
  };
  mixed?: {
    msg_item: Array<{
      msgtype: 'text' | 'image';
      text?: { content: string };
      image?: { url?: string; aeskey?: string };
    }>;
  };
}

type WeComMessageBody = BaseMessage & WeComMessageExt;

/**
 * 企业微信平台发送器实现
 */
class WeComSender implements PlatformSender {
  constructor(private adapter: WeComAdapter) {}

  async sendText(conversationId: string, text: string): Promise<string | null> {
    const wsClient = this.adapter.getWsClient();
    if (!wsClient) {
      console.warn('[WeCom] WSClient 未连接，无法发送文本消息');
      return null;
    }

    try {
      // 企业微信消息限制，使用 markdown 格式发送
      const chunks = this.splitText(text);
      let firstMessageId: string | null = null;

      for (const chunk of chunks) {
        const result = await wsClient.sendMessage(conversationId, {
          msgtype: 'markdown',
          markdown: { content: chunk },
        });
        const messageId = result?.headers?.req_id ?? `wecom-${Date.now()}`;
        if (!firstMessageId) {
          firstMessageId = messageId;
        }
      }
      return firstMessageId;
    } catch (error) {
      console.error('[WeCom] 发送文本消息失败:', error);
      return null;
    }
  }

  async sendCard(conversationId: string, card: object): Promise<string | null> {
    const wsClient = this.adapter.getWsClient();
    if (!wsClient) {
      console.warn('[WeCom] WSClient 未连接，无法发送卡片消息');
      return null;
    }

    try {
      // 企业微信卡片消息使用 markdown 格式
      const cardPayload = card as { markdown?: string; content?: string };
      const content = cardPayload.markdown || cardPayload.content || JSON.stringify(card, null, 2);

      const result = await wsClient.sendMessage(conversationId, {
        msgtype: 'markdown',
        markdown: { content },
      });
      return result?.headers?.req_id ?? null;
    } catch (error) {
      console.error('[WeCom] 发送卡片消息失败:', error);
      return null;
    }
  }

  async updateCard(messageId: string, card: object): Promise<boolean> {
    // 企业微信不支持直接更新消息，需要删除后重新发送
    // 这里暂时返回 false，表示不支持
    console.warn('[WeCom] 不支持更新消息');
    return false;
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    // 企业微信不支持撤回消息
    console.warn('[WeCom] 不支持删除消息');
    return false;
  }

  private splitText(text: string): string[] {
    const DISCORD_MESSAGE_LIMIT = 1800; // 使用较保守的限制
    if (!text.trim()) {
      return [];
    }
    if (text.length <= DISCORD_MESSAGE_LIMIT) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > DISCORD_MESSAGE_LIMIT) {
      const candidate = remaining.slice(0, DISCORD_MESSAGE_LIMIT);
      const breakAt = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
      const cut = breakAt > Math.floor(DISCORD_MESSAGE_LIMIT * 0.5) ? breakAt : DISCORD_MESSAGE_LIMIT;
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    if (remaining.length > 0) {
      chunks.push(remaining);
    }
    return chunks;
  }
}

/**
 * 企业微信平台适配器实现
 */
export class WeComAdapter implements PlatformAdapter {
  readonly platform = 'wecom' as const;

  private sender: WeComSender;
  private wsClient: WSClient | null = null;
  private messageCallbacks: Array<(event: PlatformMessageEvent) => void> = [];
  private actionCallbacks: Array<(event: PlatformActionEvent) => void> = [];
  private isActive = false;

  constructor() {
    this.sender = new WeComSender(this);
  }

  getWsClient(): WSClient | null {
    return this.wsClient;
  }

  async start(): Promise<void> {
    // 检查企业微信是否启用
    if (!wecomConfig.enabled) {
      console.log('[WeCom] 企业微信已禁用 (WECOM_ENABLED=false)，跳过启动');
      return;
    }

    // 检查企业微信配置是否完整
    if (!wecomConfig.botId || !wecomConfig.secret) {
      console.log('[WeCom] 适配器未配置，跳过启动');
      console.log('[WeCom] 如需启用企业微信，请配置 WECOM_BOT_ID 和 WECOM_SECRET');
      return;
    }

    console.log('[WeCom] 正在连接企业微信 WebSocket...');

    // 创建 WSClient 实例
    this.wsClient = new WSClient({
      botId: wecomConfig.botId,
      secret: wecomConfig.secret,
      wsUrl: 'wss://openws.work.weixin.qq.com',
      logger: {
        debug: (message: string, ...args: any[]) => console.debug(`[WeCom] ${message}`, ...args),
        info: (message: string, ...args: any[]) => console.info(`[WeCom] ${message}`, ...args),
        warn: (message: string, ...args: any[]) => console.warn(`[WeCom] ${message}`, ...args),
        error: (message: string, ...args: any[]) => console.error(`[WeCom] ${message}`, ...args),
      },
      heartbeatInterval: 30000,
      maxReconnectAttempts: 5,
      maxAuthFailureAttempts: 5,
    });

    // 监听连接事件
    this.wsClient.on('connected', () => {
      console.log('[WeCom] WebSocket 已连接');
    });

    // 监听认证成功事件
    this.wsClient.on('authenticated', () => {
      this.isActive = true;
      console.log('[WeCom] 认证成功');
    });

    // 监听断开事件
    this.wsClient.on('disconnected', (reason) => {
      console.log(`[WeCom] WebSocket 已断开：${reason}`);
      this.isActive = false;
    });

    // 监听错误事件
    this.wsClient.on('error', (error) => {
      console.error('[WeCom] WebSocket 错误:', error);
    });

    // 监听消息事件
    this.wsClient.on('message', async (frame: WsFrame<BaseMessage>) => {
      await this.handleMessage(frame);
    });

    // 连接 WebSocket
    this.wsClient.connect();
    console.log('[WeCom] WebSocket 连接请求已发送，等待认证...');
  }

  stop(): void {
    if (this.wsClient) {
      this.wsClient.disconnect();
      this.wsClient = null;
      this.isActive = false;
      console.log('[WeCom] 适配器已停止');
    }
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

  private async handleMessage(frame: WsFrame<BaseMessage>): Promise<void> {
    const body = frame.body as WeComMessageBody;
    if (!body) return;

    const chatId = body.chatid || body.from.userid;
    const chatType = body.chattype === 'group' ? 'group' : 'p2p';

    // 解析消息内容
    const { text, attachments } = this.parseMessageContent(body);

    // 跳过空消息
    if (!text && (!attachments || attachments.length === 0)) {
      console.log('[WeCom] 跳过空消息');
      return;
    }

    // 构建平台通用事件
    const event: PlatformMessageEvent = {
      platform: 'wecom',
      conversationId: chatId,
      messageId: body.msgid,
      senderId: body.from.userid,
      senderType: 'user',
      content: text || '',
      msgType: body.msgtype,
      chatType: chatType as 'p2p' | 'group',
      attachments,
      rawEvent: frame,
    };

    // 触发消息回调
    for (const callback of this.messageCallbacks) {
      try {
        await Promise.resolve(callback(event));
      } catch (error) {
        console.error('[WeCom] 消息回调执行失败:', error);
      }
    }
  }

  private parseMessageContent(body: WeComMessageBody): { text: string; attachments?: PlatformAttachment[] } {
    const textParts: string[] = [];
    const attachments: PlatformAttachment[] = [];

    // 处理图文混排消息
    if (body.msgtype === 'mixed' && body.mixed?.msg_item) {
      for (const item of body.mixed.msg_item) {
        if (item.msgtype === 'text' && item.text?.content) {
          textParts.push(item.text.content);
        } else if (item.msgtype === 'image' && item.image?.url) {
          attachments.push({
            type: 'image',
            fileKey: item.image.url,
            fileName: 'image',
            fileType: 'image',
          });
        }
      }
    } else {
      // 处理单条消息
      if (body.text?.content) {
        textParts.push(body.text.content);
      }

      // 处理图片消息
      if (body.image?.url) {
        attachments.push({
          type: 'image',
          fileKey: body.image.url,
          fileName: 'image',
          fileType: 'image/png',
        });
      }

      // 处理文件消息
      if (body.file?.url) {
        const fileName = body.file.name || 'file';
        const fileSize = body.file.size;
        attachments.push({
          type: 'file',
          fileKey: body.file.url,
          fileName,
          fileType: this.guessFileTypeFromName(fileName),
          fileSize,
        });
      }
    }

    return {
      text: textParts.join('\n').trim(),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  // 根据文件名猜测文件类型
  private guessFileTypeFromName(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      case 'pdf':
        return 'application/pdf';
      default:
        return 'application/octet-stream';
    }
  }
}

// 单例导出
export const wecomAdapter = new WeComAdapter();
