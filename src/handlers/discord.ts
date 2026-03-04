import {
  ActionRowBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { groupConfig } from '../config.js';
import { opencodeClient } from '../opencode/client.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { parseQuestionAnswerText } from '../opencode/question-parser.js';
import { questionHandler, type PendingQuestion } from '../opencode/question-handler.js';
import { permissionHandler } from '../permissions/handler.js';
import { chatSessionStore } from '../store/chat-session.js';
import { buildSessionTimestamp } from '../utils/session-title.js';
import type { PlatformMessageEvent, PlatformSender } from '../platform/types.js';

const PANEL_SELECT_PREFIX = 'oc_panel';
const BIND_SELECT_PREFIX = 'oc_bind';
const RENAME_MODAL_PREFIX = 'oc_rename';
const QUESTION_SELECT_PREFIX = 'oc_question';
const RENAME_INPUT_ID = 'session_name';
const MAX_SESSION_OPTIONS = 25;

type ParsedQuestionAnswer = NonNullable<ReturnType<typeof parseQuestionAnswerText>>;

function normalizeMessageText(value: string): string {
  return value.trim();
}

function extractTextFromOpencodeParts(parts: unknown[]): string {
  const chunks: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') {
      continue;
    }

    const record = part as Record<string, unknown>;
    if (typeof record.text === 'string' && record.text.trim()) {
      chunks.push(record.text.trim());
      continue;
    }

    if (typeof record.content === 'string' && record.content.trim()) {
      chunks.push(record.content.trim());
      continue;
    }

    if (typeof record.output === 'string' && record.output.trim()) {
      chunks.push(record.output.trim());
    }
  }

  return chunks.join('\n').trim();
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

  const commandPrefix = normalized.startsWith('//')
    ? '//'
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

class DiscordHandler {
  constructor(private readonly sender: PlatformSender) {}

  private getPermissionQueueKey(event: PlatformMessageEvent): string {
    return `discord:${event.conversationId}`;
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
    titleOverride?: string
  ): Promise<string | null> {
    const existing = chatSessionStore.getSessionIdByConversation('discord', event.conversationId);
    if (existing) {
      return existing;
    }

    const isGroup = event.chatType === 'group';
    const titlePrefix = isGroup ? 'Discord群聊' : 'Discord私聊';
    const title = titleOverride?.trim() || `${titlePrefix}-${buildSessionTimestamp()}`;
    const session = await opencodeClient.createSession(title);
    if (!session?.id) {
      return null;
    }

    chatSessionStore.setSessionByConversation(
      'discord',
      event.conversationId,
      session.id,
      event.senderId,
      session.title,
      {
        chatType: isGroup ? 'group' : 'p2p',
        resolvedDirectory: session.directory,
      }
    );

    return session.id;
  }

  private async bindSessionToConversation(
    conversationId: string,
    sessionId: string,
    userId: string,
    title?: string,
    chatType: 'group' | 'p2p' = 'group',
    resolvedDirectory?: string
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
      }
    );
  }

  private async safeReply(event: PlatformMessageEvent, text: string): Promise<void> {
    if (this.sender.reply && event.messageId) {
      const replied = await this.sender.reply(event.messageId, text);
      if (replied) {
        return;
      }
    }

    await this.sender.sendText(event.conversationId, text);
  }

  private async safeReplyCard(event: PlatformMessageEvent, card: object): Promise<void> {
    if (this.sender.replyCard && event.messageId) {
      const replied = await this.sender.replyCard(event.messageId, card);
      if (replied) {
        return;
      }
    }

    await this.sender.sendCard(event.conversationId, card);
  }

  private async handleSessionCommand(event: PlatformMessageEvent): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation('discord', event.conversationId);
    if (!sessionId) {
      await this.safeReply(event, '当前频道尚未绑定会话，发送任意消息会自动创建会话。');
      return;
    }
    await this.safeReply(event, `当前会话: ${sessionId}`);
  }

  private async handleNewSessionCommand(event: PlatformMessageEvent, titleOverride?: string): Promise<void> {
    const title = titleOverride?.trim() || `Discord会话-${buildSessionTimestamp()}`;
    const session = await opencodeClient.createSession(title);
    if (!session?.id) {
      await this.safeReply(event, '❌ 创建会话失败，请稍后重试。');
      return;
    }

    await this.bindSessionToConversation(
      event.conversationId,
      session.id,
      event.senderId,
      session.title,
      event.chatType === 'group' ? 'group' : 'p2p',
      session.directory
    );
    await this.safeReply(event, `✅ 已创建并绑定新会话: ${session.id}`);
  }

  private async handleClearCommand(event: PlatformMessageEvent): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation('discord', event.conversationId);
    if (!sessionId) {
      await this.safeReply(event, '当前频道没有活跃会话。');
      return;
    }

    const deleted = await opencodeClient.deleteSession(sessionId);
    chatSessionStore.removeSessionByConversation('discord', event.conversationId);

    if (deleted) {
      await this.safeReply(event, '🧹 已清理当前会话并解绑频道。');
      return;
    }

    await this.safeReply(event, '⚠️ 频道绑定已清理，但 OpenCode 会话删除失败，请稍后手动检查。');
  }

  private async handleBindCommand(event: PlatformMessageEvent, sessionId: string): Promise<void> {
    const normalized = sessionId.trim();
    if (!normalized) {
      await this.safeReply(event, '用法：`//bind <sessionId>`');
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
      target.directory
    );
    await this.safeReply(event, `✅ 已绑定会话: ${target.id}`);
  }

  private async handleRenameCommand(event: PlatformMessageEvent, title: string): Promise<void> {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      await this.safeReply(event, '用法：`//rename <新会话名称>`');
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
      current.resolvedDirectory
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
      return `${index + 1}. ${title}\n   ${session.id}`;
    });
    await this.safeReply(event, `可绑定会话（最近 8 条）:\n${lines.join('\n')}`);
  }

  private buildPanelCard(event: PlatformMessageEvent): object {
    const currentSessionId = chatSessionStore.getSessionIdByConversation('discord', event.conversationId);
    return {
      discordText: [
        '🎛️ Discord 会话控制面板',
        `当前会话: ${currentSessionId || '未绑定'}`,
        '通过下拉菜单执行会话操作。',
      ].join('\n'),
      discordComponents: [
        {
          type: 'select',
          customId: `${PANEL_SELECT_PREFIX}:${event.conversationId}`,
          placeholder: '选择会话操作',
          options: [
            { label: '查看当前会话', value: 'status', description: '显示当前频道绑定状态' },
            { label: '创建并绑定新会话', value: 'new', description: '创建一个新 OpenCode 会话并绑定' },
            { label: '绑定已有会话', value: 'bind', description: '从历史会话中选择绑定' },
            { label: '重命名当前会话', value: 'rename', description: '弹出输入框修改会话名' },
            { label: '清理并解绑会话', value: 'clear', description: '删除当前会话并解绑频道' },
            { label: '命令帮助', value: 'help', description: '查看 Discord 命令速查' },
          ],
        },
      ],
    };
  }

  private async handlePanelCommand(event: PlatformMessageEvent): Promise<void> {
    await this.safeReplyCard(event, this.buildPanelCard(event));
  }

  private getDiscordHelpText(): string {
    return [
      'Discord 命令速查（推荐 `//` 前缀）:',
      '- `//session`: 查看当前频道会话',
      '- `//new [名称]`: 新建并绑定会话',
      '- `//bind <sessionId>`: 绑定已有会话',
      '- `//rename <新名称>`: 重命名当前会话',
      '- `//sessions`: 查看最近历史会话',
      '- `//clear`: 清理并解绑当前会话',
      '- `//panel`: 打开下拉菜单控制面板',
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

    if (command.name === 'panel') {
      await this.handlePanelCommand(event);
      return true;
    }

    if (command.name === 'sessions') {
      await this.handleSessionsCommand(event);
      return true;
    }

    return false;
  }

  private async handlePrompt(event: PlatformMessageEvent, text: string): Promise<void> {
    const sessionId = await this.getOrCreateSession(event);
    if (!sessionId) {
      await this.safeReply(event, '❌ 无法创建 OpenCode 会话，请检查服务状态。');
      return;
    }

    const pendingMessageId = await this.safePending(event);
    try {
      const response = await opencodeClient.sendMessage(sessionId, text);
      const parts = Array.isArray(response.parts) ? response.parts : [];
      const output = extractTextFromOpencodeParts(parts);

      if (pendingMessageId) {
        await this.sender.deleteMessage(pendingMessageId);
      }

      await this.safeReply(event, output || '✅ 任务已完成（无可展示文本输出）。');
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
      await this.safeReply(event, '当前有待确认权限，请回复：允许 / 拒绝 / 始终允许（支持 y / n / always）');
      return true;
    }

    const responded = await opencodeClient.respondToPermission(
      pending.sessionId,
      pending.permissionId,
      decision.allow,
      decision.remember
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
      const description = session.id.slice(0, 100);
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(title)
          .setValue(session.id.slice(0, 100))
          .setDescription(description)
      );
    }

    return options;
  }

  private async handlePanelSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const conversationId = parseConversationIdFromCustomId(PANEL_SELECT_PREFIX, interaction.customId);
    if (!conversationId || interaction.channelId !== conversationId) {
      await interaction.reply({ content: '会话上下文不匹配，请重新打开面板。', ephemeral: true });
      return;
    }

    const selected = interaction.values[0];
    if (selected === 'status') {
      const sessionId = chatSessionStore.getSessionIdByConversation('discord', conversationId);
      await interaction.reply({
        content: sessionId ? `当前频道会话: ${sessionId}` : '当前频道未绑定会话。',
        ephemeral: true,
      });
      return;
    }

    if (selected === 'new') {
      const session = await opencodeClient.createSession(`Discord会话-${buildSessionTimestamp()}`);
      if (!session?.id) {
        await interaction.reply({ content: '创建会话失败，请稍后重试。', ephemeral: true });
        return;
      }

      await this.bindSessionToConversation(
        conversationId,
        session.id,
        interaction.user.id,
        session.title,
        'group',
        session.directory
      );
      await interaction.reply({ content: `已创建并绑定会话: ${session.id}`, ephemeral: true });
      return;
    }

    if (selected === 'bind') {
      const options = await this.buildBindOptions();
      if (options.length === 0) {
        await interaction.reply({ content: '没有可绑定的历史会话。', ephemeral: true });
        return;
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId(`${BIND_SELECT_PREFIX}:${conversationId}`)
        .setPlaceholder('选择要绑定的会话')
        .addOptions(options)
        .setMinValues(1)
        .setMaxValues(1);

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
      await interaction.reply({
        content: '请选择要绑定的会话：',
        components: [row],
        ephemeral: true,
      });
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
      const sessionId = chatSessionStore.getSessionIdByConversation('discord', conversationId);
      if (!sessionId) {
        await interaction.reply({ content: '当前频道没有活跃会话。', ephemeral: true });
        return;
      }

      const deleted = await opencodeClient.deleteSession(sessionId);
      chatSessionStore.removeSessionByConversation('discord', conversationId);
      await interaction.reply({
        content: deleted
          ? '已清理并解绑当前会话。'
          : '频道绑定已清理，但 OpenCode 会话删除失败。',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ content: this.getDiscordHelpText(), ephemeral: true });
  }

  private async handleQuestionSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const conversationId = parseConversationIdFromCustomId(QUESTION_SELECT_PREFIX, interaction.customId);
    if (!conversationId || interaction.channelId !== conversationId) {
      await interaction.reply({ content: '会话上下文不匹配，请重新尝试。', ephemeral: true });
      return;
    }

    const pending = this.getPendingQuestionByConversation(conversationId);
    if (!pending) {
      await interaction.reply({ content: '当前没有待回答问题。', ephemeral: true });
      return;
    }

    const questionCount = pending.request.questions.length;
    if (questionCount === 0) {
      await interaction.reply({ content: '当前问题状态异常，请稍后重试。', ephemeral: true });
      return;
    }

    const currentIndex = Math.min(Math.max(pending.currentQuestionIndex, 0), questionCount - 1);
    const question = pending.request.questions[currentIndex];
    const selectedValues = interaction.values;
    if (selectedValues.length === 0) {
      await interaction.reply({ content: '未选择任何答案。', ephemeral: true });
      return;
    }

    if (selectedValues.includes('__custom__')) {
      await interaction.reply({ content: '请直接在频道发送文本作为自定义答案。', ephemeral: true });
      return;
    }

    let parsed: ParsedQuestionAnswer;
    if (selectedValues.includes('__skip__')) {
      parsed = { type: 'skip' };
    } else {
      const optionLabels = new Set(question.options.map(option => option.label));
      const validSelections = selectedValues.filter(value => optionLabels.has(value));
      if (validSelections.length === 0) {
        await interaction.reply({ content: '所选答案无效，请重新选择。', ephemeral: true });
        return;
      }

      parsed = {
        type: 'selection',
        values: question.multiple ? validSelections : [validSelections[0]],
      };
    }

    await this.applyPendingQuestionAnswer(pending, parsed, selectedValues.join(', '), async message => {
      await interaction.reply({ content: message, ephemeral: true });
    });
  }

  private async handleBindSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const conversationId = parseConversationIdFromCustomId(BIND_SELECT_PREFIX, interaction.customId);
    if (!conversationId || interaction.channelId !== conversationId) {
      await interaction.reply({ content: '会话上下文不匹配，请重新执行绑定。', ephemeral: true });
      return;
    }

    const selectedSessionId = interaction.values[0];
    if (!selectedSessionId) {
      await interaction.reply({ content: '未选择会话。', ephemeral: true });
      return;
    }

    const target = await opencodeClient.findSessionAcrossProjects(selectedSessionId);
    if (!target) {
      await interaction.reply({ content: `未找到会话: ${selectedSessionId}`, ephemeral: true });
      return;
    }

    await this.bindSessionToConversation(
      conversationId,
      target.id,
      interaction.user.id,
      target.title,
      'group',
      target.directory
    );
    await interaction.reply({ content: `已绑定会话: ${target.id}`, ephemeral: true });
  }

  private async handleRenameModal(interaction: ModalSubmitInteraction): Promise<void> {
    const conversationId = parseConversationIdFromCustomId(RENAME_MODAL_PREFIX, interaction.customId);
    if (!conversationId || interaction.channelId !== conversationId) {
      await interaction.reply({ content: '会话上下文不匹配，请重新操作。', ephemeral: true });
      return;
    }

    const nextName = interaction.fields.getTextInputValue(RENAME_INPUT_ID).trim();
    if (!nextName) {
      await interaction.reply({ content: '会话名称不能为空。', ephemeral: true });
      return;
    }

    const current = chatSessionStore.getSessionByConversation('discord', conversationId);
    if (!current?.sessionId) {
      await interaction.reply({ content: '当前频道尚未绑定会话。', ephemeral: true });
      return;
    }

    const updated = await opencodeClient.updateSession(current.sessionId, nextName);
    if (!updated) {
      await interaction.reply({ content: '重命名失败，请稍后重试。', ephemeral: true });
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
    await interaction.reply({ content: `会话已重命名为：${nextName}`, ephemeral: true });
  }

  async handleInteraction(interaction: Interaction): Promise<void> {
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
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(`${RENAME_MODAL_PREFIX}:`)) {
      await this.handleRenameModal(interaction);
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
