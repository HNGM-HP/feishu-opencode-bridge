/**
 * WeChat 个人微信适配器
 *
 * 实现 PlatformAdapter 接口，使用 HTTP 长轮询获取消息
 * 支持多账号，每个账号独立轮询工作线程
 * ChatId 格式: weixin::<accountId>::<peerUserId>
 */

import type {
  PlatformAdapter,
  PlatformSender,
  PlatformMessageEvent,
  PlatformActionEvent,
  PlatformAttachment,
} from '../types.js';
import { configStore, type WeixinAccountRow } from '../../store/config-store.js';
import {
  getUpdates,
  sendTextMessage,
  getConfig,
  sendTyping as apiSendTyping,
} from './weixin/weixin-api.js';
import type { WeixinCredentials, WeixinMessage, MessageItem } from './weixin/weixin-types.js';
import { MessageItemType, TypingStatus, ERRCODE_SESSION_EXPIRED } from './weixin/weixin-types.js';
import { encodeWeixinChatId, decodeWeixinChatId } from './weixin/weixin-ids.js';
import { downloadMediaFromItem } from './weixin/weixin-media.js';

// ──────────────────────────────────────────────
// 常量
// ──────────────────────────────────────────────

const DEDUP_MAX = 500; // 每账号最大去重消息数
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 30_000;

// ──────────────────────────────────────────────
// 会话暂停管理
// ──────────────────────────────────────────────

const pausedAccounts = new Map<string, string>();

function isPaused(accountId: string): boolean {
  return pausedAccounts.has(accountId);
}

function setPaused(accountId: string, reason: string): void {
  pausedAccounts.set(accountId, reason);
  console.warn(`[weixin-adapter] Account ${accountId} paused: ${reason}`);
}

function clearPaused(accountId: string): void {
  pausedAccounts.delete(accountId);
}

// ──────────────────────────────────────────────
// WeixinSender 实现
// ──────────────────────────────────────────────

class WeixinSender implements PlatformSender {
  constructor(private readonly adapter: WeixinAdapter) {}

  async sendText(conversationId: string, text: string): Promise<string | null> {
    const decoded = decodeWeixinChatId(conversationId);
    if (!decoded) {
      console.warn('[Weixin] Invalid chatId format');
      return null;
    }

    const { accountId, peerUserId } = decoded;
    const account = configStore.getWeixinAccount(accountId);
    if (!account) {
      console.warn(`[Weixin] Account ${accountId} not found`);
      return null;
    }

    const contextToken = configStore.getWeixinContextToken(accountId, peerUserId);
    if (!contextToken) {
      console.warn(`[Weixin] No context_token for peer ${peerUserId}`);
      return null;
    }

    const creds = this.accountToCreds(account);

    // 去除 HTML/Markdown，微信只支持纯文本
    let content = text;
    content = content.replace(/<[^>]+>/g, ''); // HTML
    content = content
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/_(.*?)_/g, '$1')
      .replace(/`{3}[\s\S]*?`{3}/g, (m) => m.replace(/`{3}\w*\n?/g, '').replace(/`{3}/g, ''))
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    try {
      const { clientId } = await sendTextMessage(creds, peerUserId, content, contextToken);
      return clientId;
    } catch (error) {
      console.error('[Weixin] Send text failed:', error);
      return null;
    }
  }

  async sendCard(conversationId: string, card: object): Promise<string | null> {
    // 微信不支持卡片，降级为纯文本
    const payload = card as { text?: string; markdown?: string };
    const content = payload.text || payload.markdown || JSON.stringify(card, null, 2);
    return this.sendText(conversationId, content);
  }

  async updateCard(_messageId: string, _card: object): Promise<boolean> {
    // 微信不支持更新消息
    return false;
  }

  async deleteMessage(_messageId: string): Promise<boolean> {
    // 微信不支持删除消息
    return false;
  }

  private accountToCreds(account: WeixinAccountRow): WeixinCredentials {
    return {
      botToken: account.token,
      ilinkBotId: account.account_id,
      baseUrl: account.base_url || 'https://ilinkai.weixin.qq.com',
      cdnBaseUrl: account.cdn_base_url || 'https://novac2c.cdn.weixin.qq.com/c2c',
    };
  }
}

// ──────────────────────────────────────────────
// WeixinAdapter 实现
// ──────────────────────────────────────────────

export class WeixinAdapter implements PlatformAdapter {
  readonly platform = 'weixin' as const;

  private readonly sender: WeixinSender;
  private readonly messageCallbacks: Array<(event: PlatformMessageEvent) => void> = [];
  private readonly actionCallbacks: Array<(event: PlatformActionEvent) => void> = [];
  private isActive = false;

  private readonly pollAborts = new Map<string, AbortController>();
  private readonly seenMessageIds = new Map<string, Set<string>>();
  private readonly consecutiveFailures = new Map<string, number>();
  private readonly typingTickets = new Map<string, string>();

  constructor() {
    this.sender = new WeixinSender(this);
  }

  async start(): Promise<void> {
    const accounts = configStore.getWeixinAccounts().filter((a: WeixinAccountRow) => a.enabled === 1);

    // 先设置 isActive，确保异步工作线程能正确检测状态
    this.isActive = true;

    if (accounts.length === 0) {
      console.log('[Weixin] No enabled accounts, adapter started but idle');
      return;
    }

    // 为每个账号启动轮询工作线程
    for (const account of accounts) {
      this.startAccountWorker(account);
    }

    console.log(`[Weixin] Started with ${accounts.length} account(s)`);
  }

  stop(): void {
    // 终止所有轮询
    for (const [, controller] of this.pollAborts) {
      controller.abort();
    }
    this.pollAborts.clear();

    // 清理状态
    this.seenMessageIds.clear();
    this.consecutiveFailures.clear();
    this.typingTickets.clear();
    pausedAccounts.clear();

    this.isActive = false;
    this.messageCallbacks.length = 0;
    this.actionCallbacks.length = 0;
    console.log('[Weixin] Stopped');
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
  // 账号工作线程
  // ──────────────────────────────────────────────

  private startAccountWorker(account: WeixinAccountRow): void {
    const controller = new AbortController();
    this.pollAborts.set(account.account_id, controller);
    this.seenMessageIds.set(account.account_id, new Set());
    this.consecutiveFailures.set(account.account_id, 0);
    clearPaused(account.account_id);

    // 启动轮询循环
    this.runPollLoop(account, controller.signal).catch(error => {
      console.error(`[Weixin] Poll loop crashed for ${account.account_id}:`, error);
    });
  }

  private async runPollLoop(account: WeixinAccountRow, signal: AbortSignal): Promise<void> {
    const creds = this.accountToCreds(account);
    const accountId = account.account_id;

    console.log(`[Weixin] Poll loop started for ${accountId}`);

    while (this.isActive && !signal.aborted) {
      // 检查暂停状态
      if (isPaused(accountId)) {
        await this.sleep(10_000, signal);
        continue;
      }

      try {
        // 获取持久化的轮询游标
        const offsetBuf = configStore.getWeixinPollOffset(accountId);
        const resp = await getUpdates(creds, offsetBuf);

        // 检查会话过期
        if (resp.errcode === ERRCODE_SESSION_EXPIRED) {
          setPaused(accountId, 'Session expired (errcode -14)');
          continue;
        }

        // 检查其他 API 错误
        if (resp.errcode && resp.errcode !== 0) {
          throw new Error(`API error: ${resp.errcode} ${resp.errmsg || ''}`);
        }

        // 处理消息
        if (resp.msgs && resp.msgs.length > 0) {
          for (const msg of resp.msgs) {
            await this.processMessage(accountId, creds, msg);
          }
        }

        // 持久化新游标
        if (resp.get_updates_buf) {
          configStore.setWeixinPollOffset(accountId, resp.get_updates_buf);
        }

        // 重置失败计数
        this.consecutiveFailures.set(accountId, 0);

      } catch (error) {
        if (signal.aborted) break;

        const failures = (this.consecutiveFailures.get(accountId) || 0) + 1;
        this.consecutiveFailures.set(accountId, failures);

        const backoff = Math.min(
          BACKOFF_BASE_MS * Math.pow(2, failures - 1),
          BACKOFF_MAX_MS,
        );

        console.error(
          `[Weixin] Poll error for ${accountId} (failure ${failures}):`,
          error instanceof Error ? error.message : error,
        );

        await this.sleep(backoff, signal);
      }
    }

    console.log(`[Weixin] Poll loop ended for ${accountId}`);
  }

  // ──────────────────────────────────────────────
  // 消息处理
  // ──────────────────────────────────────────────

  private async processMessage(
    accountId: string,
    creds: WeixinCredentials,
    msg: WeixinMessage,
  ): Promise<void> {
    if (!msg.from_user_id) return;

    // 消息去重
    const msgKey = msg.message_id || `seq_${msg.seq}`;
    const seen = this.seenMessageIds.get(accountId);
    if (seen?.has(msgKey)) return;
    if (seen) {
      seen.add(msgKey);
    } else {
      // accountId未被初始化，创建新的去重集合
      this.seenMessageIds.set(accountId, new Set([msgKey]));
    }

    // 修剪去重集合
    if (seen && seen.size > DEDUP_MAX) {
      const arr = Array.from(seen);
      for (let i = 0; i < arr.length - DEDUP_MAX; i++) {
        seen.delete(arr[i]);
      }
    }

    // 持久化 context_token
    if (msg.context_token) {
      configStore.upsertWeixinContextToken(accountId, msg.from_user_id, msg.context_token);
    }

    // 提取文本
    let text = '';
    const items = msg.item_list || [];
    for (const item of items) {
      if (item.type === MessageItemType.TEXT && item.text_item?.text) {
        text += item.text_item.text;
      }
    }

    // 处理引用消息
    if (msg.ref_message) {
      const refParts: string[] = [];
      if (msg.ref_message.title) refParts.push(msg.ref_message.title);
      if (msg.ref_message.content) refParts.push(msg.ref_message.content);
      if (refParts.length > 0) {
        text = `[引用: ${refParts.join(' | ')}]\n${text}`;
      }
    }

    // 下载媒体附件
    let attachments: PlatformAttachment[] | undefined;
    try {
      const cdnBaseUrl = creds.cdnBaseUrl || 'https://novac2c.cdn.weixin.qq.com/c2c';
      attachments = await this.downloadMediaItems(items, cdnBaseUrl, accountId);
    } catch (error) {
      console.error('[Weixin] Media download failed:', error);
    }

    // 构建 ChatId
    const chatId = encodeWeixinChatId(accountId, msg.from_user_id);

    // 构建事件
    const event: PlatformMessageEvent = {
      platform: 'weixin',
      conversationId: chatId,
      messageId: msg.message_id || `weixin_${accountId}_${msg.seq || Date.now()}`,
      senderId: msg.from_user_id,
      senderType: 'user',
      content: text.trim(),
      msgType: this.determineMessageType(items),
      chatType: 'p2p',
      attachments,
      rawEvent: { accountId, originalMessage: msg },
    };

    // 触发回调
    if (event.content || (event.attachments && event.attachments.length > 0)) {
      for (const callback of this.messageCallbacks) {
        try {
          await Promise.resolve(callback(event));
        } catch (error) {
          console.error('[Weixin] Message callback failed:', error);
        }
      }
    }
  }

  private determineMessageType(items: MessageItem[]): string {
    for (const item of items) {
      switch (item.type) {
        case MessageItemType.TEXT: return 'text';
        case MessageItemType.IMAGE: return 'image';
        case MessageItemType.VOICE: return 'voice';
        case MessageItemType.FILE: return 'file';
        case MessageItemType.VIDEO: return 'video';
      }
    }
    return 'unknown';
  }

  private async downloadMediaItems(
    items: MessageItem[],
    cdnBaseUrl: string,
    accountId: string,
  ): Promise<PlatformAttachment[] | undefined> {
    const results: PlatformAttachment[] = [];

    for (const item of items) {
      if (item.type === MessageItemType.TEXT) continue;

      try {
        const media = await downloadMediaFromItem(item, cdnBaseUrl);
        if (media) {
          const id = `weixin_${accountId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          results.push({
            type: media.mimeType.startsWith('image/') ? 'image' : 'file',
            fileKey: id,
            fileName: media.filename,
            fileType: media.mimeType,
            fileSize: media.data.length,
          });
        }
      } catch (error) {
        console.error('[Weixin] Media download failed:', error);
      }
    }

    return results.length > 0 ? results : undefined;
  }

  // ──────────────────────────────────────────────
  // 输入状态
  // ──────────────────────────────────────────────

  async sendTypingIndicator(chatId: string, status: number): Promise<void> {
    const decoded = decodeWeixinChatId(chatId);
    if (!decoded) return;

    const { accountId, peerUserId } = decoded;
    const account = configStore.getWeixinAccount(accountId);
    if (!account) return;

    const contextToken = configStore.getWeixinContextToken(accountId, peerUserId);
    if (!contextToken) return;

    const creds = this.accountToCreds(account);

    // 获取或缓存 typing ticket
    const ticketKey = `${accountId}:${peerUserId}`;
    let ticket = this.typingTickets.get(ticketKey);
    if (!ticket) {
      try {
        const config = await getConfig(creds, peerUserId, contextToken);
        if (config.typing_ticket) {
          ticket = config.typing_ticket;
          this.typingTickets.set(ticketKey, ticket);
        }
      } catch {
        return;
      }
    }
    if (!ticket) return;

    await apiSendTyping(creds, peerUserId, ticket, status);
  }

  // ──────────────────────────────────────────────
  // 工具方法
  // ──────────────────────────────────────────────

  private accountToCreds(account: WeixinAccountRow): WeixinCredentials {
    return {
      botToken: account.token,
      ilinkBotId: account.account_id,
      baseUrl: account.base_url || 'https://ilinkai.weixin.qq.com',
      cdnBaseUrl: account.cdn_base_url || 'https://novac2c.cdn.weixin.qq.com/c2c',
    };
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  // ──────────────────────────────────────────────
  // 账号管理 API
  // ──────────────────────────────────────────────

  getAccountStatus(accountId: string): { active: boolean; paused: boolean; reason?: string } {
    const hasPollLoop = this.pollAborts.has(accountId);
    const paused = isPaused(accountId);
    const reason = paused ? pausedAccounts.get(accountId) : undefined;
    return { active: hasPollLoop && !paused, paused, reason };
  }

  restartAccount(accountId: string): void {
    // 终止现有轮询
    const existing = this.pollAborts.get(accountId);
    if (existing) {
      existing.abort();
      this.pollAborts.delete(accountId);
    }

    // 清理状态
    this.seenMessageIds.delete(accountId);
    this.consecutiveFailures.delete(accountId);
    this.typingTickets.delete(`:${accountId}`);
    clearPaused(accountId);

    // 重新启动
    const account = configStore.getWeixinAccount(accountId);
    if (account && account.enabled === 1) {
      this.startAccountWorker(account);
    }
  }
}

// 单例导出
export const weixinAdapter = new WeixinAdapter();
