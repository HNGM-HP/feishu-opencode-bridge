import {
  ActionRowBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { groupConfig, modelConfig } from '../config.js';
import { KNOWN_EFFORT_LEVELS, normalizeEffortLevel, stripPromptEffortPrefix, type EffortLevel } from '../commands/effort.js';
import { opencodeClient } from '../opencode/client.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { parseQuestionAnswerText } from '../opencode/question-parser.js';
import { questionHandler, type PendingQuestion } from '../opencode/question-handler.js';
import { permissionHandler } from '../permissions/handler.js';
import { chatSessionStore } from '../store/chat-session.js';
import { validateFilePath } from './file-sender.js';
import { DirectoryPolicy } from '../utils/directory-policy.js';
import type { PlatformMessageEvent, PlatformSender } from '../platform/types.js';

const PANEL_SELECT_PREFIX = 'oc_panel';
const BIND_SELECT_PREFIX = 'oc_bind';
const RENAME_MODAL_PREFIX = 'oc_rename';
const QUESTION_SELECT_PREFIX = 'oc_question';
const MODEL_SELECT_PREFIX = 'oc_model';
const AGENT_SELECT_PREFIX = 'oc_agent';
const RENAME_INPUT_ID = 'session_name';
const MAX_SESSION_OPTIONS = 25;
const MAX_MODEL_OPTIONS = 500;
const MODEL_PAGE_SIZE = 24;
const DISCORD_FILE_MAX_SIZE = 25 * 1024 * 1024;

type ParsedQuestionAnswer = NonNullable<ReturnType<typeof parseQuestionAnswerText>>;

function normalizeMessageText(value: string): string {
  return value.trim();
}

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

type DiscordCommand = {
  name: string;
  args: string;
};

function parseDiscordCommand(text: string): DiscordCommand | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  const commandPrefix = normalized.startsWith('///')
    ? '///'
    : normalized.startsWith('/')
      ? '/'
      : null;

  if (!commandPrefix) {
    return null;
  }

  const body = normalized.slice(commandPrefix.length).trim();
  if (!body) {
    return null;
  }

  const [name, ...rest] = body.split(/\s+/);
  return {
    name: name.toLowerCase(),
    args: rest.join(' ').trim(),
  };
}

function parseConversationIdFromCustomId(prefix: string, customId: string): string | null {
  const expectedPrefix = `${prefix}:`;
  if (!customId.startsWith(expectedPrefix)) {
    return null;
  }

  const value = customId.slice(expectedPrefix.length).trim();
  return value.length > 0 ? value : null;
}

function parseNaturalFileSendText(text: string): string | null {
  const matched = text.trim().match(/^发送文件\s+(.+)$/u);
  if (!matched) {
    return null;
  }

  const value = matched[1].trim();
  return value || null;
}

class DiscordHandler {
  constructor(private readonly sender: PlatformSender) {}

  private shortenId(value: string | undefined): string {
    if (!value) {
      return '000000';
    }

    const normalized = value.replace(/[^a-zA-Z0-9]/g, '');
    if (!normalized) {
      return '000000';
    }

    return normalized.slice(0, 6);
  }

  private shortenSessionId(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return '000000';
    }

    const withoutPrefix = trimmed.replace(/^[a-zA-Z_\-]+/, '');
    const normalized = (withoutPrefix || trimmed).replace(/[^a-zA-Z0-9]/g, '');
    if (!normalized) {
      return this.shortenId(trimmed);
    }

    return normalized.slice(0, 6).toLowerCase();
  }

  private buildChannelNameBySessionId(sessionId: string): string {
    return `opencode${this.shortenSessionId(sessionId)}`;
  }

  private buildSessionTitleBySessionId(chatType: 'p2p' | 'group', sessionId: string): string {
    const mode = chatType === 'p2p' ? '私聊' : '群聊';
    return `Discord ${mode} ${this.shortenSessionId(sessionId)}`;
  }

  private isUnknownInteractionError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const record = error as Record<string, unknown>;
    return Number(record.code) === 10062;
  }

  private async safeInteractionReply(
    interaction: StringSelectMenuInteraction | ModalSubmitInteraction,
    content: string,
    options?: { components?: ActionRowBuilder<StringSelectMenuBuilder>[] }
  ): Promise<void> {
    const replyPayload = {
      content,
      ...(options?.components ? { components: options.components } : {}),
      flags: MessageFlags.Ephemeral as const,
    };
    const editPayload = {
      content,
      ...(options?.components ? { components: options.components } : {}),
    };

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(editPayload);
      } else {
        await interaction.reply(replyPayload);
      }
    } catch (error) {
      if (this.isUnknownInteractionError(error) && interaction.channelId) {
        await this.sender.sendText(interaction.channelId, content);
        return;
      }

      throw error;
    }
  }

  private async deferInteractionReply(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.deferred || interaction.replied) {
      return true;
    }

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return true;
    } catch (error) {
      if (this.isUnknownInteractionError(error)) {
        if (interaction.channelId) {
          await this.sender.sendText(interaction.channelId, '⚠️ 交互已过期，请重新执行命令。');
        }
        return false;
      }

      throw error;
    }
  }

  private getRawDiscordMessage(event: PlatformMessageEvent): Message | null {
    if (!event.rawEvent || typeof event.rawEvent !== 'object') {
      return null;
    }

    const raw = event.rawEvent as Message;
    if (typeof raw.channelId !== 'string') {
      return null;
    }

    return raw;
  }

  private buildDefaultSessionTitle(
    event: PlatformMessageEvent,
    conversationIdOverride?: string
  ): string {
    const channelShort = this.shortenId(conversationIdOverride || event.conversationId);
    if (event.chatType === 'p2p') {
      const privateIdShort = this.shortenId(event.senderId);
      return `Discord 私聊 ${privateIdShort} ${channelShort}`;
    }

    const rawMessage = this.getRawDiscordMessage(event);
    const guildShort = this.shortenId(rawMessage?.guildId || undefined);
    return `Discord 群聊 ${guildShort} ${channelShort}`;
  }

  private buildDefaultSessionTitleFromInteraction(
    interaction: StringSelectMenuInteraction,
    conversationIdOverride?: string
  ): string {
    const channelShort = this.shortenId(conversationIdOverride || interaction.channelId);
    if (!interaction.guildId) {
      return `Discord 私聊 ${this.shortenId(interaction.user.id)} ${channelShort}`;
    }

    return `Discord 群聊 ${this.shortenId(interaction.guildId)} ${channelShort}`;
  }

  private getPermissionQueueKey(event: PlatformMessageEvent): string {
    return `discord:${event.conversationId}`;
  }

  private resolvePermissionDirectoryOptions(
    sessionId: string,
    conversationId: string
  ): { directory?: string; fallbackDirectories?: string[] } {
    const currentSession = chatSessionStore.getSessionByConversation('discord', conversationId);
    const conversation = chatSessionStore.getConversationBySessionId(sessionId);
    const boundSession = conversation
      ? chatSessionStore.getSessionByConversation(conversation.platform, conversation.conversationId)
      : undefined;

    const directory = boundSession?.resolvedDirectory
      || currentSession?.resolvedDirectory
      || boundSession?.defaultDirectory
      || currentSession?.defaultDirectory;

    const fallbackDirectories = Array.from(
      new Set(
        [
          boundSession?.resolvedDirectory,
          boundSession?.defaultDirectory,
          currentSession?.resolvedDirectory,
          currentSession?.defaultDirectory,
          ...chatSessionStore.getKnownDirectories(),
        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    );

    return {
      ...(directory ? { directory } : {}),
      ...(fallbackDirectories.length > 0 ? { fallbackDirectories } : {}),
    };
  }

  private shouldSkipMessage(event: PlatformMessageEvent, text: string): boolean {
    if (event.senderType === 'bot') {
      return true;
    }

    if (event.chatType === 'group' && groupConfig.requireMentionInGroup) {
      if (!event.mentions || event.mentions.length === 0) {
        return true;
      }
    }

    if (!text && (!event.attachments || event.attachments.length === 0)) {
      return true;
    }

    return false;
  }

  private getQuestionBufferKey(conversationId: string): string {
    return `chat:discord:${conversationId}`;
  }

  private touchQuestionBuffer(conversationId: string): void {
    const bufferKey = this.getQuestionBufferKey(conversationId);
    if (outputBuffer.get(bufferKey)) {
      outputBuffer.touch(bufferKey);
    }
  }

  private getPendingQuestionByConversation(conversationId: string): PendingQuestion | null {
    const sessionId = chatSessionStore.getSessionIdByConversation('discord', conversationId);
    if (!sessionId) {
      return null;
    }

    const pending = questionHandler.getBySession(sessionId);
    if (!pending || pending.chatId !== conversationId) {
      return null;
    }

    return pending;
  }

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

  private async submitPendingQuestion(
    pending: PendingQuestion,
    notify: (text: string) => Promise<void>
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

    const success = await opencodeClient.replyQuestion(pending.request.id, answers);
    if (!success) {
      await notify('⚠️ 回答提交失败，请稍后重试。');
      return;
    }

    questionHandler.remove(pending.request.id);
    this.touchQuestionBuffer(pending.chatId);
    await notify('✅ 已提交问题回答，任务继续执行。');
  }

  private async applyPendingQuestionAnswer(
    pending: PendingQuestion,
    parsed: ParsedQuestionAnswer,
    rawText: string,
    notify: (text: string) => Promise<void>
  ): Promise<void> {
    const questionCount = pending.request.questions.length;
    if (questionCount === 0) {
      await notify('当前问题状态异常，请稍后重试。');
      return;
    }

    const currentIndex = Math.min(Math.max(pending.currentQuestionIndex, 0), questionCount - 1);
    this.updateDraftAnswerFromParsed(pending, currentIndex, parsed, rawText);

    const nextIndex = currentIndex + 1;
    if (nextIndex < questionCount) {
      questionHandler.setCurrentQuestionIndex(pending.request.id, nextIndex);
      this.touchQuestionBuffer(pending.chatId);
      await notify(`✅ 已记录第 ${currentIndex + 1}/${questionCount} 题，请继续回答下一题。`);
      return;
    }

    await this.submitPendingQuestion(pending, notify);
  }

  private async getOrCreateSession(
    event: PlatformMessageEvent,
    titleOverride?: string,
    directoryOverride?: string
  ): Promise<string | null> {
    const existing = chatSessionStore.getSessionIdByConversation('discord', event.conversationId);
    if (existing) {
      return existing;
    }

    const isGroup = event.chatType === 'group';
    const title = titleOverride?.trim() || this.buildDefaultSessionTitle(event);
    const session = await opencodeClient.createSession(title, directoryOverride);
    if (!session?.id) {
      return null;
    }

    const finalTitle = this.buildSessionTitleBySessionId(isGroup ? 'group' : 'p2p', session.id);
    await opencodeClient.updateSession(session.id, finalTitle).catch(() => false);

    chatSessionStore.setSessionByConversation(
      'discord',
      event.conversationId,
      session.id,
      event.senderId,
      finalTitle,
      {
        chatType: isGroup ? 'group' : 'p2p',
        resolvedDirectory: session.directory,
      }
    );

    // 新创建会话，发送帮助和提醒消息
    await this.safeReply(event, this.getDiscordHelpText());
    await this.safeReply(event, '当前会话未与opencode绑定，已新建会话并绑定如需切换请按照help提示操作');

    // 标记提醒已发送（失败不阻断主流程）
    try {
      chatSessionStore.markReminderSent('discord', event.conversationId);
    } catch {
      // 忽略元数据写入失败
    }

    return session.id;
  }

  private async bindSessionToConversation(
    conversationId: string,
    sessionId: string,
    userId: string,
    title?: string,
    chatType: 'group' | 'p2p' = 'group',
    resolvedDirectory?: string,
    options?: { protectSessionDelete?: boolean; defaultDirectory?: string }
  ): Promise<void> {
    chatSessionStore.setSessionByConversation(
      'discord',
      conversationId,
      sessionId,
      userId,
      title,
      {
        chatType,
        ...(resolvedDirectory ? { resolvedDirectory } : {}),
        ...(options?.protectSessionDelete ? { protectSessionDelete: true } : {}),
      }
    );

    if (options && 'defaultDirectory' in options) {
      chatSessionStore.updateConfigByConversation('discord', conversationId, {
        defaultDirectory: options.defaultDirectory,
      });
    }
  }

  private async safeReply(event: PlatformMessageEvent, text: string): Promise<void> {
    await this.sender.sendText(event.conversationId, text);
  }

  private async safeReplyCard(event: PlatformMessageEvent, card: object): Promise<void> {
    await this.sender.sendCard(event.conversationId, card);
  }

  private parseProviderModel(value?: string): { providerId: string; modelId: string } | null {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const separator = trimmed.includes(':') ? ':' : (trimmed.includes('/') ? '/' : '');
    if (!separator) {
      return null;
    }

    const splitIndex = trimmed.indexOf(separator);
    const providerId = trimmed.slice(0, splitIndex).trim();
    const modelId = trimmed.slice(splitIndex + 1).trim();
    if (!providerId || !modelId) {
      return null;
    }

    return { providerId, modelId };
  }

  private async resolveCompactModel(conversationId: string): Promise<{ providerId: string; modelId: string } | null> {
    const session = chatSessionStore.getSessionByConversation('discord', conversationId);
    const preferred = this.parseProviderModel(session?.preferredModel);
    if (preferred) {
      return preferred;
    }

    if (modelConfig.defaultProvider && modelConfig.defaultModel) {
      return {
        providerId: modelConfig.defaultProvider,
        modelId: modelConfig.defaultModel,
      };
    }

    const providerPayload = await opencodeClient.getProviders();
    const providers = Array.isArray(providerPayload.providers) ? providerPayload.providers : [];
    for (const provider of providers) {
      if (!provider || typeof provider !== 'object') {
        continue;
      }

      const record = provider as Record<string, unknown>;
      const providerId = typeof record.id === 'string' ? record.id.trim() : '';
      if (!providerId) {
        continue;
      }

      const modelsRaw = record.models;
      const modelList = Array.isArray(modelsRaw)
        ? modelsRaw
        : (modelsRaw && typeof modelsRaw === 'object' ? Object.values(modelsRaw) : []);

      for (const modelItem of modelList) {
        if (!modelItem || typeof modelItem !== 'object') {
          continue;
        }

        const modelRecord = modelItem as Record<string, unknown>;
        const modelId = typeof modelRecord.id === 'string' ? modelRecord.id.trim() : '';
        if (modelId) {
          return { providerId, modelId };
        }
      }
    }

    return null;
  }

  private async buildAllModelOptions(limit: number = MAX_MODEL_OPTIONS): Promise<Array<{ label: string; value: string; description?: string }>> {
    const providerPayload = await opencodeClient.getProviders().catch(() => ({ providers: [] }));
    const providers = Array.isArray(providerPayload.providers) ? providerPayload.providers : [];
    const options: Array<{ label: string; value: string; description?: string }> = [];
    const seen = new Set<string>();

    for (const provider of providers) {
      if (!provider || typeof provider !== 'object') {
        continue;
      }

      const providerRecord = provider as Record<string, unknown>;
      const providerId = typeof providerRecord.id === 'string' ? providerRecord.id.trim() : '';
      const providerName = typeof providerRecord.name === 'string' ? providerRecord.name.trim() : providerId;
      if (!providerId) {
        continue;
      }

      const modelsRaw = providerRecord.models;
      const modelList = Array.isArray(modelsRaw)
        ? modelsRaw
        : (modelsRaw && typeof modelsRaw === 'object' ? Object.values(modelsRaw) : []);

      for (const modelItem of modelList) {
        if (!modelItem || typeof modelItem !== 'object') {
          continue;
        }

        const modelRecord = modelItem as Record<string, unknown>;
        const modelId = typeof modelRecord.id === 'string'
          ? modelRecord.id.trim()
          : (typeof modelRecord.modelID === 'string' ? modelRecord.modelID.trim() : '');
        if (!modelId) {
          continue;
        }

        const value = `${providerId}:${modelId}`;
        if (seen.has(value)) {
          continue;
        }
        seen.add(value);

        const rawName = typeof modelRecord.name === 'string' && modelRecord.name.trim()
          ? modelRecord.name.trim()
          : modelId;
        options.push({
          label: rawName.slice(0, 100),
          value,
          description: providerName.slice(0, 100),
        });

        if (options.length >= limit) {
          return options;
        }
      }
    }

    return options;
  }

  private async buildModelSelectOptions(page: number = 1): Promise<{
    options: Array<{ label: string; value: string; description?: string }>;
    currentPage: number;
    totalPages: number;
    totalCount: number;
  }> {
    const allOptions = await this.buildAllModelOptions();
    if (allOptions.length === 0) {
      return {
        options: [],
        currentPage: 1,
        totalPages: 1,
        totalCount: 0,
      };
    }

    const totalPages = Math.max(1, Math.ceil(allOptions.length / MODEL_PAGE_SIZE));
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const start = (currentPage - 1) * MODEL_PAGE_SIZE;
    const end = start + MODEL_PAGE_SIZE;
    return {
      options: allOptions.slice(start, end),
      currentPage,
      totalPages,
      totalCount: allOptions.length,
    };
  }

  private async buildAgentSelectOptions(limit: number = 24): Promise<Array<{ label: string; value: string; description?: string }>> {
    const agents = await opencodeClient.getAgents().catch(() => [] as Array<{ name: string; hidden?: boolean; mode?: 'primary' | 'subagent'; description?: string }>);
    const visible = agents.filter(agent => agent.hidden !== true && !['compaction', 'title', 'summary'].includes(agent.name));
    const options: Array<{ label: string; value: string; description?: string }> = [];

    options.push({
      label: '默认角色',
      value: 'none',
      description: '跟随 OpenCode 默认角色',
    });

    for (const agent of visible.slice(0, limit)) {
      const modePrefix = agent.mode === 'subagent' ? '子' : '主';
      options.push({
        label: `${modePrefix}:${agent.name}`.slice(0, 100),
        value: agent.name,
        description: (agent.description || agent.name).slice(0, 100),
      });
    }

    return options.slice(0, 25);
  }

  private buildEffortSelectOptions(): Array<{ label: string; value: string; description?: string }> {
    const levels = ['none', ...KNOWN_EFFORT_LEVELS.filter(level => level !== 'none')];
    return levels.map(level => ({
      label: level === 'none' ? '默认（自动）' : level,
      value: level,
      description: level === 'none' ? '清除会话强度设置' : `设置为 ${level}`,
    }));
  }

  private parseNewSessionArgs(args: string): { title?: string; directoryInput?: string } {
    const raw = args.trim();
    if (!raw) {
      return {};
    }

    const dirInlineMatch = raw.match(/^(.*?)(?:\s+--dir=(.+))$/u);
    if (dirInlineMatch) {
      const title = dirInlineMatch[1].trim();
      const directoryInput = dirInlineMatch[2].trim();
      return {
        ...(title ? { title } : {}),
        ...(directoryInput ? { directoryInput } : {}),
      };
    }

    const dirSplitMatch = raw.match(/^(.*?)(?:\s+--dir\s+(.+))$/u);
    if (dirSplitMatch) {
      const title = dirSplitMatch[1].trim();
      const directoryInput = dirSplitMatch[2].trim();
      return {
        ...(title ? { title } : {}),
        ...(directoryInput ? { directoryInput } : {}),
      };
    }

    return { title: raw };
  }

  private resolveDirectoryInput(
    event: PlatformMessageEvent,
    directoryInput?: string
  ): { ok: true; directory?: string; projectName?: string } | { ok: false; message: string } {
    const current = chatSessionStore.getSessionByConversation('discord', event.conversationId);
    const normalizedInput = directoryInput?.trim();
    const explicitDirectory = normalizedInput && path.isAbsolute(normalizedInput)
      ? normalizedInput
      : undefined;
    const aliasName = normalizedInput && !path.isAbsolute(normalizedInput)
      ? normalizedInput
      : undefined;

    const result = DirectoryPolicy.resolve({
      explicitDirectory,
      aliasName,
      chatDefaultDirectory: current?.defaultDirectory,
    });

    if (!result.ok) {
      return { ok: false, message: result.userMessage };
    }

    const directory = result.source === 'server_default' ? undefined : result.directory;
    return {
      ok: true,
      ...(directory ? { directory } : {}),
      ...(result.projectName ? { projectName: result.projectName } : {}),
    };
  }

  private async sendFileToDiscord(event: PlatformMessageEvent, rawPath: string): Promise<void> {
    const normalized = rawPath.trim();
    if (!normalized) {
      await this.safeReply(event, '用法：`///send <绝对路径>` 或 `发送文件 <绝对路径>`');
      return;
    }

    const resolvedPath = path.resolve(normalized);
    const fileName = path.basename(resolvedPath);
    const validation = validateFilePath(resolvedPath);
    if (!validation.safe) {
      await this.safeReply(event, `❌ 文件发送被拒绝: ${validation.reason || '路径不安全'}`);
      return;
    }

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(resolvedPath);
    } catch {
      await this.safeReply(event, `❌ 文件不存在: ${fileName}`);
      return;
    }

    if (!stat.isFile()) {
      await this.safeReply(event, `❌ 路径不是文件: ${fileName}`);
      return;
    }

    if (stat.size === 0) {
      await this.safeReply(event, '❌ 不允许发送空文件。');
      return;
    }

    if (stat.size > DISCORD_FILE_MAX_SIZE) {
      await this.safeReply(event, `❌ 文件过大（${(stat.size / (1024 * 1024)).toFixed(1)}MB），超过 25MB 限制。`);
      return;
    }

    const rawMessage = this.getRawDiscordMessage(event);
    if (!rawMessage || !rawMessage.channel || !('send' in rawMessage.channel)) {
      await this.safeReply(event, '❌ 当前上下文不支持发送文件。');
      return;
    }

    try {
      const channel = rawMessage.channel as { send: (payload: { files: string[] }) => Promise<unknown> };
      await channel.send({ files: [resolvedPath] });
      await this.safeReply(event, `✅ 已发送文件: ${fileName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.safeReply(event, `❌ 发送失败: ${message}`);
    }
  }

  private async handleSessionCommand(event: PlatformMessageEvent): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation('discord', event.conversationId);
    if (!sessionId) {
      await this.safeReply(event, '当前频道尚未绑定会话，发送任意消息会自动创建会话。');
      return;
    }
    await this.safeReply(event, `当前会话: ${sessionId}`);
  }

  private async handleNewSessionCommand(event: PlatformMessageEvent, rawArgs?: string): Promise<void> {
    const parsed = this.parseNewSessionArgs(rawArgs || '');
    const title = parsed.title?.trim() || this.buildDefaultSessionTitle(event);
    const directoryResolved = this.resolveDirectoryInput(event, parsed.directoryInput);
    if (!directoryResolved.ok) {
      await this.safeReply(event, directoryResolved.message);
      return;
    }

    const session = await opencodeClient.createSession(title, directoryResolved.directory);
    if (!session?.id) {
      await this.safeReply(event, '❌ 创建会话失败，请稍后重试。');
      return;
    }

    const finalTitle = this.buildSessionTitleBySessionId(
      event.chatType === 'group' ? 'group' : 'p2p',
      session.id
    );
    await opencodeClient.updateSession(session.id, finalTitle).catch(() => false);

    await this.bindSessionToConversation(
      event.conversationId,
      session.id,
      event.senderId,
      finalTitle,
      event.chatType === 'group' ? 'group' : 'p2p',
      session.directory,
      {
        ...(directoryResolved.directory ? { defaultDirectory: directoryResolved.directory } : {}),
      }
    );
    await this.safeReply(event, `✅ 已创建并绑定新会话: ${session.id}`);
  }

  private async handleUnbindCommand(event: PlatformMessageEvent): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation('discord', event.conversationId);
    if (!sessionId) {
      await this.safeReply(event, '当前频道没有可解绑会话。');
      return;
    }

    chatSessionStore.removeSessionByConversation('discord', event.conversationId);
    await this.safeReply(event, `✅ 已解绑当前频道会话: ${sessionId}`);
  }

  private async handleNewChannelCommand(event: PlatformMessageEvent, rawArgs?: string): Promise<void> {
    const rawMessage = this.getRawDiscordMessage(event);
    if (!rawMessage || !rawMessage.guild || event.chatType === 'p2p') {
      await this.safeReply(event, '该命令仅支持在服务器频道中执行。');
      return;
    }

    const parsed = this.parseNewSessionArgs(rawArgs || '');
    const initialTitle = parsed.title?.trim() || this.buildDefaultSessionTitle(event);
    const directoryResolved = this.resolveDirectoryInput(event, parsed.directoryInput);
    if (!directoryResolved.ok) {
      await this.safeReply(event, directoryResolved.message);
      return;
    }

    const session = await opencodeClient.createSession(initialTitle, directoryResolved.directory);
    if (!session?.id) {
      await this.safeReply(event, '❌ 创建会话失败，请稍后重试。');
      return;
    }

    const guild = rawMessage.guild;
    const parentId = 'parentId' in rawMessage.channel ? rawMessage.channel.parentId : null;
    const botId = rawMessage.client.user?.id;
    const channelName = this.buildChannelNameBySessionId(session.id);

    try {
      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        ...(parentId ? { parent: parentId } : {}),
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: event.senderId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
          ...(botId
            ? [{
                id: botId,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.ReadMessageHistory,
                  PermissionFlagsBits.ManageChannels,
                ],
              }]
            : []),
        ],
        topic: `oc-session:${session.id}`,
      });

      const finalTitle = this.buildSessionTitleBySessionId('group', session.id);
      await opencodeClient.updateSession(session.id, finalTitle).catch(() => false);
      await this.bindSessionToConversation(
        channel.id,
        session.id,
        event.senderId,
        finalTitle,
        'group',
        session.directory,
        {
          ...(directoryResolved.directory ? { defaultDirectory: directoryResolved.directory } : {}),
        }
      );

      await this.sender.sendText(channel.id, `✅ 已绑定 OpenCode 会话: ${session.id}`);
      await this.safeReply(event, `✅ 已创建会话频道 <#${channel.id}> 并绑定会话: ${session.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.bindSessionToConversation(
        event.conversationId,
        session.id,
        event.senderId,
        initialTitle,
        event.chatType === 'group' ? 'group' : 'p2p',
        session.directory,
        {
          ...(directoryResolved.directory ? { defaultDirectory: directoryResolved.directory } : {}),
        }
      );
      await this.safeReply(
        event,
        `⚠️ 创建频道失败（需 Discord 管理频道/权限覆盖权限），已回退为当前频道绑定会话: ${session.id}\n${message}`
      );
    }
  }

  private async handleClearCommand(event: PlatformMessageEvent): Promise<void> {
    const current = chatSessionStore.getSessionByConversation('discord', event.conversationId);
    if (!current?.sessionId) {
      await this.safeReply(event, '当前频道没有活跃会话。');
      return;
    }

    const shouldDeleteSession = current.protectSessionDelete !== true;
    const deleted = shouldDeleteSession
      ? await opencodeClient.deleteSession(current.sessionId, current.resolvedDirectory ? { directory: current.resolvedDirectory } : undefined)
      : true;
    chatSessionStore.removeSessionByConversation('discord', event.conversationId);
    const deletedChannel = await this.tryDeleteDedicatedChannel(event);

    if (deleted) {
      if (deletedChannel) {
        return;
      }
      await this.safeReply(
        event,
        shouldDeleteSession
          ? '🧹 已清理当前会话并解绑频道。'
          : '🧹 已解绑当前频道（该会话为外部绑定，未删除 OpenCode 会话）。'
      );
      return;
    }

    await this.safeReply(event, '⚠️ 频道绑定已清理，但 OpenCode 会话删除失败，请稍后手动检查。');
  }

  private async handleStopCommand(event: PlatformMessageEvent): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation('discord', event.conversationId);
    if (!sessionId) {
      await this.safeReply(event, '当前频道没有活跃会话。');
      return;
    }

    const aborted = await opencodeClient.abortSession(sessionId);
    if (aborted) {
      await this.safeReply(event, `✅ 已停止会话: ${sessionId}`);
    } else {
      await this.safeReply(event, `⚠️ 停止失败，会话可能已结束。`);
    }
  }


  private async tryDeleteDedicatedChannel(event: PlatformMessageEvent): Promise<boolean> {
    const rawMessage = this.getRawDiscordMessage(event);
    if (!rawMessage || !rawMessage.guild || rawMessage.channel.type !== ChannelType.GuildText) {
      return false;
    }

    if (!rawMessage.channel.topic?.startsWith('oc-session:')) {
      return false;
    }

    try {
      await rawMessage.channel.delete('OpenCode 会话频道已清理');
      return true;
    } catch (error) {
      console.warn('[Discord] 删除会话频道失败:', error);
      return false;
    }
  }

  private async handleBindCommand(event: PlatformMessageEvent, sessionId: string): Promise<void> {
    const normalized = sessionId.trim();
    if (!normalized) {
      await this.safeReply(event, '用法：`///bind <sessionId>`');
      return;
    }

    const target = await opencodeClient.findSessionAcrossProjects(normalized);
    if (!target) {
      await this.safeReply(event, `❌ 未找到会话: ${normalized}`);
      return;
    }

    await this.bindSessionToConversation(
      event.conversationId,
      target.id,
      event.senderId,
      target.title,
      event.chatType === 'group' ? 'group' : 'p2p',
      target.directory,
      {
        protectSessionDelete: true,
        ...(target.directory ? { defaultDirectory: target.directory } : {}),
      }
    );
    await this.safeReply(event, `✅ 已绑定会话: ${target.id}`);
  }

  private async handleRenameCommand(event: PlatformMessageEvent, title: string): Promise<void> {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      await this.safeReply(event, '用法：`///rename <新会话名称>`');
      return;
    }

    const current = chatSessionStore.getSessionByConversation('discord', event.conversationId);
    if (!current?.sessionId) {
      await this.safeReply(event, '当前频道尚未绑定会话。');
      return;
    }

    const updated = await opencodeClient.updateSession(current.sessionId, normalizedTitle);
    if (!updated) {
      await this.safeReply(event, '❌ 重命名失败，请稍后重试。');
      return;
    }

    await this.bindSessionToConversation(
      event.conversationId,
      current.sessionId,
      current.creatorId || event.senderId,
      normalizedTitle,
      current.chatType === 'p2p' ? 'p2p' : 'group',
      current.resolvedDirectory,
      {
        ...(current.protectSessionDelete ? { protectSessionDelete: true } : {}),
        ...(current.defaultDirectory ? { defaultDirectory: current.defaultDirectory } : {}),
      }
    );
    await this.safeReply(event, `✅ 会话已重命名为：${normalizedTitle}`);
  }

  private async handleSessionsCommand(event: PlatformMessageEvent): Promise<void> {
    const sessions = await opencodeClient.listSessionsAcrossProjects();
    if (!sessions.length) {
      await this.safeReply(event, '当前没有可绑定的历史会话。');
      return;
    }

    const lines = sessions.slice(0, 8).map((session, index) => {
      const title = session.title || '未命名会话';
      const directory = session.directory || '-';
      return `${index + 1}. ${title}\n   ${session.id}\n   工作区: ${directory}`;
    });
    await this.safeReply(event, `可绑定会话（最近 8 条）:\n${lines.join('\n')}`);
  }

  private async handleWorkdirCommand(event: PlatformMessageEvent, rawArgs: string): Promise<void> {
    const input = rawArgs.trim();
    const current = chatSessionStore.getSessionByConversation('discord', event.conversationId);
    if (!input) {
      const defaultDirectory = current?.defaultDirectory || '(未设置)';
      const resolvedDirectory = current?.resolvedDirectory || '(跟随会话目录)';
      await this.safeReply(event, `当前工作目录配置\n- 默认目录: ${defaultDirectory}\n- 会话目录: ${resolvedDirectory}`);
      return;
    }

    const normalized = input.toLowerCase();
    if (normalized === 'clear' || normalized === 'default' || normalized === 'none') {
      if (!current) {
        await this.safeReply(event, '当前频道尚未绑定会话。');
        return;
      }
      chatSessionStore.updateConfigByConversation('discord', event.conversationId, { defaultDirectory: undefined });
      await this.safeReply(event, '✅ 已清除默认工作目录。');
      return;
    }

    const resolved = this.resolveDirectoryInput(event, input);
    if (!resolved.ok) {
      await this.safeReply(event, resolved.message);
      return;
    }

    if (current) {
      chatSessionStore.updateConfigByConversation('discord', event.conversationId, {
        defaultDirectory: resolved.directory,
      });
      await this.safeReply(event, `✅ 已设置默认工作目录: ${resolved.directory || '(跟随服务端默认)'}`);
      return;
    }

    const title = this.buildDefaultSessionTitle(event);
    const session = await opencodeClient.createSession(title, resolved.directory);
    if (!session?.id) {
      await this.safeReply(event, '❌ 创建会话失败，无法设置工作目录。');
      return;
    }

    const finalTitle = this.buildSessionTitleBySessionId(
      event.chatType === 'group' ? 'group' : 'p2p',
      session.id
    );
    await opencodeClient.updateSession(session.id, finalTitle).catch(() => false);

    await this.bindSessionToConversation(
      event.conversationId,
      session.id,
      event.senderId,
      finalTitle,
      event.chatType === 'group' ? 'group' : 'p2p',
      session.directory,
      {
        ...(resolved.directory ? { defaultDirectory: resolved.directory } : {}),
      }
    );

    await this.safeReply(event, `✅ 已创建并绑定会话，同时设置默认工作目录: ${resolved.directory || '(跟随服务端默认)'}`);
  }

  private async handleUndoCommand(event: PlatformMessageEvent): Promise<void> {
    const result = await this.performUndo(event.conversationId);
    await this.safeReply(event, result.message);
  }

  private async performUndo(conversationId: string): Promise<{ ok: boolean; message: string }> {
    const current = chatSessionStore.getSessionByConversation('discord', conversationId);
    if (!current?.sessionId) {
      return { ok: false, message: '当前频道没有活跃会话。' };
    }

    try {
      const messages = await opencodeClient.getSessionMessages(current.sessionId);
      if (!Array.isArray(messages) || messages.length === 0) {
        return { ok: false, message: '⚠️ 没有可回撤的消息。' };
      }

      const lastMessage = messages[messages.length - 1];
      const prevMessage = messages.length >= 2 ? messages[messages.length - 2] : undefined;
      const targetId = (() => {
        const prevInfo = prevMessage?.info as Record<string, unknown> | undefined;
        const lastInfo = lastMessage.info as Record<string, unknown>;
        if (prevInfo && typeof prevInfo.id === 'string' && prevInfo.id.trim()) {
          return prevInfo.id.trim();
        }
        if (typeof lastInfo.id === 'string' && lastInfo.id.trim()) {
          return lastInfo.id.trim();
        }
        return '';
      })();

      if (!targetId) {
        return { ok: false, message: '❌ 回撤失败: 未找到可回撤消息 ID。' };
      }

      const reverted = await opencodeClient.revertMessage(current.sessionId, targetId);
      if (!reverted) {
        return { ok: false, message: '❌ 回撤失败: OpenCode 回撤请求未生效。' };
      }

      return { ok: true, message: '✅ 已执行回撤。' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `❌ 回撤失败: ${message}` };
    }
  }

  private async handleCompactCommand(event: PlatformMessageEvent): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation('discord', event.conversationId);
    if (!sessionId) {
      await this.safeReply(event, '当前频道没有活跃会话。');
      return;
    }

    const model = await this.resolveCompactModel(event.conversationId);
    if (!model) {
      await this.safeReply(event, '❌ 未找到可用模型，无法执行上下文压缩。');
      return;
    }

    const compacted = await opencodeClient.summarizeSession(sessionId, model.providerId, model.modelId);
    if (!compacted) {
      await this.safeReply(event, `❌ 上下文压缩失败（模型: ${model.providerId}:${model.modelId}）`);
      return;
    }

    await this.safeReply(event, `✅ 上下文压缩完成（模型: ${model.providerId}:${model.modelId}）`);
  }

  private sortEffortLevels(values: EffortLevel[]): EffortLevel[] {
    const order = new Map<string, number>();
    KNOWN_EFFORT_LEVELS.forEach((level, index) => {
      order.set(level, index);
    });

    return [...values].sort((left, right) => {
      const leftOrder = order.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(right) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.localeCompare(right);
    });
  }

  private parseModelEffortVariants(modelRecord: Record<string, unknown>): EffortLevel[] {
    const variants = modelRecord.variants;
    if (!variants || typeof variants !== 'object' || Array.isArray(variants)) {
      return [];
    }

    const result: EffortLevel[] = [];
    for (const key of Object.keys(variants as Record<string, unknown>)) {
      const normalized = normalizeEffortLevel(key);
      if (!normalized || normalized === 'none' || result.includes(normalized)) {
        continue;
      }
      result.push(normalized);
    }

    return this.sortEffortLevels(result);
  }

  private async getEffortSupportInfo(conversationId: string): Promise<{
    modelLabel: string;
    supportedEfforts: EffortLevel[];
  }> {
    const model = await this.resolveCompactModel(conversationId);
    if (!model) {
      return {
        modelLabel: '未知',
        supportedEfforts: [],
      };
    }

    const providersPayload = await opencodeClient.getProviders();
    const providers = Array.isArray(providersPayload.providers) ? providersPayload.providers : [];
    const providerLower = model.providerId.toLowerCase();
    const modelLower = model.modelId.toLowerCase();

    for (const provider of providers) {
      if (!provider || typeof provider !== 'object') {
        continue;
      }

      const providerRecord = provider as Record<string, unknown>;
      const providerId = typeof providerRecord.id === 'string' ? providerRecord.id.trim() : '';
      if (!providerId || providerId.toLowerCase() !== providerLower) {
        continue;
      }

      const modelsRaw = providerRecord.models;
      const modelList = Array.isArray(modelsRaw)
        ? modelsRaw
        : (modelsRaw && typeof modelsRaw === 'object' ? Object.values(modelsRaw) : []);

      for (const modelItem of modelList) {
        if (!modelItem || typeof modelItem !== 'object') {
          continue;
        }

        const modelRecord = modelItem as Record<string, unknown>;
        const modelId = typeof modelRecord.id === 'string'
          ? modelRecord.id.trim()
          : (typeof modelRecord.modelID === 'string' ? modelRecord.modelID.trim() : '');
        if (!modelId || modelId.toLowerCase() !== modelLower) {
          continue;
        }

        return {
          modelLabel: `${model.providerId}:${model.modelId}`,
          supportedEfforts: this.parseModelEffortVariants(modelRecord),
        };
      }
    }

    return {
      modelLabel: `${model.providerId}:${model.modelId}`,
      supportedEfforts: [],
    };
  }

  private async handleEffortCommand(event: PlatformMessageEvent, rawArgs: string): Promise<void> {
    const currentSessionId = await this.getOrCreateSession(event);
    if (!currentSessionId) {
      await this.safeReply(event, '❌ 无法创建会话以设置强度。');
      return;
    }

    const current = chatSessionStore.getSessionByConversation('discord', event.conversationId);
    const currentEffort = current?.preferredEffort || '默认（自动）';
    const args = rawArgs.trim();

    if (!args) {
      await this.safeReply(
        event,
        [
          `当前强度: ${currentEffort}`,
          '用法: ///effort <档位|default>，例如 ///effort high',
          '临时覆盖: #xhigh 帮我深度分析这段代码',
        ].join('\n')
      );
      return;
    }

    const normalized = args.toLowerCase();
    if (normalized === 'default' || normalized === 'clear' || normalized === 'none') {
      chatSessionStore.updateConfigByConversation('discord', event.conversationId, { preferredEffort: undefined });
      await this.safeReply(event, '✅ 已清除会话强度，恢复模型默认。');
      return;
    }

    const level = normalizeEffortLevel(normalized);
    if (!level || level === 'none') {
      await this.safeReply(event, `❌ 不支持的强度: ${args}`);
      return;
    }

    const support = await this.getEffortSupportInfo(event.conversationId);
    if (support.supportedEfforts.length > 0 && !support.supportedEfforts.includes(level)) {
      await this.safeReply(
        event,
        `❌ 当前模型不支持强度 ${level}\n当前模型: ${support.modelLabel}\n可用强度: ${support.supportedEfforts.join(' / ')}`
      );
      return;
    }

    chatSessionStore.updateConfigByConversation('discord', event.conversationId, { preferredEffort: level });
    await this.safeReply(event, `✅ 已设置会话强度: ${level}`);
  }

  private parseCreateChatArgs(rawArgs: string): {
    category: 'all' | 'session' | 'model' | 'agent' | 'effort';
    page: number;
  } {
    const normalized = rawArgs.trim();
    if (!normalized) {
      return { category: 'all', page: 1 };
    }

    const [first, second] = normalized.split(/\s+/, 2);
    const key = first.toLowerCase();
    if (key === 'session' || key === '会话') {
      return { category: 'session', page: 1 };
    }

    if (key === 'model' || key === '模型') {
      const page = Number(second);
      return {
        category: 'model',
        page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
      };
    }

    if (key === 'agent' || key === 'role' || key === '角色') {
      return { category: 'agent', page: 1 };
    }

    if (key === 'effort' || key === '强度') {
      return { category: 'effort', page: 1 };
    }

    return { category: 'all', page: 1 };
  }

  private async buildPanelCard(
    event: PlatformMessageEvent,
    category: 'all' | 'session' | 'model' | 'agent' | 'effort' = 'all',
    modelPageIndex: number = 1
  ): Promise<object> {
    const currentSessionId = chatSessionStore.getSessionIdByConversation('discord', event.conversationId);
    const session = chatSessionStore.getSessionByConversation('discord', event.conversationId);
    const components: Array<{
      type: 'select';
      customId: string;
      placeholder: string;
      options: Array<{ label: string; value: string; description?: string }>;
      minValues?: number;
      maxValues?: number;
    }> = [];

    if (category === 'all' || category === 'session') {
      components.push({
        type: 'select',
        customId: `${PANEL_SELECT_PREFIX}:${event.conversationId}`,
        placeholder: '选择会话操作',
        options: [
          { label: '查看当前会话', value: 'status', description: '显示当前频道绑定状态' },
          { label: '创建并绑定新会话', value: 'new', description: '创建一个新 OpenCode 会话并绑定' },
          { label: '创建会话频道', value: 'new_channel', description: '新建频道并绑定新会话' },
          { label: '绑定已有会话', value: 'bind', description: '从历史会话中选择绑定' },
          { label: '重命名当前会话', value: 'rename', description: '弹出输入框修改会话名' },
          { label: '回撤上一轮', value: 'undo', description: '执行 undo 回撤上一轮' },
          { label: '压缩上下文', value: 'compact', description: '执行 compact 压缩当前会话' },
          { label: '清理并解绑会话', value: 'clear', description: '删除当前会话并解绑频道' },
          { label: '命令帮助', value: 'help', description: '查看 Discord 命令速查' },
        ],
      });
    }

    const modelPage = await this.buildModelSelectOptions(modelPageIndex);
    if ((category === 'all' || category === 'model') && modelPage.options.length > 0) {
      components.push({
        type: 'select',
        customId: `${MODEL_SELECT_PREFIX}:${event.conversationId}`,
        placeholder: '选择模型',
        options: [
          { label: '默认模型', value: 'none', description: '跟随 OpenCode 默认模型' },
          ...modelPage.options,
        ],
        minValues: 1,
        maxValues: 1,
      });
    }

    if (category === 'all' || category === 'agent') {
      const agentOptions = await this.buildAgentSelectOptions();
      if (agentOptions.length > 0) {
        components.push({
          type: 'select',
          customId: `${AGENT_SELECT_PREFIX}:${event.conversationId}`,
          placeholder: '选择角色',
          options: agentOptions,
          minValues: 1,
          maxValues: 1,
        });
      }
    }

    const scopeLabel = category === 'all' ? '综合' : category;
    const modelPagerLine = modelPage.totalCount > 0
      ? `模型分页: ${modelPage.currentPage}/${modelPage.totalPages}（共 ${modelPage.totalCount} 条，使用 ///create_chat model <页码>）`
      : '模型分页: 暂无可用模型';

    return {
      discordText: [
        `🎛️ Discord 会话控制面板（${scopeLabel}）`,
        `当前会话: ${currentSessionId || '未绑定'}`,
        `模型: ${session?.preferredModel || '默认'}`,
        `角色: ${session?.preferredAgent || '默认'}`,
        `强度: ${session?.preferredEffort || '默认'}`,
        '强度命令: ///effort <档位> / ///effort default',
        modelPagerLine,
      ].join('\n'),
      discordComponents: components,
    };
  }

  private async handlePanelCommand(event: PlatformMessageEvent, rawArgs: string): Promise<void> {
    const parsed = this.parseCreateChatArgs(rawArgs);
    const card = await this.buildPanelCard(event, parsed.category, parsed.page);
    await this.safeReplyCard(event, card);
  }

  private getDiscordHelpText(): string {
    return [
      'Discord 命令速查（推荐 `///` 前缀）:',
      '- `///session`: 查看当前频道会话',
      '- `///new [名称] [--dir 路径|别名]`: 新建并绑定会话',
      '- `///new-channel [名称] [--dir 路径|别名]`: 新建会话频道并绑定',
      '- `///bind <sessionId>`: 绑定已有会话',
      '- `///unbind`: 仅解绑当前频道会话',
      '- `///rename <新名称>`: 重命名当前会话',
      '- `///sessions`: 查看最近历史会话',
      '- `///effort`: 查看当前强度',
      '- `///effort <档位>`: 设置会话默认强度（按当前模型能力校验）',
      '- `///effort default`: 清除强度恢复默认',
      '- `#xhigh 你的问题`: 仅当前消息临时覆盖强度',
      '- `///workdir [路径|别名|clear]`: 设置/查看默认工作目录',
      '- `///undo`: 回撤上一轮',
      '- `///compact` 或 `///compat`: 压缩上下文',
      '- `///send <绝对路径>`: 发送白名单文件到当前频道',
      '- `///stop`: 停止当前频道会话',
      '- `///clear`: 清理并解绑当前会话',
      '- `///create_chat`: 打开会话控制面板',
      '- `///create_chat model <页码>`: 打开模型分页下拉（最多 500 条）',
      '- `///create_chat session|agent|effort`: 打开分类控制面板',
    ].join('\n');
  }

  private async handleCommand(event: PlatformMessageEvent, command: DiscordCommand): Promise<boolean> {
    if (command.name === 'help') {
      await this.safeReply(event, this.getDiscordHelpText());
      return true;
    }

    if (command.name === 'session' || command.name === 'status') {
      await this.handleSessionCommand(event);
      return true;
    }

    if (command.name === 'new' || command.name === 'new-session') {
      await this.handleNewSessionCommand(event, command.args);
      return true;
    }

    if (command.name === 'new-channel' || command.name === 'channel') {
      await this.handleNewChannelCommand(event, command.args);
      return true;
    }

    if (command.name === 'bind') {
      await this.handleBindCommand(event, command.args);
      return true;
    }

    if (command.name === 'rename') {
      await this.handleRenameCommand(event, command.args);
      return true;
    }

    if (command.name === 'clear') {
      await this.handleClearCommand(event);
      return true;
    }

    if (command.name === 'unbind') {
      await this.handleUnbindCommand(event);
      return true;
    }

    if (command.name === 'create_chat' || command.name === 'panel') {
      await this.handlePanelCommand(event, command.args);
      return true;
    }

    if (command.name === 'sessions') {
      await this.handleSessionsCommand(event);
      return true;
    }

    if (command.name === 'effort') {
      await this.handleEffortCommand(event, command.args);
      return true;
    }

    if (command.name === 'workdir') {
      await this.handleWorkdirCommand(event, command.args);
      return true;
    }

    if (command.name === 'stop') {
      await this.handleStopCommand(event);
      return true;
    }

    if (command.name === 'undo') {
      await this.handleUndoCommand(event);
      return true;
    }

    if (command.name === 'compact' || command.name === 'compat') {
      await this.handleCompactCommand(event);
      return true;
    }

    if (command.name === 'send') {
      await this.sendFileToDiscord(event, command.args);
      return true;
    }

    return false;
  }

  private async handlePrompt(event: PlatformMessageEvent, text: string): Promise<void> {
    const effortParsed = stripPromptEffortPrefix(text);
    const promptText = effortParsed.text.trim() || text.trim() || '请根据我发送的内容继续处理。';

    const sessionId = await this.getOrCreateSession(event);
    if (!sessionId) {
      await this.safeReply(event, '❌ 无法创建 OpenCode 会话，请检查服务状态。');
      return;
    }

    const session = chatSessionStore.getSessionByConversation('discord', event.conversationId);
    const preferredModel = this.parseProviderModel(session?.preferredModel);
    const variant = effortParsed.effort || session?.preferredEffort;

    const pendingMessageId = await this.safePending(event);
    try {
      const response = await opencodeClient.sendMessage(sessionId, promptText, {
        ...(preferredModel ? { providerId: preferredModel.providerId, modelId: preferredModel.modelId } : {}),
        ...(session?.preferredAgent ? { agent: session.preferredAgent } : {}),
        ...(variant ? { variant } : {}),
        ...((session?.resolvedDirectory || session?.defaultDirectory)
          ? { directory: session.resolvedDirectory || session.defaultDirectory }
          : {}),
      });

      if (pendingMessageId) {
        await this.sender.deleteMessage(pendingMessageId);
      }

      const parts = Array.isArray(response.parts) ? response.parts : [];
      if (parts.length === 0) {
        await this.safeReply(event, '-----------\n✅ 已提交请求，等待模型返回结果...');
      }
    } catch (error) {
      if (pendingMessageId) {
        await this.sender.deleteMessage(pendingMessageId);
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.safeReply(event, `❌ 请求失败: ${message}`);
    }
  }

  private async safePending(event: PlatformMessageEvent): Promise<string | null> {
    return await this.sender.sendText(event.conversationId, '⏳ 正在处理，请稍候...');
  }

  private async tryHandlePendingPermission(event: PlatformMessageEvent, text: string): Promise<boolean> {
    const queueKey = this.getPermissionQueueKey(event);
    const pending = permissionHandler.peekForChat(queueKey);
    if (!pending) {
      return false;
    }

    const decision = parsePermissionDecision(text);
    if (!decision) {
      await this.safeReply(
        event,
        `⚠️ 有待处理的权限请求：
- 工具：${pending.tool}
- 说明：${pending.description}
${pending.risk ? `- 风险：${pending.risk}` : ''}

请回复"允许"或"拒绝"来确认权限。`
      );
      return true;
    }

    const responded = await opencodeClient.respondToPermission(
      pending.sessionId,
      pending.permissionId,
      decision.allow,
      decision.remember,
      this.resolvePermissionDirectoryOptions(pending.sessionId, event.conversationId)
    );

    if (!responded) {
      await this.safeReply(event, '权限响应失败，请稍后重试。');
      return true;
    }

    permissionHandler.resolveForChat(queueKey, pending.permissionId);
    await this.safeReply(
      event,
      decision.allow
        ? (decision.remember ? '✅ 已允许并记住该权限' : '✅ 已允许该权限')
        : '❌ 已拒绝该权限'
    );
    return true;
  }

  private async tryHandlePendingQuestion(event: PlatformMessageEvent, text: string): Promise<boolean> {
    const pending = this.getPendingQuestionByConversation(event.conversationId);
    if (!pending) {
      return false;
    }

    const questionCount = pending.request.questions.length;
    if (questionCount === 0) {
      await this.safeReply(event, '当前问题状态异常，请稍后重试。');
      return true;
    }

    const currentIndex = Math.min(Math.max(pending.currentQuestionIndex, 0), questionCount - 1);
    const question = pending.request.questions[currentIndex];
    const parsed = parseQuestionAnswerText(text, question);
    if (!parsed) {
      await this.safeReply(event, '当前有待回答问题，请回复选项内容/编号，或直接输入自定义答案。');
      return true;
    }

    await this.applyPendingQuestionAnswer(pending, parsed, text, async message => {
      await this.safeReply(event, message);
    });

    return true;
  }

  private async buildBindOptions(): Promise<StringSelectMenuOptionBuilder[]> {
    const sessions = await opencodeClient.listSessionsAcrossProjects();
    const options: StringSelectMenuOptionBuilder[] = [];

    for (const session of sessions.slice(0, MAX_SESSION_OPTIONS)) {
      const title = (session.title || '未命名会话').slice(0, 100);
      const workspace = (session.directory || '-').slice(0, 72);
      const description = `工作区: ${workspace}`.slice(0, 100);
      const label = `${title} · ${session.id.slice(0, 8)}`.slice(0, 100);
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(label)
          .setValue(session.id.slice(0, 100))
          .setDescription(description)
      );
    }

    return options;
  }

  private async handlePanelSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const conversationId = parseConversationIdFromCustomId(PANEL_SELECT_PREFIX, interaction.customId);
    if (!conversationId || interaction.channelId !== conversationId) {
      await this.safeInteractionReply(interaction, '会话上下文不匹配，请重新打开面板。');
      return;
    }

    const selected = interaction.values[0];
    if (selected !== 'rename') {
      const deferred = await this.deferInteractionReply(interaction);
      if (!deferred) {
        return;
      }
    }

    if (selected === 'status') {
      const sessionId = chatSessionStore.getSessionIdByConversation('discord', conversationId);
      await this.safeInteractionReply(interaction, sessionId ? `当前频道会话: ${sessionId}` : '当前频道未绑定会话。');
      return;
    }

    if (selected === 'new') {
      const defaultTitle = this.buildDefaultSessionTitleFromInteraction(interaction, conversationId);
      const currentBinding = chatSessionStore.getSessionByConversation('discord', conversationId);
      const session = await opencodeClient.createSession(defaultTitle, currentBinding?.defaultDirectory);
      if (!session?.id) {
        await this.safeInteractionReply(interaction, '创建会话失败，请稍后重试。');
        return;
      }

      const chatType: 'group' | 'p2p' = interaction.guildId ? 'group' : 'p2p';
      const finalTitle = this.buildSessionTitleBySessionId(chatType, session.id);
      await opencodeClient.updateSession(session.id, finalTitle).catch(() => false);

      await this.bindSessionToConversation(
        conversationId,
        session.id,
        interaction.user.id,
        finalTitle,
        chatType,
        session.directory,
        {
          ...(currentBinding?.defaultDirectory ? { defaultDirectory: currentBinding.defaultDirectory } : {}),
        }
      );
      await this.safeInteractionReply(interaction, `已创建并绑定会话: ${session.id}`);
      return;
    }

    if (selected === 'bind') {
      const options = await this.buildBindOptions();
      if (options.length === 0) {
        await this.safeInteractionReply(interaction, '没有可绑定的历史会话。');
        return;
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId(`${BIND_SELECT_PREFIX}:${conversationId}`)
        .setPlaceholder('选择要绑定的会话')
        .addOptions(options)
        .setMinValues(1)
        .setMaxValues(1);

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
      await this.safeInteractionReply(interaction, '请选择要绑定的会话：', { components: [row] });
      return;
    }

    if (selected === 'model') {
      const modelPage = await this.buildModelSelectOptions(1);
      if (modelPage.options.length === 0) {
        await this.safeInteractionReply(interaction, '当前无可用模型可切换。');
        return;
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId(`${MODEL_SELECT_PREFIX}:${conversationId}`)
        .setPlaceholder('选择模型')
        .addOptions([
          new StringSelectMenuOptionBuilder().setLabel('默认模型').setValue('none').setDescription('跟随 OpenCode 默认'),
          ...modelPage.options.map(option => new StringSelectMenuOptionBuilder()
            .setLabel(option.label.slice(0, 100))
            .setValue(option.value.slice(0, 100))
            .setDescription((option.description || option.value).slice(0, 100))),
        ])
        .setMinValues(1)
        .setMaxValues(1);

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
      const text = modelPage.totalPages > 1
        ? `请选择目标模型（第 ${modelPage.currentPage}/${modelPage.totalPages} 页，共 ${modelPage.totalCount} 条；更多请用 ///create_chat model <页码>）`
        : '请选择目标模型：';
      await this.safeInteractionReply(interaction, text, { components: [row] });
      return;
    }

    if (selected === 'agent') {
      const agentOptions = await this.buildAgentSelectOptions();
      const select = new StringSelectMenuBuilder()
        .setCustomId(`${AGENT_SELECT_PREFIX}:${conversationId}`)
        .setPlaceholder('选择角色')
        .addOptions(agentOptions.map(option => new StringSelectMenuOptionBuilder()
          .setLabel(option.label.slice(0, 100))
          .setValue(option.value.slice(0, 100))
          .setDescription((option.description || option.value).slice(0, 100))))
        .setMinValues(1)
        .setMaxValues(1);

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
      await this.safeInteractionReply(interaction, '请选择目标角色：', { components: [row] });
      return;
    }

    if (selected === 'effort') {
      await this.safeInteractionReply(interaction, '强度请使用命令行设置：///effort <档位>，例如 ///effort high');
      return;
    }

    if (selected === 'undo') {
      const result = await this.performUndo(conversationId);
      await this.safeInteractionReply(interaction, result.message);
      return;
    }

    if (selected === 'compact') {
      const sessionId = chatSessionStore.getSessionIdByConversation('discord', conversationId);
      if (!sessionId) {
        await this.safeInteractionReply(interaction, '当前频道没有活跃会话。');
        return;
      }

      const model = await this.resolveCompactModel(conversationId);
      if (!model) {
        await this.safeInteractionReply(interaction, '❌ 未找到可用模型，无法执行上下文压缩。');
        return;
      }

      const compacted = await opencodeClient.summarizeSession(sessionId, model.providerId, model.modelId);
      await this.safeInteractionReply(
        interaction,
        compacted
          ? `✅ 上下文压缩完成（模型: ${model.providerId}:${model.modelId}）`
          : `❌ 上下文压缩失败（模型: ${model.providerId}:${model.modelId}）`
      );
      return;
    }

    if (selected === 'new_channel') {
      const currentBinding = chatSessionStore.getSessionByConversation('discord', conversationId);
      const session = await opencodeClient.createSession(
        this.buildDefaultSessionTitleFromInteraction(interaction, conversationId),
        currentBinding?.defaultDirectory
      );
      if (!session?.id) {
        await this.safeInteractionReply(interaction, '创建会话失败，请稍后重试。');
        return;
      }

      const channelName = this.buildChannelNameBySessionId(session.id);
      if (!interaction.guild) {
        const finalTitle = this.buildSessionTitleBySessionId('p2p', session.id);
        await opencodeClient.updateSession(session.id, finalTitle).catch(() => false);
        await this.bindSessionToConversation(
          conversationId,
          session.id,
          interaction.user.id,
          finalTitle,
          'p2p',
          session.directory,
          {
            ...(currentBinding?.defaultDirectory ? { defaultDirectory: currentBinding.defaultDirectory } : {}),
          }
        );
        await this.safeInteractionReply(interaction, `当前不在服务器中，已改为绑定当前会话: ${session.id}`);
        return;
      }

      const botId = interaction.client.user?.id;
      try {
        const channel = await interaction.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            {
              id: interaction.guild.roles.everyone.id,
              deny: [PermissionFlagsBits.ViewChannel],
            },
            {
              id: interaction.user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            },
            ...(botId
              ? [{
                  id: botId,
                  allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageChannels,
                  ],
                }]
              : []),
          ],
          topic: `oc-session:${session.id}`,
        });

        const finalTitle = this.buildSessionTitleBySessionId('group', session.id);
        await opencodeClient.updateSession(session.id, finalTitle).catch(() => false);
        await this.bindSessionToConversation(
          channel.id,
          session.id,
          interaction.user.id,
          finalTitle,
          'group',
          session.directory,
          {
            ...(currentBinding?.defaultDirectory ? { defaultDirectory: currentBinding.defaultDirectory } : {}),
          }
        );
        await this.sender.sendText(channel.id, `✅ 已绑定 OpenCode 会话: ${session.id}`);
        await this.safeInteractionReply(interaction, `已创建会话频道 <#${channel.id}> 并绑定会话。`);
      } catch (error) {
        await this.bindSessionToConversation(
          conversationId,
          session.id,
          interaction.user.id,
          this.buildSessionTitleBySessionId('group', session.id),
          'group',
          session.directory,
          {
            ...(currentBinding?.defaultDirectory ? { defaultDirectory: currentBinding.defaultDirectory } : {}),
          }
        );
        const message = error instanceof Error ? error.message : String(error);
        await this.safeInteractionReply(interaction, `创建频道失败，已回退为当前频道绑定会话: ${session.id}\n${message}`);
      }

      return;
    }

    if (selected === 'rename') {
      const modal = new ModalBuilder()
        .setCustomId(`${RENAME_MODAL_PREFIX}:${conversationId}`)
        .setTitle('重命名当前会话');

      const input = new TextInputBuilder()
        .setCustomId(RENAME_INPUT_ID)
        .setLabel('新会话名称')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80);

      const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
      modal.addComponents(row);

      await interaction.showModal(modal);
      return;
    }

    if (selected === 'clear') {
      const current = chatSessionStore.getSessionByConversation('discord', conversationId);
      if (!current?.sessionId) {
        await this.safeInteractionReply(interaction, '当前频道没有活跃会话。');
        return;
      }

      const shouldDeleteSession = current.protectSessionDelete !== true;
      const deleted = shouldDeleteSession
        ? await opencodeClient.deleteSession(
            current.sessionId,
            current.resolvedDirectory ? { directory: current.resolvedDirectory } : undefined
          )
        : true;
      chatSessionStore.removeSessionByConversation('discord', conversationId);
      await this.safeInteractionReply(
        interaction,
        deleted
          ? (shouldDeleteSession
              ? '已清理并解绑当前会话。'
              : '已解绑当前频道（该会话为外部绑定，未删除 OpenCode 会话）。')
          : '频道绑定已清理，但 OpenCode 会话删除失败。'
      );
      return;
    }

    await this.safeInteractionReply(interaction, this.getDiscordHelpText());
  }

  private async handleQuestionSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const deferred = await this.deferInteractionReply(interaction);
    if (!deferred) {
      return;
    }

    const conversationId = parseConversationIdFromCustomId(QUESTION_SELECT_PREFIX, interaction.customId);
    if (!conversationId || interaction.channelId !== conversationId) {
      await this.safeInteractionReply(interaction, '会话上下文不匹配，请重新尝试。');
      return;
    }

    const pending = this.getPendingQuestionByConversation(conversationId);
    if (!pending) {
      await this.safeInteractionReply(interaction, '当前没有待回答问题。');
      return;
    }

    const questionCount = pending.request.questions.length;
    if (questionCount === 0) {
      await this.safeInteractionReply(interaction, '当前问题状态异常，请稍后重试。');
      return;
    }

    const currentIndex = Math.min(Math.max(pending.currentQuestionIndex, 0), questionCount - 1);
    const question = pending.request.questions[currentIndex];
    const selectedValues = interaction.values;
    if (selectedValues.length === 0) {
      await this.safeInteractionReply(interaction, '未选择任何答案。');
      return;
    }

    if (selectedValues.includes('__custom__')) {
      await this.safeInteractionReply(interaction, '请直接在频道发送文本作为自定义答案。');
      return;
    }

    let parsed: ParsedQuestionAnswer;
    if (selectedValues.includes('__skip__')) {
      parsed = { type: 'skip' };
    } else {
      const optionLabels = new Set(question.options.map(option => option.label));
      const validSelections = selectedValues.filter(value => optionLabels.has(value));
      if (validSelections.length === 0) {
        await this.safeInteractionReply(interaction, '所选答案无效，请重新选择。');
        return;
      }

      parsed = {
        type: 'selection',
        values: question.multiple ? validSelections : [validSelections[0]],
      };
    }

    await this.applyPendingQuestionAnswer(pending, parsed, selectedValues.join(', '), async message => {
      await this.safeInteractionReply(interaction, message);
    });
  }

  private async handleModelSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const deferred = await this.deferInteractionReply(interaction);
    if (!deferred) {
      return;
    }

    const conversationId = parseConversationIdFromCustomId(MODEL_SELECT_PREFIX, interaction.customId);
    if (!conversationId || interaction.channelId !== conversationId) {
      await this.safeInteractionReply(interaction, '会话上下文不匹配，请重新执行操作。');
      return;
    }

    const selected = interaction.values[0];
    if (!selected) {
      await this.safeInteractionReply(interaction, '未选择模型。');
      return;
    }

    if (selected === 'none') {
      chatSessionStore.updateConfigByConversation('discord', conversationId, { preferredModel: undefined });
      await this.safeInteractionReply(interaction, '✅ 已切换为默认模型。');
      return;
    }

    chatSessionStore.updateConfigByConversation('discord', conversationId, { preferredModel: selected });
    await this.safeInteractionReply(interaction, `✅ 已切换模型: ${selected}`);
  }

  private async handleAgentSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const deferred = await this.deferInteractionReply(interaction);
    if (!deferred) {
      return;
    }

    const conversationId = parseConversationIdFromCustomId(AGENT_SELECT_PREFIX, interaction.customId);
    if (!conversationId || interaction.channelId !== conversationId) {
      await this.safeInteractionReply(interaction, '会话上下文不匹配，请重新执行操作。');
      return;
    }

    const selected = interaction.values[0];
    if (!selected) {
      await this.safeInteractionReply(interaction, '未选择角色。');
      return;
    }

    chatSessionStore.updateConfigByConversation('discord', conversationId, {
      preferredAgent: selected === 'none' ? undefined : selected,
    });
    await this.safeInteractionReply(interaction, selected === 'none' ? '✅ 已切换为默认角色。' : `✅ 已切换角色: ${selected}`);
  }

  private async handleBindSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const deferred = await this.deferInteractionReply(interaction);
    if (!deferred) {
      return;
    }

    const conversationId = parseConversationIdFromCustomId(BIND_SELECT_PREFIX, interaction.customId);
    if (!conversationId || interaction.channelId !== conversationId) {
      await this.safeInteractionReply(interaction, '会话上下文不匹配，请重新执行绑定。');
      return;
    }

    const selectedSessionId = interaction.values[0];
    if (!selectedSessionId) {
      await this.safeInteractionReply(interaction, '未选择会话。');
      return;
    }

    const target = await opencodeClient.findSessionAcrossProjects(selectedSessionId);
    if (!target) {
      await this.safeInteractionReply(interaction, `未找到会话: ${selectedSessionId}`);
      return;
    }

    await this.bindSessionToConversation(
      conversationId,
      target.id,
      interaction.user.id,
      target.title,
      'group',
      target.directory,
      {
        protectSessionDelete: true,
        ...(target.directory ? { defaultDirectory: target.directory } : {}),
      }
    );
    await this.safeInteractionReply(interaction, `已绑定会话: ${target.id}`);
  }

  private async handleRenameModal(interaction: ModalSubmitInteraction): Promise<void> {
    const conversationId = parseConversationIdFromCustomId(RENAME_MODAL_PREFIX, interaction.customId);
    if (!conversationId || interaction.channelId !== conversationId) {
      await this.safeInteractionReply(interaction, '会话上下文不匹配，请重新操作。');
      return;
    }

    const nextName = interaction.fields.getTextInputValue(RENAME_INPUT_ID).trim();
    if (!nextName) {
      await this.safeInteractionReply(interaction, '会话名称不能为空。');
      return;
    }

    const current = chatSessionStore.getSessionByConversation('discord', conversationId);
    if (!current?.sessionId) {
      await this.safeInteractionReply(interaction, '当前频道尚未绑定会话。');
      return;
    }

    const updated = await opencodeClient.updateSession(current.sessionId, nextName);
    if (!updated) {
      await this.safeInteractionReply(interaction, '重命名失败，请稍后重试。');
      return;
    }

    await this.bindSessionToConversation(
      conversationId,
      current.sessionId,
      current.creatorId || interaction.user.id,
      nextName,
      current.chatType === 'p2p' ? 'p2p' : 'group',
      current.resolvedDirectory
    );
    await this.safeInteractionReply(interaction, `会话已重命名为：${nextName}`);
  }

  async handleInteraction(interaction: Interaction): Promise<void> {
    try {
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith(`${PANEL_SELECT_PREFIX}:`)) {
          await this.handlePanelSelect(interaction);
          return;
        }

        if (interaction.customId.startsWith(`${BIND_SELECT_PREFIX}:`)) {
          await this.handleBindSelect(interaction);
          return;
        }

        if (interaction.customId.startsWith(`${QUESTION_SELECT_PREFIX}:`)) {
          await this.handleQuestionSelect(interaction);
          return;
        }

        if (interaction.customId.startsWith(`${MODEL_SELECT_PREFIX}:`)) {
          await this.handleModelSelect(interaction);
          return;
        }

        if (interaction.customId.startsWith(`${AGENT_SELECT_PREFIX}:`)) {
          await this.handleAgentSelect(interaction);
          return;
        }

        return;
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith(`${RENAME_MODAL_PREFIX}:`)) {
        await this.handleRenameModal(interaction);
      }
    } catch (error) {
      if (this.isUnknownInteractionError(error)) {
        console.warn('[Discord] 交互已过期，忽略本次操作');
        return;
      }

      console.error('[Discord] 处理交互失败:', error);
      if (interaction.channelId) {
        await this.sender.sendText(interaction.channelId, '❌ 交互处理失败，请重试。');
      }
    }
  }

  async handleMessage(event: PlatformMessageEvent): Promise<void> {
    const text = normalizeMessageText(event.content);

    const command = parseDiscordCommand(text);
    if (command) {
      const handled = await this.handleCommand(event, command);
      if (handled) {
        return;
      }
    }

    const naturalSendPath = parseNaturalFileSendText(text);
    if (naturalSendPath) {
      await this.sendFileToDiscord(event, naturalSendPath);
      return;
    }

    if (this.shouldSkipMessage(event, text)) {
      return;
    }

    const permissionHandled = await this.tryHandlePendingPermission(event, text);
    if (permissionHandled) {
      return;
    }

    const questionHandled = await this.tryHandlePendingQuestion(event, text);
    if (questionHandled) {
      return;
    }

    const promptText = text || '请根据我发送的内容继续处理。';
    await this.handlePrompt(event, promptText);
  }
}

export function createDiscordHandler(sender: PlatformSender): DiscordHandler {
  return new DiscordHandler(sender);
}
