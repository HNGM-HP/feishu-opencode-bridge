/**
 * Telegram 平台适配器
 *
 * 使用 grammy 库实现 PlatformAdapter 接口
 * 支持 Long Polling 模式连接 Telegram Bot API
 */

import { Bot, InlineKeyboard, type Context } from 'grammy';
import type {
  PlatformAdapter,
  PlatformSender,
  PlatformMessageEvent,
  PlatformActionEvent,
} from '../types.js';
import { telegramConfig } from '../../config.js';

const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Telegram 卡片载荷类型
 */
type TelegramCardPayload = {
  telegramText?: string;
  text?: string;
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

  /**
   * 转义 MarkdownV2 特殊字符
   */
  private escapeMarkdownV2(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
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
        const result = await bot.api.sendMessage(conversationId, chunk, {
          parse_mode: 'MarkdownV2',
        });
        this.adapter.rememberMessageConversation(String(result.message_id), conversationId);
        if (!firstMessageId) {
          firstMessageId = String(result.message_id);
        }
      }
      return firstMessageId;
    } catch (error) {
      console.error('[Telegram] 发送文本消息失败:', error);
      // 尝试不使用 Markdown 格式重发
      try {
        let fallbackFirstMessageId: string | null = null;
        for (const chunk of chunks) {
          const result = await bot.api.sendMessage(conversationId, this.escapeMarkdownV2(chunk));
          this.adapter.rememberMessageConversation(String(result.message_id), conversationId);
          if (!fallbackFirstMessageId) {
            fallbackFirstMessageId = String(result.message_id);
          }
        }
        return fallbackFirstMessageId;
      } catch (fallbackError) {
        console.error('[Telegram] 降级发送也失败:', fallbackError);
        return null;
      }
    }
  }

  async sendCard(conversationId: string, card: object): Promise<string | null> {
    const bot = this.adapter.getBot();
    if (!bot) {
      console.warn('[Telegram] Bot 未初始化，无法发送卡片消息');
      return null;
    }

    try {
      const payload = card as TelegramCardPayload;
      const content = payload.telegramText || payload.text || JSON.stringify(card, null, 2);

      const keyboard = this.buildInlineKeyboard(payload.buttons);
      const result = await bot.api.sendMessage(conversationId, content, {
        parse_mode: 'MarkdownV2',
        reply_markup: keyboard,
      });

      this.adapter.rememberMessageConversation(String(result.message_id), conversationId);
      return String(result.message_id);
    } catch (error) {
      console.error('[Telegram] 发送卡片消息失败:', error);
      // 降级为普通文本发送
      return this.sendText(conversationId, JSON.stringify(card, null, 2));
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
      const content = payload.telegramText || payload.text || JSON.stringify(card, null, 2);
      const keyboard = this.buildInlineKeyboard(payload.buttons);

      await bot.api.editMessageText(conversationId, Number(messageId), content, {
        parse_mode: 'MarkdownV2',
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
  private buildInlineKeyboard(buttons?: Array<{ text: string; callback_data: string }>): InlineKeyboard | undefined {
    if (!buttons || buttons.length === 0) {
      return undefined;
    }

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

      // 启动 Long Polling
      await this.bot.start({
        onStart: () => {
          this.isActive = true;
          console.log('[Telegram] Long Polling 已启动');
        },
      });
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
    const text = message.text || '';

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

    // 构建平台通用事件
    const event: PlatformMessageEvent = {
      platform: 'telegram',
      conversationId: String(chat.id),
      messageId: String(message.message_id),
      senderId: String(message.from?.id || ''),
      senderType: 'user',
      content: cleanedContent,
      msgType: 'text',
      chatType: chatType as 'p2p' | 'group',
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