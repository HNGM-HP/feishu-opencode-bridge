/**
 * 个人微信 (Weixin) 消息处理器
 *
 * 参考 telegram.ts 的结构，处理个人微信消息
 * 支持：权限请求、问题回答、命令处理、附件处理
 */

import type { PlatformMessageEvent, PlatformSender, PlatformAttachment } from '../platform/types.js';
import { decodeWeixinChatId } from '../platform/adapters/weixin/weixin-ids.js';
import { configStore } from '../store/config-store.js';
import { modelConfig, attachmentConfig } from '../config.js';
import { opencodeClient } from '../opencode/client.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { chatSessionStore } from '../store/chat-session.js';
import { parseCommand, type ParsedCommand } from '../commands/parser.js';
import { DirectoryPolicy } from '../utils/directory-policy.js';
import { buildSessionTimestamp } from '../utils/session-title.js';
import type { EffortLevel } from '../commands/effort.js';
import { permissionHandler } from '../permissions/handler.js';
import { questionHandler, type PendingQuestion } from '../opencode/question-handler.js';
import { parseQuestionAnswerText } from '../opencode/question-parser.js';

const WEIXIN_MESSAGE_LIMIT = 1800;
const WEIXIN_HELP_TEXT = `📖 **微信 × OpenCode 机器人指南**

💬 **如何对话**
直接发送消息即可与 AI 对话。

🛠️ **常用命令**
• \`/help\` 显示帮助
• \`/model\` 查看当前模型
• \`/model <名称>\` 切换模型 (e.g. \`/model gpt-4\`)
• \`/agent\` 查看当前角色
• \`/agent <名称>\` 切换角色
• \`/effort\` 查看当前强度
• \`/effort <档位>\` 设置会话强度 (low/high/xhigh)
• \`/stop\` 停止当前回答
• \`/undo\` 撤回上一轮对话
• \`/compact\` 压缩上下文

⚙️ **会话管理**
• \`/session new\` 开启新话题
• \`/sessions\` 列出会话
• \`/rename <新名称>\` 重命名会话
• \`/project list\` 列出可用项目
• \`/status\` 查看当前状态
• \`/clear\` 重置对话上下文

💡 **提示**
• 切换的模型/角色仅对当前会话生效。
• 支持 #前缀临时设置强度，如 \`#high 帮我分析代码\``;

type ParsedQuestionAnswer = { type: 'skip' | 'custom' | 'selection'; values?: string[]; custom?: string };
type OpencodeFilePartInput = { type: 'file'; mime: string; url: string; filename?: string };
type OpencodePartInput = { type: 'text'; text: string } | OpencodeFilePartInput;

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

export class WeixinHandler {
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

  private getPermissionQueueKey(conversationId: string): string {
    return `weixin:${conversationId}`;
  }

  private resolvePermissionDirectoryOptions(
    sessionId: string,
    conversationId: string
  ): { directory?: string; fallbackDirectories?: string[] } {
    const boundSession = chatSessionStore.getSessionByConversation('weixin', conversationId);
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
   * 处理微信消息
   */
  async handleMessage(
    event: PlatformMessageEvent,
    sender: PlatformSender
  ): Promise<void> {
    const { conversationId, content, senderId, attachments } = event;
    const trimmed = content.trim();

    // 解码 ChatId 获取账号信息
    const decoded = decodeWeixinChatId(conversationId);
    if (!decoded) {
      console.warn('[Weixin] Invalid chatId format');
      return;
    }
    const { accountId, peerUserId } = decoded;

    // 获取账号信息
    const account = configStore.getWeixinAccount(accountId);
    if (!account || account.enabled !== 1) {
      console.warn(`[Weixin] Account ${accountId} not found or disabled`);
      return;
    }

    // 检查用户白名单
    const allowedUsers = process.env.WEIXIN_ALLOWED_USERS?.split(',').map(u => u.trim()).filter(Boolean);
    if (allowedUsers && allowedUsers.length > 0) {
      if (!allowedUsers.includes(peerUserId)) {
        console.log(`[Weixin] User ${peerUserId} not in whitelist, ignoring`);
        return;
      }
    }

    // 0. 检查是否有待处理的权限请求
    const permissionHandled = await this.tryHandlePendingPermission(conversationId, trimmed, sender);
    if (permissionHandled) {
      return;
    }

    // 0.1 检查是否有待回答的问题
    const questionHandled = await this.tryHandlePendingQuestion(conversationId, trimmed, sender);
    if (questionHandled) {
      return;
    }

    // 1. 优先处理命令
    const command = parseCommand(trimmed);
    if (command.type !== 'prompt') {
      console.log(`[Weixin] 收到命令：${command.type}`);
      await this.handleCommand(command, event, sender);
      return;
    }

    // 2. 获取或创建会话
    let sessionId = chatSessionStore.getSessionIdByConversation('weixin', conversationId);
    if (!sessionId) {
      const title = `微信会话-${buildSessionTimestamp()}`;
      const chatDefault = chatSessionStore.getSessionByConversation('weixin', conversationId)?.defaultDirectory;
      const dirResult = DirectoryPolicy.resolve({ chatDefaultDirectory: chatDefault });
      const effectiveDir = dirResult.ok && dirResult.source !== 'server_default' ? dirResult.directory : undefined;
      const session = await opencodeClient.createSession(title, effectiveDir);
      if (session) {
        sessionId = session.id;
        chatSessionStore.setSessionByConversation('weixin', conversationId, sessionId, senderId, title, {
          chatType: event.chatType || 'p2p',
          resolvedDirectory: session.directory,
        });
      } else {
        await sender.sendText(conversationId, '无法创建 OpenCode 会话');
        return;
      }
    }

    // 3. 处理 Prompt
    const sessionConfig = chatSessionStore.getSessionByConversation('weixin', conversationId);
    const promptText = command.text ?? trimmed;
    await this.processPrompt(
      sessionId,
      promptText,
      conversationId,
      attachments,
      sessionConfig,
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
    let respondedSessionId = pending.sessionId;
    let lastError: unknown;
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
          respondedSessionId = candidateSessionId;
          break;
        }
        if (result.expired) {
          expiredDetected = true;
        }
      } catch (error) {
        lastError = error;
        console.error(`[Weixin] 权限文本响应失败: session=${candidateSessionId}`, error);
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

    console.log(
      `[Weixin] 权限文本响应成功: session=${respondedSessionId}, allow=${decision.allow}`
    );

    const removed = permissionHandler.resolveForChat(queueKey, pending.permissionId);
    const toolName = removed?.tool || pending.tool || '工具';
    const resultText = decision.allow
      ? decision.remember ? `已允许并记住权限：${toolName}` : `已允许权限：${toolName}`
      : `已拒绝权限：${toolName}`;

    await sender.sendText(conversationId, resultText);
    return true;
  }

  /**
   * 获取待回答的问题
   */
  private getPendingQuestionByConversation(conversationId: string): PendingQuestion | null {
    const sessionId = chatSessionStore.getSessionIdByConversation('weixin', conversationId);
    if (!sessionId) {
      return null;
    }

    const pending = questionHandler.getBySession(sessionId);
    if (!pending || pending.chatId !== conversationId) {
      return null;
    }

    return pending;
  }

  /**
   * 尝试处理待回答的问题
   */
  private async tryHandlePendingQuestion(
    conversationId: string,
    text: string,
    sender: PlatformSender
  ): Promise<boolean> {
    const pending = this.getPendingQuestionByConversation(conversationId);
    if (!pending) {
      return false;
    }

    const questionCount = pending.request.questions.length;
    if (questionCount === 0) {
      await sender.sendText(conversationId, '当前问题状态异常，请稍后重试。');
      return true;
    }

    const pendingCustomIndex = questionHandler.getPendingCustomQuestionIndex(pending.request.id);
    if (typeof pendingCustomIndex === 'number') {
      questionHandler.setDraftAnswer(pending.request.id, pendingCustomIndex, []);
      questionHandler.setDraftCustomAnswer(pending.request.id, pendingCustomIndex, text);
      questionHandler.setPendingCustomQuestion(pending.request.id, undefined);
      await this.advanceOrSubmitQuestion(pending, pendingCustomIndex, conversationId, sender);
      return true;
    }

    const currentIndex = Math.min(Math.max(pending.currentQuestionIndex, 0), questionCount - 1);
    const question = pending.request.questions[currentIndex];
    const parsed = parseQuestionAnswerText(text, question);

    if (!parsed) {
      await sender.sendText(conversationId, '当前有待回答问题，请回复选项内容/编号，或直接输入自定义答案。');
      return true;
    }

    await this.applyPendingQuestionAnswer(pending, parsed, text, sender, conversationId);
    return true;
  }

  private async applyPendingQuestionAnswer(
    pending: PendingQuestion,
    parsed: ParsedQuestionAnswer,
    rawText: string,
    sender: PlatformSender,
    conversationId: string
  ): Promise<void> {
    const currentIndex = Math.min(Math.max(pending.currentQuestionIndex, 0), pending.request.questions.length - 1);

    this.updateDraftAnswerFromParsed(pending, currentIndex, parsed, rawText);
    await this.advanceOrSubmitQuestion(pending, currentIndex, conversationId, sender);
  }

  private updateDraftAnswerFromParsed(
    pending: PendingQuestion,
    questionIndex: number,
    parsed: ParsedQuestionAnswer,
    _rawText: string
  ): void {
    if (parsed.type === 'skip') {
      questionHandler.setDraftAnswer(pending.request.id, questionIndex, []);
      questionHandler.setDraftCustomAnswer(pending.request.id, questionIndex, '');
      return;
    }

    if (parsed.type === 'custom' && parsed.custom) {
      questionHandler.setDraftAnswer(pending.request.id, questionIndex, []);
      questionHandler.setDraftCustomAnswer(pending.request.id, questionIndex, parsed.custom);
      return;
    }

    if (parsed.type === 'selection' && parsed.values) {
      questionHandler.setDraftAnswer(pending.request.id, questionIndex, parsed.values);
      questionHandler.setDraftCustomAnswer(pending.request.id, questionIndex, '');
    }
  }

  private async advanceOrSubmitQuestion(
    pending: PendingQuestion,
    answeredIndex: number,
    conversationId: string,
    sender: PlatformSender
  ): Promise<void> {
    const nextIndex = answeredIndex + 1;
    const totalQuestions = pending.request.questions.length;

    if (nextIndex >= totalQuestions) {
      const sessionId = chatSessionStore.getSessionIdByConversation('weixin', conversationId);
      if (!sessionId) {
        await sender.sendText(conversationId, '会话已过期，请重新发起');
        return;
      }

      const answers: string[][] = [];
      const customAnswers = questionHandler.getDraftCustomAnswers(pending.request.id);

      for (let i = 0; i < totalQuestions; i++) {
        const custom = customAnswers ? customAnswers[i] : undefined;
        if (custom) {
          answers.push([custom]);
        } else {
          answers.push([]);
        }
      }

      const result = await opencodeClient.replyQuestion(pending.request.id, answers);

      questionHandler.remove(pending.request.id);

      if (result.ok) {
        const answerText = answers
          .map((a, i) => `Q${i + 1}: ${a.join(', ') || '(跳过)'}`)
          .join('\n');
        await sender.sendText(conversationId, `已提交回答\n${answerText}`);
      } else {
        const errorMsg = result.expired ? '问题已过期' : '回答提交失败';
        await sender.sendText(conversationId, errorMsg);
      }
    } else {
      questionHandler.setCurrentQuestionIndex(pending.request.id, nextIndex);
      const nextQuestion = pending.request.questions[nextIndex];
      let promptText = `问题 ${nextIndex + 1}/${totalQuestions}：\n${nextQuestion.question}`;
      if (nextQuestion.options && nextQuestion.options.length > 0) {
        promptText += '\n选项：';
        nextQuestion.options.forEach((opt, i) => {
          promptText += `\n${i + 1}. ${opt}`;
        });
      }
      await sender.sendText(conversationId, promptText);
    }
  }

  /**
   * 处理命令
   */
  private async handleCommand(
    command: ParsedCommand,
    event: PlatformMessageEvent,
    sender: PlatformSender
  ): Promise<void> {
    const { conversationId } = event;

    switch (command.type) {
      case 'help':
        await sender.sendText(conversationId, WEIXIN_HELP_TEXT);
        break;

      case 'session': {
        if (command.sessionAction === 'new') {
          const title = `微信会话-${buildSessionTimestamp()}`;
          const session = await opencodeClient.createSession(title);
          if (session) {
            chatSessionStore.setSessionByConversation('weixin', conversationId, session.id, event.senderId, title, {
              chatType: event.chatType || 'p2p',
              resolvedDirectory: session.directory,
            });
            await sender.sendText(conversationId, `已创建新会话：${session.id.slice(0, 8)}...`);
          } else {
            await sender.sendText(conversationId, '创建会话失败');
          }
        } else {
          await sender.sendText(conversationId, '会话操作：/session new - 创建新会话');
        }
        break;
      }

      case 'clear': {
        const sessionId = chatSessionStore.getSessionIdByConversation('weixin', conversationId);
        if (sessionId) {
          chatSessionStore.removeSessionByConversation('weixin', conversationId);
          outputBuffer.clear(`chat:${conversationId}`);
          await sender.sendText(conversationId, '会话已清除，发送消息将创建新会话');
        } else {
          await sender.sendText(conversationId, '当前没有活跃会话');
        }
        break;
      }

      case 'status': {
        const sessionId = chatSessionStore.getSessionIdByConversation('weixin', conversationId);
        const session = sessionId ? chatSessionStore.getSession(sessionId) : null;
        if (session) {
          const info = `会话ID: ${sessionId?.slice(0, 12)}...
目录: ${session.resolvedDirectory || '默认'}`;
          await sender.sendText(conversationId, info);
        } else {
          await sender.sendText(conversationId, '当前没有绑定会话');
        }
        break;
      }

      case 'stop': {
        const sessionId = chatSessionStore.getSessionIdByConversation('weixin', conversationId);
        if (sessionId) {
          await opencodeClient.abortSession(sessionId);
          await sender.sendText(conversationId, '已发送中断请求');
        } else {
          await sender.sendText(conversationId, '当前没有活跃的会话');
        }
        break;
      }

      default:
        await sender.sendText(conversationId, `未知命令：${command.type}。发送 /help 查看帮助`);
    }
  }

  /**
   * 处理 Prompt
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
      console.error('[Weixin] 发送器为空，无法发送消息');
      return;
    }

    try {
      console.log(`[Weixin] 发送消息：chat=${chatId}, session=${sessionId.slice(0, 8)}...`);

      const parts: OpencodePartInput[] = [];

      if (text) {
        parts.push({ type: 'text', text });
      }

      if (attachments && attachments.length > 0) {
        const prepared = await this.prepareAttachmentParts(attachments);
        if (prepared.warnings.length > 0) {
          await sender.sendText(chatId, `附件警告：\n${prepared.warnings.join('\n')}`);
        }
        parts.push(...prepared.parts);
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
        }
      }

      const effectiveEffort = promptEffort || config?.preferredEffort;
      const sessionData = chatSessionStore.getSessionByConversation('weixin', chatId);
      const directory = sessionData?.resolvedDirectory;

      await opencodeClient.sendMessagePartsAsync(
        sessionId,
        parts,
        {
          providerId,
          modelId,
          agent: config?.preferredAgent,
          ...(effectiveEffort ? { variant: effectiveEffort } : {}),
          ...(directory ? { directory } : {}),
        }
      );

    } catch (error) {
      const errorMessage = this.formatDispatchError(error);
      console.error('[Weixin] 请求派发失败:', error);

      outputBuffer.append(bufferKey, `\n\n错误：${errorMessage}`);
      outputBuffer.setStatus(bufferKey, 'failed');

      const currentBuffer = outputBuffer.get(bufferKey);
      if (!currentBuffer?.messageId) {
        await sender.sendText(chatId, `错误：${errorMessage}`);
      }
    }
  }

  /**
   * 准备附件部分
   */
  private async prepareAttachmentParts(
    attachments: PlatformAttachment[]
  ): Promise<{ parts: OpencodeFilePartInput[]; warnings: string[] }> {
    const parts: OpencodeFilePartInput[] = [];
    const warnings: string[] = [];

    for (const att of attachments) {
      // 检查文件大小
      if (att.fileSize && att.fileSize > attachmentConfig.maxSize) {
        warnings.push(`附件 ${att.fileName || '未知'} 过大（${Math.round(att.fileSize / 1024 / 1024)}MB），已跳过`);
        continue;
      }

      if (!att.fileKey) {
        warnings.push(`附件 ${att.fileName || '未知'} 缺少文件标识`);
        continue;
      }

      const mime = att.fileType || 'application/octet-stream';
      const filename = att.fileName || 'attachment';

      parts.push({
        type: 'file',
        mime,
        url: att.fileKey,
        filename,
      });
    }

    return { parts, warnings };
  }

  /**
   * 截断消息以适应微信消息限制
   */
  private truncateMessage(text: string): string {
    if (text.length <= WEIXIN_MESSAGE_LIMIT) {
      return text;
    }
    return text.slice(0, WEIXIN_MESSAGE_LIMIT - 20) + '\n...（内容已截断）';
  }
}

export const weixinHandler = new WeixinHandler();