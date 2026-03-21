/**
 * WhatsApp 消息处理器
 *
 * 参考 telegram.ts 的结构，处理 WhatsApp 消息
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

export class WhatsAppHandler {
  private ensureStreamingBuffer(chatId: string, sessionId: string): void {
    const key = `chat:whatsapp:${chatId}`;
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
   * 处理 WhatsApp 消息
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
      console.log(`[WhatsApp] 收到命令：${command.type}`);
      await sender.sendText(chatId, `命令 "${command.type}" 暂不支持，请使用文本消息`);
      return;
    }

    // 2. 获取或创建会话
    let sessionId = chatSessionStore.getSessionIdByConversation('whatsapp', chatId);
    if (!sessionId) {
      const title = `WhatsApp会话-${buildSessionTimestamp()}`;
      const chatDefault = chatSessionStore.getSessionByConversation('whatsapp', chatId)?.defaultDirectory;
      const dirResult = DirectoryPolicy.resolve({ chatDefaultDirectory: chatDefault });
      const effectiveDir = dirResult.ok && dirResult.source !== 'server_default' ? dirResult.directory : undefined;
      const session = await opencodeClient.createSession(title, effectiveDir);
      if (session) {
        sessionId = session.id;
        chatSessionStore.setSessionByConversation('whatsapp', chatId, sessionId, senderId, title, {
          chatType: event.chatType || 'p2p',
          resolvedDirectory: session.directory,
        });
      } else {
        await sender.sendText(chatId, '无法创建 OpenCode 会话');
        return;
      }
    }

    // 3. 处理 Prompt
    const sessionConfig = chatSessionStore.getSessionByConversation('whatsapp', chatId);
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
   * 处理动作事件
   */
  async handleAction(
    event: { action: { tag: string; value: Record<string, unknown> }; senderId: string; conversationId?: string; messageId?: string },
    sender: PlatformSender
  ): Promise<void> {
    const { action, conversationId } = event;
    if (!conversationId) return;

    console.log(`[WhatsApp] 收到动作：${action.tag}`);

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
    const bufferKey = `chat:whatsapp:${chatId}`;
    this.ensureStreamingBuffer(chatId, sessionId);

    if (!sender) {
      console.error('[WhatsApp] 发送器为空，无法发送消息');
      return;
    }

    try {
      console.log(`[WhatsApp] 发送消息：chat=${chatId}, session=${sessionId.slice(0, 8)}...`);

      const parts: OpencodePartInput[] = [];

      if (text) {
        parts.push({ type: 'text', text });
      }

      if (attachments && attachments.length > 0) {
        console.warn('[WhatsApp] 附件暂不支持');
      }

      if (parts.length === 0) {
        await sender.sendText(chatId, '未检测到有效内容');
        outputBuffer.setStatus(bufferKey, 'completed');
        return;
      }

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

      const sessionData = chatSessionStore.getSessionByConversation('whatsapp', chatId);
      const directory = sessionData?.resolvedDirectory;

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
      console.error('[WhatsApp] 请求派发失败:', error);

      outputBuffer.append(bufferKey, `\n\n错误：${errorMessage}`);
      outputBuffer.setStatus(bufferKey, 'failed');

      const currentBuffer = outputBuffer.get(bufferKey);
      if (!currentBuffer?.messageId) {
        await sender.sendText(chatId, `错误：${errorMessage}`);
      }
    }
  }
}

export const whatsappHandler = new WhatsAppHandler();