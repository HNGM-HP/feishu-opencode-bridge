import * as lark from '@larksuiteoapi/node-sdk';
import { feishuConfig } from '../config.js';
import { EventEmitter } from 'events';

function formatError(error: unknown): { message: string; responseData?: unknown } {
  if (error instanceof Error) {
    const responseData = typeof error === 'object' && error !== null && 'response' in error
      ? (error as { response?: { data?: unknown } }).response?.data
      : undefined;
    return { message: `${error.name}: ${error.message}`, responseData };
  }

  const responseData = typeof error === 'object' && error !== null && 'response' in error
    ? (error as { response?: { data?: unknown } }).response?.data
    : undefined;

  let message = '';
  try {
    message = JSON.stringify(error);
  } catch {
    message = String(error);
  }

  return { message, responseData };
}

// 飞书事件数据类型（SDK 未导出，手动定义）
interface FeishuEventData {
  event_id?: string;
  token?: string;
  create_time?: string;
  event_type?: string;
  tenant_key?: string;
  ts?: string;
  uuid?: string;
  type?: string;
  app_id?: string;
  sender: {
    sender_id?: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
    sender_type: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    create_time: string;
    update_time?: string;
    chat_id: string;
    thread_id?: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      id: {
        union_id?: string;
        user_id?: string;
        open_id?: string;
      };
      name: string;
      tenant_key?: string;
    }>;
    user_agent?: string;
  };
}

// 消息事件类型
export interface FeishuMessageEvent {
  messageId: string;
  chatId: string;
  threadId?: string;
  chatType: 'p2p' | 'group';
  senderId: string;
  senderType: 'user' | 'bot';
  content: string;
  msgType: string;
  attachments?: FeishuAttachment[];
  mentions?: Array<{ key: string; id: { open_id: string }; name: string }>;
  rawEvent: FeishuEventData;
}

export interface FeishuAttachment {
  type: 'image' | 'file';
  fileKey: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function collectAttachmentsFromContent(content: unknown): FeishuAttachment[] {
  if (!content || typeof content !== 'object') return [];
  const attachments: FeishuAttachment[] = [];
  const visited = new Set<object>();
  const stack: unknown[] = [content];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current as object)) continue;
    visited.add(current as object);

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    const record = current as Record<string, unknown>;
    const imageKey = getString(record.image_key) || getString(record.imageKey);
    if (imageKey) {
      attachments.push({ type: 'image', fileKey: imageKey });
    }

    const fileKey = getString(record.file_key) || getString(record.fileKey);
    if (fileKey) {
      attachments.push({
        type: 'file',
        fileKey,
        fileName: getString(record.file_name) || getString(record.fileName),
        fileType: getString(record.file_type) || getString(record.fileType),
        fileSize: getNumber(record.file_size) || getNumber(record.fileSize),
      });
    }

    for (const value of Object.values(record)) {
      stack.push(value);
    }
  }

  return attachments;
}

function extractTextFromPost(content: unknown): string {
  if (!content || typeof content !== 'object') return '';
  const record = content as { content?: unknown; title?: unknown };
  const parts: string[] = [];
  const root = record.content;
  if (!root) return '';
  const stack: unknown[] = [root];
  const visited = new Set<object>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current as object)) continue;
    visited.add(current as object);

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    const node = current as Record<string, unknown>;
    const tag = getString(node.tag);
    if ((tag === 'text' || tag === 'a') && typeof node.text === 'string') {
      parts.push(node.text);
    }

    for (const value of Object.values(node)) {
      stack.push(value);
    }
  }

  return parts.join('');
}

// 卡片动作事件类型
export interface FeishuCardActionEvent {
  openId: string;
  action: {
    tag: string;
    value: Record<string, unknown>;
  };
  token: string;
  messageId?: string;
  chatId?: string;
  threadId?: string;
  rawEvent: unknown;
}

export type FeishuCardActionResponse = object;

class FeishuClient extends EventEmitter {
  private client: lark.Client;
  private wsClient: lark.WSClient | null = null;
  private eventDispatcher: lark.EventDispatcher;
  private cardActionHandler?: (event: FeishuCardActionEvent) => Promise<FeishuCardActionResponse | void>;

  constructor() {
    super();
    this.client = new lark.Client({
      appId: feishuConfig.appId,
      appSecret: feishuConfig.appSecret,
      disableTokenCache: false,
    });

    // 创建事件分发器
    this.eventDispatcher = new lark.EventDispatcher({
      encryptKey: feishuConfig.encryptKey,
      verificationToken: feishuConfig.verificationToken,
    });
  }

  // 启动长连接
  async start(): Promise<void> {
    console.log('[飞书] 正在启动长连接...');

    // 注册消息接收事件
    this.eventDispatcher.register({
      'im.message.receive_v1': (data) => {
        this.handleMessage(data as FeishuEventData);
        return { msg: 'ok' };
      },
    });

    // 注册卡片回调事件
    this.eventDispatcher.register({
      'card.action.trigger': async (data: unknown) => {
        return await this.handleCardAction(data);
      },
    } as unknown as Record<string, (data: unknown) => Promise<FeishuCardActionResponse | { msg: string }>>);

    this.wsClient = new lark.WSClient({
      appId: feishuConfig.appId,
      appSecret: feishuConfig.appSecret,
    });

    // 启动连接
    await this.wsClient.start({ eventDispatcher: this.eventDispatcher });
    console.log('[飞书] 长连接已建立');
  }

  // 处理接收到的消息
  private handleMessage(data: FeishuEventData): void {
    try {
      const message = data.message;
      const sender = data.sender;

      // 忽略机器人自己发的消息
      if (sender.sender_type === 'bot') {
        return;
      }

      const msgType = message.message_type;
      let content = '';
      let parsedContent: Record<string, unknown> | null = null;
      try {
        parsedContent = JSON.parse(message.content) as Record<string, unknown>;
        if (parsedContent && typeof parsedContent.text === 'string') {
          content = parsedContent.text;
        }
      } catch {
        content = message.content;
      }

      if (!content && parsedContent && msgType === 'post') {
        const postText = extractTextFromPost(parsedContent);
        if (postText) content = postText;
      }

      const attachments: FeishuAttachment[] = [];
      const attachmentMap = new Map<string, FeishuAttachment>();
      const addAttachment = (item: FeishuAttachment): void => {
        const key = `${item.type}:${item.fileKey}`;
        const existing = attachmentMap.get(key);
        if (!existing) {
          attachmentMap.set(key, item);
          return;
        }
        attachmentMap.set(key, {
          type: existing.type,
          fileKey: existing.fileKey,
          fileName: existing.fileName || item.fileName,
          fileType: existing.fileType || item.fileType,
          fileSize: existing.fileSize ?? item.fileSize,
        });
      };

      if (parsedContent && msgType === 'image') {
        const imageKey = getString(parsedContent.image_key) || getString(parsedContent.imageKey);
        if (imageKey) {
          addAttachment({ type: 'image', fileKey: imageKey });
        }
      }

      if (parsedContent && msgType === 'file') {
        const fileKey = getString(parsedContent.file_key) || getString(parsedContent.fileKey);
        if (fileKey) {
          addAttachment({
            type: 'file',
            fileKey,
            fileName: getString(parsedContent.file_name) || getString(parsedContent.fileName),
            fileType: getString(parsedContent.file_type) || getString(parsedContent.fileType),
            fileSize: getNumber(parsedContent.file_size) || getNumber(parsedContent.fileSize),
          });
        }
      }

      if (parsedContent) {
        const collected = collectAttachmentsFromContent(parsedContent);
        for (const item of collected) {
          addAttachment(item);
        }
      }

      attachments.push(...attachmentMap.values());

      // 移除@机器人的部分
      if (message.mentions) {
        for (const mention of message.mentions) {
          content = content.replace(mention.key, '').trim();
        }
      }

      const messageEvent: FeishuMessageEvent = {
        messageId: message.message_id,
        chatId: message.chat_id,
        threadId: message.thread_id,
        chatType: message.chat_type as 'p2p' | 'group',
        senderId: sender.sender_id?.open_id || '',
        senderType: sender.sender_type as 'user' | 'bot',
        content: content.trim(),
        msgType,
        attachments: attachments.length > 0 ? attachments : undefined,
        mentions: message.mentions?.map(m => ({
          key: m.key,
          id: { open_id: m.id.open_id || '' },
          name: m.name,
        })),
        rawEvent: data,
      };

      this.emit('message', messageEvent);
    } catch (error) {
      console.error('[飞书] 解析消息失败:', error);
    }
  }

  // 设置卡片动作处理器（支持直接返回新卡片）
  setCardActionHandler(handler: (event: FeishuCardActionEvent) => Promise<FeishuCardActionResponse | void>): void {
    this.cardActionHandler = handler;
  }

  // 处理卡片按钮点击（通过 CardActionHandler 处理，需要单独设置）
  private async handleCardAction(data: unknown): Promise<FeishuCardActionResponse | { msg: string }> {
    try {
      const event = data as {
        operator: { open_id: string };
        action: { tag: string; value: Record<string, unknown> };
        token: string;
        open_message_id?: string;
        message_id?: string;
        open_chat_id?: string;
        chat_id?: string;
        open_thread_id?: string;
        thread_id?: string;
      };

      const messageId = event.open_message_id || event.message_id;
      const chatId = event.open_chat_id || event.chat_id;
      const threadId = event.open_thread_id || event.thread_id;

      const cardEvent: FeishuCardActionEvent = {
        openId: event.operator.open_id,
        action: event.action,
        token: event.token,
        messageId,
        chatId,
        threadId,
        rawEvent: data,
      };

      if (this.cardActionHandler) {
        const response = await this.cardActionHandler(cardEvent);
        if (response !== undefined) {
          return response;
        }
        return { msg: 'ok' };
      }

      this.emit('cardAction', cardEvent);
      return { msg: 'ok' };
    } catch (error) {
      console.error('[飞书] 解析卡片事件失败:', error);
      return { msg: 'ok' };
    }
  }

  // 下载消息中的资源文件
  async downloadMessageResource(
    messageId: string,
    fileKey: string,
    type: 'image' | 'file' | 'audio' | 'video'
  ): Promise<{ writeFile: (filePath: string) => Promise<unknown>; headers: Record<string, unknown> } | null> {
    try {
      const response = await this.client.im.messageResource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type },
      });
      return {
        writeFile: response.writeFile,
        headers: response.headers as Record<string, unknown>,
      };
    } catch (error) {
      const formatted = formatError(error);
      console.error('[飞书] 下载消息资源失败:', formatted.message, formatted.responseData ?? '');
      return null;
    }
  }

  // 发送文本消息
  async sendText(chatId: string, text: string): Promise<string | null> {
    try {
      const response = await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });

      const msgId = response.data?.message_id || null;
      if (msgId) {
        console.log(`[飞书] 发送文字成功: msgId=${msgId.slice(0, 16)}...`);
      } else {
        console.log('[飞书] 发送文字返回空消息ID');
      }
      return msgId;
    } catch (error) {
      const formatted = formatError(error);
      const errCode = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: number }).code : undefined;
      console.error(`[飞书] 发送文字失败: code=${errCode}, ${formatted.message}`);
      return null;
    }
  }

  // 回复消息
  async reply(messageId: string, text: string): Promise<string | null> {
    try {
      const response = await this.client.im.message.reply({
        path: { message_id: messageId },
        data: {
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });

      const msgId = response.data?.message_id || null;
      if (msgId) {
        console.log(`[飞书] 回复成功: msgId=${msgId.slice(0, 16)}...`);
      } else {
        console.log('[飞书] 回复返回空消息ID');
      }
      return msgId;
    } catch (error) {
      const formatted = formatError(error);
      const errCode = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: number }).code : undefined;
      console.error(`[飞书] 回复失败: code=${errCode}, ${formatted.message}`);
      return null;
    }
  }

  // 回复卡片
  async replyCard(messageId: string, card: object): Promise<string | null> {
    try {
      const response = await this.client.im.message.reply({
        path: { message_id: messageId },
        data: {
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      });

      const msgId = response.data?.message_id || null;
      if (msgId) {
        console.log(`[飞书] 回复卡片成功: msgId=${msgId.slice(0, 16)}...`);
      } else {
        console.log('[飞书] 回复卡片返回空消息ID');
      }
      return msgId;
    } catch (error) {
      const formatted = formatError(error);
      const errCode = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: number }).code : undefined;
      console.error(`[飞书] 回复卡片失败: code=${errCode}, ${formatted.message}`);
      return null;
    }
  }

  // 更新卡片
  async updateCard(messageId: string, card: object): Promise<boolean> {
    try {
      const data = {
        msg_type: 'interactive',
        content: JSON.stringify(card),
      } as unknown as { content: string };
      await this.client.im.message.patch({
        path: { message_id: messageId },
        data,
      });
      console.log(`[飞书] 更新卡片成功: msgId=${messageId.slice(0, 16)}...`);
      return true;
    } catch (error) {
      const formatted = formatError(error);
      const errCode = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: number }).code : undefined;
      const errMsg = typeof error === 'object' && error !== null && 'msg' in error ? (error as { msg?: string }).msg : undefined;
      console.error(`[飞书] 更新卡片失败: code=${errCode}, msg=${errMsg}, msgId=${messageId}`);
      console.error(`[飞书] 更新卡片错误详情: ${formatted.message}`);
      if (formatted.responseData) {
        try {
          console.error(`[飞书] 响应数据: ${JSON.stringify(formatted.responseData).slice(0, 500)}`);
        } catch {
          // ignore
        }
      }
      return false;
    }
  }

  // 更新消息（用于定时刷新输出）
  async updateMessage(messageId: string, text: string): Promise<boolean> {
    try {
      await this.client.im.message.patch({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify({ text }),
        },
      });
      return true;
    } catch (error) {
      const formatted = formatError(error);
      console.error('[飞书] 更新消息失败:', formatted.message, formatted.responseData ?? '');
      return false;
    }
  }

  // 发送消息卡片
  async sendCard(chatId: string, card: object): Promise<string | null> {
    try {
      const response = await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      });

      const msgId = response.data?.message_id || null;
      if (msgId) {
        console.log(`[飞书] 发送卡片成功: msgId=${msgId.slice(0, 16)}...`);
      } else {
        console.log('[飞书] 发送卡片返回空消息ID');
      }
      return msgId;
    } catch (error) {
      const formatted = formatError(error);
      const errCode = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: number }).code : undefined;
      console.error(`[飞书] 发送卡片失败: code=${errCode}, ${formatted.message}`);
      return null;
    }
  }

  // 撤回消息
  async deleteMessage(messageId: string): Promise<boolean> {
    try {
      await this.client.im.message.delete({
        path: { message_id: messageId },
      });
      return true;
    } catch (error) {
      const formatted = formatError(error);
      console.error('[飞书] 撤回消息失败:', formatted.message, formatted.responseData ?? '');
      return false;
    }
  }

  // 指定群管理员
  async addChatManager(chatId: string, managerId: string, idType: 'open_id' | 'app_id'): Promise<boolean> {
    try {
      const response = await this.client.im.chatManagers.addManagers({
        path: { chat_id: chatId },
        params: { member_id_type: idType },
        data: { manager_ids: [managerId] },
      });

      return response.code === 0;
    } catch (error) {
      const formatted = formatError(error);
      console.error('[飞书] 设置群管理员失败:', formatted.message, formatted.responseData ?? '');
      return false;
    }
  }


  // 停止长连接
  stop(): void {
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
    console.log('[飞书] 已断开连接');
  }
}

// 单例导出
export const feishuClient = new FeishuClient();
