/**
 * QQ 消息处理器
 *
 * 参考 telegram.ts 的结构，处理 QQ 消息
 * 支持基础命令：/help, /status, /session, /model, /agent, /clear, /stop 等
 */

import { modelConfig, attachmentConfig } from '../config.js';
import { opencodeClient } from '../opencode/client.js';
import { preprocessVisionParts, type VisionPart } from '../services/vision-ocr.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { chatSessionStore } from '../store/chat-session.js';
import { parseCommand, type ParsedCommand } from '../commands/parser.js';
import { normalizeEffortLevel, type EffortLevel } from '../commands/effort.js';
import { DirectoryPolicy } from '../utils/directory-policy.js';
import { buildSessionTimestamp } from '../utils/session-title.js';
import { shouldSkipGroupMessage } from '../utils/group-mention.js';
import { permissionHandler } from '../permissions/handler.js';
import { questionHandler, type PendingQuestion } from '../opencode/question-handler.js';
import { parseQuestionAnswerText } from '../opencode/question-parser.js';
import type { PlatformMessageEvent, PlatformSender } from '../platform/types.js';
import {
  collectAllowedChatModels,
  findAllowedChatModel,
  isChatModelAllowed,
  parseChatModelReference,
} from '../utils/chat-model-whitelist.js';
import { randomUUID } from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import axios from 'axios';

type OpencodeFilePartInput = { type: 'file'; mime: string; url: string; filename?: string };
type OpencodePartInput = { type: 'text'; text: string } | OpencodeFilePartInput;

// 附件相关配置
const ATTACHMENT_BASE_DIR = path.resolve(process.cwd(), 'tmp', 'qq-uploads');
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf',
  '.pjp', '.pjpeg', '.jfif', '.jpe',
  '.mp4', '.mp3', '.wav', '.ogg', '.m4a'
]);

// Helper functions for file type detection
function extractExtension(name: string): string {
  return path.extname(name).toLowerCase();
}

function normalizeExtension(ext: string): string {
  if (!ext) return '';
  const withDot = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  if (withDot === '.jpeg' || withDot === '.pjpeg' || withDot === '.pjp' || withDot === '.jpe' || withDot === '.jfif') {
    return '.jpg';
  }
  return withDot;
}

function extensionFromContentType(contentType: string): string {
  const ct = contentType.toLowerCase().split(';')[0].trim();
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'video/mp4': '.mp4',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/mp4': '.m4a',
  };
  return map[ct] || '';
}

function mimeFromExtension(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
  };
  return map[ext] || 'application/octet-stream';
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 200);
}

// 权限决策类型
type PermissionDecision = {
  allow: boolean;
  remember: boolean;
};

// 解析用户文本权限决策
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

  // 数字快捷回复：1=允许，2=拒绝，3=始终允许
  if (compact === '1') return { allow: true, remember: false };
  if (compact === '2') return { allow: false, remember: false };
  if (compact === '3') return { allow: true, remember: true };

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

// QQ 帮助文本
function getQQHelpText(): string {
  return `QQ × OpenCode 机器人指南

如何对话
直接发送消息即可与 AI 对话。

常用命令
/model - 查看当前模型
/model <名称> - 切换模型
/models - 列出所有可用模型
/agent - 查看当前角色
/agent <名称> - 切换角色
/agents - 列出所有可用角色
/agent off - 切回默认角色
/status - 查看当前状态
/session - 列出当前项目的会话
/session new - 开启新话题
/sessions all - 列出所有会话
/clear - 清空对话上下文
/stop - 停止当前生成
/help - 显示此帮助

权限确认
当 AI 需要执行敏感操作时，会发送权限确认消息。
回复 1 或 允许 - 同意执行
回复 2 或 拒绝 - 不同意执行
回复 3 或 始终允许 - 同意并记住此工具

问答互动
当 AI 需要您的反馈时，会发送问答消息。
回复选项编号（如 1、2）选择对应选项
回复多个编号（如 1 3）可多选
直接输入文字可提交自定义答案
回复"跳过"可跳过当前问题

提示
切换的模型/角色仅对当前会话生效。`;
}

export class QQHandler {
  private ensureStreamingBuffer(chatId: string, sessionId: string): void {
    const key = `chat:qq:${chatId}`;
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
   * 构建权限请求文本消息
   */
  private buildPermissionRequestText(tool: string, description: string, risk?: string): string {
    const riskText = risk === 'high' ? '⚠️ 高风险' : risk === 'medium' ? '⚡ 中等风险' : '✅ 低风险';
    return `🔐 权限确认请求

工具名称: ${tool}
操作描述: ${description}
风险等级: ${riskText}

请回复以下选项之一:
1 - 允许
2 - 拒绝
3 - 始终允许此工具

也可以直接回复: 允许 / 拒绝 / 始终允许 (或 y / n / always)`;
  }

  /**
   * 尝试处理待确认的权限请求
   * 返回 true 表示已处理（消息是权限响应），false 表示未处理
   */
  private async tryHandlePendingPermission(
    chatId: string,
    content: string,
    sender: PlatformSender
  ): Promise<boolean> {
    const permissionChatKey = `qq:${chatId}`;
    const pending = permissionHandler.peekForChat(permissionChatKey);
    if (!pending) return false;

    const decision = parsePermissionDecision(content);
    if (!decision) {
      // 提示用户如何回复
      await sender.sendText(
        chatId,
        '当前有待确认权限，请回复:\n1 或 允许 - 同意\n2 或 拒绝 - 不同意\n3 或 始终允许 - 同意并记住此工具'
      );
      return true;
    }

    // 收集候选 session IDs
    const candidateSessionIds = Array.from(
      new Set(
        [pending.sessionId, pending.parentSessionId, pending.relatedSessionId]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    );

    // 获取权限目录选项
    const resolvePermissionDirectoryOptions = (sessionId: string): { directory?: string; fallbackDirectories?: string[] } => {
      const conversation = chatSessionStore.getConversationBySessionId(sessionId);
      const boundSession = conversation
        ? chatSessionStore.getSessionByConversation(conversation.platform, conversation.conversationId)
        : undefined;
      const queueHintSession = chatSessionStore.getSession(chatId);

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
    };

    // 尝试每个候选 session，直到成功
    let responded = false;
    let respondedSessionId = pending.sessionId;
    let lastError: unknown;
    let expiredDetected = false;

    for (const candidateSessionId of candidateSessionIds) {
      const permissionDirectoryOptions = resolvePermissionDirectoryOptions(candidateSessionId);
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
        console.error(`[QQ] 权限响应失败: session=${candidateSessionId}, permission=${pending.permissionId}`, error);
      }
    }

    if (!responded) {
      console.error(`[QQ] 所有候选 session 权限响应失败: sessions=${candidateSessionIds.join(',')}`, lastError);
      if (expiredDetected) {
        await sender.sendText(chatId, '操作已过期，请重新发起');
      } else {
        await sender.sendText(chatId, '权限响应失败，请重试');
      }
      return true;
    }

    console.log(
      `[QQ] 权限响应成功: session=${respondedSessionId}, permission=${pending.permissionId}, allow=${decision.allow}, remember=${decision.remember}`
    );

    // 从队列移除
    permissionHandler.resolveForChat(permissionChatKey, pending.permissionId);

    // 更新 buffer
    const bufferKey = `chat:qq:${chatId}`;
    if (!outputBuffer.get(bufferKey)) {
      outputBuffer.getOrCreate(bufferKey, chatId, respondedSessionId, null);
    }

    const resultText = decision.allow
      ? decision.remember ? `✅ 已允许并记住权限：${pending.tool}` : `✅ 已允许权限：${pending.tool}`
      : `❌ 已拒绝权限：${pending.tool}`;

    outputBuffer.append(bufferKey, `\n\n${resultText}`);
    outputBuffer.touch(bufferKey);

    await sender.sendText(
      chatId,
      decision.allow ? (decision.remember ? '已允许并记住该权限' : '已允许该权限') : '已拒绝该权限'
    );
    return true;
  }

  /**
   * 发送权限请求通知
   */
  async sendPermissionRequest(
    chatId: string,
    tool: string,
    description: string,
    risk: string | undefined,
    sender: PlatformSender
  ): Promise<void> {
    const text = this.buildPermissionRequestText(tool, description, risk);
    await sender.sendText(chatId, text);
  }

  /**
   * 尝试处理待回答的问题
   * 返回 true 表示已处理（消息是问答回复），false 表示未处理
   */
  private async tryHandlePendingQuestion(
    chatId: string,
    content: string,
    sender: PlatformSender
  ): Promise<boolean> {
    const conversationKey = `chat:qq:${chatId}`;
    const pending = questionHandler.getByConversationKey(conversationKey);
    if (!pending) return false;

    const currentIndex = pending.currentQuestionIndex;
    const question = pending.request.questions[currentIndex];
    if (!question) {
      questionHandler.remove(pending.request.id);
      return false;
    }

    // 解析答案
    const parsed = parseQuestionAnswerText(content, question);
    if (!parsed) {
      await sender.sendText(chatId, '未识别答案，请回复选项编号或直接输入自定义内容。');
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

      // 发送下一题提示
      const nextQuestion = pending.request.questions[nextIndex];
      const questionNum = nextIndex + 1;
      const totalQuestions = pending.request.questions.length;
      const lines: string[] = [`✅ 已记录第 ${currentIndex + 1}/${totalQuestions} 题的回答`];
      lines.push(`\n【问题 ${questionNum}/${totalQuestions}】`);
      if (nextQuestion.header) {
        lines.push(nextQuestion.header);
      }
      if (nextQuestion.question) {
        lines.push(nextQuestion.question);
      }
      if (nextQuestion.options && nextQuestion.options.length > 0) {
        lines.push('\n选项：');
        for (let j = 0; j < nextQuestion.options.length; j++) {
          const option = nextQuestion.options[j];
          lines.push(`  ${j + 1}. ${option.label}${option.description ? ` - ${option.description}` : ''}`);
        }
        if (nextQuestion.multiple) {
          lines.push('（可多选，用空格或逗号分隔多个编号）');
        }
      }
      lines.push('\n请回复选项编号或输入自定义答案');

      await sender.sendText(chatId, lines.join('\n'));
      outputBuffer.touch(conversationKey);
    } else {
      // 提交所有答案
      await this.submitQuestionAnswers(pending, chatId, sender);
    }

    return true;
  }

  /**
   * 提交问题答案
   */
  private async submitQuestionAnswers(
    pending: PendingQuestion,
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

    console.log(`[QQ] 提交问题回答: requestId=${pending.request.id.slice(0, 8)}...`);

    const bufferKey = `chat:qq:${chatId}`;
    this.ensureStreamingBuffer(chatId, pending.request.sessionID);

    const result = await opencodeClient.replyQuestion(pending.request.id, answers);

    if (result.ok) {
      questionHandler.remove(pending.request.id);
      outputBuffer.touch(bufferKey);
      await sender.sendText(chatId, '✅ 已提交回答，AI 正在处理...');
    } else if (result.expired) {
      questionHandler.remove(pending.request.id);
      await sender.sendText(chatId, '⚠️ 问题已过期，请重新发起对话');
    } else {
      await sender.sendText(chatId, '⚠️ 回答提交失败，请重试');
    }
  }

  /**
   * 处理 QQ 命令
   */
  private async handleCommand(
    command: ParsedCommand,
    chatId: string,
    senderId: string,
    sender: PlatformSender
  ): Promise<void> {
    switch (command.type) {
      case 'help':
        await sender.sendText(chatId, getQQHelpText());
        break;

      case 'status': {
        const sessionId = chatSessionStore.getSessionIdByConversation('qq', chatId);
        const status = sessionId
          ? `当前绑定会话: ${sessionId}`
          : '未绑定会话';
        await sender.sendText(chatId, `OpenCode 状态\n\n${status}`);
        break;
      }

      case 'session':
      case 'sessions':
        await this.handleSessionCommand(command, chatId, senderId, sender);
        break;

      case 'model':
        await this.handleModelCommand(command, chatId, senderId, sender);
        break;

      case 'models':
        await this.handleModelsCommand(chatId, sender);
        break;

      case 'agent':
        await this.handleAgentCommand(command, chatId, senderId, sender);
        break;

      case 'agents':
        await this.handleAgentsCommand(chatId, sender);
        break;

      case 'clear':
        await this.handleClearCommand(chatId, senderId, sender);
        break;

      case 'stop': {
        const sessionId = chatSessionStore.getSessionIdByConversation('qq', chatId);
        if (sessionId) {
          await opencodeClient.abortSession(sessionId);
          await sender.sendText(chatId, '已发送中断请求');
        } else {
          await sender.sendText(chatId, '当前没有活跃的会话');
        }
        break;
      }

      default:
        // 其他命令暂不支持
        await sender.sendText(chatId, `命令 "${command.type}" 暂不支持，/help 查看可用命令`);
    }
  }

  /**
   * 处理 session 命令
   */
  private async handleSessionCommand(
    command: ParsedCommand,
    chatId: string,
    senderId: string,
    sender: PlatformSender
  ): Promise<void> {
    if (command.sessionAction === 'new') {
      // 创建新会话
      const title = `QQ会话-${buildSessionTimestamp()}`;
      const chatDefault = chatSessionStore.getSessionByConversation('qq', chatId)?.defaultDirectory;
      const dirResult = DirectoryPolicy.resolve({ chatDefaultDirectory: chatDefault });
      const effectiveDir = dirResult.ok && dirResult.source !== 'server_default' ? dirResult.directory : undefined;

      try {
        const session = await opencodeClient.createSession(title, effectiveDir);
        if (session) {
          chatSessionStore.setSessionByConversation('qq', chatId, session.id, senderId, title, {
            chatType: 'p2p',
            resolvedDirectory: session.directory,
          });
          const dirInfo = session.directory ? `\n工作目录: ${session.directory}` : '';
          await sender.sendText(chatId, `已创建新会话窗口\nID: ${session.id}${dirInfo}`);
        } else {
          await sender.sendText(chatId, '创建会话失败');
        }
      } catch (error) {
        console.error('[QQ] 创建会话失败:', error);
        await sender.sendText(chatId, '创建会话失败，请稍后重试');
      }
    } else if (command.sessionAction === 'switch' && command.sessionId) {
      // 切换到指定会话
      try {
        const session = await opencodeClient.findSessionAcrossProjects(command.sessionId);
        if (session) {
          chatSessionStore.setSessionByConversation('qq', chatId, session.id, senderId, session.title || '未命名会话', {
            chatType: 'p2p',
            resolvedDirectory: session.directory,
          });
          await sender.sendText(chatId, `已切换到会话: ${session.id}`);
        } else {
          await sender.sendText(chatId, `未找到会话: ${command.sessionId}`);
        }
      } catch (error) {
        console.error('[QQ] 切换会话失败:', error);
        await sender.sendText(chatId, '切换会话失败');
      }
    } else {
      // 列出会话
      await this.handleListSessions(chatId, command.listAll ?? false, sender);
    }
  }

  /**
   * 列出会话
   */
  private async handleListSessions(
    chatId: string,
    listAll: boolean,
    sender: PlatformSender
  ): Promise<void> {
    try {
      const sessions = listAll
        ? await opencodeClient.listSessionsAcrossProjects()
        : await opencodeClient.listSessions();

      if (sessions.length === 0) {
        await sender.sendText(chatId, '暂无会话');
        return;
      }

      const lines: string[] = ['会话列表:'];
      for (const session of sessions.slice(0, 20)) {
        const title = session.title || '未命名';
        const shortId = session.id.slice(0, 8);
        lines.push(`- ${shortId}: ${title}`);
      }

      if (sessions.length > 20) {
        lines.push(`... 共 ${sessions.length} 个会话`);
      }

      await sender.sendText(chatId, lines.join('\n'));
    } catch (error) {
      console.error('[QQ] 获取会话列表失败:', error);
      await sender.sendText(chatId, '获取会话列表失败');
    }
  }

  /**
   * 处理 model 命令
   */
  private async handleModelCommand(
    command: ParsedCommand,
    chatId: string,
    _senderId: string,
    sender: PlatformSender
  ): Promise<void> {
    const session = chatSessionStore.getSessionByConversation('qq', chatId);

    if (!command.modelName) {
      // 显示当前模型
      const envDefaultModel = modelConfig.defaultProvider && modelConfig.defaultModel
        ? `${modelConfig.defaultProvider}:${modelConfig.defaultModel}`
        : undefined;
      const currentModel = session?.preferredModel || envDefaultModel || '跟随 OpenCode 默认模型';
      await sender.sendText(chatId, `当前模型: ${currentModel}`);
      return;
    }

    // 设置模型
    const normalizedModelName = command.modelName.trim();

    // 验证模型是否存在
    try {
      const providersResult = await opencodeClient.getProviders();
      const providers = Array.isArray(providersResult.providers) ? providersResult.providers : [];

      const matchedModel = findAllowedChatModel(providers, normalizedModelName);

      if (matchedModel) {
        chatSessionStore.updateConfigByConversation('qq', chatId, {
          preferredModel: `${matchedModel.providerId}:${matchedModel.modelId}`,
        });
        await sender.sendText(chatId, `已切换模型: ${matchedModel.providerId}:${matchedModel.modelId}`);
      } else if (normalizedModelName.includes(':') || normalizedModelName.includes('/')) {
        const parsedModel = parseChatModelReference(normalizedModelName);
        if (!parsedModel) {
          await sender.sendText(chatId, `未找到模型 "${normalizedModelName}"`);
          return;
        }
        if (!isChatModelAllowed(parsedModel.providerId, parsedModel.modelId)) {
          await sender.sendText(chatId, `模型 "${normalizedModelName}" 不在当前允许列表中`);
          return;
        }

        chatSessionStore.updateConfigByConversation('qq', chatId, {
          preferredModel: `${parsedModel.providerId}:${parsedModel.modelId}`,
        });
        await sender.sendText(chatId, `已设置模型: ${parsedModel.providerId}:${parsedModel.modelId}`);
      } else {
        await sender.sendText(chatId, `未找到模型 "${normalizedModelName}"`);
      }
    } catch (error) {
      console.error('[QQ] 设置模型失败:', error);
      await sender.sendText(chatId, `设置模型失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 列出所有可用模型
   */
  private async handleModelsCommand(chatId: string, sender: PlatformSender): Promise<void> {
    try {
      const providersResult = await opencodeClient.getProviders();
      const providers = Array.isArray(providersResult?.providers) ? providersResult.providers : [];

      if (providers.length === 0) {
        console.warn('[QQ] No providers found in getProviders result');
        await sender.sendText(chatId, '❌ 未找到可用的模型提供商，请检查 OpenCode 配置');
        return;
      }

      const lines: string[] = ['📋 可用模型列表\n'];
      let totalCount = 0;

      const models = collectAllowedChatModels(providers);
      const providerGroups = new Map<string, { providerName: string; models: Array<{ id: string; name: string }> }>();

      for (const model of models) {
        if (!providerGroups.has(model.providerId)) {
          providerGroups.set(model.providerId, {
            providerName: model.providerName,
            models: [],
          });
        }
        providerGroups.get(model.providerId)!.models.push({ id: model.modelId, name: model.modelName });
      }

      for (const [providerId, group] of providerGroups.entries()) {
        if (group.models.length === 0) continue;
        lines.push(`【${group.providerName}】`);

        for (const model of group.models.slice(0, 10)) {
          const modelDisplay = model.name || model.id;
          lines.push(`  ${modelDisplay} (${providerId}:${model.id})`);
          totalCount++;
        }

        if (group.models.length > 10) {
          lines.push(`  ... 共 ${group.models.length} 个模型`);
        }
        lines.push('');
      }

      if (totalCount === 0) {
        lines.push('暂无可用模型');
      } else {
        lines.push(`共 ${totalCount} 个模型，使用 /model <名称> 切换`);
      }

      let result = lines.join('\n');
      if (result.length > 3000) {
        result = result.slice(0, 2900) + '\n\n... 列表过长，已截断';
      }

      await sender.sendText(chatId, result);
    } catch (error) {
      console.error('[QQ] 获取模型列表失败:', error);
      await sender.sendText(chatId, '获取模型列表失败');
    }
  }

  /**
   * 处理 agent 命令
   */
  private async handleAgentCommand(
    command: ParsedCommand,
    chatId: string,
    _senderId: string,
    sender: PlatformSender
  ): Promise<void> {
    const session = chatSessionStore.getSessionByConversation('qq', chatId);

    if (!command.agentName) {
      // 显示当前角色
      const currentAgent = session?.preferredAgent || '默认角色';
      await sender.sendText(chatId, `当前角色: ${currentAgent}`);
      return;
    }

    // 设置角色
    const normalizedAgentName = command.agentName.trim().toLowerCase();

    if (normalizedAgentName === 'off' || normalizedAgentName === 'default') {
      chatSessionStore.updateConfigByConversation('qq', chatId, { preferredAgent: undefined });
      await sender.sendText(chatId, '已切换为默认角色');
      return;
    }

    chatSessionStore.updateConfigByConversation('qq', chatId, { preferredAgent: command.agentName.trim() });
    await sender.sendText(chatId, `已切换角色: ${command.agentName.trim()}`);
  }

  /**
   * 列出所有可用角色
   */
  private async handleAgentsCommand(chatId: string, sender: PlatformSender): Promise<void> {
    try {
      const agents = await opencodeClient.getAgents();
      const visibleAgents = agents.filter((a: { name: string }) =>
        a.name && !['compaction', 'title', 'summary'].includes(a.name)
      );

      if (visibleAgents.length === 0) {
        await sender.sendText(chatId, '暂无可用角色');
        return;
      }

      const lines: string[] = ['📋 可用角色列表\n'];

      for (const agent of visibleAgents) {
        const desc = agent.description ? ` - ${agent.description.slice(0, 50)}${agent.description.length > 50 ? '...' : ''}` : '';
        lines.push(`• ${agent.name}${desc}`);
      }

      lines.push(`\n共 ${visibleAgents.length} 个角色，使用 /agent <名称> 切换`);

      await sender.sendText(chatId, lines.join('\n'));
    } catch (error) {
      console.error('[QQ] 获取角色列表失败:', error);
      await sender.sendText(chatId, '获取角色列表失败');
    }
  }

  /**
   * 处理 clear 命令
   */
  private async handleClearCommand(
    chatId: string,
    senderId: string,
    sender: PlatformSender
  ): Promise<void> {
    const session = chatSessionStore.getSessionByConversation('qq', chatId);

    if (session?.sessionId) {
      await opencodeClient.deleteSession(session.sessionId);
      chatSessionStore.removeSessionByConversation('qq', chatId);
      await sender.sendText(chatId, '会话上下文已清除，新消息将开启新会话。');
    } else {
      // 创建新会话
      const title = `QQ会话-${buildSessionTimestamp()}`;
      const dirResult = DirectoryPolicy.resolve({});
      const effectiveDir = dirResult.ok && dirResult.source !== 'server_default' ? dirResult.directory : undefined;

      try {
        const newSession = await opencodeClient.createSession(title, effectiveDir);
        if (newSession) {
          chatSessionStore.setSessionByConversation('qq', chatId, newSession.id, senderId, title, {
            chatType: 'p2p',
            resolvedDirectory: newSession.directory,
          });
          await sender.sendText(chatId, '已创建新会话');
        }
      } catch (error) {
        console.error('[QQ] 创建会话失败:', error);
        await sender.sendText(chatId, '创建新会话失败');
      }
    }
  }

  /**
   * 处理 QQ 消息
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

    // 0. 优先检查待处理的权限请求
    if (trimmed && !trimmed.startsWith('/')) {
      const handled = await this.tryHandlePendingPermission(chatId, trimmed, sender);
      if (handled) return;
    }

    // 0.5 检查待回答的问题
    if (trimmed && !trimmed.startsWith('/')) {
      const handled = await this.tryHandlePendingQuestion(chatId, trimmed, sender);
      if (handled) return;
    }

    // 1. 处理命令
    const command = parseCommand(trimmed);
    if (command.type !== 'prompt') {
      console.log(`[QQ] 收到命令：${command.type}`);
      await this.handleCommand(command, chatId, senderId, sender);
      return;
    }

    // 2. 获取或创建会话
    let sessionId = chatSessionStore.getSessionIdByConversation('qq', chatId);
    if (!sessionId) {
      const title = `QQ会话-${buildSessionTimestamp()}`;
      const chatDefault = chatSessionStore.getSessionByConversation('qq', chatId)?.defaultDirectory;
      const dirResult = DirectoryPolicy.resolve({ chatDefaultDirectory: chatDefault });
      const effectiveDir = dirResult.ok && dirResult.source !== 'server_default' ? dirResult.directory : undefined;
      const session = await opencodeClient.createSession(title, effectiveDir);
      if (session) {
        sessionId = session.id;
        chatSessionStore.setSessionByConversation('qq', chatId, sessionId, senderId, title, {
          chatType: event.chatType || 'p2p',
          resolvedDirectory: session.directory,
        });
      } else {
        await sender.sendText(chatId, '无法创建 OpenCode 会话');
        return;
      }
    }

    // 3. 处理 Prompt
    const sessionConfig = chatSessionStore.getSessionByConversation('qq', chatId);
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

    console.log(`[QQ] 收到动作：${action.tag}`);

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
    const bufferKey = `chat:qq:${chatId}`;
    this.ensureStreamingBuffer(chatId, sessionId);

    if (!sender) {
      console.error('[QQ] 发送器为空，无法发送消息');
      return;
    }

    try {
      console.log(`[QQ] 发送消息：chat=${chatId}, session=${sessionId.slice(0, 8)}...`);

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

      const sessionData = chatSessionStore.getSessionByConversation('qq', chatId);
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
          console.debug('[QQ] 获取模型支持的 variants 失败，跳过验证:', error instanceof Error ? error.message : String(error));
        }
      }

      // ── 非多模态主模型图片回退 ──
      const dispatchParts = await preprocessVisionParts(
        parts as VisionPart[],
        { providerId, modelId, directory },
        'QQ',
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
      console.error('[QQ] 请求派发失败:', error);

      outputBuffer.append(bufferKey, `\n\n错误：${errorMessage}`);
      outputBuffer.setStatus(bufferKey, 'failed');

      const currentBuffer = outputBuffer.get(bufferKey);
      if (!currentBuffer?.messageId) {
        await sender.sendText(chatId, `错误：${errorMessage}`);
      }
    }
  }

  /**
   * 处理附件下载和转换
   * 支持 OneBot 和 QQ 官方 API 的附件格式
   */
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
      try {
        // 检查文件大小
        if (attachment.fileSize && attachment.fileSize > attachmentConfig.maxSize) {
          warnings.push(`附件 ${attachment.fileName || '未知'} 过大 (${Math.round(attachment.fileSize / 1024 / 1024)}MB)，已跳过`);
          continue;
        }

        const fileKey = attachment.fileKey;
        if (!fileKey) {
          warnings.push(`附件 ${attachment.fileName || '未知'} 缺少文件 URL`);
          continue;
        }

        console.log(`[QQ] 下载附件: ${attachment.fileName || fileKey.slice(0, 50)}`);

        // 下载文件
        const response = await axios({
          method: 'GET',
          url: fileKey,
          responseType: 'arraybuffer',
          timeout: 60000,
          maxContentLength: attachmentConfig.maxSize,
        });

        const buffer = Buffer.from(response.data);
        const contentType = (response.headers['content-type'] as string) || '';

        // 确定文件扩展名
        const extFromName = attachment.fileName ? extractExtension(attachment.fileName) : '';
        const extFromType = attachment.fileType ? normalizeExtension(attachment.fileType) : '';
        const extFromContent = contentType ? extensionFromContentType(contentType) : '';
        let ext = normalizeExtension(extFromName || extFromType || extFromContent);

        // 图片默认扩展名
        if (!ext && attachment.type === 'image') {
          ext = '.jpg';
        }

        // 检查扩展名是否支持
        if (!ext || !ALLOWED_ATTACHMENT_EXTENSIONS.has(ext)) {
          console.log(`[QQ] 不支持的附件格式: ext=${ext || 'unknown'}, contentType=${contentType}`);
          warnings.push(`附件格式不支持 (${ext || 'unknown'})，已跳过`);
          continue;
        }

        // 生成文件名
        const fileId = randomUUID();
        const rawName = attachment.fileName || `attachment${ext}`;
        const safeName = sanitizeFilename(rawName.endsWith(ext) ? rawName : `${rawName}${ext}`);
        const filePath = path.join(ATTACHMENT_BASE_DIR, `${fileId}${ext}`);

        try {
          // 写入临时文件
          await fs.writeFile(filePath, buffer);

          // 转换为 base64 data URL
          const base64 = buffer.toString('base64');
          let mime = contentType ? contentType.split(';')[0].trim() : '';
          if (!mime || mime === 'application/octet-stream') {
            mime = mimeFromExtension(ext);
          }

          const dataUrl = `data:${mime};base64,${base64}`;

          parts.push({
            type: 'file',
            mime,
            url: dataUrl,
            filename: safeName,
          });

          console.log(`[QQ] 附件处理成功: ${safeName}, mime=${mime}`);
        } finally {
          // 清理临时文件
          fs.unlink(filePath).catch(() => {});
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[QQ] 附件下载失败: ${attachment.fileName || '未知'} - ${errorMsg}`);
        warnings.push(`附件 ${attachment.fileName || '未知'} 下载失败: ${errorMsg}`);
      }
    }

    return { parts, warnings };
  }
}

export const qqHandler = new QQHandler();
