/**
 * 企业微信 (WeCom) 消息处理器
 *
 * 参考 discord.ts 和 group.ts 的结构，处理企业微信消息
 */

import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { modelConfig, attachmentConfig } from '../config.js';
import { opencodeClient } from '../opencode/client.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { chatSessionStore } from '../store/chat-session.js';
import { parseCommand } from '../commands/parser.js';
import { commandHandler } from './command.js';
import { DirectoryPolicy } from '../utils/directory-policy.js';
import { buildSessionTimestamp } from '../utils/session-title.js';
import type { PlatformMessageEvent, PlatformSender } from '../platform/types.js';
import type { EffortLevel } from '../commands/effort.js';

// 附件相关配置
const ATTACHMENT_BASE_DIR = path.resolve(process.cwd(), 'tmp', 'wecom-uploads');
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf',
]);

const DISCORD_MESSAGE_LIMIT = 1800;

type OpencodeFilePartInput = { type: 'file'; mime: string; url: string; filename?: string };
type OpencodePartInput = { type: 'text'; text: string } | OpencodeFilePartInput;

export class WeComHandler {
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

  // 处理企业微信消息
  async handleMessage(
    event: PlatformMessageEvent,
    sender: PlatformSender
  ): Promise<void> {
    const { conversationId: chatId, content, senderId, attachments } = event;
    const trimmed = content.trim();

    // 1. 优先处理命令
    const command = parseCommand(trimmed);
    if (command.type !== 'prompt') {
      console.log(`[WeCom] 收到命令：${command.type}`);
      // 企业微信命令处理暂时简化，仅支持部分命令
      await sender.sendText(chatId, `命令 "${command.type}" 暂不支持，请使用文本消息`);
      return;
    }

    // 2. 获取或创建会话
    let sessionId = chatSessionStore.getSessionIdByConversation('wecom', chatId);
    if (!sessionId) {
      // 如果没有绑定会话，自动创建一个（走 DirectoryPolicy）
      const title = `企微会话-${buildSessionTimestamp()}`;
      const chatDefault = chatSessionStore.getSessionByConversation('wecom', chatId)?.defaultDirectory;
      const dirResult = DirectoryPolicy.resolve({ chatDefaultDirectory: chatDefault });
      const effectiveDir = dirResult.ok && dirResult.source !== 'server_default' ? dirResult.directory : undefined;
      const session = await opencodeClient.createSession(title, effectiveDir);
      if (session) {
        sessionId = session.id;
        chatSessionStore.setSessionByConversation('wecom', chatId, sessionId, senderId, title, {
          chatType: event.chatType || 'p2p',
          resolvedDirectory: session.directory,
        });
      } else {
        await sender.sendText(chatId, '❌ 无法创建 OpenCode 会话');
        return;
      }
    }

    // 3. 处理 Prompt
    const sessionConfig = chatSessionStore.getSessionByConversation('wecom', chatId);
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

  // 处理消息发送
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
      console.error('[WeCom] 发送器为空，无法发送消息');
      return;
    }

    try {
      console.log(`[WeCom] 发送消息：chat=${chatId}, session=${sessionId.slice(0, 8)}...`);

      const parts: OpencodePartInput[] = [];

      // 按需注入文件发送指令
      let effectiveText = text;
      if (effectiveText && /发给我 | 发送文件 | 上传 | 传给我 | send.*file/i.test(effectiveText)) {
        effectiveText += '\n[wecom-bridge: 如需发送文件到当前会话，执行 echo WECOM_SEND_FILE <文件绝对路径>]';
      }

      if (effectiveText) {
        parts.push({ type: 'text', text: effectiveText });
      }

      if (attachments && attachments.length > 0) {
        const prepared = await this.prepareAttachmentParts(attachments);
        if (prepared.warnings.length > 0) {
          await sender.sendText(chatId, `⚠️ 附件警告:\n${prepared.warnings.join('\n')}`);
        }
        parts.push(...prepared.parts);
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
      const sessionData = chatSessionStore.getSessionByConversation('wecom', chatId);
      let directory = sessionData?.resolvedDirectory;

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
      console.error('[WeCom] 请求派发失败:', error);

      outputBuffer.append(bufferKey, `\n\n❌ ${errorMessage}`);
      outputBuffer.setStatus(bufferKey, 'failed');

      const currentBuffer = outputBuffer.get(bufferKey);
      if (!currentBuffer?.messageId) {
        await sender.sendText(chatId, `❌ ${errorMessage}`);
      }
    }
  }

  // 处理附件
  private async prepareAttachmentParts(
    attachments: PlatformMessageEvent['attachments']
  ): Promise<{ parts: OpencodeFilePartInput[]; warnings: string[] }> {
    const parts: OpencodeFilePartInput[] = [];
    const warnings: string[] = [];

    await fs.mkdir(ATTACHMENT_BASE_DIR, { recursive: true }).catch(() => undefined);

    if (!attachments) {
      return { parts, warnings };
    }

    for (const attachment of attachments) {
      // 企业微信附件暂时仅支持 URL 方式
      warnings.push(`附件 ${attachment.fileName || attachment.fileKey} 暂不支持，需要实现下载逻辑`);
    }

    return { parts, warnings };
  }
}

export const wecomHandler = new WeComHandler();
