/**
 * WhatsApp 消息处理器
 *
 * 参考 telegram.ts 的结构，处理 WhatsApp 消息
 * 支持权限交互：文本确认和按钮交互
 */

import { modelConfig, attachmentConfig } from '../config.js';
import { opencodeClient } from '../opencode/client.js';
import { preprocessVisionParts, type VisionPart } from '../services/vision-ocr.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { chatSessionStore } from '../store/chat-session.js';
import { parseCommand } from '../commands/parser.js';
import { normalizeEffortLevel, type EffortLevel } from '../commands/effort.js';
import { PlatformCommandHandler } from './platform-command.handler.js';
import { DirectoryPolicy } from '../utils/directory-policy.js';
import { buildSessionTimestamp } from '../utils/session-title.js';
import { shouldSkipGroupMessage } from '../utils/group-mention.js';
import { permissionHandler } from '../permissions/handler.js';
import { questionHandler } from '../opencode/question-handler.js';
import { parseQuestionAnswerText } from '../opencode/question-parser.js';
import type { PlatformMessageEvent, PlatformSender } from '../platform/types.js';
import type { PendingPermission } from '../permissions/handler.js';

type OpencodeFilePartInput = { type: 'file'; mime: string; url: string; filename?: string };
type OpencodePartInput = { type: 'text'; text: string } | OpencodeFilePartInput;

/**
 * 权限决策结果
 */
type PermissionDecision = {
  allow: boolean;
  remember: boolean;
};

/**
 * 解析权限决策文本
 * 支持：允许 / 拒绝 / 始终允许 / y / n / always 等
 */
function parsePermissionDecision(raw: string): PermissionDecision | null {
  const normalized = raw.normalize('NFKC').trim().toLowerCase();
  if (!normalized) return null;

  const compact = normalized
    .replace(/[\s\u3000]+/g, '')
    .replace(/[。！!,.，；;:：\-]/g, '');

  const hasAlways =
    compact.includes('始终') ||
    compact.includes('永久') ||
    compact.includes('always') ||
    compact.includes('记住') ||
    compact.includes('总是');

  const containsAny = (words: string[]): boolean => {
    return words.some(word => compact === word || compact.includes(word));
  };

  const isDeny =
    compact === 'n' ||
    compact === 'no' ||
    compact === '否' ||
    compact === '拒绝' ||
    containsAny(['拒绝', '不同意', '不允许', 'deny']);
  if (isDeny) {
    return { allow: false, remember: false };
  }

  const isAllow =
    compact === 'y' ||
    compact === 'yes' ||
    compact === 'ok' ||
    compact === 'always' ||
    compact === '允许' ||
    compact === '始终允许' ||
    containsAny(['允许', '同意', '通过', '批准', 'allow']);
  if (isAllow) {
    return { allow: true, remember: hasAlways };
  }

  return null;
}

export class WhatsAppHandler {
  private commandHandler = new PlatformCommandHandler('whatsapp');

  /**
   * 获取权限存储的 key
   * WhatsApp 使用命名空间 key 避免与其他平台冲突
   */
  private getPermissionKey(chatId: string): string {
    return `whatsapp:${chatId}`;
  }

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
   * 解析权限目录选项
   */
  private resolvePermissionDirectoryOptions(
    sessionId: string,
    chatIdHint?: string
  ): { directory?: string; fallbackDirectories?: string[] } {
    const conversation = chatSessionStore.getConversationBySessionId(sessionId);
    const boundSession = conversation
      ? chatSessionStore.getSessionByConversation(conversation.platform, conversation.conversationId)
      : undefined;

    const queueHintSession = chatIdHint
      ? chatSessionStore.getSession(chatIdHint)
      : undefined;

    const directory = boundSession?.resolvedDirectory
      || queueHintSession?.resolvedDirectory
      || boundSession?.defaultDirectory
      || queueHintSession?.defaultDirectory;

    const fallbackDirectories = Array.from(
      new Set(
        [
          boundSession?.resolvedDirectory,
          boundSession?.defaultDirectory,
          queueHintSession?.resolvedDirectory,
          queueHintSession?.defaultDirectory,
          ...chatSessionStore.getKnownDirectories(),
        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    );

    return {
      ...(directory ? { directory } : {}),
      ...(fallbackDirectories.length > 0 ? { fallbackDirectories } : {}),
    };
  }

  /**
   * 处理权限文本响应
   * 当有待确认权限时，解析用户文本并响应权限请求
   */
  private async tryHandlePendingPermissionByText(
    chatId: string,
    content: string,
    sender: PlatformSender
  ): Promise<boolean> {
    const permissionKey = this.getPermissionKey(chatId);
    const pending = permissionHandler.peekForChat(permissionKey);
    if (!pending) return false;

    const decision = parsePermissionDecision(content);
    if (!decision) {
      await sender.sendText(chatId, '当前有待确认权限，请回复：允许 / 拒绝 / 始终允许（也支持 y / n / always）');
      return true;
    }

    // 收集候选 session IDs（包括父会话和相关会话）
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
      const permissionDirectoryOptions = this.resolvePermissionDirectoryOptions(candidateSessionId, chatId);
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
        console.error(`[WhatsApp 权限] 文本响应失败: session=${candidateSessionId}, permission=${pending.permissionId}`, error);
      }
    }

    if (!responded) {
      console.error(`[WhatsApp 权限] 所有候选 session 文本响应失败: chat=${chatId}, sessions=${candidateSessionIds.join(',')}`, lastError);
      if (expiredDetected) {
        await sender.sendText(chatId, '操作已过期，请重新发起');
        return true;
      }
      await sender.sendText(chatId, '权限响应失败，请重试');
      return true;
    }

    console.log(
      `[WhatsApp 权限] 文本响应成功: chat=${chatId}, session=${respondedSessionId}, permission=${pending.permissionId}, allow=${decision.allow}, remember=${decision.remember}`
    );

    const removed = permissionHandler.resolveForChat(permissionKey, pending.permissionId);
    const toolName = removed?.tool || pending.tool || '工具';
    const resolvedText = decision.allow
      ? decision.remember ? `已允许并记住权限：${toolName}` : `已允许权限：${toolName}`
      : `已拒绝权限：${toolName}`;

    await sender.sendText(chatId, resolvedText);
    return true;
  }

  /**
   * 处理权限动作响应（按钮点击）
   */
  private async handlePermissionAction(
    chatId: string,
    actionValue: Record<string, unknown>,
    action: 'permission_allow' | 'permission_deny',
    sender: PlatformSender
  ): Promise<void> {
    const sessionId = typeof actionValue.sessionId === 'string' ? actionValue.sessionId.trim() : undefined;
    const permissionId = typeof actionValue.permissionId === 'string' ? actionValue.permissionId.trim() : undefined;

    if (!sessionId || !permissionId) {
      await sender.sendText(chatId, '权限参数缺失');
      return;
    }

    const parentSessionId = typeof actionValue.parentSessionId === 'string' ? actionValue.parentSessionId.trim() : undefined;
    const relatedSessionId = typeof actionValue.relatedSessionId === 'string' ? actionValue.relatedSessionId.trim() : undefined;
    const candidateSessionIds = Array.from(
      new Set(
        [sessionId, parentSessionId, relatedSessionId]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    );

    const allow = action === 'permission_allow';
    const rememberRaw = typeof actionValue.remember === 'string'
      ? actionValue.remember.normalize('NFKC').trim().toLowerCase()
      : actionValue.remember;
    const remember =
      rememberRaw === true ||
      rememberRaw === 1 ||
      rememberRaw === '1' ||
      rememberRaw === 'true' ||
      rememberRaw === 'always' ||
      rememberRaw === '始终允许';

    let responded = false;
    let respondedSessionId = sessionId;
    let lastError: unknown;
    let expiredDetected = false;

    for (const candidateSessionId of candidateSessionIds) {
      const permissionDirectoryOptions = this.resolvePermissionDirectoryOptions(candidateSessionId);
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
        console.error(`[WhatsApp 权限] 按钮响应失败: session=${candidateSessionId}, permission=${permissionId}`, error);
      }
    }

    if (!responded) {
      console.error(`[WhatsApp 权限] 所有候选 session 按钮响应失败: sessions=${candidateSessionIds.join(',')}, permission=${permissionId}`, lastError);
      if (expiredDetected) {
        await sender.sendText(chatId, '操作已过期，请重新发起');
        return;
      }
      await sender.sendText(chatId, '权限响应失败');
      return;
    }

    console.log(
      `[WhatsApp 权限] 按钮响应成功: session=${respondedSessionId}, permission=${permissionId}, allow=${allow}, remember=${remember}`
    );

    const permissionKey = this.getPermissionKey(chatId);
    const removed = permissionHandler.resolveForChat(permissionKey, permissionId);
    const toolName = removed?.tool || '工具';
    const resolvedText = allow
      ? remember ? `已允许并记住权限：${toolName}` : `已允许权限：${toolName}`
      : `已拒绝权限：${toolName}`;

    await sender.sendText(chatId, resolvedText);
  }

  /**
   * 处理问答文本响应
   * 当有待回答问题时，解析用户文本并提交答案
   */
  private async tryHandlePendingQuestion(
    chatId: string,
    content: string,
    sender: PlatformSender
  ): Promise<boolean> {
    const bufferKey = `chat:whatsapp:${chatId}`;
    const pending = questionHandler.getByConversationKey(bufferKey);
    if (!pending) return false;

    const currentIndex = pending.currentQuestionIndex;
    const question = pending.request.questions[currentIndex];

    // 解析答案
    const parsed = parseQuestionAnswerText(content, question);
    if (!parsed) {
      await sender.sendText(chatId, '未识别答案，请回复选项编号/字母，或直接输入自定义内容。');
      return true;
    }

    // 更新草稿
    if (parsed.type === 'skip') {
      questionHandler.setDraftAnswer(pending.request.id, currentIndex, []);
      questionHandler.setDraftCustomAnswer(pending.request.id, currentIndex, '');
    } else if (parsed.type === 'custom') {
      questionHandler.setDraftAnswer(pending.request.id, currentIndex, []);
      questionHandler.setDraftCustomAnswer(pending.request.id, currentIndex, parsed.custom || content);
    } else {
      questionHandler.setDraftCustomAnswer(pending.request.id, currentIndex, '');
      questionHandler.setDraftAnswer(pending.request.id, currentIndex, parsed.values || []);
    }

    // 进入下一题或提交
    const nextIndex = currentIndex + 1;
    if (nextIndex < pending.request.questions.length) {
      questionHandler.setCurrentQuestionIndex(pending.request.id, nextIndex);
      const nextQuestion = pending.request.questions[nextIndex];
      const nextQuestionText = this.formatSingleQuestion(nextQuestion, nextIndex + 1, pending.request.questions.length);
      await sender.sendText(chatId, nextQuestionText);
      outputBuffer.touch(bufferKey);
    } else {
      // 提交所有答案
      await this.submitQuestionAnswers(pending, chatId, sender);
    }

    return true;
  }

  /**
   * 格式化单个问题文本
   */
  private formatSingleQuestion(
    question: { question: string; header: string; options: { label: string; description: string }[]; multiple?: boolean; custom?: boolean },
    questionNum: number,
    totalQuestions: number
  ): string {
    const lines: string[] = [];
    lines.push(`【问题 ${questionNum}/${totalQuestions}】`);
    if (question.header) {
      lines.push(question.header);
    }
    if (question.question) {
      lines.push(question.question);
    }
    if (question.options && question.options.length > 0) {
      lines.push('选项：');
      for (let j = 0; j < question.options.length; j++) {
        const option = question.options[j];
        lines.push(`  ${j + 1}. ${option.label}${option.description ? ` - ${option.description}` : ''}`);
      }
      if (question.multiple) {
        lines.push('（可多选，用空格或逗号分隔多个编号）');
      }
    }
    lines.push('请回复选项编号（如 1）或直接输入自定义答案');
    lines.push('回复"跳过"可跳过当前问题');
    return lines.join('\n');
  }

  /**
   * 提交问题答案
   */
  private async submitQuestionAnswers(
    pending: import('../opencode/question-handler.js').PendingQuestion,
    chatId: string,
    sender: PlatformSender
  ): Promise<void> {
    const answers: string[][] = [];
    const totalQuestions = pending.request.questions.length;

    for (let i = 0; i < totalQuestions; i++) {
      const custom = (pending.draftCustomAnswers[i] || '').trim();
      if (custom) {
        answers.push([custom]);
      } else {
        answers.push(pending.draftAnswers[i] || []);
      }
    }

    console.log(`[WhatsApp 问题] 提交回答: requestId=${pending.request.id.slice(0, 8)}...`);

    const bufferKey = `chat:whatsapp:${chatId}`;
    this.ensureStreamingBuffer(chatId, pending.request.sessionID);

    const result = await opencodeClient.replyQuestion(pending.request.id, answers);

    if (result.ok) {
      questionHandler.remove(pending.request.id);
      outputBuffer.touch(bufferKey);
      await sender.sendText(chatId, '答案已提交，请等待 AI 处理...');
    } else if (result.expired) {
      questionHandler.remove(pending.request.id);
      await sender.sendText(chatId, '问题已过期，请重新发起对话');
    } else {
      await sender.sendText(chatId, '回答提交失败，请重试');
    }
  }

  /**
   * 处理 WhatsApp 消息
   */
  async handleMessage(
    event: PlatformMessageEvent,
    sender: PlatformSender
  ): Promise<void> {
    // 群聊 @ 提到检查
    if (shouldSkipGroupMessage(event)) {
      return;
    }

    const { conversationId: chatId, content, senderId, attachments } = event;
    const trimmed = content.trim();

    // 0. 优先检查是否有待处理的权限请求
    if (await this.tryHandlePendingPermissionByText(chatId, trimmed, sender)) {
      return;
    }

    // 0.5 检查是否有待回答的问题
    if (await this.tryHandlePendingQuestion(chatId, trimmed, sender)) {
      return;
    }

    // 1. 处理命令
    const command = parseCommand(trimmed);
    if (command.type !== 'prompt') {
      console.log(`[WhatsApp] 收到命令：${command.type}`);
      await this.commandHandler.handle(command, {
        chatId,
        senderId,
        chatType: event.chatType || 'p2p',
      }, sender);
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
   * 处理动作事件（按钮点击）
   */
  async handleAction(
    event: { action: { tag: string; value: Record<string, unknown> }; senderId: string; conversationId?: string; messageId?: string },
    sender: PlatformSender
  ): Promise<void> {
    const { action, conversationId } = event;
    if (!conversationId) return;

    console.log(`[WhatsApp] 收到动作：${action.tag}`);

    // 处理权限相关动作
    if (action.tag === 'permission_allow' || action.tag === 'permission_deny') {
      await this.handlePermissionAction(conversationId, action.value, action.tag, sender);
      return;
    }

    // 处理旧的 allow/deny 标签（向后兼容）
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
        const prepared = await this.prepareAttachmentParts(attachments);
        if (prepared.warnings.length > 0) {
          await sender.sendText(chatId, `附件警告:\n${prepared.warnings.join('\n')}`);
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
        } else {
          if (providerId) {
            modelId = config.preferredModel;
          }
        }
      }

      const sessionData = chatSessionStore.getSessionByConversation('whatsapp', chatId);
      const directory = sessionData?.resolvedDirectory;

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
          console.debug('[WhatsApp] 获取模型支持的 variants 失败，跳过验证:', error instanceof Error ? error.message : String(error));
        }
      }

      // ── 非多模态主模型图片回退 ──
      const dispatchParts = await preprocessVisionParts(
        parts as VisionPart[],
        { providerId, modelId, directory },
        'WhatsApp',
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
      console.error('[WhatsApp] 请求派发失败:', error);

      outputBuffer.append(bufferKey, `\n\n错误：${errorMessage}`);
      outputBuffer.setStatus(bufferKey, 'failed');

      const currentBuffer = outputBuffer.get(bufferKey);
      if (!currentBuffer?.messageId) {
        await sender.sendText(chatId, `错误：${errorMessage}`);
      }
    }
  }

  /**
   * 处理附件，转换为 OpenCode API 需要的格式
   * WhatsApp adapter 已将媒体转为 base64 data URL
   */
  private async prepareAttachmentParts(
    attachments: PlatformMessageEvent['attachments']
  ): Promise<{ parts: OpencodeFilePartInput[]; warnings: string[] }> {
    const parts: OpencodeFilePartInput[] = [];
    const warnings: string[] = [];

    if (!attachments || attachments.length === 0) {
      return { parts, warnings };
    }

    for (const attachment of attachments) {
      // 检查文件大小
      if (attachment.fileSize && attachment.fileSize > attachmentConfig.maxSize) {
        warnings.push(`附件 ${attachment.fileName || '未知文件'} 过大 (${Math.round(attachment.fileSize / 1024 / 1024)}MB)，已跳过`);
        continue;
      }

      // WhatsApp adapter 已将 fileKey 设为 data URL
      const dataUrl = attachment.fileKey;

      // 验证是否为有效的 data URL
      if (!dataUrl || !dataUrl.startsWith('data:')) {
        warnings.push(`附件 ${attachment.fileName || '未知文件'} 格式无效，已跳过`);
        continue;
      }

      // 从 data URL 中提取 MIME 类型
      const mimeMatch = dataUrl.match(/^data:([^;,]+);/);
      const mimeType = mimeMatch ? mimeMatch[1] : attachment.fileType || 'application/octet-stream';

      // 构建文件名
      let fileName = attachment.fileName;
      if (!fileName) {
        // 根据类型推断文件名
        const ext = mimeType.split('/')[1] || 'bin';
        if (attachment.type === 'image') {
          fileName = `image.${ext}`;
        } else {
          fileName = `file.${ext}`;
        }
      }

      parts.push({
        type: 'file',
        mime: mimeType,
        url: dataUrl,
        filename: fileName,
      });

      console.log(`[WhatsApp] 附件处理成功: ${fileName}, 类型: ${mimeType}`);
    }

    return { parts, warnings };
  }
}

export const whatsappHandler = new WhatsAppHandler();