/**
 * 钉钉 (DingTalk) 消息处理器
 *
 * 处理钉钉消息：权限请求、问题回答、命令处理
 */

import type { PlatformMessageEvent, PlatformSender } from '../platform/types.js';
import { decodeDingtalkChatId } from '../platform/adapters/dingtalk/dingtalk-ids.js';
import { configStore } from '../store/config-store.js';
import { opencodeClient } from '../opencode/client.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { chatSessionStore } from '../store/chat-session.js';
import { parseCommand, type ParsedCommand } from '../commands/parser.js';
import { DirectoryPolicy } from '../utils/directory-policy.js';
import { buildSessionTimestamp } from '../utils/session-title.js';
import { shouldSkipGroupMessage } from '../utils/group-mention.js';
import { permissionHandler } from '../permissions/handler.js';
import { PlatformCommandHandler } from './platform-command.handler.js';

type PermissionDecision = {
  allow: boolean;
  remember: boolean;
};

function parsePermissionDecision(raw: string): PermissionDecision | null {
  const normalized = raw.normalize('NFKC').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const compact = normalized
    .replace(/[\s\u3000]+/g, '')
    .replace(/[。！!,.，；;:：\-]/g, '');

  const hasAlways =
    compact.includes('始终')
    || compact.includes('永久')
    || compact.includes('always')
    || compact.includes('记住')
    || compact.includes('总是');

  const containsAny = (words: string[]): boolean => {
    return words.some(word => compact === word || compact.includes(word));
  };

  const isDeny =
    compact === 'n'
    || compact === 'no'
    || compact === '否'
    || compact === '拒绝'
    || containsAny(['拒绝', '不同意', '不允许', 'deny']);

  if (isDeny) {
    return { allow: false, remember: false };
  }

  const isAllow =
    compact === 'y'
    || compact === 'yes'
    || compact === 'ok'
    || compact === 'always'
    || compact === '允许'
    || compact === '始终允许'
    || containsAny(['允许', '同意', '通过', '批准', 'allow']);

  if (isAllow) {
    return { allow: true, remember: hasAlways };
  }

  return null;
}

export class DingtalkHandler {
  private readonly commandHandler = new PlatformCommandHandler('dingtalk');

  private ensureStreamingBuffer(chatId: string, sessionId: string): void {
    const key = `chat:dingtalk:${chatId}`;
    const current = outputBuffer.get(key);
    if (current && current.status !== 'running') {
      outputBuffer.clear(key);
    }

    if (!outputBuffer.get(key)) {
      outputBuffer.getOrCreate(key, chatId, sessionId, null);
    }
  }

  private getPermissionQueueKey(conversationId: string): string {
    return `dingtalk:${conversationId}`;
  }

  private resolvePermissionDirectoryOptions(
    sessionId: string,
    conversationId: string
  ): { directory?: string; fallbackDirectories?: string[] } {
    const boundSession = chatSessionStore.getSessionByConversation('dingtalk', conversationId);
    const directory = boundSession?.resolvedDirectory || boundSession?.defaultDirectory;

    const fallbackDirectories = Array.from(
      new Set(
        [
          boundSession?.resolvedDirectory,
          boundSession?.defaultDirectory,
          ...chatSessionStore.getKnownDirectories(),
        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    );

    return {
      ...(directory ? { directory } : {}),
      ...(fallbackDirectories.length > 0 ? { fallbackDirectories } : {}),
    };
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
   * 处理钉钉消息
   */
  async handleMessage(
    event: PlatformMessageEvent,
    sender: PlatformSender
  ): Promise<void> {
    // 群聊 @ 提到检查
    if (shouldSkipGroupMessage(event)) {
      return;
    }

    const { conversationId, content, senderId, msgType, chatType } = event;
    const trimmed = content.trim();

    // 解码 ChatId 获取账号信息
    const decoded = decodeDingtalkChatId(conversationId);
    if (!decoded) {
      console.warn('[钉钉] 无效的 chatId 格式');
      return;
    }
    const { accountId } = decoded;

    // 忽略非文本消息
    if (msgType && msgType !== 'text') {
      console.log(`[钉钉] 忽略非文本消息: ${msgType}`);
      return;
    }

    if (!trimmed) {
      return;
    }

    // 0. 检查是否有待处理的权限请求
    const permissionHandled = await this.tryHandlePendingPermission(conversationId, trimmed, sender);
    if (permissionHandled) {
      return;
    }

    // 1. 解析命令
    const command = parseCommand(trimmed);

    // 2. 使用 PlatformCommandHandler 处理非 prompt 命令
    if (command.type !== 'prompt') {
      console.log(`[钉钉] 收到命令：${command.type}`);
      await this.commandHandler.handle(
        command,
        {
          chatId: conversationId,
          senderId,
          chatType: chatType === 'group' ? 'group' : 'p2p',
        },
        sender
      );
      return;
    }

    // 3. 获取或创建会话
    let sessionId = chatSessionStore.getSessionIdByConversation('dingtalk', conversationId);
    if (!sessionId) {
      const title = `钉钉会话-${buildSessionTimestamp()}`;
      const chatDefault = chatSessionStore.getSessionByConversation('dingtalk', conversationId)?.defaultDirectory;
      const dirResult = DirectoryPolicy.resolve({ chatDefaultDirectory: chatDefault });
      const effectiveDir = dirResult.ok && dirResult.source !== 'server_default' ? dirResult.directory : undefined;
      const session = await opencodeClient.createSession(title, effectiveDir);
      if (session) {
        sessionId = session.id;
        chatSessionStore.setSessionByConversation('dingtalk', conversationId, sessionId, senderId, title, {
          chatType: event.chatType || 'p2p',
          resolvedDirectory: session.directory,
        });
      } else {
        await sender.sendText(conversationId, '无法创建 OpenCode 会话');
        return;
      }
    }

    // 4. 处理 Prompt
    const sessionConfig = chatSessionStore.getSessionByConversation('dingtalk', conversationId);
    const promptText = command.text ?? trimmed;
    await this.processPrompt(
      sessionId,
      promptText,
      conversationId,
      sessionConfig ?? undefined,
      command.promptEffort,
      sender
    );
  }

  /**
   * 尝试处理待处理的权限请求
   */
  private async tryHandlePendingPermission(
    conversationId: string,
    text: string,
    sender: PlatformSender
  ): Promise<boolean> {
    const queueKey = this.getPermissionQueueKey(conversationId);
    const pending = permissionHandler.peekForChat(queueKey);
    if (!pending) {
      return false;
    }

    const decision = parsePermissionDecision(text);
    if (!decision) {
      await sender.sendText(conversationId, '当前有待确认权限，请回复：允许 / 拒绝 / 始终允许（也支持 y / n / always）');
      return true;
    }

    const candidateSessionIds = Array.from(
      new Set(
        [pending.sessionId, pending.parentSessionId, pending.relatedSessionId]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    );

    let responded = false;
    let expiredDetected = false;

    for (const candidateSessionId of candidateSessionIds) {
      const permissionDirectoryOptions = this.resolvePermissionDirectoryOptions(candidateSessionId, conversationId);
      try {
        const result = await opencodeClient.respondToPermission(
          candidateSessionId,
          pending.permissionId,
          decision.allow,
          decision.remember,
          permissionDirectoryOptions
        );
        if (result.ok) {
          responded = true;
          break;
        }
        if (result.expired) {
          expiredDetected = true;
        }
      } catch (error) {
        console.error(`[钉钉] 权限文本响应失败: session=${candidateSessionId}`, error);
      }
    }

    if (!responded) {
      if (expiredDetected) {
        await sender.sendText(conversationId, '操作已过期，请重新发起');
      } else {
        await sender.sendText(conversationId, '权限响应失败，请重试');
      }
      return true;
    }

    console.log(`[钉钉] 权限文本响应成功: allow=${decision.allow}`);

    const removed = permissionHandler.resolveForChat(queueKey, pending.permissionId);
    const toolName = removed?.tool || pending.tool || '工具';
    const resultText = decision.allow
      ? decision.remember ? `已允许并记住权限：${toolName}` : `已允许权限：${toolName}`
      : `已拒绝权限：${toolName}`;

    await sender.sendText(conversationId, resultText);
    return true;
  }

  /**
   * 处理 Prompt
   */
  private async processPrompt(
    sessionId: string,
    text: string,
    conversationId: string,
    sessionConfig: { resolvedDirectory?: string; defaultDirectory?: string; preferredModel?: string; preferredAgent?: string; preferredEffort?: string } | undefined,
    promptEffort: string | undefined,
    sender: PlatformSender
  ): Promise<void> {
    this.ensureStreamingBuffer(conversationId, sessionId);

    try {
      const dispatchOptions: {
        directory?: string;
        fallbackDirectories?: string[];
        effort?: string;
        model?: string;
        agent?: string;
      } = {};

      const directory = sessionConfig?.resolvedDirectory || sessionConfig?.defaultDirectory;
      if (directory) {
        dispatchOptions.directory = directory;
      }

      const fallbackDirectories = chatSessionStore.getKnownDirectories();
      if (fallbackDirectories.length > 0) {
        dispatchOptions.fallbackDirectories = fallbackDirectories;
      }

      if (promptEffort) {
        dispatchOptions.effort = promptEffort;
      }

      if (sessionConfig?.preferredModel) {
        dispatchOptions.model = sessionConfig.preferredModel;
      }

      if (sessionConfig?.preferredAgent) {
        dispatchOptions.agent = sessionConfig.preferredAgent;
      }

      if (sessionConfig?.preferredEffort) {
        dispatchOptions.effort = sessionConfig.preferredEffort;
      }

      // 发送消息到 OpenCode
      await opencodeClient.sendMessage(sessionId, text, dispatchOptions);

    } catch (error) {
      console.error('[钉钉] Process prompt error:', error);
      await sender.sendText(conversationId, this.formatDispatchError(error));
    }
  }
}

export const dingtalkHandler = new DingtalkHandler();