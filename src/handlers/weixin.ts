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
import { preprocessVisionParts, type VisionPart } from '../services/vision-ocr.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { chatSessionStore } from '../store/chat-session.js';
import { parseCommand, type ParsedCommand } from '../commands/parser.js';
import { DirectoryPolicy } from '../utils/directory-policy.js';
import { buildSessionTimestamp } from '../utils/session-title.js';
import { shouldSkipGroupMessage } from '../utils/group-mention.js';
import type { EffortLevel } from '../commands/effort.js';
import { normalizeEffortLevel, KNOWN_EFFORT_LEVELS } from '../commands/effort.js';
import { permissionHandler } from '../permissions/handler.js';
import { questionHandler, type PendingQuestion } from '../opencode/question-handler.js';
import { parseQuestionAnswerText } from '../opencode/question-parser.js';
import {
  collectAllowedChatModels,
  findAllowedChatModel,
  isChatModelAllowed,
  parseChatModelReference,
} from '../utils/chat-model-whitelist.js';

const WEIXIN_MESSAGE_LIMIT = 1800;
const WEIXIN_HELP_TEXT = `📖 **微信 × OpenCode 机器人指南**

💬 **如何对话**
直接发送消息即可与 AI 对话。

🛠️ **常用命令**
• \`/help\` 显示帮助
• \`/model\` 查看当前模型
• \`/model <名称>\` 切换模型
• \`/models\` 列出所有可用模型
• \`/agent\` 查看当前角色
• \`/agent <名称>\` 切换角色
• \`/agents\` 列出所有可用角色
• \`/effort\` 查看当前强度
• \`/effort <档位>\` 设置会话强度 (low/high/xhigh)
• \`/undo\` 撤回上一轮对话
• \`/stop\` 停止当前回答
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
    // 群聊 @ 提到检查
    if (shouldSkipGroupMessage(event)) {
      return;
    }

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

    try {
      switch (command.type) {
        case 'help':
          await sender.sendText(conversationId, WEIXIN_HELP_TEXT);
          break;

        case 'status': {
          const sessionId = chatSessionStore.getSessionIdByConversation('weixin', conversationId);
          const session = chatSessionStore.getSessionByConversation('weixin', conversationId);
          const status = sessionId
            ? `当前绑定会话: ${sessionId.slice(0, 8)}...\n工作目录: ${session?.resolvedDirectory || '未设置'}`
            : '未绑定会话';
          await sender.sendText(conversationId, `🤖 **OpenCode 状态**\n\n${status}`);
          break;
        }

        case 'session':
          if (command.sessionAction === 'new') {
            await this.handleNewSession(conversationId, event.senderId, command.sessionDirectory, command.sessionName, sender);
          } else if (command.sessionAction === 'switch' && command.sessionId) {
            await this.handleSwitchSession(conversationId, command.sessionId, event.senderId, sender);
          } else {
            await sender.sendText(conversationId, '用法: /session new 或 /session <sessionId>');
          }
          break;

        case 'sessions':
          await this.handleListSessions(conversationId, command.listAll ?? false, sender);
          break;

        case 'model':
          await this.handleModel(conversationId, command.modelName, sender);
          break;

        case 'models':
          await this.handleModels(conversationId, sender);
          break;

        case 'agent':
          await this.handleAgent(conversationId, command.agentName, sender);
          break;

        case 'agents':
          await this.handleAgents(conversationId, sender);
          break;

        case 'effort':
          await this.handleEffort(conversationId, command, sender);
          break;

        case 'stop': {
          const sessionId = chatSessionStore.getSessionIdByConversation('weixin', conversationId);
          if (sessionId) {
            await opencodeClient.abortSession(sessionId);
            await sender.sendText(conversationId, '⏹️ 已发送中断请求');
          } else {
            await sender.sendText(conversationId, '当前没有活跃的会话');
          }
          break;
        }

        case 'undo':
          await this.handleUndo(conversationId, sender);
          break;

        case 'compact':
          await this.handleCompact(conversationId, sender);
          break;

        case 'rename':
          await this.handleRename(conversationId, command.renameTitle, sender);
          break;

        case 'clear':
          await this.handleNewSession(conversationId, event.senderId, undefined, undefined, sender);
          break;

        case 'project':
          if (command.projectAction === 'list') {
            await this.handleProjectList(conversationId, sender);
          } else if (command.projectAction === 'default_show') {
            await this.handleProjectDefaultShow(conversationId, sender);
          } else if (command.projectAction === 'default_set' && command.projectValue) {
            await this.handleProjectDefaultSet(conversationId, command.projectValue, sender);
          } else if (command.projectAction === 'default_clear') {
            await this.handleProjectDefaultClear(conversationId, sender);
          } else {
            await sender.sendText(conversationId, '用法: /project list 或 /project default set <路径或别名>');
          }
          break;

        default:
          await sender.sendText(conversationId, `命令 "${command.type}" 暂不支持\n使用 /help 查看可用命令`);
          break;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Weixin] 命令执行失败:', error);
      await sender.sendText(conversationId, `❌ 命令执行出错: ${errorMessage}`);
    }
  }

  /**
   * 创建新会话
   */
  private async handleNewSession(
    conversationId: string,
    senderId: string,
    sessionDirectory?: string,
    sessionName?: string,
    sender?: PlatformSender
  ): Promise<void> {
    const title = sessionName || `微信会话-${buildSessionTimestamp()}`;
    const dirResult = DirectoryPolicy.resolve({ chatDefaultDirectory: sessionDirectory });
    const effectiveDir = dirResult.ok ? dirResult.directory : undefined;
    const session = await opencodeClient.createSession(title, effectiveDir);
    if (session) {
      chatSessionStore.setSessionByConversation('weixin', conversationId, session.id, senderId, title, {
        chatType: 'p2p',
        resolvedDirectory: session.directory,
      });
      await sender?.sendText(conversationId, `✅ 已创建新会话：${session.id.slice(0, 8)}...`);
    } else {
      await sender?.sendText(conversationId, '❌ 创建会话失败');
    }
  }

  /**
   * 切换到已有会话
   */
  private async handleSwitchSession(
    conversationId: string,
    targetSessionId: string,
    senderId: string,
    sender?: PlatformSender
  ): Promise<void> {
    try {
      const sessions = await opencodeClient.listSessionsAcrossProjects();
      const target = sessions.find((s: { id: string }) => s.id === targetSessionId || s.id.startsWith(targetSessionId));
      if (!target) {
        await sender?.sendText(conversationId, `❌ 未找到会话: ${targetSessionId}`);
        return;
      }
      chatSessionStore.setSessionByConversation('weixin', conversationId, target.id, senderId, target.title || '未命名', {
        chatType: 'p2p',
        resolvedDirectory: target.directory,
      });
      await sender?.sendText(conversationId, `✅ 已切换到会话：${target.id.slice(0, 8)}...`);
    } catch (error) {
      console.error('[Weixin] 切换会话失败:', error);
      await sender?.sendText(conversationId, '❌ 切换会话失败');
    }
  }

  /**
   * 列出会话
   */
  private async handleListSessions(
    conversationId: string,
    listAll: boolean,
    sender?: PlatformSender
  ): Promise<void> {
    try {
      const sessions = await opencodeClient.listSessionsAcrossProjects();
      if (sessions.length === 0) {
        await sender?.sendText(conversationId, '暂无会话');
        return;
      }

      const currentSession = chatSessionStore.getSessionByConversation('weixin', conversationId);
      const lines = sessions.slice(0, 20).map((s: { id: string; title?: string; directory?: string }) => {
        const isCurrent = currentSession?.sessionId === s.id;
        const prefix = isCurrent ? '👉 ' : '   ';
        return `${prefix}${s.id.slice(0, 8)}... ${s.title || '未命名'}${s.directory ? ` (${s.directory})` : ''}`;
      });

      let result = lines.join('\n');
      if (sessions.length > 20) {
        result += `\n\n... 共 ${sessions.length} 个会话`;
      }
      await sender?.sendText(conversationId, `📋 **会话列表**\n\n${result}`);
    } catch (error) {
      console.error('[Weixin] 获取会话列表失败:', error);
      await sender?.sendText(conversationId, '❌ 获取会话列表失败');
    }
  }

  /**
   * 处理模型切换
   */
  private async handleModel(
    conversationId: string,
    modelName: string | undefined,
    sender?: PlatformSender
  ): Promise<void> {
    try {
      const providersResult = await opencodeClient.getProviders();
      const providers = Array.isArray(providersResult.providers) ? providersResult.providers : [];

      if (!modelName) {
        const session = chatSessionStore.getSessionByConversation('weixin', conversationId);
        if (session?.preferredModel) {
          await sender?.sendText(conversationId, `当前模型: ${session.preferredModel}`);
        } else if (modelConfig.defaultProvider && modelConfig.defaultModel) {
          await sender?.sendText(conversationId, `当前模型: ${modelConfig.defaultProvider}:${modelConfig.defaultModel} (默认)`);
        } else {
          await sender?.sendText(conversationId, '当前未设置模型，使用 OpenCode 默认');
        }
        return;
      }

      const normalizedModelName = modelName.trim();
      const matchedModel = findAllowedChatModel(providers, normalizedModelName);
      if (matchedModel) {
        const preferredModel = `${matchedModel.providerId}:${matchedModel.modelId}`;
        chatSessionStore.updateConfigByConversation('weixin', conversationId, { preferredModel });
        await sender?.sendText(conversationId, `✅ 已设置模型: ${preferredModel}`);
        return;
      }

      const parsedModel = parseChatModelReference(normalizedModelName);
      if (!parsedModel) {
        await sender?.sendText(conversationId, `❌ 未找到模型: ${normalizedModelName}`);
        return;
      }
      if (!isChatModelAllowed(parsedModel.providerId, parsedModel.modelId)) {
        await sender?.sendText(conversationId, `❌ 模型 "${normalizedModelName}" 不在当前允许列表中`);
        return;
      }

      const preferredModel = `${parsedModel.providerId}:${parsedModel.modelId}`;
      chatSessionStore.updateConfigByConversation('weixin', conversationId, { preferredModel });
      await sender?.sendText(conversationId, `✅ 已设置模型: ${preferredModel}`);
    } catch (error) {
      console.error('[Weixin] 设置模型失败:', error);
      await sender?.sendText(conversationId, '❌ 设置模型失败');
    }
  }

  /**
   * 处理角色切换
   */
  private async handleAgent(
    conversationId: string,
    agentName: string | undefined,
    sender?: PlatformSender
  ): Promise<void> {
    try {
      const agents = await opencodeClient.getAgents();

      if (!agentName) {
        const session = chatSessionStore.getSessionByConversation('weixin', conversationId);
        const currentAgent = session?.preferredAgent;
        if (currentAgent) {
          const agentInfo = agents.find((a: { name: string }) => a.name === currentAgent);
          await sender?.sendText(conversationId, `当前角色: ${currentAgent}${agentInfo?.description ? `\n${agentInfo.description.slice(0, 100)}` : ''}`);
        } else {
          await sender?.sendText(conversationId, '当前使用默认角色');
        }
        return;
      }

      const normalizedAgentName = agentName.trim().toLowerCase();
      if (normalizedAgentName === 'off' || normalizedAgentName === 'default') {
        chatSessionStore.updateConfigByConversation('weixin', conversationId, { preferredAgent: undefined });
        await sender?.sendText(conversationId, '✅ 已切换为默认角色');
        return;
      }

      const matched = agents.find((a: { name: string }) => a.name.toLowerCase() === normalizedAgentName || a.name === agentName.trim());
      if (matched) {
        chatSessionStore.updateConfigByConversation('weixin', conversationId, { preferredAgent: matched.name });
        await sender?.sendText(conversationId, `✅ 已切换角色: ${matched.name}`);
      } else {
        await sender?.sendText(conversationId, `❌ 未找到角色: ${agentName}\n使用 /agent 查看可用角色`);
      }
    } catch (error) {
      console.error('[Weixin] 设置角色失败:', error);
      await sender?.sendText(conversationId, '❌ 设置角色失败');
    }
  }

  /**
   * 列出所有可用模型
   */
  private async handleModels(conversationId: string, sender?: PlatformSender): Promise<void> {
    try {
      const providersResult = await opencodeClient.getProviders();
      const providers = Array.isArray(providersResult?.providers) ? providersResult.providers : [];

      if (providers.length === 0) {
        console.warn('[Weixin] No providers found in getProviders result');
        await sender?.sendText(conversationId, '❌ 未找到可用的模型提供商，请检查 OpenCode 配置');
        return;
      }

      const lines: string[] = ['📋 **可用模型列表**\n'];
      let totalCount = 0;

      const models = collectAllowedChatModels(providers);
      const providerGroups = new Map<string, { providerName: string; models: Array<{ id: string; name: string }> }>();

      for (const model of models) {
        if (!providerGroups.has(model.providerId)) {
          providerGroups.set(model.providerId, { providerName: model.providerName, models: [] });
        }
        providerGroups.get(model.providerId)!.models.push({ id: model.modelId, name: model.modelName });
      }

      for (const [providerId, group] of providerGroups.entries()) {
        if (group.models.length === 0) continue;
        lines.push(`**${group.providerName}**`);

        for (const model of group.models.slice(0, 15)) {
          const modelDisplay = model.name || model.id;
          const modelKey = `${providerId}:${model.id}`;
          lines.push(`  • ${modelDisplay} (\`${modelKey}\`)`);
          totalCount++;
        }

        if (group.models.length > 15) {
          lines.push(`  _... 共 ${group.models.length} 个模型_`);
        }
        lines.push('');
      }

      if (totalCount === 0) {
        lines.push('暂无可用模型');
      } else {
        lines.push(`💡 共 ${totalCount} 个模型，使用 \`/model <名称>\` 切换`);
      }

      let result = lines.join('\n');
      if (result.length > 3500) {
        result = result.slice(0, 3400) + '\n\n... 列表过长，已截断';
      }

      await sender?.sendText(conversationId, result);
    } catch (error) {
      console.error('[Weixin] 获取模型列表失败:', error);
      await sender?.sendText(conversationId, '❌ 获取模型列表失败');
    }
  }

  /**
   * 列出所有可用角色
   */
  private async handleAgents(conversationId: string, sender?: PlatformSender): Promise<void> {
    try {
      const agents = await opencodeClient.getAgents();
      const visibleAgents = agents.filter((a: { name: string }) =>
        a.name && !['compaction', 'title', 'summary'].includes(a.name)
      );

      if (visibleAgents.length === 0) {
        await sender?.sendText(conversationId, '暂无可用角色');
        return;
      }

      const lines: string[] = ['📋 **可用角色列表**\n'];

      for (const agent of visibleAgents) {
        const desc = agent.description ? ` - ${agent.description.slice(0, 60)}${agent.description.length > 60 ? '...' : ''}` : '';
        lines.push(`• **${agent.name}**${desc}`);
      }

      lines.push(`\n💡 共 ${visibleAgents.length} 个角色，使用 \`/agent <名称>\` 切换`);

      await sender?.sendText(conversationId, lines.join('\n'));
    } catch (error) {
      console.error('[Weixin] 获取角色列表失败:', error);
      await sender?.sendText(conversationId, '❌ 获取角色列表失败');
    }
  }

  /**
   * 处理强度设置
   */
  private async handleEffort(
    conversationId: string,
    command: ParsedCommand,
    sender?: PlatformSender
  ): Promise<void> {
    const session = chatSessionStore.getSessionByConversation('weixin', conversationId);

    if (command.effortReset) {
      chatSessionStore.updateConfigByConversation('weixin', conversationId, { preferredEffort: undefined });
      await sender?.sendText(conversationId, '✅ 已清除会话强度，恢复模型默认');
      return;
    }

    if (command.effortLevel) {
      chatSessionStore.updateConfigByConversation('weixin', conversationId, { preferredEffort: command.effortLevel });
      await sender?.sendText(conversationId, `✅ 已设置会话强度: ${command.effortLevel}`);
      return;
    }

    const currentEffort = session?.preferredEffort;
    if (currentEffort) {
      await sender?.sendText(conversationId, `当前会话强度: ${currentEffort}\n\n可用档位: ${KNOWN_EFFORT_LEVELS.join(' / ')}`);
    } else {
      await sender?.sendText(conversationId, `当前未设置会话强度，使用模型默认\n\n可用档位: ${KNOWN_EFFORT_LEVELS.join(' / ')}`);
    }
  }

  /**
   * 处理撤回
   *
   * 注意：微信个人号 API 不支持撤回已发送的消息
   * 此命令仅撤回 OpenCode 侧的消息，并发送提示通知
   */
  private async handleUndo(conversationId: string, sender?: PlatformSender): Promise<void> {
    const session = chatSessionStore.getSessionByConversation('weixin', conversationId);
    if (!session || !session.sessionId) {
      await sender?.sendText(conversationId, '❌ 当前没有活跃的会话');
      return;
    }

    console.log(`[Weixin] 尝试撤回会话 ${session.sessionId} 的最后一次交互`);

    try {
      const lastInteraction = chatSessionStore.popInteractionByConversation
        ? chatSessionStore.popInteractionByConversation('weixin', conversationId)
        : null;

      if (!lastInteraction) {
        await sender?.sendText(conversationId, '⚠️ 没有可撤回的消息');
        return;
      }

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
        console.warn('[Weixin Undo] Failed to fetch messages for revert calculation', e);
      }

      if (targetRevertId) {
        await opencodeClient.revertMessage(session.sessionId, targetRevertId);
      }

      await sender?.sendText(conversationId, '✅ OpenCode 上一句会话已撤回\n💡 提示：微信不支持撤回平台消息');
    } catch (error) {
      console.error('[Weixin Undo] 执行失败:', error);
      await sender?.sendText(conversationId, '❌ 撤回失败');
    }
  }

  /**
   * 处理压缩上下文
   */
  private async handleCompact(conversationId: string, sender?: PlatformSender): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation('weixin', conversationId);
    if (!sessionId) {
      await sender?.sendText(conversationId, '❌ 当前没有活跃的会话');
      return;
    }

    try {
      let providerId = modelConfig.defaultProvider;
      let modelId = modelConfig.defaultModel;

      const session = chatSessionStore.getSessionByConversation('weixin', conversationId);
      if (session?.preferredModel) {
        const [p, m] = session.preferredModel.split(':');
        if (p && m) {
          providerId = p;
          modelId = m;
        }
      }

      if (!providerId || !modelId) {
        await sender?.sendText(conversationId, '❌ 未找到可用模型，无法执行上下文压缩');
        return;
      }

      const compacted = await opencodeClient.summarizeSession(sessionId, providerId, modelId);
      if (compacted) {
        await sender?.sendText(conversationId, `✅ 上下文压缩完成（模型: ${providerId}:${modelId}）`);
      } else {
        await sender?.sendText(conversationId, '❌ 上下文压缩失败');
      }
    } catch (error) {
      console.error('[Weixin] 压缩失败:', error);
      await sender?.sendText(conversationId, '❌ 上下文压缩失败');
    }
  }

  /**
   * 处理重命名
   */
  private async handleRename(
    conversationId: string,
    newTitle: string | undefined,
    sender?: PlatformSender
  ): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation('weixin', conversationId);
    if (!sessionId) {
      await sender?.sendText(conversationId, '❌ 当前没有活跃的会话');
      return;
    }

    if (!newTitle || !newTitle.trim()) {
      await sender?.sendText(conversationId, '用法: /rename <新名称>');
      return;
    }

    const trimmedTitle = newTitle.trim();
    if (trimmedTitle.length > 100) {
      await sender?.sendText(conversationId, `❌ 会话名称过长（${trimmedTitle.length} 字符），请控制在 100 字符以内`);
      return;
    }

    try {
      const success = await opencodeClient.updateSession(sessionId, trimmedTitle);
      if (success) {
        chatSessionStore.updateTitleByConversation('weixin', conversationId, trimmedTitle);
        await sender?.sendText(conversationId, `✅ 会话已重命名为 "${trimmedTitle}"`);
      } else {
        await sender?.sendText(conversationId, '❌ 重命名失败');
      }
    } catch (error) {
      console.error('[Weixin] 重命名失败:', error);
      await sender?.sendText(conversationId, '❌ 重命名失败');
    }
  }

  /**
   * 处理项目列表
   */
  private async handleProjectList(conversationId: string, sender?: PlatformSender): Promise<void> {
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
        await sender?.sendText(conversationId, '暂无可用项目');
        return;
      }

      const lines = projects.map((project, index) => {
        const tag = project.source === 'alias' ? '🏷️' : '📂';
        return `${index + 1}. ${tag} ${project.name} - ${project.directory}`;
      });

      await sender?.sendText(conversationId, `📁 **项目列表**\n\n${lines.join('\n')}`);
    } catch (error) {
      console.error('[Weixin] 获取项目列表失败:', error);
      await sender?.sendText(conversationId, '❌ 获取项目列表失败');
    }
  }

  /**
   * 显示默认项目
   */
  private async handleProjectDefaultShow(conversationId: string, sender?: PlatformSender): Promise<void> {
    const session = chatSessionStore.getSessionByConversation('weixin', conversationId);
    const defaultDir = session?.defaultDirectory;
    if (defaultDir) {
      await sender?.sendText(conversationId, `当前默认项目: ${defaultDir}`);
    } else {
      await sender?.sendText(conversationId, '未设置默认项目');
    }
  }

  /**
   * 设置默认项目
   */
  private async handleProjectDefaultSet(
    conversationId: string,
    projectValue: string,
    sender?: PlatformSender
  ): Promise<void> {
    chatSessionStore.updateConfigByConversation('weixin', conversationId, { defaultDirectory: projectValue });
    await sender?.sendText(conversationId, `✅ 已设置默认项目: ${projectValue}`);
  }

  /**
   * 清除默认项目
   */
  private async handleProjectDefaultClear(conversationId: string, sender?: PlatformSender): Promise<void> {
    chatSessionStore.updateConfigByConversation('weixin', conversationId, { defaultDirectory: undefined });
    await sender?.sendText(conversationId, '✅ 已清除默认项目');
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

      let effectiveEffort = promptEffort || config?.preferredEffort;

      // 验证 variant 是否与当前模型兼容
      if (effectiveEffort && providerId && modelId) {
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
                if (supportedVariants.length > 0 && !supportedVariants.includes(effectiveEffort)) {
                  effectiveEffort = undefined;
                }
              }
              break;
            }
            break;
          }
        } catch (error) {
          console.debug('[Weixin] 获取模型支持的 variants 失败，跳过验证:', error instanceof Error ? error.message : String(error));
        }
      }

      const sessionData = chatSessionStore.getSessionByConversation('weixin', chatId);
      const directory = sessionData?.resolvedDirectory;

      // ── 非多模态主模型图片回退 ──
      const dispatchParts = await preprocessVisionParts(
        parts as VisionPart[],
        { providerId, modelId, directory },
        'Weixin',
      ) as OpencodePartInput[];

      await opencodeClient.sendMessagePartsAsync(
        sessionId,
        dispatchParts,
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
