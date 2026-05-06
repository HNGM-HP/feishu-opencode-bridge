/**
 * Telegram 平台适配器
 *
 * 使用 grammy 库实现 PlatformAdapter 接口
 * 支持 Long Polling 模式连接 Telegram Bot API
 * 支持附件下载：photo、document、video、audio
 */

import type { File as TelegramFile } from '@grammyjs/types';
import type { Bot, Context, InlineKeyboard } from 'grammy';
import { telegramConfig } from '../../config.js';
import type {
  PlatformActionEvent,
  PlatformAdapter,
  PlatformAttachment,
  PlatformMessageEvent,
  PlatformSender,
} from '../types.js';

// 动态导入缓存：仅在启用时加载 grammy
type GrammyModule = typeof import('grammy');
let _grammyModule: GrammyModule | null = null;
async function getGrammyModule(): Promise<GrammyModule> {
  if (!_grammyModule) {
    _grammyModule = await import('grammy');
  }
  return _grammyModule;
}

const TELEGRAM_MESSAGE_LIMIT = 4096;
const TELEGRAM_FILE_BASE_URL = 'https://api.telegram.org/file/bot';

/**
 * Telegram 卡片载荷类型
 */
type TelegramCardPayload = {
  telegramText?: string;
  text?: string;
  markdown?: string;
  buttons?: Array<{
    text: string;
    callback_data: string;
  }>;
};

/**
 * Telegram 平台发送器实现
 */
class TelegramSender implements PlatformSender {
  constructor(private readonly adapter: TelegramAdapter) {}

  /**
   * 分割超长文本消息
   */
  private splitText(text: string): string[] {
    if (!text.trim()) {
      return [];
    }
    if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > TELEGRAM_MESSAGE_LIMIT) {
      const candidate = remaining.slice(0, TELEGRAM_MESSAGE_LIMIT);
      const breakAt = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
      const cut = breakAt > Math.floor(TELEGRAM_MESSAGE_LIMIT * 0.5) ? breakAt : TELEGRAM_MESSAGE_LIMIT;
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    if (remaining.length > 0) {
      chunks.push(remaining);
    }
    return chunks;
  }

  async sendText(conversationId: string, text: string): Promise<string | null> {
    const bot = this.adapter.getBot();
    if (!bot) {
      console.warn('[Telegram] Bot 未初始化，无法发送文本消息');
      return null;
    }

    const chunks = this.splitText(text);
    if (chunks.length === 0) {
      return null;
    }

    let firstMessageId: string | null = null;
    try {
      for (const chunk of chunks) {
        // 不使用 parse_mode，发送纯文本避免 MarkdownV2 转义问题
        const result = await bot.api.sendMessage(conversationId, chunk);
        this.adapter.rememberMessageConversation(String(result.message_id), conversationId);
        if (!firstMessageId) {
          firstMessageId = String(result.message_id);
        }
      }
      return firstMessageId;
    } catch (error) {
      console.error('[Telegram] 发送文本消息失败:', error);
      return null;
    }
  }

  async sendCard(conversationId: string, card: object): Promise<string | null> {
    const bot = this.adapter.getBot();
    if (!bot) {
      console.warn('[Telegram] Bot 未初始化，无法发送卡片消息');
      return null;
    }

    const payload = card as TelegramCardPayload;
    // 优先使用 telegramText（纯文本格式），避免 MarkdownV2 转义问题
    const content = payload.telegramText || payload.text || payload.markdown || JSON.stringify(card, null, 2);

    try {
      const keyboard = await this.buildInlineKeyboard(payload.buttons);
      // 不使用 parse_mode，发送纯文本避免 MarkdownV2 转义问题
      const result = await bot.api.sendMessage(conversationId, content, {
        reply_markup: keyboard,
      });

      this.adapter.rememberMessageConversation(String(result.message_id), conversationId);
      return String(result.message_id);
    } catch (error) {
      console.error('[Telegram] 发送卡片消息失败:', error);
      // 降级为普通文本发送
      return this.sendText(conversationId, content);
    }
  }

  async updateCard(messageId: string, card: object): Promise<boolean> {
    const bot = this.adapter.getBot();
    if (!bot) {
      console.warn('[Telegram] Bot 未初始化，无法更新卡片消息');
      return false;
    }

    const conversationId = this.adapter.getConversationByMessageId(messageId);
    if (!conversationId) {
      console.warn('[Telegram] 无法找到消息对应的会话 ID');
      return false;
    }

    try {
      const payload = card as TelegramCardPayload;
      // 优先使用 telegramText（纯文本格式）
      const content = payload.telegramText || payload.text || payload.markdown || JSON.stringify(card, null, 2);
      const keyboard = await this.buildInlineKeyboard(payload.buttons);

      // 不使用 parse_mode，发送纯文本
      await bot.api.editMessageText(conversationId, Number(messageId), content, {
        reply_markup: keyboard,
      });
      return true;
    } catch (error) {
      console.error('[Telegram] 更新卡片消息失败:', error);
      return false;
    }
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    const bot = this.adapter.getBot();
    if (!bot) {
      console.warn('[Telegram] Bot 未初始化，无法删除消息');
      return false;
    }

    const conversationId = this.adapter.getConversationByMessageId(messageId);
    if (!conversationId) {
      console.warn('[Telegram] 无法找到消息对应的会话 ID');
      return false;
    }

    try {
      await bot.api.deleteMessage(conversationId, Number(messageId));
      this.adapter.forgetMessageConversation(messageId);
      return true;
    } catch (error) {
      console.error('[Telegram] 删除消息失败:', error);
      return false;
    }
  }

  /**
   * 构建 InlineKeyboard
   */
  private async buildInlineKeyboard(buttons?: Array<{ text: string; callback_data: string }>): Promise<InlineKeyboard | undefined> {
    if (!buttons || buttons.length === 0) {
      return undefined;
    }

    const { InlineKeyboard } = await getGrammyModule();
    const keyboard = new InlineKeyboard();
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      if (!button) continue;
      keyboard.text(button.text, button.callback_data);
      if (i < buttons.length - 1) {
        keyboard.row();
      }
    }
    return keyboard;
  }
}

/**
 * Telegram 平台适配器实现
 */
export class TelegramAdapter implements PlatformAdapter {
  readonly platform = 'telegram' as const;

  private readonly sender: TelegramSender;
  private readonly messageCallbacks: Array<(event: PlatformMessageEvent) => void> = [];
  private readonly actionCallbacks: Array<(event: PlatformActionEvent) => void> = [];
  private readonly messageConversationMap = new Map<string, string>();
  private bot: Bot | null = null;
  private isActive = false;
  private botUsername: string | null = null;

  constructor() {
    this.sender = new TelegramSender(this);
  }

  getBot(): Bot | null {
    return this.bot;
  }

  async start(): Promise<void> {
    if (!telegramConfig.enabled) {
      console.log('[Telegram] 适配器未启用，跳过启动');
      return;
    }

    if (!telegramConfig.botToken) {
      console.warn('[Telegram] 已启用但缺少 TELEGRAM_BOT_TOKEN，适配器将保持不活跃状态');
      return;
    }

    if (this.bot) {
      console.warn('[Telegram] 适配器已存在 Bot 实例，跳过重复启动');
      return;
    }

    try {
      // 动态加载 grammy（节省内存，未启用时不加载）
      console.log('[Telegram] 动态加载 grammy SDK...');
      const { Bot } = await getGrammyModule();
      this.bot = new Bot(telegramConfig.botToken);

      // 获取 Bot 信息
      const botInfo = await this.bot.api.getMe();
      this.botUsername = botInfo.username || null;
      console.log(`[Telegram] 已连接: @${this.botUsername}`);

      // 监听消息事件
      this.bot.on('message', async (ctx: Context) => {
        await this.handleMessage(ctx);
      });

      // 监听回调查询事件（按钮点击）
      this.bot.on('callback_query', async (ctx: Context) => {
        await this.handleCallbackQuery(ctx);
      });

      // 启动 Long Polling（非阻塞，让 bot 在后台运行）
      this.bot.start({
        onStart: () => {
          this.isActive = true;
          console.log('[Telegram] Long Polling 已启动');
        },
      }).catch(error => {
        console.error('[Telegram] Long Polling 运行出错:', error);
        this.bot = null;
        this.isActive = false;
      });
      // 不等待 start() 完成，因为它是一个无限循环
      // 立即返回，让后续平台可以启动
    } catch (error) {
      console.error('[Telegram] 启动失败:', error);
      this.bot = null;
      this.isActive = false;
    }
  }

  stop(): void {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
      this.isActive = false;
      this.messageCallbacks.length = 0;
      this.actionCallbacks.length = 0;
      this.messageConversationMap.clear();
      console.log('[Telegram] 适配器已停止');
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

  isAdapterActive(): boolean {
    return this.isActive;
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

  forgetConversationMessages(conversationId: string): void {
    for (const [messageId, mappedConversationId] of this.messageConversationMap.entries()) {
      if (mappedConversationId === conversationId) {
        this.messageConversationMap.delete(messageId);
      }
    }
  }

  /**
   * 通过 file_id 下载 Telegram 文件
   * @param fileId Telegram 文件 ID
   * @returns 文件内容和元信息，或 null 表示下载失败
   */
  async downloadFile(fileId: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string } | null> {
    if (!this.bot) {
      console.warn('[Telegram] Bot 未初始化，无法下载文件');
      return null;
    }

    try {
      const fileInfo: TelegramFile = await this.bot.api.getFile(fileId);
      if (!fileInfo.file_path) {
        console.warn('[Telegram] getFile 返回的 file_path 为空');
        return null;
      }

      const fileUrl = `${TELEGRAM_FILE_BASE_URL}${telegramConfig.botToken}/${fileInfo.file_path}`;
      const response = await fetch(fileUrl);
      if (!response.ok) {
        console.error(`[Telegram] 下载文件失败: HTTP ${response.status}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 从 Content-Type 或 file_path 推断 MIME 类型
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const mimeType = contentType.split(';')[0]?.trim() || 'application/octet-stream';

      // 从 file_path 提取文件名
      const pathParts = fileInfo.file_path.split('/');
      const fileName = pathParts[pathParts.length - 1] || `file_${fileId}`;

      return { buffer, fileName, mimeType };
    } catch (error) {
      console.error('[Telegram] 下载文件失败:', error);
      return null;
    }
  }

  /**
   * 从消息中提取附件信息
   * 支持 photo、document、video、audio 类型
   */
  private extractAttachmentFromMessage(message: NonNullable<Context['message']>): PlatformAttachment[] | undefined {
    const attachments: PlatformAttachment[] = [];

    // 处理图片（选择最大尺寸）
    if (message.photo && message.photo.length > 0) {
      const largestPhoto = message.photo[message.photo.length - 1];
      if (largestPhoto?.file_id) {
        attachments.push({
          type: 'image',
          fileKey: largestPhoto.file_id,
          fileName: `photo_${largestPhoto.file_id.slice(0, 8)}.jpg`,
          fileType: 'image/jpeg',
          fileSize: largestPhoto.file_size,
        });
      }
    }

    // 处理文档
    if (message.document) {
      const doc = message.document;
      if (doc.file_id) {
        const isImage = doc.mime_type?.startsWith('image/');
        attachments.push({
          type: isImage ? 'image' : 'file',
          fileKey: doc.file_id,
          fileName: doc.file_name,
          fileType: doc.mime_type,
          fileSize: doc.file_size,
        });
      }
    }

    // 处理视频
    if (message.video) {
      const video = message.video;
      if (video.file_id) {
        attachments.push({
          type: 'file',
          fileKey: video.file_id,
          fileName: video.file_name,
          fileType: video.mime_type || 'video/mp4',
          fileSize: video.file_size,
        });
      }
    }

    // 处理音频
    if (message.audio) {
      const audio = message.audio;
      if (audio.file_id) {
        attachments.push({
          type: 'file',
          fileKey: audio.file_id,
          fileName: audio.file_name,
          fileType: audio.mime_type || 'audio/mpeg',
          fileSize: audio.file_size,
        });
      }
    }

    // 处理语音消息
    if (message.voice) {
      const voice = message.voice;
      if (voice.file_id) {
        attachments.push({
          type: 'file',
          fileKey: voice.file_id,
          fileName: `voice_${voice.file_id.slice(0, 8)}.ogg`,
          fileType: voice.mime_type || 'audio/ogg',
          fileSize: voice.file_size,
        });
      }
    }

    return attachments.length > 0 ? attachments : undefined;
  }

  /**
   * 确定消息类型
   */
  private determineMessageType(message: NonNullable<Context['message']>): string {
    if (message.photo && message.photo.length > 0) return 'image';
    if (message.document) return 'document';
    if (message.video) return 'video';
    if (message.audio) return 'audio';
    if (message.voice) return 'voice';
    if (message.text) return 'text';
    return 'unknown';
  }

  /**
   * 处理消息事件
   */
  private async handleMessage(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (!message) return;

    // 跳过自己发送的消息
    if (message.from?.is_bot) return;

    const chat = ctx.chat;
    if (!chat) return;

    const chatType = chat.type === 'private' ? 'p2p' : 'group';
    const text = message.text || message.caption || '';

    // 群聊检查：需要 @ 机器人才响应
    if (chatType === 'group' && this.botUsername) {
      const mentionPattern = new RegExp(`@${this.botUsername}`, 'i');
      if (!mentionPattern.test(text)) {
        // 群聊中未 @ 机器人，不响应
        return;
      }
    }

    // 清理消息内容（移除 @ 机器人的部分）
    let cleanedContent = text;
    if (this.botUsername) {
      const mentionPattern = new RegExp(`@${this.botUsername}`, 'gi');
      cleanedContent = text.replace(mentionPattern, '').trim();
    }

    // 提取附件信息
    const attachments = this.extractAttachmentFromMessage(message);
    const msgType = this.determineMessageType(message);

    // 构建平台通用事件
    const event: PlatformMessageEvent = {
      platform: 'telegram',
      conversationId: String(chat.id),
      messageId: String(message.message_id),
      senderId: String(message.from?.id || ''),
      senderType: 'user',
      content: cleanedContent,
      msgType,
      chatType: chatType as 'p2p' | 'group',
      attachments,
      rawEvent: ctx,
    };

    // 记录消息与会话的映射
    this.rememberMessageConversation(String(message.message_id), String(chat.id));

    // 触发消息回调
    for (const callback of this.messageCallbacks) {
      try {
        await Promise.resolve(callback(event));
      } catch (error) {
        console.error('[Telegram] 消息回调执行失败:', error);
      }
    }
  }

  /**
   * 处理回调查询事件（按钮点击）
   */
  private async handleCallbackQuery(ctx: Context): Promise<void> {
    const callbackQuery = ctx.callbackQuery;
    if (!callbackQuery) return;

    // 回复回调查询，避免客户端一直转圈
    await ctx.answerCallbackQuery().catch((error: unknown) => {
      console.error('[Telegram] 回复回调查询失败:', error);
    });

    const event: PlatformActionEvent = {
      platform: 'telegram',
      senderId: String(callbackQuery.from.id),
      action: {
        tag: callbackQuery.data || '',
        value: {},
      },
      token: callbackQuery.id,
      messageId: callbackQuery.message ? String(callbackQuery.message.message_id) : undefined,
      conversationId: callbackQuery.message?.chat ? String(callbackQuery.message.chat.id) : undefined,
      rawEvent: ctx,
    };

    // 触发动作回调
    for (const callback of this.actionCallbacks) {
      try {
        await Promise.resolve(callback(event));
      } catch (error) {
        console.error('[Telegram] 动作回调执行失败:', error);
      }
    }
  }
}

// 单例导出
export const telegramAdapter = new TelegramAdapter();
