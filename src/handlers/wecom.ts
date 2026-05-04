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
import { preprocessVisionParts, type VisionPart } from '../services/vision-ocr.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { chatSessionStore } from '../store/chat-session.js';
import { parseCommand, type ParsedCommand } from '../commands/parser.js';
import { DirectoryPolicy } from '../utils/directory-policy.js';
import { buildSessionTimestamp } from '../utils/session-title.js';
import { shouldSkipGroupMessage } from '../utils/group-mention.js';
import { KNOWN_EFFORT_LEVELS, normalizeEffortLevel, type EffortLevel } from '../commands/effort.js';
import { permissionHandler } from '../permissions/handler.js';
import { questionHandler, type PendingQuestion } from '../opencode/question-handler.js';
import { parseQuestionAnswerText } from '../opencode/question-parser.js';
import type { PlatformMessageEvent, PlatformSender, PlatformAttachment } from '../platform/types.js';
import {
  collectAllowedChatModels,
  findAllowedChatModel,
  isChatModelAllowed,
  parseChatModelReference,
} from '../utils/chat-model-whitelist.js';

// 附件相关配置
const ATTACHMENT_BASE_DIR = path.resolve(process.cwd(), 'tmp', 'wecom-uploads');
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf',
  '.pjp', '.pjpeg', '.jfif', '.jpe'
]);

const WECOM_MESSAGE_LIMIT = 1800;

// 文件类型检测辅助函数
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
  const type = contentType.split(';')[0]?.trim().toLowerCase();
  if (type === 'image/png') return '.png';
  if (type === 'image/jpeg') return '.jpg';
  if (type === 'image/gif') return '.gif';
  if (type === 'image/webp') return '.webp';
  if (type === 'application/pdf') return '.pdf';
  return '';
}

function mimeFromExtension(ext: string): string {
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
    case '.pjpeg':
    case '.pjp':
    case '.jfif':
    case '.jpe':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '_').trim();
  return cleaned || 'attachment';
}

// 从 URL 中提取文件名
function extractFilenameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const segments = pathname.split('/');
    const lastSegment = segments[segments.length - 1];
    if (lastSegment && lastSegment.includes('.')) {
      return decodeURIComponent(lastSegment);
    }
  } catch {
    // URL 解析失败，忽略
  }
  return 'attachment';
}

type OpencodeFilePartInput = { type: 'file'; mime: string; url: string; filename?: string };
type OpencodePartInput = { type: 'text'; text: string } | OpencodeFilePartInput;

// 权限决策解析结果
type PermissionDecision = {
  allow: boolean;
  remember: boolean;
};

// 解析用户的权限决策文本
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

  /**
   * 获取企业微信帮助文本
   * 企业微信 Markdown 格式有限，使用纯文本 + emoji
   */
  private getWeComHelpText(): string {
    return `> 📖 企业微信 x OpenCode 机器人指南

💬 如何对话
直接发送消息即可与 AI 对话。

⚡ 常用命令
/help - 显示帮助
/status - 查看当前会话状态
/session - 查看当前会话
/session new - 创建新会话
/sessions - 列出所有会话
/model - 查看当前模型
/model <名称> - 切换模型
/models - 列出所有可用模型
/agent - 查看当前角色
/agent <名称> - 切换角色
/agents - 列出所有可用角色
/agent off - 切回默认角色
/effort - 查看当前推理强度
/effort <档位> - 设置推理强度 (low/high/xhigh)
/stop - 停止当前生成
/undo - 撤回上一轮对话
/compact - 压缩上下文
/rename <名称> - 重命名会话
/clear - 清空对话上下文

💡 提示
切换的模型/角色仅对当前会话生效
其他未知 /xxx 命令会自动透传给 OpenCode`;
  }

  /**
   * 处理命令
   */
  private async handleCommand(
    command: ParsedCommand,
    event: PlatformMessageEvent,
    sender: PlatformSender
  ): Promise<void> {
    const { conversationId: chatId, senderId } = event;

    switch (command.type) {
      case 'help':
        await sender.sendText(chatId, this.getWeComHelpText());
        break;

      case 'status': {
        const session = chatSessionStore.getSessionByConversation('wecom', chatId);
        if (!session?.sessionId) {
          await sender.sendText(chatId, '当前会话未绑定 OpenCode 会话，发送消息将自动创建。');
          return;
        }
        const lines = [
          `📊 会话状态`,
          `会话ID: ${session.sessionId.slice(0, 8)}...`,
          `标题: ${session.title || '未命名'}`,
          `模型: ${session.preferredModel || '默认'}`,
          `角色: ${session.preferredAgent || '默认'}`,
          `强度: ${session.preferredEffort || '默认'}`,
          `工作目录: ${session.resolvedDirectory || '默认'}`,
        ];
        await sender.sendText(chatId, lines.join('\n'));
        break;
      }

      case 'session': {
        if (command.sessionAction === 'new') {
          await this.handleNewSession(chatId, senderId, command.sessionDirectory, command.sessionName, event.chatType, sender);
        } else if (command.sessionAction === 'switch' && command.sessionId) {
          await this.handleSwitchSession(chatId, senderId, command.sessionId, event.chatType, sender);
        } else {
          // 显示当前会话
          const sessionId = chatSessionStore.getSessionIdByConversation('wecom', chatId);
          if (!sessionId) {
            await sender.sendText(chatId, '当前会话未绑定。发送消息将自动创建会话，或使用 `/session new` 创建新会话。');
          } else {
            await sender.sendText(chatId, `当前会话: ${sessionId.slice(0, 8)}...`);
          }
        }
        break;
      }

      case 'sessions': {
        await this.handleListSessions(chatId, command.listAll ?? false, sender);
        break;
      }

      case 'model': {
        await this.handleModel(chatId, senderId, event.chatType, command.modelName, sender);
        break;
      }

      case 'models': {
        await this.handleModels(chatId, sender);
        break;
      }

      case 'agent': {
        await this.handleAgent(chatId, senderId, event.chatType, command.agentName, sender);
        break;
      }

      case 'agents': {
        await this.handleAgents(chatId, sender);
        break;
      }

      case 'effort': {
        await this.handleEffort(chatId, senderId, event.chatType, command, sender);
        break;
      }

      case 'stop': {
        const sessionId = chatSessionStore.getSessionIdByConversation('wecom', chatId);
        if (sessionId) {
          await opencodeClient.abortSession(sessionId);
          await sender.sendText(chatId, '已发送中断请求');
        } else {
          await sender.sendText(chatId, '当前没有活跃的会话');
        }
        break;
      }

      case 'undo': {
        await this.handleUndo(chatId, sender);
        break;
      }

      case 'compact': {
        await this.handleCompact(chatId, sender);
        break;
      }

      case 'rename': {
        await this.handleRename(chatId, command.renameTitle, sender);
        break;
      }

      case 'clear': {
        await this.handleClear(chatId, senderId, event.chatType, sender);
        break;
      }

      case 'commands': {
        await this.handleCommandsList(chatId, sender);
        break;
      }

      case 'command': {
        // 透传命令到 OpenCode
        await this.handlePassthroughCommand(chatId, command.commandName || '', command.commandArgs || '', sender);
        break;
      }

      default:
        await sender.sendText(chatId, `命令 "${command.type}" 暂不支持，请使用 /help 查看可用命令。`);
    }
  }

  /**
   * 创建新会话
   */
  private async handleNewSession(
    chatId: string,
    senderId: string,
    directory?: string,
    sessionName?: string,
    chatType?: 'p2p' | 'group',
    sender?: PlatformSender
  ): Promise<void> {
    if (!sender) return;

    let effectiveDir: string | undefined;
    if (directory) {
      const dirResult = DirectoryPolicy.resolve({ explicitDirectory: directory });
      if (!dirResult.ok) {
        await sender.sendText(chatId, dirResult.userMessage);
        return;
      }
      effectiveDir = dirResult.source === 'server_default' ? undefined : dirResult.directory;
    } else {
      const chatDefault = chatSessionStore.getSessionByConversation('wecom', chatId)?.defaultDirectory;
      const dirResult = DirectoryPolicy.resolve({ chatDefaultDirectory: chatDefault });
      effectiveDir = dirResult.ok && dirResult.source !== 'server_default' ? dirResult.directory : undefined;
    }

    const title = sessionName || `企微会话-${buildSessionTimestamp()}`;
    const session = await opencodeClient.createSession(title, effectiveDir);

    if (!session?.id) {
      await sender.sendText(chatId, '创建会话失败，请稍后重试');
      return;
    }

    chatSessionStore.setSessionByConversation('wecom', chatId, session.id, senderId, title, {
      chatType: chatType || 'p2p',
      resolvedDirectory: session.directory,
    });

    await sender.sendText(chatId, `已创建新会话: ${session.id.slice(0, 8)}...\n标题: ${title}`);
  }

  /**
   * 切换会话
   */
  private async handleSwitchSession(
    chatId: string,
    senderId: string,
    sessionId: string,
    chatType?: 'p2p' | 'group',
    sender?: PlatformSender
  ): Promise<void> {
    if (!sender) return;

    // 验证会话是否存在
    const session = await opencodeClient.findSessionAcrossProjects(sessionId);
    if (!session) {
      await sender.sendText(chatId, `未找到会话: ${sessionId}`);
      return;
    }

    chatSessionStore.setSessionByConversation('wecom', chatId, session.id, senderId, session.title || '未命名', {
      chatType: chatType || 'p2p',
      resolvedDirectory: session.directory,
    });

    await sender.sendText(chatId, `已切换到会话: ${session.id.slice(0, 8)}...\n标题: ${session.title || '未命名'}`);
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
        await sender.sendText(chatId, '没有找到会话');
        return;
      }

      const lines = [`📋 会话列表 (${sessions.length} 个)`, ''];
      const displaySessions = sessions.slice(0, 20);

      for (const session of displaySessions) {
        const title = session.title || '未命名';
        const shortId = session.id.slice(0, 8);
        const dir = session.directory || '默认目录';
        lines.push(`${shortId} | ${title.slice(0, 30)}${title.length > 30 ? '...' : ''}`);
        lines.push(`  📁 ${dir}`);
      }

      if (sessions.length > 20) {
        lines.push(`\n... 还有 ${sessions.length - 20} 个会话`);
      }

      lines.push('\n使用 /session <sessionId> 切换会话');

      await sender.sendText(chatId, lines.join('\n'));
    } catch (error) {
      console.error('[企业微信] 获取会话列表失败:', error);
      await sender.sendText(chatId, '获取会话列表失败，请稍后重试');
    }
  }

  /**
   * 处理模型命令
   */
  private async handleModel(
    chatId: string,
    senderId: string,
    chatType: 'p2p' | 'group' | undefined,
    modelName: string | undefined,
    sender: PlatformSender
  ): Promise<void> {
    if (!modelName) {
      // 显示当前模型
      const session = chatSessionStore.getSessionByConversation('wecom', chatId);
      const currentModel = session?.preferredModel || modelConfig.defaultModel || '默认';
      await sender.sendText(chatId, `当前模型: ${currentModel}\n使用 \`/model <名称>\` 切换模型`);
      return;
    }

    // 设置模型
    const session = chatSessionStore.getSessionByConversation('wecom', chatId);
    if (!session?.sessionId) {
      await sender.sendText(chatId, '当前没有绑定会话，请先发送消息创建会话');
      return;
    }

    try {
      const providersResult = await opencodeClient.getProviders();
      const providers = Array.isArray(providersResult.providers) ? providersResult.providers : [];
      const normalizedModelName = modelName.trim();
      const matchedModel = findAllowedChatModel(providers, normalizedModelName);

      if (matchedModel) {
        const preferredModel = `${matchedModel.providerId}:${matchedModel.modelId}`;
        chatSessionStore.updateConfigByConversation('wecom', chatId, { preferredModel });
        await sender.sendText(chatId, `已切换模型: ${preferredModel}`);
        return;
      }

      const parsedModel = parseChatModelReference(normalizedModelName);
      if (!parsedModel) {
        await sender.sendText(chatId, `未找到模型 "${normalizedModelName}"`);
        return;
      }
      if (!isChatModelAllowed(parsedModel.providerId, parsedModel.modelId)) {
        await sender.sendText(chatId, `模型 "${normalizedModelName}" 不在当前允许列表中`);
        return;
      }

      const preferredModel = `${parsedModel.providerId}:${parsedModel.modelId}`;
      chatSessionStore.updateConfigByConversation('wecom', chatId, { preferredModel });
      await sender.sendText(chatId, `已切换模型: ${preferredModel}`);
    } catch (error) {
      console.error('[WeCom] 设置模型失败:', error);
      await sender.sendText(chatId, '设置模型失败');
    }
  }

  /**
   * 列出所有可用模型
   */
  private async handleModels(chatId: string, sender: PlatformSender): Promise<void> {
    try {
      const providersResult = await opencodeClient.getProviders();
      const providers = Array.isArray(providersResult.providers) ? providersResult.providers : [];

      const lines: string[] = ['📋 可用模型列表\n'];
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
      console.error('[WeCom] 获取模型列表失败:', error);
      await sender.sendText(chatId, '获取模型列表失败');
    }
  }

  /**
   * 处理角色命令
   */
  private async handleAgent(
    chatId: string,
    senderId: string,
    chatType: 'p2p' | 'group' | undefined,
    agentName: string | undefined,
    sender: PlatformSender
  ): Promise<void> {
    if (!agentName) {
      // 显示当前角色
      const session = chatSessionStore.getSessionByConversation('wecom', chatId);
      const currentAgent = session?.preferredAgent || '默认';
      await sender.sendText(chatId, `当前角色: ${currentAgent}\n使用 \`/agent <名称>\` 切换角色`);
      return;
    }

    // 设置角色
    const session = chatSessionStore.getSessionByConversation('wecom', chatId);
    if (!session?.sessionId) {
      await sender.sendText(chatId, '当前没有绑定会话，请先发送消息创建会话');
      return;
    }

    if (agentName.toLowerCase() === 'off') {
      chatSessionStore.updateConfig(chatId, { preferredAgent: undefined });
      await sender.sendText(chatId, '已切回默认角色');
    } else {
      chatSessionStore.updateConfig(chatId, { preferredAgent: agentName });
      await sender.sendText(chatId, `已切换角色: ${agentName}`);
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

      const lines: string[] = ['📋 可用角色列表\n'];

      for (const agent of visibleAgents) {
        const desc = agent.description ? ` - ${agent.description.slice(0, 50)}${agent.description.length > 50 ? '...' : ''}` : '';
        lines.push(`• ${agent.name}${desc}`);
      }

      lines.push(`\n共 ${visibleAgents.length} 个角色，使用 /agent <名称> 切换`);

      await sender.sendText(chatId, lines.join('\n'));
    } catch (error) {
      console.error('[WeCom] 获取角色列表失败:', error);
      await sender.sendText(chatId, '获取角色列表失败');
    }
  }

  /**
   * 处理推理强度命令
   */
  private async handleEffort(
    chatId: string,
    senderId: string,
    chatType: 'p2p' | 'group' | undefined,
    command: ParsedCommand,
    sender: PlatformSender
  ): Promise<void> {
    const session = chatSessionStore.getSessionByConversation('wecom', chatId);

    if (!command.effortLevel && !command.effortReset) {
      // 显示当前强度
      const currentEffort = session?.preferredEffort || '默认';
      const lines = [
        `当前推理强度: ${currentEffort}`,
        '',
        '可用档位:',
        '- low: 快速响应',
        '- high: 平衡模式',
        '- xhigh: 深度思考',
        '',
        '使用 `/effort <档位>` 设置强度',
        '使用 `/effort default` 恢复默认',
      ];
      await sender.sendText(chatId, lines.join('\n'));
      return;
    }

    if (command.effortReset) {
      chatSessionStore.updateConfig(chatId, { preferredEffort: undefined });
      await sender.sendText(chatId, '已恢复默认推理强度');
      return;
    }

    if (command.effortLevel) {
      chatSessionStore.updateConfig(chatId, { preferredEffort: command.effortLevel });
      await sender.sendText(chatId, `已设置推理强度: ${command.effortLevel}`);
    }
  }

  /**
   * 处理撤回命令
   *
   * 注意：企业微信机器人不支持撤回已发送的消息（平台限制）
   * 此命令仅撤回 OpenCode 侧的消息，并发送提示通知
   */
  private async handleUndo(chatId: string, sender: PlatformSender): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation('wecom', chatId);
    if (!sessionId) {
      await sender.sendText(chatId, '当前没有活跃的会话');
      return;
    }

    // 获取会话消息，找到最后一条用户消息并撤回
    try {
      const messages = await opencodeClient.getSessionMessages(sessionId);
      // 找到最后一条用户消息
      const lastUserMessage = [...messages].reverse().find(m => m.info.role === 'user');
      if (!lastUserMessage) {
        await sender.sendText(chatId, '没有可撤回的消息');
        return;
      }

      const reverted = await opencodeClient.revertMessage(sessionId, lastUserMessage.info.id);
      if (reverted) {
        await sender.sendText(chatId, '✅ OpenCode 上一句会话已撤回\n💡 提示：企业微信机器人不支持撤回平台消息');
      } else {
        await sender.sendText(chatId, '撤回失败，请稍后重试');
      }
    } catch (error) {
      console.error('[企业微信] 撤回失败:', error);
      await sender.sendText(chatId, '撤回失败，请稍后重试');
    }
  }

  /**
   * 处理压缩命令
   */
  private async handleCompact(chatId: string, sender: PlatformSender): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation('wecom', chatId);
    if (!sessionId) {
      await sender.sendText(chatId, '当前没有活跃的会话');
      return;
    }

    try {
      // 获取可用的模型进行压缩
      const providers = await opencodeClient.getProviders();
      const provider = providers.providers[0];
      if (!provider) {
        await sender.sendText(chatId, '未找到可用模型，无法执行上下文压缩');
        return;
      }

      const model = provider.models[0];
      if (!model) {
        await sender.sendText(chatId, '未找到可用模型，无法执行上下文压缩');
        return;
      }

      const compacted = await opencodeClient.summarizeSession(sessionId, provider.id, model.id);
      if (compacted) {
        await sender.sendText(chatId, `已压缩会话上下文（模型: ${provider.id}:${model.id}）`);
      } else {
        await sender.sendText(chatId, '压缩失败，请稍后重试');
      }
    } catch (error) {
      console.error('[企业微信] 压缩失败:', error);
      await sender.sendText(chatId, '压缩失败，请稍后重试');
    }
  }

  /**
   * 处理重命名命令
   */
  private async handleRename(chatId: string, newTitle: string | undefined, sender: PlatformSender): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation('wecom', chatId);
    if (!sessionId) {
      await sender.sendText(chatId, '当前没有活跃的会话，请先发送消息建立会话');
      return;
    }

    if (!newTitle || !newTitle.trim()) {
      await sender.sendText(chatId, '用法: /rename <新名称>\n示例: /rename Q3后端API设计讨论');
      return;
    }

    const trimmedTitle = newTitle.trim();
    if (trimmedTitle.length > 100) {
      await sender.sendText(chatId, `会话名称过长（${trimmedTitle.length} 字符），请控制在 100 字符以内`);
      return;
    }

    const success = await opencodeClient.updateSession(sessionId, trimmedTitle);
    if (success) {
      chatSessionStore.updateTitleByConversation('wecom', chatId, trimmedTitle);
      await sender.sendText(chatId, `已重命名为 "${trimmedTitle}"`);
    } else {
      await sender.sendText(chatId, '重命名失败，请稍后重试');
    }
  }

  /**
   * 处理清空命令
   */
  private async handleClear(
    chatId: string,
    senderId: string,
    chatType: 'p2p' | 'group' | undefined,
    sender: PlatformSender
  ): Promise<void> {
    await this.handleNewSession(chatId, senderId, undefined, undefined, chatType, sender);
  }

  /**
   * 处理命令列表
   */
  private async handleCommandsList(chatId: string, sender: PlatformSender): Promise<void> {
    try {
      const commands = await opencodeClient.getCommands();
      if (commands.length === 0) {
        await sender.sendText(chatId, '没有可用的自定义命令');
        return;
      }

      const lines = [`⚡ 可用命令 (${commands.length} 个)`, ''];
      for (const cmd of commands.slice(0, 30)) {
        const desc = cmd.description ? ` - ${cmd.description.slice(0, 50)}` : '';
        lines.push(`/${cmd.name}${desc}`);
      }

      if (commands.length > 30) {
        lines.push(`\n... 还有 ${commands.length - 30} 个命令`);
      }

      await sender.sendText(chatId, lines.join('\n'));
    } catch (error) {
      console.error('[企业微信] 获取命令列表失败:', error);
      await sender.sendText(chatId, '获取命令列表失败，请稍后重试');
    }
  }

  /**
   * 处理透传命令
   */
  private async handlePassthroughCommand(
    chatId: string,
    commandName: string,
    commandArgs: string,
    sender: PlatformSender
  ): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation('wecom', chatId);
    if (!sessionId) {
      await sender.sendText(chatId, '当前没有绑定会话，无法透传命令');
      return;
    }

    // 透传命令到 OpenCode
    const fullCommand = `/${commandName}${commandArgs ? ' ' + commandArgs : ''}`;
    try {
      await opencodeClient.sendMessageAsync(sessionId, fullCommand);
      await sender.sendText(chatId, `已发送命令: ${fullCommand}`);
    } catch (error) {
      console.error('[企业微信] 透传命令失败:', error);
      await sender.sendText(chatId, '命令透传失败，请稍后重试');
    }
  }

  /**
   * 获取权限队列的 key
   */
  private getPermissionQueueKey(chatId: string): string {
    return `wecom:${chatId}`;
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
   * 尝试处理待确认的权限请求
   * 返回 true 表示已处理，false 表示没有待处理的权限
   */
  private async tryHandlePendingPermission(
    event: PlatformMessageEvent,
    text: string,
    sender: PlatformSender
  ): Promise<boolean> {
    const queueKey = this.getPermissionQueueKey(event.conversationId);
    const pending = permissionHandler.peekForChat(queueKey);
    if (!pending) {
      return false;
    }

    const decision = parsePermissionDecision(text);
    if (!decision) {
      // 用户输入的不是权限决策，提示如何操作
      await this.sendPermissionPrompt(event.conversationId, pending, sender);
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
      const permissionDirectoryOptions = this.resolvePermissionDirectoryOptions(
        candidateSessionId,
        event.conversationId
      );
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
        console.error(
          `[企业微信] 权限响应失败: session=${candidateSessionId}, permission=${pending.permissionId}`,
          error
        );
      }
    }

    if (!responded) {
      console.error(
        `[企业微信] 所有候选 session 权限响应失败: sessions=${candidateSessionIds.join(',')}`,
        lastError
      );
      const errorMessage = expiredDetected ? '操作已过期，请重新发起' : '权限响应失败，请稍后重试';
      await sender.sendText(event.conversationId, errorMessage);
      return true;
    }

    console.log(
      `[企业微信] 权限响应成功: session=${respondedSessionId}, permission=${pending.permissionId}, allow=${decision.allow}, remember=${decision.remember}`
    );

    permissionHandler.resolveForChat(queueKey, pending.permissionId);
    const toolName = pending.tool || '工具';
    const resultMessage = decision.allow
      ? decision.remember
        ? `✅ 已允许并记住权限：${toolName}`
        : `✅ 已允许权限：${toolName}`
      : `❌ 已拒绝权限：${toolName}`;

    await sender.sendText(event.conversationId, resultMessage);
    return true;
  }

  /**
   * 发送权限请求提示消息（Markdown 格式）
   */
  private async sendPermissionPrompt(
    chatId: string,
    pending: { tool: string; description: string; risk?: string },
    sender: PlatformSender
  ): Promise<void> {
    const riskEmoji = pending.risk === 'high' ? '⚠️' : pending.risk === 'medium' ? '⚡' : '✅';
    const riskText = pending.risk === 'high' ? '高风险' : pending.risk === 'medium' ? '中等风险' : '低风险';

    const lines = [
      '> 🔐 权限确认请求',
      '',
      `工具: ${pending.tool}`,
      `描述: ${pending.description}`,
      `风险: ${riskEmoji} ${riskText}`,
      '',
      '---',
      '请回复以下选项之一：',
      '1️⃣ 允许 (或回复 y)',
      '2️⃣ 始终允许 (或回复 always)',
      '3️⃣ 拒绝 (或回复 n)',
    ];

    const message = lines.join('\n');
    await sender.sendText(chatId, message);
  }

  // ==================== 问答互动处理 ====================

  /**
   * 获取问答缓冲区 key
   */
  private getQuestionBufferKey(chatId: string): string {
    return `chat:wecom:${chatId}`;
  }

  /**
   * 获取待回答问题
   */
  private getPendingQuestionByConversation(chatId: string): PendingQuestion | null {
    const sessionId = chatSessionStore.getSessionIdByConversation('wecom', chatId);
    if (!sessionId) {
      return null;
    }

    const pending = questionHandler.getBySession(sessionId);
    if (!pending || pending.chatId !== chatId) {
      return null;
    }

    return pending;
  }

  /**
   * 尝试处理待回答的问题
   * 返回 true 表示已处理，false 表示没有待回答的问题
   */
  private async tryHandlePendingQuestion(
    event: PlatformMessageEvent,
    text: string,
    sender: PlatformSender
  ): Promise<boolean> {
    const pending = this.getPendingQuestionByConversation(event.conversationId);
    if (!pending) {
      return false;
    }

    const questionCount = pending.request.questions.length;
    if (questionCount === 0) {
      await sender.sendText(event.conversationId, '当前问题状态异常，请稍后重试。');
      return true;
    }

    const currentIndex = Math.min(Math.max(pending.currentQuestionIndex, 0), questionCount - 1);
    const question = pending.request.questions[currentIndex];
    const parsed = parseQuestionAnswerText(text, question);
    if (!parsed) {
      // 用户输入的不是有效答案，发送问答提示
      await this.sendQuestionPrompt(event.conversationId, pending, currentIndex, sender);
      return true;
    }

    // 更新草稿答案
    if (parsed.type === 'skip') {
      questionHandler.setDraftAnswer(pending.request.id, currentIndex, []);
      questionHandler.setDraftCustomAnswer(pending.request.id, currentIndex, '');
    } else if (parsed.type === 'custom') {
      questionHandler.setDraftAnswer(pending.request.id, currentIndex, []);
      questionHandler.setDraftCustomAnswer(pending.request.id, currentIndex, parsed.custom || text);
    } else {
      questionHandler.setDraftCustomAnswer(pending.request.id, currentIndex, '');
      questionHandler.setDraftAnswer(pending.request.id, currentIndex, parsed.values || []);
    }

    // 进入下一题或提交
    const nextIndex = currentIndex + 1;
    if (nextIndex < questionCount) {
      questionHandler.setCurrentQuestionIndex(pending.request.id, nextIndex);
      const bufferKey = this.getQuestionBufferKey(event.conversationId);
      if (outputBuffer.get(bufferKey)) {
        outputBuffer.touch(bufferKey);
      }
      await sender.sendText(
        event.conversationId,
        `✅ 已记录第 ${currentIndex + 1}/${questionCount} 题，请继续回答下一题。`
      );
    } else {
      // 提交所有答案
      await this.submitQuestionAnswers(pending, event.conversationId, sender);
    }

    return true;
  }

  /**
   * 发送问答提示消息（Markdown 格式）
   */
  private async sendQuestionPrompt(
    chatId: string,
    pending: PendingQuestion,
    questionIndex: number,
    sender: PlatformSender
  ): Promise<void> {
    const question = pending.request.questions[questionIndex];
    const totalQuestions = pending.request.questions.length;
    const header = question.header || `问题 ${questionIndex + 1}`;

    const lines: string[] = [
      `> 🤝 ${header}`,
      `(第 ${questionIndex + 1}/${totalQuestions} 题)`,
      '',
      question.question,
      '',
    ];

    // 添加选项
    if (question.options && question.options.length > 0) {
      lines.push('选项：');
      question.options.forEach((opt, idx) => {
        const desc = opt.description ? ` - ${opt.description}` : '';
        lines.push(`${idx + 1}️⃣ ${opt.label}${desc}`);
      });
      lines.push('');
    }

    // 提示信息
    lines.push('---');
    if (question.multiple) {
      lines.push('可多选，用空格或逗号分隔多个选项编号');
    }
    if (question.custom !== false) {
      lines.push('也可以直接输入自定义答案');
    }
    lines.push('回复"跳过"可跳过此题');

    const message = lines.join('\n');
    await sender.sendText(chatId, message);
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

    console.log(`[企业微信] 提交问题回答: requestId=${pending.request.id.slice(0, 8)}...`);

    const result = await opencodeClient.replyQuestion(pending.request.id, answers);

    if (result.ok) {
      questionHandler.remove(pending.request.id);
      const bufferKey = this.getQuestionBufferKey(chatId);
      if (outputBuffer.get(bufferKey)) {
        outputBuffer.touch(bufferKey);
      }
      await sender.sendText(chatId, '✅ 已提交问题回答，任务继续执行。');
    } else if (result.expired) {
      questionHandler.remove(pending.request.id);
      await sender.sendText(chatId, '⚠️ 问题已过期，请重新发起对话。');
    } else {
      await sender.sendText(chatId, '⚠️ 回答提交失败，请稍后重试。');
    }
  }

  // 处理企业微信消息
  async handleMessage(
    event: PlatformMessageEvent,
    sender: PlatformSender
  ): Promise<void> {
    // 0. 群聊 @ 提到检查
    if (shouldSkipGroupMessage(event)) {
      return;
    }

    const { conversationId: chatId, content, senderId, attachments } = event;
    const trimmed = content.trim();

    // 1. 优先检查待确认权限
    if (!trimmed.startsWith('/')) {
      const permissionHandled = await this.tryHandlePendingPermission(event, trimmed, sender);
      if (permissionHandled) {
        return;
      }

      // 0.5 检查待回答问题
      const questionHandled = await this.tryHandlePendingQuestion(event, trimmed, sender);
      if (questionHandled) {
        return;
      }
    }

    // 1. 优先处理命令
    const command = parseCommand(trimmed);
    if (command.type !== 'prompt') {
      console.log(`[企业微信] 收到命令：${command.type}`);
      await this.handleCommand(command, event, sender);
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
        await sender.sendText(chatId, '无法创建 OpenCode 会话');
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
      console.error('[企业微信] 发送器为空，无法发送消息');
      return;
    }

    try {
      console.log(`[企业微信] 发送消息：chat=${chatId}, session=${sessionId.slice(0, 8)}...`);

      const parts: OpencodePartInput[] = [];

      // 按需注入文件发送指令
      let effectiveText = text;
      if (effectiveText && /发给我|发送文件|上传|传给我|send.*file/i.test(effectiveText)) {
        effectiveText += '\n[wecom-bridge: 如需发送文件到当前会话，执行 echo WECOM_SEND_FILE <文件绝对路径>]';
      }

      if (effectiveText) {
        parts.push({ type: 'text', text: effectiveText });
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
          console.debug('[企业微信] 获取模型支持的 variants 失败，跳过验证:', error instanceof Error ? error.message : String(error));
        }
      }

      // ── 非多模态主模型图片回退 ──
      const dispatchParts = await preprocessVisionParts(
        parts as VisionPart[],
        { providerId, modelId, directory },
        '企业微信',
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
      console.error('[企业微信] 请求派发失败:', error);

      outputBuffer.append(bufferKey, `\n\n错误: ${errorMessage}`);
      outputBuffer.setStatus(bufferKey, 'failed');

      const currentBuffer = outputBuffer.get(bufferKey);
      if (!currentBuffer?.messageId) {
        await sender.sendText(chatId, `错误: ${errorMessage}`);
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
      try {
        // 企业微信附件的 fileKey 实际上是下载 URL
        const downloadUrl = attachment.fileKey;
        if (!downloadUrl) {
          warnings.push(`附件 ${attachment.fileName || '未知'} 缺少下载链接`);
          continue;
        }

        // 检查文件大小
        if (attachment.fileSize && attachment.fileSize > attachmentConfig.maxSize) {
          warnings.push(`附件 ${attachment.fileName || '未知'} 过大 (${Math.round(attachment.fileSize / 1024 / 1024)}MB)，已跳过`);
          continue;
        }

        // 下载文件
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          warnings.push(`附件 ${attachment.fileName || '未知'} 下载失败: ${response.status}`);
          continue;
        }

        const contentType = response.headers.get('content-type') || '';
        const contentLength = response.headers.get('content-length');

        // 检查下载后的文件大小
        if (contentLength) {
          const size = parseInt(contentLength, 10);
          if (size > attachmentConfig.maxSize) {
            warnings.push(`附件 ${attachment.fileName || '未知'} 过大 (${Math.round(size / 1024 / 1024)}MB)，已跳过`);
            continue;
          }
        }

        // 确定文件扩展名
        const extFromName = attachment.fileName ? extractExtension(attachment.fileName) : '';
        const extFromType = attachment.fileType ? normalizeExtension(attachment.fileType) : '';
        const extFromContent = contentType ? extensionFromContentType(contentType) : '';
        let ext = normalizeExtension(extFromName || extFromType || extFromContent);

        // 如果没有扩展名，根据类型推断
        if (!ext && attachment.type === 'image') {
          ext = '.jpg';
        } else if (!ext && attachment.type === 'file') {
          // 尝试从 URL 提取
          const urlFilename = extractFilenameFromUrl(downloadUrl);
          if (urlFilename) {
            ext = extractExtension(urlFilename);
          }
        }

        if (!ext || !ALLOWED_ATTACHMENT_EXTENSIONS.has(ext)) {
          console.log(`[企业微信] 不支持的附件格式: ext=${ext || 'unknown'}, contentType=${contentType}`);
          warnings.push(`附件格式不支持 (${ext || 'unknown'})，已跳过`);
          continue;
        }

        // 生成文件名
        const fileId = randomUUID();
        const filePath = path.join(ATTACHMENT_BASE_DIR, `${fileId}${ext}`);
        const rawName = attachment.fileName || extractFilenameFromUrl(downloadUrl) || `attachment${ext}`;
        const safeName = sanitizeFilename(rawName.endsWith(ext) ? rawName : `${rawName}${ext}`);

        // 写入临时文件
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        await fs.writeFile(filePath, buffer);

        // 转换为 base64 data URL
        const base64 = buffer.toString('base64');
        let mime = contentType.split(';')[0].trim();
        if (!mime || mime === 'application/octet-stream') {
          mime = mimeFromExtension(ext);
        }
        const dataUrl = `data:${mime};base64,${base64}`;

        parts.push({
          type: 'file',
          mime,
          url: dataUrl,
          filename: safeName
        });

        // 清理临时文件
        await fs.unlink(filePath).catch(() => {});

        console.log(`[企业微信] 附件处理成功: ${safeName} (${Math.round(buffer.length / 1024)}KB)`);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[企业微信] 附件处理失败:`, error);
        warnings.push(`附件 ${attachment.fileName || '未知'} 处理失败: ${errorMessage}`);
      }
    }

    return { parts, warnings };
  }
}

export const wecomHandler = new WeComHandler();
