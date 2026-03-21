/**
 * Telegram 消息处理器
 *
 * 参考 wecom.ts 和 discord.ts 的结构，处理 Telegram 消息
 */

import { modelConfig } from '../config.js';
import { opencodeClient } from '../opencode/client.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { chatSessionStore } from '../store/chat-session.js';
import { parseCommand } from '../commands/parser.js';
import { DirectoryPolicy } from '../utils/directory-policy.js';
import { buildSessionTimestamp } from '../utils/session-title.js';
import type { PlatformMessageEvent, PlatformSender } from '../platform/types.js';
import type { EffortLevel } from '../commands/effort.js';

type OpencodeFilePartInput = { type: 'file'; mime: string; url: string; filename?: string };
type OpencodePartInput = { type: 'text'; text: string } | OpencodeFilePartInput;

export class TelegramHandler {
  private ensureStreamingBuffer(chatId: string, sessionId: string): void {
    const key = `chat:${chatId}`;
    const current = outputBuffer.get(key);
    if (current && current.status !== 'running') {
      outputBuffer.clear(key);
    }

    if (!outputBuffer.get(key)) {
      outputBuffer.getOrCreate(key, chatId, sessionId, null);
    }
  }

  private formatDispatchError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();

    if (normalized.includes('fetch failed') || normalized.includes('networkerror')) {
      return '与 OpenCode 的连接失败，请检查服务是否在线或网络是否超时';
    }

    if (normalized.includes('timed out') || normalized.includes('timeout')) {
      return '请求 OpenCode 超时，请稍后重试';
    }

    return `请求失败：${message}`;
  }

  /**
   * 处理 Telegram 消息
   */
  async handleMessage(
    event: PlatformMessageEvent,
    sender: PlatformSender
  ): Promise<void> {
    const { conversationId: chatId, content, senderId, attachments } = event;
    const trimmed = content.trim();

    // 1. 优先处理命令
    const command = parseCommand(trimmed);
    if (command.type !== 'prompt') {
      console.log(`[Telegram] 收到命令：${command.type}`);
      // Telegram 命令处理暂时简化，仅支持部分命令
      await sender.sendText(chatId, `命令 "${command.type}" 暂不支持，请使用文本消息`);
      return;
    }

    // 2. 获取或创建会话
    let sessionId = chatSessionStore.getSessionIdByConversation('telegram', chatId);
    if (!sessionId) {
      // 如果没有绑定会话，自动创建一个
      const title = `Telegram会话-${buildSessionTimestamp()}`;
      const chatDefault = chatSessionStore.getSessionByConversation('telegram', chatId)?.defaultDirectory;
      const dirResult = DirectoryPolicy.resolve({ chatDefaultDirectory: chatDefault });
      const effectiveDir = dirResult.ok && dirResult.source !== 'server_default' ? dirResult.directory : undefined;
      const session = await opencodeClient.createSession(title, effectiveDir);
      if (session) {
        sessionId = session.id;
        chatSessionStore.setSessionByConversation('telegram', chatId, sessionId, senderId, title, {
          chatType: event.chatType || 'p2p',
          resolvedDirectory: session.directory,
        });
      } else {
        await sender.sendText(chatId, '无法创建 OpenCode 会话');
        return;
      }
    }

    // 3. 处理 Prompt
    const sessionConfig = chatSessionStore.getSessionByConversation('telegram', chatId);
    const promptText = command.text ?? trimmed;
    await this.processPrompt(
      sessionId,
      promptText,
      chatId,
      attachments,
      sessionConfig,
      command.promptEffort,
      sender
    );
  }

  /**
   * 处理回调查询（按钮点击）
   */
  async handleAction(
    event: { action: { tag: string; value: Record<string, unknown> }; senderId: string; conversationId?: string; messageId?: string },
    sender: PlatformSender
  ): Promise<void> {
    const { action, conversationId } = event;
    if (!conversationId) return;

    // 简单的回调处理，可以根据需要扩展
    console.log(`[Telegram] 收到回调查询：${action.tag}`);

    // 根据不同的 action.tag 执行不同的操作
    if (action.tag === 'allow') {
      await sender.sendText(conversationId, '已允许该操作');
    } else if (action.tag === 'deny') {
      await sender.sendText(conversationId, '已拒绝该操作');
    }
  }

  /**
   * 处理消息发送
   */
  private async processPrompt(
    sessionId: string,
    text: string,
    chatId: string,
    attachments: PlatformMessageEvent['attachments'],
    config?: { preferredModel?: string; preferredAgent?: string; preferredEffort?: EffortLevel },
    promptEffort?: EffortLevel,
    sender?: PlatformSender
  ): Promise<void> {
    const bufferKey = `chat:${chatId}`;
    this.ensureStreamingBuffer(chatId, sessionId);

    if (!sender) {
      console.error('[Telegram] 发送器为空，无法发送消息');
      return;
    }

    try {
      console.log(`[Telegram] 发送消息：chat=${chatId}, session=${sessionId.slice(0, 8)}...`);

      const parts: OpencodePartInput[] = [];

      if (text) {
        parts.push({ type: 'text', text });
      }

      if (attachments && attachments.length > 0) {
        // Telegram 附件处理（暂不支持，需要额外实现文件下载）
        console.warn('[Telegram] 附件暂不支持');
      }

      if (parts.length === 0) {
        await sender.sendText(chatId, '未检测到有效内容');
        outputBuffer.setStatus(bufferKey, 'completed');
        return;
      }

      // 提取 providerId 和 modelId
      let providerId: string | undefined;
      let modelId: string | undefined;

      if (modelConfig.defaultProvider && modelConfig.defaultModel) {
        providerId = modelConfig.defaultProvider;
        modelId = modelConfig.defaultModel;
      }

      if (config?.preferredModel) {
        const [p, m] = config.preferredModel.split(':');
        if (p && m) {
          providerId = p;
          modelId = m;
        } else {
          if (providerId) {
            modelId = config.preferredModel;
          }
        }
      }

      // 获取会话的工作目录
      const sessionData = chatSessionStore.getSessionByConversation('telegram', chatId);
      const directory = sessionData?.resolvedDirectory;

      // 异步触发 OpenCode 请求
      const variant = promptEffort || config?.preferredEffort;
      await opencodeClient.sendMessagePartsAsync(
        sessionId,
        parts,
        {
          providerId,
          modelId,
          agent: config?.preferredAgent,
          ...(variant ? { variant } : {}),
          ...(directory ? { directory } : {}),
        }
      );

    } catch (error) {
      const errorMessage = this.formatDispatchError(error);
      console.error('[Telegram] 请求派发失败:', error);

      outputBuffer.append(bufferKey, `\n\n错误：${errorMessage}`);
      outputBuffer.setStatus(bufferKey, 'failed');

      const currentBuffer = outputBuffer.get(bufferKey);
      if (!currentBuffer?.messageId) {
        await sender.sendText(chatId, `错误：${errorMessage}`);
      }
    }
  }
}

export const telegramHandler = new TelegramHandler();