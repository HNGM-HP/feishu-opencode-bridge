/**
 * Telegram 消息处理器
 *
 * 参考 wecom.ts 和 discord.ts 的结构，处理 Telegram 消息
 * 支持附件处理：photo、document、video、audio
 */

import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { modelConfig, attachmentConfig } from '../config.js';
import { opencodeClient } from '../opencode/client.js';
import { preprocessVisionParts, type VisionPart } from '../services/vision-ocr.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { chatSessionStore } from '../store/chat-session.js';
import { parseCommand, getHelpText, type ParsedCommand } from '../commands/parser.js';
import { DirectoryPolicy } from '../utils/directory-policy.js';
import { buildSessionTimestamp } from '../utils/session-title.js';
import type { PlatformMessageEvent, PlatformSender, PlatformAttachment } from '../platform/types.js';
import type { EffortLevel } from '../commands/effort.js';
import { normalizeEffortLevel, KNOWN_EFFORT_LEVELS } from '../commands/effort.js';
import { lifecycleHandler } from './lifecycle.js';
import { permissionHandler } from '../permissions/handler.js';
import { questionHandler, type PendingQuestion } from '../opencode/question-handler.js';
import { parseQuestionAnswerText } from '../opencode/question-parser.js';
import { telegramAdapter } from '../platform/adapters/telegram-adapter.js';

// 附件相关配置
const ATTACHMENT_BASE_DIR = path.resolve(process.cwd(), 'tmp', 'telegram-uploads');
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf',
  '.mp4', '.mov', '.mp3', '.ogg', '.wav', '.m4a',
]);

// Helper functions for file type detection
function extractExtension(name: string): string {
  return path.extname(name).toLowerCase();
}

function mimeFromExtension(ext: string): string {
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.pdf': return 'application/pdf';
    case '.mp4': return 'video/mp4';
    case '.mov': return 'video/quicktime';
    case '.mp3': return 'audio/mpeg';
    case '.ogg': return 'audio/ogg';
    case '.wav': return 'audio/wav';
    case '.m4a': return 'audio/mp4';
    default: return 'application/octet-stream';
  }
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '_').trim();
  return cleaned || 'attachment';
}

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

export class TelegramHandler {
  private ensureStreamingBuffer(chatId: string, sessionId: string): void {
    const key = `chat:telegram:${chatId}`;
    const current = outputBuffer.get(key);
    if (current && current.status !== 'running') {
      outputBuffer.clear(key);
    }

    if (!outputBuffer.get(key)) {
      outputBuffer.getOrCreate(key, chatId, sessionId, null);
    }
  }

  private getPermissionQueueKey(conversationId: string): string {
    return `telegram:${conversationId}`;
  }

  private resolvePermissionDirectoryOptions(
    sessionId: string,
    conversationId: string
  ): { directory?: string; fallbackDirectories?: string[] } {
    const boundSession = chatSessionStore.getSessionByConversation('telegram', conversationId);
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
   * 处理 Telegram 消息
   */
  async handleMessage(
    event: PlatformMessageEvent,
    sender: PlatformSender
  ): Promise<void> {
    // 注意：群聊 @ 提到检查已在 telegram-adapter 中处理（通过 botUsername 正则过滤），
    // 此处不再重复调用 shouldSkipGroupMessage，避免因 mentions 字段未填充导致群消息被误丢弃。

    const { conversationId: chatId, content, senderId, attachments } = event;
    const trimmed = content.trim();

    // 0. 检查是否有待处理的权限请求（文本回复）
    const permissionHandled = await this.tryHandlePendingPermission(chatId, trimmed, sender);
    if (permissionHandled) {
      return;
    }

    // 0.1 检查是否有待回答的问题（文本回复）
    const questionHandled = await this.tryHandlePendingQuestion(chatId, trimmed, sender);
    if (questionHandled) {
      return;
    }

    // 1. 优先处理命令
    const command = parseCommand(trimmed);
    if (command.type !== 'prompt') {
      console.log(`[Telegram] 收到命令：${command.type}`);
      await this.handleCommand(command, event, sender);
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
   * 尝试处理待处理的权限请求（文本回复）
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

    // 收集候选 session IDs
    const candidateSessionIds = Array.from(
      new Set(
        [pending.sessionId, pending.parentSessionId, pending.relatedSessionId]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    );

    // 尝试每个候选 session，直到成功
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
        console.error(`[Telegram] 权限文本响应失败: session=${candidateSessionId}, permission=${pending.permissionId}`, error);
      }
    }

    if (!responded) {
      console.error(`[Telegram] 所有候选 session 权限文本响应失败: sessions=${candidateSessionIds.join(',')}`, lastError);
      if (expiredDetected) {
        await sender.sendText(conversationId, '操作已过期，请重新发起');
      } else {
        await sender.sendText(conversationId, '权限响应失败，请重试');
      }
      return true;
    }

    console.log(
      `[Telegram] 权限文本响应成功: session=${respondedSessionId}, permission=${pending.permissionId}, allow=${decision.allow}, remember=${decision.remember}`
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
    const sessionId = chatSessionStore.getSessionIdByConversation('telegram', conversationId);
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
   * 尝试处理待回答的问题（文本回复）
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

    // 检查是否有待处理的自定义问题
    const pendingCustomIndex = questionHandler.getPendingCustomQuestionIndex(pending.request.id);
    if (typeof pendingCustomIndex === 'number') {
      // 将文本作为自定义答案处理
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

  /**
   * 更新草稿答案
   */
  private updateDraftAnswerFromParsed(
    pending: PendingQuestion,
    questionIndex: number,
    parsed: ParsedQuestionAnswer,
    rawText: string
  ): void {
    if (parsed.type === 'skip') {
      questionHandler.setDraftAnswer(pending.request.id, questionIndex, []);
      questionHandler.setDraftCustomAnswer(pending.request.id, questionIndex, '');
      return;
    }

    if (parsed.type === 'custom') {
      questionHandler.setDraftAnswer(pending.request.id, questionIndex, []);
      questionHandler.setDraftCustomAnswer(pending.request.id, questionIndex, parsed.custom || rawText);
      return;
    }

    questionHandler.setDraftCustomAnswer(pending.request.id, questionIndex, '');
    questionHandler.setDraftAnswer(pending.request.id, questionIndex, parsed.values || []);
  }

  /**
   * 应用问答答案
   */
  private async applyPendingQuestionAnswer(
    pending: PendingQuestion,
    parsed: ParsedQuestionAnswer,
    rawText: string,
    sender: PlatformSender,
    conversationId: string
  ): Promise<void> {
    const questionCount = pending.request.questions.length;
    if (questionCount === 0) {
      await sender.sendText(conversationId, '当前问题状态异常，请稍后重试。');
      return;
    }

    const currentIndex = Math.min(Math.max(pending.currentQuestionIndex, 0), questionCount - 1);
    this.updateDraftAnswerFromParsed(pending, currentIndex, parsed, rawText);

    const nextIndex = currentIndex + 1;
    if (nextIndex < questionCount) {
      questionHandler.setCurrentQuestionIndex(pending.request.id, nextIndex);
      this.touchQuestionBuffer(conversationId);
      await sender.sendText(conversationId, `✅ 已记录第 ${currentIndex + 1}/${questionCount} 题，请继续回答下一题。`);
      return;
    }

    await this.submitPendingQuestion(pending, sender, conversationId);
  }

  /**
   * 提交所有问题答案
   */
  private async submitPendingQuestion(
    pending: PendingQuestion,
    sender: PlatformSender,
    conversationId: string
  ): Promise<void> {
    const answers: string[][] = [];
    for (let index = 0; index < pending.request.questions.length; index++) {
      const custom = (pending.draftCustomAnswers[index] || '').trim();
      if (custom) {
        answers.push([custom]);
      } else {
        answers.push(pending.draftAnswers[index] || []);
      }
    }

    const result = await opencodeClient.replyQuestion(pending.request.id, answers);
    if (!result.ok) {
      if (result.expired) {
        questionHandler.remove(pending.request.id);
        await sender.sendText(conversationId, '⚠️ 问题已过期，请重新发起对话。');
      } else {
        await sender.sendText(conversationId, '⚠️ 回答提交失败，请稍后重试。');
      }
      return;
    }

    questionHandler.remove(pending.request.id);
    this.touchQuestionBuffer(conversationId);
    await sender.sendText(conversationId, '✅ 已提交问题回答，任务继续执行。');
  }

  /**
   * 触发问答缓冲区更新
   */
  private touchQuestionBuffer(conversationId: string): void {
    const bufferKey = `chat:telegram:${conversationId}`;
    outputBuffer.touch(bufferKey);
  }

  /**
   * 处理回调查询（按钮点击）
   */
  async handleAction(
    event: { action: { tag: string; value: Record<string, unknown> }; senderId: string; conversationId?: string; messageId?: string },
    sender: PlatformSender
  ): Promise<void> {
    const { action, conversationId, messageId } = event;
    if (!conversationId) return;

    console.log(`[Telegram] 收到回调查询：${action.tag}`);

    // 尝试解析 callback_data 为 JSON
    let callbackData: Record<string, unknown> = {};
    try {
      if (action.tag.startsWith('{')) {
        callbackData = JSON.parse(action.tag);
      } else {
        callbackData = action.value || {};
      }
    } catch {
      callbackData = action.value || {};
    }

    const callbackAction = typeof callbackData.action === 'string' ? callbackData.action : '';

    // 处理权限确认回调
    if (callbackAction === 'permission_allow' || callbackAction === 'permission_deny') {
      await this.handlePermissionCallback(conversationId, callbackData, callbackAction, sender, messageId);
      return;
    }

    // 处理问答回调
    if (callbackAction === 'question_select' || callbackAction === 'question_skip' || callbackAction === 'question_custom') {
      await this.handleQuestionCallback(conversationId, callbackData, callbackAction, sender, messageId);
      return;
    }

    // 兼容旧的简单回调格式
    if (action.tag === 'allow') {
      await sender.sendText(conversationId, '已允许该操作');
    } else if (action.tag === 'deny') {
      await sender.sendText(conversationId, '已拒绝该操作');
    }
  }

  /**
   * 处理权限确认回调
   */
  private async handlePermissionCallback(
    conversationId: string,
    callbackData: Record<string, unknown>,
    action: string,
    sender: PlatformSender,
    messageId?: string
  ): Promise<void> {
    const sessionId = typeof callbackData.sessionId === 'string' ? callbackData.sessionId : '';
    const permissionId = typeof callbackData.permissionId === 'string' ? callbackData.permissionId : '';
    const parentSessionId = typeof callbackData.parentSessionId === 'string' ? callbackData.parentSessionId : undefined;
    const relatedSessionId = typeof callbackData.relatedSessionId === 'string' ? callbackData.relatedSessionId : undefined;

    if (!sessionId || !permissionId) {
      await sender.sendText(conversationId, '权限参数缺失');
      return;
    }

    const allow = action === 'permission_allow';
    const rememberRaw = callbackData.remember;
    const remember =
      rememberRaw === true ||
      rememberRaw === 1 ||
      rememberRaw === '1' ||
      rememberRaw === 'true' ||
      rememberRaw === 'always' ||
      rememberRaw === '始终允许';

    // 收集候选 session IDs
    const candidateSessionIds = Array.from(
      new Set(
        [sessionId, parentSessionId, relatedSessionId]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    );

    // 尝试每个候选 session，直到成功
    let responded = false;
    let respondedSessionId = sessionId;
    let lastError: unknown;
    let expiredDetected = false;

    for (const candidateSessionId of candidateSessionIds) {
      const permissionDirectoryOptions = this.resolvePermissionDirectoryOptions(candidateSessionId, conversationId);
      try {
        const result = await opencodeClient.respondToPermission(
          candidateSessionId,
          permissionId,
          allow,
          remember,
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
        console.error(`[Telegram] 权限响应失败: session=${candidateSessionId}, permission=${permissionId}`, error);
      }
    }

    if (!responded) {
      console.error(`[Telegram] 所有候选 session 权限响应失败: sessions=${candidateSessionIds.join(',')}`, lastError);
      if (expiredDetected) {
        await sender.sendText(conversationId, '操作已过期，请重新发起');
      } else {
        await sender.sendText(conversationId, '权限响应失败，请重试');
      }
      return;
    }

    console.log(
      `[Telegram] 权限响应成功: session=${respondedSessionId}, permission=${permissionId}, allow=${allow}, remember=${remember}`
    );

    // 从队列中移除权限请求
    const queueKey = this.getPermissionQueueKey(conversationId);
    const removed = permissionHandler.resolveForChat(queueKey, permissionId);

    const toolName = removed?.tool || '工具';
    const resultText = allow
      ? remember ? `已允许并记住权限：${toolName}` : `已允许权限：${toolName}`
      : `已拒绝权限：${toolName}`;

    // 更新消息，移除按钮
    if (messageId) {
      await sender.updateCard(messageId, {
        text: resultText,
        telegramText: resultText,
      });
    } else {
      await sender.sendText(conversationId, resultText);
    }
  }

  /**
   * 处理问答回调
   */
  private async handleQuestionCallback(
    conversationId: string,
    callbackData: Record<string, unknown>,
    action: string,
    sender: PlatformSender,
    messageId?: string
  ): Promise<void> {
    const requestId = typeof callbackData.requestId === 'string' ? callbackData.requestId : '';
    const sessionId = typeof callbackData.sessionId === 'string' ? callbackData.sessionId : '';
    const questionIndex = typeof callbackData.questionIndex === 'number' ? callbackData.questionIndex : 0;
    const label = typeof callbackData.label === 'string' ? callbackData.label : '';

    if (!requestId) {
      await sender.sendText(conversationId, '问题参数缺失');
      return;
    }

    const pending = questionHandler.get(requestId);
    if (!pending) {
      await sender.sendText(conversationId, '问题已过期或不存在');
      return;
    }

    const questionCount = pending.request.questions.length;
    if (questionCount === 0) {
      await sender.sendText(conversationId, '问题状态异常');
      return;
    }

    const currentIndex = Math.min(Math.max(questionIndex, 0), questionCount - 1);
    const question = pending.request.questions[currentIndex];

    // 处理跳过
    if (action === 'question_skip') {
      questionHandler.setDraftAnswer(requestId, currentIndex, []);
      questionHandler.setDraftCustomAnswer(requestId, currentIndex, '');
      await this.advanceOrSubmitQuestion(pending, currentIndex, conversationId, sender, messageId);
      return;
    }

    // 处理自定义答案
    if (action === 'question_custom') {
      questionHandler.setPendingCustomQuestion(requestId, currentIndex);
      await sender.sendText(conversationId, '请直接回复自定义答案内容：');
      return;
    }

    // 处理选项选择
    if (action === 'question_select' && label) {
      // 检查是否多选
      if (question.multiple) {
        // 多选模式：追加选项
        const currentAnswers = pending.draftAnswers[currentIndex] || [];
        const newAnswers = currentAnswers.includes(label)
          ? currentAnswers.filter(l => l !== label)
          : [...currentAnswers, label];
        questionHandler.setDraftAnswer(requestId, currentIndex, newAnswers);
        questionHandler.setDraftCustomAnswer(requestId, currentIndex, '');

        // 更新消息显示已选选项
        const selectedText = newAnswers.length > 0 ? `已选: ${newAnswers.join(', ')}` : '请继续选择';
        const progressHint = questionCount > 1 ? `\n📋 第 ${currentIndex + 1}/${questionCount} 题` : '';

        if (messageId) {
          await sender.updateCard(messageId, {
            text: `❓ ${question.header}\n\n${question.question}${progressHint}\n\n${selectedText}`,
            telegramText: `❓ ${question.header}\n\n${question.question}${progressHint}\n\n${selectedText}`,
          });
        }
        return;
      }

      // 单选模式：直接选择并推进
      questionHandler.setDraftAnswer(requestId, currentIndex, [label]);
      questionHandler.setDraftCustomAnswer(requestId, currentIndex, '');
      await this.advanceOrSubmitQuestion(pending, currentIndex, conversationId, sender, messageId);
    }
  }

  /**
   * 推进到下一题或提交答案
   */
  private async advanceOrSubmitQuestion(
    pending: PendingQuestion,
    currentIndex: number,
    conversationId: string,
    sender: PlatformSender,
    messageId?: string
  ): Promise<void> {
    const questionCount = pending.request.questions.length;
    const nextIndex = currentIndex + 1;

    if (nextIndex < questionCount) {
      // 推进到下一题
      questionHandler.setCurrentQuestionIndex(pending.request.id, nextIndex);
      this.touchQuestionBuffer(conversationId);

      const nextQuestion = pending.request.questions[nextIndex];
      const questionText = `❓ ${nextQuestion.header}\n\n${nextQuestion.question}`;
      const progressHint = `\n📋 第 ${nextIndex + 1}/${questionCount} 题`;

      // 构建下一题的按钮
      const buttons: { text: string; callback_data: string }[] = [];
      const optionLabels = nextQuestion.options.map(opt => opt.label);

      for (let i = 0; i < optionLabels.length; i++) {
        const label = optionLabels[i];
        const callbackData = JSON.stringify({
          action: 'question_select',
          requestId: pending.request.id,
          sessionId: pending.request.sessionID,
          questionIndex: nextIndex,
          label: label,
        });
        buttons.push({ text: label, callback_data: callbackData });
      }

      // 添加跳过按钮
      const skipCallbackData = JSON.stringify({
        action: 'question_skip',
        requestId: pending.request.id,
        sessionId: pending.request.sessionID,
        questionIndex: nextIndex,
      });
      buttons.push({ text: '⏭️ 跳过', callback_data: skipCallbackData });

      // 如果支持自定义答案，添加自定义按钮
      if (nextQuestion.custom) {
        const customCallbackData = JSON.stringify({
          action: 'question_custom',
          requestId: pending.request.id,
          sessionId: pending.request.sessionID,
          questionIndex: nextIndex,
        });
        buttons.push({ text: '✏️ 自定义', callback_data: customCallbackData });
      }

      // 更新消息为下一题
      if (messageId) {
        await sender.updateCard(messageId, {
          text: questionText + progressHint + '\n\n💡 也可以直接回复文本作答',
          telegramText: questionText + progressHint + '\n\n💡 也可以直接回复文本作答',
          buttons,
        });
      } else {
        await sender.sendCard(conversationId, {
          text: questionText + progressHint + '\n\n💡 也可以直接回复文本作答',
          telegramText: questionText + progressHint + '\n\n💡 也可以直接回复文本作答',
          buttons,
        });
      }
      return;
    }

    // 提交答案
    await this.submitPendingQuestion(pending, sender, conversationId);

    // 更新消息显示已提交
    if (messageId) {
      await sender.updateCard(messageId, {
        text: '✅ 已提交问题回答，任务继续执行。',
        telegramText: '✅ 已提交问题回答，任务继续执行。',
      });
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
    const { conversationId: chatId, senderId, chatType } = event;

    try {
      switch (command.type) {
        case 'help':
          await sender.sendText(chatId, this.getTelegramHelpText());
          break;

        case 'status': {
          const sessionId = chatSessionStore.getSessionIdByConversation('telegram', chatId);
          const session = chatSessionStore.getSessionByConversation('telegram', chatId);
          const status = sessionId
            ? `当前绑定会话: ${sessionId.slice(0, 8)}...\n工作目录: ${session?.resolvedDirectory || '未设置'}`
            : '未绑定会话';
          await sender.sendText(chatId, `🤖 **OpenCode 状态**\n\n${status}`);
          break;
        }

        case 'session':
          if (command.sessionAction === 'new') {
            await this.handleNewSession(chatId, senderId, chatType || 'p2p', command.sessionDirectory, command.sessionName, sender);
          } else if (command.sessionAction === 'switch' && command.sessionId) {
            await this.handleSwitchSession(chatId, command.sessionId, senderId, chatType || 'p2p', sender);
          } else {
            await sender.sendText(chatId, '用法: /session new 或 /session <sessionId>');
          }
          break;

        case 'sessions':
          await this.handleListSessions(chatId, command.listAll ?? false, sender);
          break;

        case 'model':
          await this.handleModel(chatId, command.modelName, sender);
          break;

        case 'models':
          await this.handleModels(chatId, sender);
          break;

        case 'agent':
          await this.handleAgent(chatId, command.agentName, sender);
          break;

        case 'agents':
          await this.handleAgents(chatId, sender);
          break;

        case 'effort':
          await this.handleEffort(chatId, command, sender);
          break;

        case 'stop': {
          const sessionId = chatSessionStore.getSessionIdByConversation('telegram', chatId);
          if (sessionId) {
            await opencodeClient.abortSession(sessionId);
            await sender.sendText(chatId, '⏹️ 已发送中断请求');
          } else {
            await sender.sendText(chatId, '当前没有活跃的会话');
          }
          break;
        }

        case 'undo':
          await this.handleUndo(chatId, sender);
          break;

        case 'compact':
          await this.handleCompact(chatId, sender);
          break;

        case 'rename':
          await this.handleRename(chatId, command.renameTitle, sender);
          break;

        case 'clear':
          await this.handleNewSession(chatId, senderId, chatType || 'p2p', undefined, undefined, sender);
          break;

        case 'project':
          if (command.projectAction === 'list') {
            await this.handleProjectList(chatId, sender);
          } else if (command.projectAction === 'default_show') {
            await this.handleProjectDefaultShow(chatId, sender);
          } else if (command.projectAction === 'default_set' && command.projectValue) {
            await this.handleProjectDefaultSet(chatId, command.projectValue, sender);
          } else if (command.projectAction === 'default_clear') {
            await this.handleProjectDefaultClear(chatId, sender);
          } else {
            await sender.sendText(chatId, '用法: /project list 或 /project default set <路径或别名>');
          }
          break;

        default:
          // 未知命令提示
          await sender.sendText(chatId, `命令 "${command.type}" 暂不支持\n使用 /help 查看可用命令`);
          break;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Telegram] 命令执行失败:', error);
      await sender.sendText(chatId, `❌ 命令执行出错: ${errorMessage}`);
    }
  }

  /**
   * 获取 Telegram 帮助文本
   */
  private getTelegramHelpText(): string {
    return `📖 **Telegram × OpenCode 机器人指南**

💬 **如何对话**
直接发送消息即可与 AI 对话。

🛠️ **常用命令**
• \`/model\` 查看当前模型
• \`/model <名称>\` 切换模型
• \`/models\` 列出所有可用模型
• \`/agent\` 查看当前角色
• \`/agent <名称>\` 切换角色
• \`/agents\` 列出所有可用角色
• \`/effort\` 查看当前强度
• \`/effort <档位>\` 设置会话默认强度
• \`/undo\` 撤回上一轮对话
• \`/stop\` 停止当前正在生成的回答
• \`/compact\` 压缩当前会话上下文

⚙️ **会话管理**
• \`/session\` 列出当前项目的会话
• \`/session new\` 开启新话题
• \`/session new <别名或路径>\` 指定项目
• \`/rename <新名称>\` 重命名当前会话
• \`/status\` 查看当前绑定状态

📁 **项目管理**
• \`/project list\` 列出可用项目
• \`/project default set <路径或别名>\` 设置群默认项目
• \`/project default clear\` 清除群默认项目

💡 **提示**
• 切换的模型/角色仅对当前会话生效
• 强度优先级: #临时覆盖 > /effort 会话默认 > OpenCode 默认`;
  }

  /**
   * 处理新建会话
   */
  private async handleNewSession(
    chatId: string,
    senderId: string,
    chatType: 'p2p' | 'group',
    rawDirectory?: string,
    customName?: string,
    sender?: PlatformSender
  ): Promise<void> {
    if (!sender) return;

    const chatDefault = chatSessionStore.getSessionByConversation('telegram', chatId)?.defaultDirectory;
    const dirResult = DirectoryPolicy.resolve({
      explicitDirectory: rawDirectory,
      chatDefaultDirectory: chatDefault,
    });

    if (!dirResult.ok) {
      await sender.sendText(chatId, dirResult.userMessage);
      return;
    }

    const title = customName?.trim() || `Telegram会话-${buildSessionTimestamp()}`;
    const effectiveDir = dirResult.source === 'server_default' ? undefined : dirResult.directory;

    try {
      const session = await opencodeClient.createSession(title, effectiveDir);
      if (session) {
        chatSessionStore.setSessionByConversation('telegram', chatId, session.id, senderId, title, {
          chatType,
          resolvedDirectory: session.directory,
        });
        const dirInfo = session.directory ? `\n📂 工作目录: ${session.directory}` : '';
        await sender.sendText(chatId, `✅ 已创建新会话窗口\nID: ${session.id}${dirInfo}`);
      } else {
        await sender.sendText(chatId, '❌ 创建会话失败');
      }
    } catch (error) {
      console.error('[Telegram] 创建会话失败:', error);
      await sender.sendText(chatId, '❌ 创建会话失败，请检查目录是否为有效的代码仓库');
    }
  }

  /**
   * 处理切换会话
   */
  private async handleSwitchSession(
    chatId: string,
    sessionId: string,
    senderId: string,
    chatType: 'p2p' | 'group',
    sender: PlatformSender
  ): Promise<void> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      await sender.sendText(chatId, '❌ 会话 ID 不能为空');
      return;
    }

    try {
      const session = await opencodeClient.findSessionAcrossProjects(normalizedSessionId);
      if (!session) {
        await sender.sendText(chatId, `❌ 未找到会话: ${normalizedSessionId}`);
        return;
      }

      chatSessionStore.setSessionByConversation('telegram', chatId, session.id, senderId, session.title || '未命名会话', {
        chatType,
        resolvedDirectory: session.directory,
      });

      await sender.sendText(chatId, `✅ 已切换到会话: ${session.id.slice(0, 8)}...\n标题: ${session.title || '未命名'}`);
    } catch (error) {
      console.error('[Telegram] 切换会话失败:', error);
      await sender.sendText(chatId, '❌ 切换会话失败');
    }
  }

  /**
   * 处理列出会话
   */
  private async handleListSessions(chatId: string, listAll: boolean, sender: PlatformSender): Promise<void> {
    try {
      const storeKnownDirs = chatSessionStore.getKnownDirectories();
      const sessions = await opencodeClient.listAllSessions(listAll ? [] : storeKnownDirs);

      if (sessions.length === 0) {
        await sender.sendText(chatId, '暂无会话记录');
        return;
      }

      const lines = sessions.slice(0, 20).map((session, index) => {
        const title = session.title || '未命名';
        const shortId = session.id.slice(0, 8);
        const dir = session.directory || '/';
        return `${index + 1}. ${shortId} - ${title.slice(0, 30)}\n   📁 ${dir}`;
      });

      const hint = listAll ? '\n\n使用 /session <id> 切换到指定会话' : '\n\n使用 /sessions all 列出全部会话';
      await sender.sendText(chatId, `📋 **会话列表**\n\n${lines.join('\n')}${hint}`);
    } catch (error) {
      console.error('[Telegram] 获取会话列表失败:', error);
      await sender.sendText(chatId, '❌ 获取会话列表失败');
    }
  }

  /**
   * 处理模型切换
   */
  private async handleModel(chatId: string, modelName: string | undefined, sender: PlatformSender): Promise<void> {
    try {
      const providersResult = await opencodeClient.getProviders();
      const providers = Array.isArray(providersResult.providers) ? providersResult.providers : [];

      if (!modelName) {
        // 显示当前模型
        const session = chatSessionStore.getSessionByConversation('telegram', chatId);
        if (session?.preferredModel) {
          await sender.sendText(chatId, `当前模型: ${session.preferredModel}`);
        } else if (modelConfig.defaultProvider && modelConfig.defaultModel) {
          await sender.sendText(chatId, `当前模型: ${modelConfig.defaultProvider}:${modelConfig.defaultModel} (默认)`);
        } else {
          await sender.sendText(chatId, '当前未设置模型，使用 OpenCode 默认');
        }
        return;
      }

      // 设置模型
      const normalizedModelName = modelName.trim();
      chatSessionStore.updateConfigByConversation('telegram', chatId, { preferredModel: normalizedModelName });
      await sender.sendText(chatId, `✅ 已设置模型: ${normalizedModelName}`);
    } catch (error) {
      console.error('[Telegram] 设置模型失败:', error);
      await sender.sendText(chatId, '❌ 设置模型失败');
    }
  }

  /**
   * 列出所有可用模型
   */
  private async handleModels(chatId: string, sender: PlatformSender): Promise<void> {
    try {
      const providersResult = await opencodeClient.getProviders();
      const providers = Array.isArray(providersResult?.providers) ? providersResult.providers : [];

      if (providers.length === 0) {
        console.warn('[Telegram] No providers found in getProviders result');
        await sender.sendText(chatId, '❌ 未找到可用的模型提供商，请检查 OpenCode 配置');
        return;
      }

      const lines: string[] = ['📋 **可用模型列表**\n'];
      let totalCount = 0;

      for (const provider of providers) {
        const providerId = (provider as Record<string, unknown>).id as string | undefined;
        const providerName = (provider as Record<string, unknown>).name || providerId || 'Unknown';
        const rawModels = (provider as Record<string, unknown>).models;

        // models 可能是数组，也可能是对象（Map）
        const models: Array<{ id: string; name?: string }> = [];
        if (Array.isArray(rawModels)) {
          for (const m of rawModels) {
            if (m && typeof m === 'object') {
              const mr = m as Record<string, unknown>;
              models.push({
                id: (mr.id as string) || '',
                name: mr.name as string | undefined,
              });
            }
          }
        } else if (rawModels && typeof rawModels === 'object') {
          // SDK 返回的是对象 Map<string, Model>
          const modelMap = rawModels as Record<string, unknown>;
          for (const [modelId, modelInfo] of Object.entries(modelMap)) {
            if (modelInfo && typeof modelInfo === 'object') {
              const mi = modelInfo as Record<string, unknown>;
              models.push({
                id: modelId,
                name: (mi.name as string) || modelId,
              });
            }
          }
        }

        if (models.length === 0) continue;
        lines.push(`**${providerName}**`);

        for (const model of models.slice(0, 15)) {
          const modelDisplay = model.name || model.id;
          const modelKey = `${providerId}:${model.id}`;
          lines.push(`  • ${modelDisplay} (\`${modelKey}\`)`);
          totalCount++;
        }

        if (models.length > 15) {
          lines.push(`  _... 共 ${models.length} 个模型_`);
        }
        lines.push('');
      }

      if (totalCount === 0) {
        lines.push('暂无可用模型');
      } else {
        lines.push(`💡 共 ${totalCount} 个模型，使用 \`/model <名称>\` 切换`);
      }

      let result = lines.join('\n');
      if (result.length > 4000) {
        result = result.slice(0, 3900) + '\n\n... 列表过长，已截断';
      }

      await sender.sendText(chatId, result);
    } catch (error) {
      console.error('[Telegram] 获取模型列表失败:', error);
      await sender.sendText(chatId, '❌ 获取模型列表失败');
    }
  }

  /**
   * 处理角色切换
   */
  private async handleAgent(chatId: string, agentName: string | undefined, sender: PlatformSender): Promise<void> {
    try {
      const agents = await opencodeClient.getAgents();

      if (!agentName) {
        // 显示当前角色
        const session = chatSessionStore.getSessionByConversation('telegram', chatId);
        const currentAgent = session?.preferredAgent;
        if (currentAgent) {
          const agentInfo = agents.find((a: { name: string }) => a.name === currentAgent);
          await sender.sendText(chatId, `当前角色: ${currentAgent}${agentInfo?.description ? `\n${agentInfo.description.slice(0, 100)}` : ''}`);
        } else {
          await sender.sendText(chatId, '当前使用默认角色');
        }
        return;
      }

      const normalizedAgentName = agentName.trim().toLowerCase();
      if (normalizedAgentName === 'off' || normalizedAgentName === 'default') {
        chatSessionStore.updateConfigByConversation('telegram', chatId, { preferredAgent: undefined });
        await sender.sendText(chatId, '✅ 已切换为默认角色');
        return;
      }

      const matched = agents.find((a: { name: string }) => a.name.toLowerCase() === normalizedAgentName || a.name === agentName.trim());
      if (matched) {
        chatSessionStore.updateConfigByConversation('telegram', chatId, { preferredAgent: matched.name });
        await sender.sendText(chatId, `✅ 已切换角色: ${matched.name}`);
      } else {
        await sender.sendText(chatId, `❌ 未找到角色: ${agentName}\n使用 /agent 查看可用角色`);
      }
    } catch (error) {
      console.error('[Telegram] 设置角色失败:', error);
      await sender.sendText(chatId, '❌ 设置角色失败');
    }
  }

  /**
   * 列出所有可用角色
   */
  private async handleAgents(chatId: string, sender: PlatformSender): Promise<void> {
    try {
      const agents = await opencodeClient.getAgents();
      const visibleAgents = agents.filter((a: { name: string }) =>
        a.name && !['compaction', 'title', 'summary'].includes(a.name)
      );

      if (visibleAgents.length === 0) {
        await sender.sendText(chatId, '暂无可用角色');
        return;
      }

      const lines: string[] = ['📋 **可用角色列表**\n'];

      for (const agent of visibleAgents) {
        const desc = agent.description ? ` - ${agent.description.slice(0, 60)}${agent.description.length > 60 ? '...' : ''}` : '';
        lines.push(`• **${agent.name}**${desc}`);
      }

      lines.push(`\n💡 共 ${visibleAgents.length} 个角色，使用 \`/agent <名称>\` 切换`);

      await sender.sendText(chatId, lines.join('\n'));
    } catch (error) {
      console.error('[Telegram] 获取角色列表失败:', error);
      await sender.sendText(chatId, '❌ 获取角色列表失败');
    }
  }

  /**
   * 处理强度设置
   */
  private async handleEffort(chatId: string, command: ParsedCommand, sender: PlatformSender): Promise<void> {
    const session = chatSessionStore.getSessionByConversation('telegram', chatId);

    if (command.effortReset) {
      chatSessionStore.updateConfigByConversation('telegram', chatId, { preferredEffort: undefined });
      await sender.sendText(chatId, '✅ 已清除会话强度，恢复模型默认');
      return;
    }

    if (command.effortLevel) {
      chatSessionStore.updateConfigByConversation('telegram', chatId, { preferredEffort: command.effortLevel });
      await sender.sendText(chatId, `✅ 已设置会话强度: ${command.effortLevel}`);
      return;
    }

    // 显示当前强度
    const currentEffort = session?.preferredEffort;
    if (currentEffort) {
      await sender.sendText(chatId, `当前会话强度: ${currentEffort}\n\n可用档位: ${KNOWN_EFFORT_LEVELS.join(' / ')}`);
    } else {
      await sender.sendText(chatId, `当前未设置会话强度，使用模型默认\n\n可用档位: ${KNOWN_EFFORT_LEVELS.join(' / ')}`);
    }
  }

  /**
   * 处理撤回
   */
  private async handleUndo(chatId: string, sender: PlatformSender): Promise<void> {
    const session = chatSessionStore.getSessionByConversation('telegram', chatId);
    if (!session || !session.sessionId) {
      await sender.sendText(chatId, '❌ 当前没有活跃的会话');
      return;
    }

    console.log(`[Telegram] 尝试撤回会话 ${session.sessionId} 的最后一次交互`);

    try {
      // 1. Pop interaction
      const lastInteraction = chatSessionStore.popInteractionByConversation
        ? chatSessionStore.popInteractionByConversation('telegram', chatId)
        : null;

      if (!lastInteraction) {
        await sender.sendText(chatId, '⚠️ 没有可撤回的消息');
        return;
      }

      // 2. Revert in OpenCode
      let targetRevertId = '';
      try {
        const messages = await opencodeClient.getSessionMessages(session.sessionId);
        const aiMsgIndex = messages.findIndex(m => m.info.id === lastInteraction.openCodeMsgId);

        if (aiMsgIndex !== -1 && aiMsgIndex >= 1) {
          targetRevertId = messages[aiMsgIndex - 1].info.id;
        } else if (messages.length >= 2) {
          targetRevertId = messages[messages.length - 2].info.id;
        } else if (messages.length === 1) {
          targetRevertId = messages[0].info.id;
        }
      } catch (e) {
        console.warn('[Telegram Undo] Failed to fetch messages for revert calculation', e);
      }

      if (targetRevertId) {
        await opencodeClient.revertMessage(session.sessionId, targetRevertId);
      }

      await sender.sendText(chatId, '✅ 已撤回上一轮对话');
    } catch (error) {
      console.error('[Telegram Undo] 执行失败:', error);
      await sender.sendText(chatId, '❌ 撤回失败');
    }
  }

  /**
   * 处理压缩上下文
   */
  private async handleCompact(chatId: string, sender: PlatformSender): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation('telegram', chatId);
    if (!sessionId) {
      await sender.sendText(chatId, '❌ 当前没有活跃的会话');
      return;
    }

    try {
      let providerId = modelConfig.defaultProvider;
      let modelId = modelConfig.defaultModel;

      const session = chatSessionStore.getSessionByConversation('telegram', chatId);
      if (session?.preferredModel) {
        const [p, m] = session.preferredModel.split(':');
        if (p && m) {
          providerId = p;
          modelId = m;
        }
      }

      if (!providerId || !modelId) {
        await sender.sendText(chatId, '❌ 未找到可用模型，无法执行上下文压缩');
        return;
      }

      const compacted = await opencodeClient.summarizeSession(sessionId, providerId, modelId);
      if (compacted) {
        await sender.sendText(chatId, `✅ 上下文压缩完成（模型: ${providerId}:${modelId}）`);
      } else {
        await sender.sendText(chatId, '❌ 上下文压缩失败');
      }
    } catch (error) {
      console.error('[Telegram] 压缩失败:', error);
      await sender.sendText(chatId, '❌ 上下文压缩失败');
    }
  }

  /**
   * 处理重命名
   */
  private async handleRename(chatId: string, newTitle: string | undefined, sender: PlatformSender): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation('telegram', chatId);
    if (!sessionId) {
      await sender.sendText(chatId, '❌ 当前没有活跃的会话');
      return;
    }

    if (!newTitle || !newTitle.trim()) {
      await sender.sendText(chatId, '用法: /rename <新名称>');
      return;
    }

    const trimmedTitle = newTitle.trim();
    if (trimmedTitle.length > 100) {
      await sender.sendText(chatId, `❌ 会话名称过长（${trimmedTitle.length} 字符），请控制在 100 字符以内`);
      return;
    }

    try {
      const success = await opencodeClient.updateSession(sessionId, trimmedTitle);
      if (success) {
        chatSessionStore.updateTitleByConversation('telegram', chatId, trimmedTitle);
        await sender.sendText(chatId, `✅ 会话已重命名为 "${trimmedTitle}"`);
      } else {
        await sender.sendText(chatId, '❌ 重命名失败');
      }
    } catch (error) {
      console.error('[Telegram] 重命名失败:', error);
      await sender.sendText(chatId, '❌ 重命名失败');
    }
  }

  /**
   * 处理项目列表
   */
  private async handleProjectList(chatId: string, sender: PlatformSender): Promise<void> {
    try {
      const storeKnownDirs = chatSessionStore.getKnownDirectories();
      let knownDirs: string[] = [...storeKnownDirs];

      try {
        const sessions = await opencodeClient.listSessionsAcrossProjects();
        const sessionDirs = sessions
          .map((s: { directory?: string }) => s.directory)
          .filter((d): d is string => Boolean(d));
        knownDirs = [...new Set([...knownDirs, ...sessionDirs])];
      } catch {
        // 忽略错误
      }

      const projects = DirectoryPolicy.listAvailableProjects(knownDirs);

      if (projects.length === 0) {
        await sender.sendText(chatId, '暂无可用项目');
        return;
      }

      const lines = projects.map((project, index) => {
        const tag = project.source === 'alias' ? '🏷️' : '📂';
        return `${index + 1}. ${tag} ${project.name} - ${project.directory}`;
      });

      await sender.sendText(chatId, `📋 **可用项目列表**\n\n${lines.join('\n')}`);
    } catch (error) {
      console.error('[Telegram] 获取项目列表失败:', error);
      await sender.sendText(chatId, '❌ 获取项目列表失败');
    }
  }

  /**
   * 处理显示群默认项目
   */
  private async handleProjectDefaultShow(chatId: string, sender: PlatformSender): Promise<void> {
    const chatDefault = chatSessionStore.getSessionByConversation('telegram', chatId)?.defaultDirectory;
    if (chatDefault) {
      await sender.sendText(chatId, `当前群默认项目: ${chatDefault}\n使用 /project default clear 清除`);
    } else {
      await sender.sendText(chatId, '当前群未设置默认项目（跟随全局默认）');
    }
  }

  /**
   * 处理设置群默认项目
   */
  private async handleProjectDefaultSet(chatId: string, value: string, sender: PlatformSender): Promise<void> {
    const dirResult = DirectoryPolicy.resolve({ explicitDirectory: value });
    if (!dirResult.ok) {
      await sender.sendText(chatId, dirResult.userMessage);
      return;
    }

    chatSessionStore.updateConfigByConversation('telegram', chatId, { defaultDirectory: dirResult.directory });
    await sender.sendText(chatId, `✅ 已设置群默认项目: ${dirResult.directory}`);
  }

  /**
   * 处理清除群默认项目
   */
  private async handleProjectDefaultClear(chatId: string, sender: PlatformSender): Promise<void> {
    chatSessionStore.updateConfigByConversation('telegram', chatId, { defaultDirectory: undefined });
    await sender.sendText(chatId, '✅ 已清除群默认项目');
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
    const bufferKey = `chat:telegram:${chatId}`;
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
      let variant = promptEffort || config?.preferredEffort;

      // 验证 variant 是否与当前模型兼容
      if (variant && providerId && modelId) {
        try {
          const providersPayload = await opencodeClient.getProviders();
          const providers = Array.isArray(providersPayload.providers) ? providersPayload.providers : [];
          const providerLower = providerId.toLowerCase();
          const modelLower = modelId.toLowerCase();

          for (const provider of providers) {
            if (!provider || typeof provider !== 'object') continue;
            const providerRecord = provider as Record<string, unknown>;
            const providerIdRaw = typeof providerRecord.id === 'string' ? providerRecord.id.trim() : '';
            if (!providerIdRaw || providerIdRaw.toLowerCase() !== providerLower) continue;

            const modelsRaw = providerRecord.models;
            const modelList = Array.isArray(modelsRaw)
              ? modelsRaw
              : (modelsRaw && typeof modelsRaw === 'object' ? Object.values(modelsRaw) : []);

            for (const modelItem of modelList) {
              if (!modelItem || typeof modelItem !== 'object') continue;
              const modelRecord = modelItem as Record<string, unknown>;
              const modelIdRaw = typeof modelRecord.id === 'string'
                ? modelRecord.id.trim()
                : (typeof modelRecord.modelID === 'string' ? modelRecord.modelID.trim() : '');
              if (!modelIdRaw || modelIdRaw.toLowerCase() !== modelLower) continue;

              // 解析模型支持的 variants
              const variants = modelRecord.variants;
              if (variants && typeof variants === 'object' && !Array.isArray(variants)) {
                const supportedVariants: EffortLevel[] = [];
                for (const key of Object.keys(variants as Record<string, unknown>)) {
                  const normalized = normalizeEffortLevel(key);
                  if (normalized && normalized !== 'none' && !supportedVariants.includes(normalized)) {
                    supportedVariants.push(normalized);
                  }
                }
                // 如果当前 variant 不在支持列表中，清除它
                if (supportedVariants.length > 0 && !supportedVariants.includes(variant)) {
                  variant = undefined;
                }
              }
              break;
            }
            break;
          }
        } catch (error) {
          console.debug('[Telegram] 获取模型支持的 variants 失败，跳过验证:', error instanceof Error ? error.message : String(error));
        }
      }

      // ── 非多模态主模型图片回退 ──
      const dispatchParts = await preprocessVisionParts(
        parts as VisionPart[],
        { providerId, modelId, directory },
        'Telegram',
      ) as OpencodePartInput[];

      await opencodeClient.sendMessagePartsAsync(
        sessionId,
        dispatchParts,
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

  /**
   * 处理 Telegram 附件
   * 下载文件并转换为 OpenCode 需要的格式
   */
  private async prepareAttachmentParts(
    attachments: PlatformAttachment[]
  ): Promise<{ parts: OpencodeFilePartInput[]; warnings: string[] }> {
    const parts: OpencodeFilePartInput[] = [];
    const warnings: string[] = [];

    await fs.mkdir(ATTACHMENT_BASE_DIR, { recursive: true }).catch(() => undefined);

    for (const attachment of attachments) {
      // 检查文件大小
      if (attachment.fileSize && attachment.fileSize > attachmentConfig.maxSize) {
        warnings.push(`附件 ${attachment.fileName || '未知'} 过大（${Math.round(attachment.fileSize / 1024 / 1024)}MB），已跳过`);
        continue;
      }

      // 通过 Telegram API 下载文件
      const downloaded = await telegramAdapter.downloadFile(attachment.fileKey);
      if (!downloaded) {
        warnings.push(`附件 ${attachment.fileName || '未知'} 下载失败`);
        continue;
      }

      // 确定文件扩展名
      const extFromName = attachment.fileName ? extractExtension(attachment.fileName) : '';
      const extFromMime = downloaded.mimeType.split('/')[1] ? `.${downloaded.mimeType.split('/')[1]}` : '';
      let ext = extFromName || extFromMime;

      // 标准化扩展名
      if (ext === '.jpeg') ext = '.jpg';
      if (!ext && attachment.type === 'image') ext = '.jpg';

      // 检查是否支持该格式
      if (!ext || !ALLOWED_ATTACHMENT_EXTENSIONS.has(ext.toLowerCase())) {
        console.log(`[Telegram] 不支持的附件格式: ext=${ext || 'unknown'}, fileName=${attachment.fileName}`);
        warnings.push(`附件格式不支持 (${ext || 'unknown'})，已跳过`);
        continue;
      }

      const fileId = randomUUID();
      const filePath = path.join(ATTACHMENT_BASE_DIR, `${fileId}${ext}`);
      const rawName = attachment.fileName || downloaded.fileName || `attachment${ext}`;
      const safeName = sanitizeFilename(rawName.endsWith(ext) ? rawName : `${rawName}${ext}`);

      try {
        // 写入临时文件
        await fs.writeFile(filePath, downloaded.buffer);

        // 转换为 base64 data URL
        const base64 = downloaded.buffer.toString('base64');
        const mime = downloaded.mimeType || mimeFromExtension(ext);
        const dataUrl = `data:${mime};base64,${base64}`;

        parts.push({
          type: 'file',
          mime,
          url: dataUrl,
          filename: safeName,
        });

        console.log(`[Telegram] 附件处理成功: ${safeName} (${Math.round(downloaded.buffer.length / 1024)}KB)`);
      } catch (e) {
        console.error('[Telegram] 附件处理失败:', e);
        warnings.push(`附件处理失败: ${attachment.fileName || '未知'}`);
      } finally {
        // 清理临时文件
        fs.unlink(filePath).catch(() => undefined);
      }
    }

    return { parts, warnings };
  }
}

export const telegramHandler = new TelegramHandler();