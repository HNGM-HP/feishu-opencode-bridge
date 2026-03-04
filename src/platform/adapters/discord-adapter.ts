import {
  ActionRowBuilder,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Interaction,
  type Message,
} from 'discord.js';
import type {
  PlatformActionEvent,
  PlatformAdapter,
  PlatformMention,
  PlatformMessageEvent,
  PlatformSender,
} from '../types.js';
import { discordConfig } from '../../config.js';
import { chatSessionStore } from '../../store/chat-session.js';

const DISCORD_MESSAGE_LIMIT = 1800;

type DiscordSelectOptionPayload = {
  label: string;
  value: string;
  description?: string;
  emoji?: string;
};

type DiscordSelectComponentPayload = {
  type?: 'select';
  customId: string;
  placeholder?: string;
  options: DiscordSelectOptionPayload[];
  minValues?: number;
  maxValues?: number;
  disabled?: boolean;
};

type DiscordCardPayload = {
  discordText?: string;
  discordComponents?: DiscordSelectComponentPayload[];
};

type DiscordMessagePayload = {
  content: string;
  components?: ActionRowBuilder<StringSelectMenuBuilder>[];
};

type DiscordSendableChannel = {
  send: (content: string | DiscordMessagePayload) => Promise<Message>;
  messages: {
    fetch: (messageId: string) => Promise<Message>;
  };
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isDiscordSendableChannel(channel: unknown): channel is DiscordSendableChannel {
  if (!channel || typeof channel !== 'object') {
    return false;
  }

  const record = channel as {
    send?: unknown;
    messages?: { fetch?: unknown };
  };

  return typeof record.send === 'function'
    && !!record.messages
    && typeof record.messages.fetch === 'function';
}

class DiscordSender implements PlatformSender {
  constructor(private readonly adapter: DiscordAdapter) {}

  private splitText(text: string): string[] {
    if (!text.trim()) {
      return [];
    }
    if (text.length <= DISCORD_MESSAGE_LIMIT) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > DISCORD_MESSAGE_LIMIT) {
      const candidate = remaining.slice(0, DISCORD_MESSAGE_LIMIT);
      const breakAt = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
      const cut = breakAt > Math.floor(DISCORD_MESSAGE_LIMIT * 0.5) ? breakAt : DISCORD_MESSAGE_LIMIT;
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    if (remaining.length > 0) {
      chunks.push(remaining);
    }
    return chunks;
  }

  private normalizeCardPayload(card: object): DiscordMessagePayload {
    const payload = card as DiscordCardPayload;

    const content = (() => {
      if (typeof payload.discordText === 'string' && payload.discordText.trim()) {
        return payload.discordText;
      }
      const serialized = JSON.stringify(card, null, 2);
      const clipped = serialized.length > 1500
        ? `${serialized.slice(0, 1500)}\n...`
        : serialized;
      return `\`\`\`json\n${clipped}\n\`\`\``;
    })();

    const rows = this.buildSelectComponents(payload.discordComponents);
    if (rows.length === 0) {
      return { content };
    }

    return {
      content,
      components: rows,
    };
  }

  private buildSelectComponents(
    components?: DiscordSelectComponentPayload[]
  ): ActionRowBuilder<StringSelectMenuBuilder>[] {
    if (!Array.isArray(components) || components.length === 0) {
      return [];
    }

    const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
    for (const component of components.slice(0, 5)) {
      if (!component || component.type === undefined || component.type === 'select') {
        const options = Array.isArray(component.options) ? component.options.slice(0, 25) : [];
        if (options.length === 0 || !component.customId) {
          continue;
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId(component.customId.slice(0, 100))
          .setPlaceholder((component.placeholder || '请选择操作').slice(0, 150))
          .setMinValues(Math.max(1, Math.min(component.minValues ?? 1, options.length)))
          .setMaxValues(Math.max(1, Math.min(component.maxValues ?? 1, options.length)))
          .setDisabled(component.disabled === true);

        const builtOptions: StringSelectMenuOptionBuilder[] = [];
        for (const option of options) {
          const menuOption = new StringSelectMenuOptionBuilder()
            .setLabel(option.label.slice(0, 100))
            .setValue(option.value.slice(0, 100));

          if (option.description) {
            menuOption.setDescription(option.description.slice(0, 100));
          }

          if (option.emoji) {
            menuOption.setEmoji(option.emoji);
          }

          builtOptions.push(menuOption);
        }

        menu.addOptions(builtOptions);
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
      }
    }

    return rows;
  }

  async sendText(conversationId: string, text: string): Promise<string | null> {
    const channel = await this.adapter.resolveTextChannel(conversationId);
    if (!channel) {
      return null;
    }

    const chunks = this.splitText(text);
    if (chunks.length === 0) {
      return null;
    }

    let firstMessageId: string | null = null;
    for (const chunk of chunks) {
      const sent = await channel.send(chunk);
      this.adapter.rememberMessageConversation(sent.id, conversationId);
      if (!firstMessageId) {
        firstMessageId = sent.id;
      }
    }
    return firstMessageId;
  }

  async sendCard(conversationId: string, card: object): Promise<string | null> {
    const channel = await this.adapter.resolveTextChannel(conversationId);
    if (!channel) {
      return null;
    }

    const payload = this.normalizeCardPayload(card);
    const sent = await channel.send(payload);
    this.adapter.rememberMessageConversation(sent.id, conversationId);
    return sent.id;
  }

  async updateCard(messageId: string, card: object): Promise<boolean> {
    const conversationId = this.adapter.getConversationByMessageId(messageId);
    if (!conversationId) {
      return false;
    }

    const message = await this.adapter.fetchMessage(conversationId, messageId);
    if (!message) {
      return false;
    }

    await message.edit(this.normalizeCardPayload(card));
    return true;
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    const conversationId = this.adapter.getConversationByMessageId(messageId);
    if (!conversationId) {
      return false;
    }

    const message = await this.adapter.fetchMessage(conversationId, messageId);
    if (!message) {
      return false;
    }

    await message.delete();
    this.adapter.forgetMessageConversation(messageId);
    return true;
  }

  async reply(messageId: string, text: string): Promise<string | null> {
    const conversationId = this.adapter.getConversationByMessageId(messageId);
    if (!conversationId) {
      return null;
    }

    const message = await this.adapter.fetchMessage(conversationId, messageId);
    if (!message) {
      return null;
    }

    const chunks = this.splitText(text);
    if (chunks.length === 0) {
      return null;
    }

    let firstMessageId: string | null = null;
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      if (!chunk) {
        continue;
      }

      const sent = index === 0
        ? await message.reply(chunk)
        : await this.sendText(conversationId, chunk).then(async sentId => {
          if (!sentId) {
            throw new Error('Discord 发送失败');
          }
          const sentMessage = await this.adapter.fetchMessage(conversationId, sentId);
          if (!sentMessage) {
            throw new Error('Discord 发送后读取消息失败');
          }
          return sentMessage;
        });
      this.adapter.rememberMessageConversation(sent.id, conversationId);
      if (!firstMessageId) {
        firstMessageId = sent.id;
      }
    }

    return firstMessageId;
  }

  async replyCard(messageId: string, card: object): Promise<string | null> {
    const conversationId = this.adapter.getConversationByMessageId(messageId);
    if (!conversationId) {
      return null;
    }

    const message = await this.adapter.fetchMessage(conversationId, messageId);
    if (!message) {
      return null;
    }

    const sent = await message.reply(this.normalizeCardPayload(card));
    this.adapter.rememberMessageConversation(sent.id, conversationId);
    return sent.id;
  }
}

export class DiscordAdapter implements PlatformAdapter {
  readonly platform = 'discord' as const;

  private readonly sender: DiscordSender;
  private readonly messageCallbacks: Array<(event: PlatformMessageEvent) => void> = [];
  private readonly interactionCallbacks: Array<(interaction: Interaction) => Promise<void> | void> = [];
  private readonly actionCallbacks: Array<(event: PlatformActionEvent) => void> = [];
  private readonly messageRecalledCallbacks: Array<(event: unknown) => void> = [];
  private readonly messageConversationMap = new Map<string, string>();
  private client: Client | null = null;
  private isActive = false;

  constructor() {
    this.sender = new DiscordSender(this);
  }

  async start(): Promise<void> {
    if (!discordConfig.enabled) {
      console.log('[Discord] 适配器未启用，跳过启动');
      return;
    }

    if (!discordConfig.token) {
      console.warn('[Discord] ⚠️ 已启用但缺少 DISCORD_TOKEN（或 DISCORD_BOT_TOKEN），适配器将保持不活跃状态');
      console.warn('[Discord] 请设置 DISCORD_TOKEN 或 DISCORD_BOT_TOKEN 后重启服务');
      return;
    }

    if (!discordConfig.clientId) {
      console.warn('[Discord] ⚠️ 未设置 DISCORD_CLIENT_ID，后续交互能力可能受限');
    }

    if (this.client) {
      console.warn('[Discord] 适配器已存在客户端实例，跳过重复启动');
      return;
    }

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    client.once(Events.ClientReady, readyClient => {
      this.isActive = true;
      console.log(`[Discord] 已连接: ${readyClient.user.tag}`);
    });

    client.on(Events.MessageCreate, message => {
      void this.handleMessageCreate(message);
    });

    client.on(Events.InteractionCreate, interaction => {
      void this.handleInteractionCreate(interaction);
    });

    client.on(Events.MessageDelete, message => {
      this.forgetMessageConversation(message.id);
      const payload = {
        platform: 'discord',
        messageId: message.id,
        conversationId: message.channelId,
      };
      for (const callback of this.messageRecalledCallbacks) {
        callback(payload);
      }
    });

    this.client = client;
    await client.login(discordConfig.token);
    console.log('[Discord] 网关登录请求已发送，等待 Ready 事件');
  }

  stop(): void {
    if (!this.client) {
      return;
    }
    this.client.destroy();
    this.client = null;
    this.isActive = false;
    this.messageConversationMap.clear();
    console.log('[Discord] 适配器已停止');
  }

  getSender(): PlatformSender {
    return this.sender;
  }

  onMessage(callback: (event: PlatformMessageEvent) => void): void {
    this.messageCallbacks.push(callback);
  }

  onInteraction(callback: (interaction: Interaction) => Promise<void> | void): void {
    this.interactionCallbacks.push(callback);
  }

  onAction(callback: (event: PlatformActionEvent) => void): void {
    this.actionCallbacks.push(callback);
  }

  onMessageRecalled(callback: (event: unknown) => void): void {
    this.messageRecalledCallbacks.push(callback);
  }

  bindSession(conversationId: string, sessionId: string, creatorId: string): void {
    chatSessionStore.setSessionByConversation('discord', conversationId, sessionId, creatorId);
    console.log(`[Discord] 会话绑定: discord:${conversationId} -> ${sessionId}`);
  }

  getSessionId(conversationId: string): string | null {
    return chatSessionStore.getSessionIdByConversation('discord', conversationId);
  }

  isAdapterActive(): boolean {
    return this.isActive;
  }

  getConversationByMessageId(messageId: string): string | undefined {
    return this.messageConversationMap.get(messageId);
  }

  rememberMessageConversation(messageId: string, conversationId: string): void {
    this.messageConversationMap.set(messageId, conversationId);
  }

  forgetMessageConversation(messageId: string): void {
    this.messageConversationMap.delete(messageId);
  }

  async resolveTextChannel(conversationId: string): Promise<DiscordSendableChannel | null> {
    if (!this.client) {
      return null;
    }

    const channel = await this.client.channels.fetch(conversationId);
    if (!channel || !channel.isTextBased() || !isDiscordSendableChannel(channel)) {
      return null;
    }
    return channel;
  }

  async fetchMessage(conversationId: string, messageId: string): Promise<Message | null> {
    const channel = await this.resolveTextChannel(conversationId);
    if (!channel) {
      return null;
    }

    try {
      const message = await channel.messages.fetch(messageId);
      return message;
    } catch {
      return null;
    }
  }

  private async handleMessageCreate(message: Message): Promise<void> {
    if (!this.client || message.author.bot) {
      return;
    }

    const botId = this.client.user?.id;
    const mentionPattern = botId
      ? new RegExp(`<@!?${escapeRegExp(botId)}>`, 'g')
      : null;

    const mentionUsers = Array.from(message.mentions.users.values());
    const targetMentions = botId
      ? mentionUsers.filter(user => user.id === botId)
      : mentionUsers;

    const mentions: PlatformMention[] = targetMentions.map(user => ({
      key: `<@${user.id}>`,
      id: { discord_id: user.id },
      name: user.username,
    }));

    const cleanedContent = mentionPattern
      ? message.content.replace(mentionPattern, '').trim()
      : message.content.trim();

    const attachments = Array.from(message.attachments.values()).map(attachment => ({
      type: attachment.contentType?.startsWith('image/') ? 'image' as const : 'file' as const,
      fileKey: attachment.id,
      fileName: attachment.name,
      fileType: attachment.contentType || undefined,
      fileSize: attachment.size,
    }));

    const chatType = message.channel.type === ChannelType.DM ? 'p2p' as const : 'group' as const;
    const event: PlatformMessageEvent = {
      platform: 'discord',
      conversationId: message.channelId,
      messageId: message.id,
      senderId: message.author.id,
      senderType: 'user',
      content: cleanedContent,
      msgType: message.attachments.size > 0 && !cleanedContent ? 'attachment' : 'text',
      threadId: message.channel.isThread() ? message.channel.id : undefined,
      chatType,
      attachments: attachments.length > 0 ? attachments : undefined,
      mentions: mentions.length > 0 ? mentions : undefined,
      rawEvent: message,
    };

    this.rememberMessageConversation(message.id, message.channelId);

    for (const callback of this.messageCallbacks) {
      await Promise.resolve(callback(event));
    }
  }

  private async handleInteractionCreate(interaction: Interaction): Promise<void> {
    if (interaction.isStringSelectMenu()) {
      const event: PlatformActionEvent = {
        platform: 'discord',
        senderId: interaction.user.id,
        action: {
          tag: interaction.customId,
          value: {
            values: interaction.values,
          },
        },
        token: interaction.id,
        messageId: interaction.message?.id,
        conversationId: interaction.channelId || undefined,
        rawEvent: interaction,
      };

      for (const callback of this.actionCallbacks) {
        await Promise.resolve(callback(event));
      }
    }

    for (const callback of this.interactionCallbacks) {
      await Promise.resolve(callback(interaction));
    }
  }
}

export const discordAdapter = new DiscordAdapter();
