import { feishuClient, type FeishuMessageEvent, type FeishuCardActionEvent } from '../feishu/client.js';
import { opencodeClient } from '../opencode/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import {
  buildCreateChatCard,
  buildWelcomeCard,
  CREATE_CHAT_NEW_SESSION_VALUE,
  type CreateChatCardData,
  type CreateChatSessionOption,
} from '../feishu/cards.js';
import { parseCommand, getHelpText, type ParsedCommand } from '../commands/parser.js';
import { commandHandler } from './command.js';
import { groupHandler } from './group.js';
import { userConfig } from '../config.js';

interface EnsurePrivateSessionResult {
  firstBinding: boolean;
}

type OpencodeSession = Awaited<ReturnType<typeof opencodeClient.listSessions>>[number];

const CREATE_CHAT_OPTION_LIMIT = 100;
const CREATE_CHAT_EXISTING_LIMIT = CREATE_CHAT_OPTION_LIMIT - 1;

export class P2PHandler {
  private createChatSelectionMap: Map<string, string> = new Map();

  private async safeReply(
    messageId: string | undefined,
    chatId: string | undefined,
    text: string
  ): Promise<boolean> {
    if (messageId) {
      await feishuClient.reply(messageId, text);
      return true;
    }

    if (chatId) {
      await feishuClient.sendText(chatId, text);
      return true;
    }

    return false;
  }

  private getStringValue(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private getCardActionOption(event: FeishuCardActionEvent): string | undefined {
    const actionRecord = event.action as unknown as Record<string, unknown>;
    const option = actionRecord.option;
    if (typeof option === 'string') {
      return this.getStringValue(option);
    }

    if (option && typeof option === 'object') {
      const optionRecord = option as Record<string, unknown>;
      return this.getStringValue(optionRecord.value) || this.getStringValue(optionRecord.key);
    }

    return undefined;
  }

  private getCreateChatSelectionKeys(chatId?: string, messageId?: string, openId?: string): string[] {
    const keys: string[] = [];
    const normalizedMessageId = this.getStringValue(messageId);
    const normalizedChatId = this.getStringValue(chatId);
    const normalizedOpenId = this.getStringValue(openId);

    if (normalizedMessageId) {
      keys.push(`msg:${normalizedMessageId}`);
    }
    if (normalizedChatId && normalizedOpenId) {
      keys.push(`chat:${normalizedChatId}:user:${normalizedOpenId}`);
    }

    return keys;
  }

  private rememberCreateChatSelection(
    selectedSessionId: string,
    chatId?: string,
    messageId?: string,
    openId?: string
  ): void {
    const normalized = this.getStringValue(selectedSessionId);
    if (!normalized) return;

    const keys = this.getCreateChatSelectionKeys(chatId, messageId, openId);
    for (const key of keys) {
      this.createChatSelectionMap.set(key, normalized);
    }
  }

  private getRememberedCreateChatSelection(chatId?: string, messageId?: string, openId?: string): string | undefined {
    const keys = this.getCreateChatSelectionKeys(chatId, messageId, openId);
    for (const key of keys) {
      const selected = this.createChatSelectionMap.get(key);
      if (selected) {
        return selected;
      }
    }
    return undefined;
  }

  private clearCreateChatSelection(chatId?: string, messageId?: string, openId?: string): void {
    const keys = this.getCreateChatSelectionKeys(chatId, messageId, openId);
    for (const key of keys) {
      this.createChatSelectionMap.delete(key);
    }
  }

  private getSessionOptionLabel(session: OpencodeSession): string {
    const title = typeof session.title === 'string' && session.title.trim().length > 0
      ? session.title.trim()
      : '未命名会话';
    const compactTitle = title.length > 24 ? `${title.slice(0, 24)}...` : title;
    const shortId = session.id.slice(0, 8);
    return `${compactTitle} (${shortId})`;
  }

  private sortSessionsByUpdateTime(sessions: OpencodeSession[]): OpencodeSession[] {
    return [...sessions].sort((a, b) => {
      const left = b.time?.updated ?? b.time?.created ?? 0;
      const right = a.time?.updated ?? a.time?.created ?? 0;
      return left - right;
    });
  }

  private async buildCreateChatCardData(selectedSessionId?: string): Promise<CreateChatCardData> {
    const sessionOptions: CreateChatSessionOption[] = [
      {
        label: '新建 OpenCode 会话（默认）',
        value: CREATE_CHAT_NEW_SESSION_VALUE,
      },
    ];

    let totalSessionCount = 0;
    if (userConfig.enableManualSessionBind) {
      try {
        const sessions = this.sortSessionsByUpdateTime(await opencodeClient.listSessions());
        totalSessionCount = sessions.length;

        for (const session of sessions.slice(0, CREATE_CHAT_EXISTING_LIMIT)) {
          sessionOptions.push({
            label: this.getSessionOptionLabel(session),
            value: session.id,
          });
        }
      } catch (error) {
        console.warn('[P2P] 加载 OpenCode 会话列表失败，建群卡片将仅显示新建选项:', error);
      }
    }

    const hasSelected = sessionOptions.some(option => option.value === selectedSessionId);
    return {
      selectedSessionId: hasSelected ? selectedSessionId : CREATE_CHAT_NEW_SESSION_VALUE,
      sessionOptions,
      totalSessionCount,
      manualBindEnabled: userConfig.enableManualSessionBind,
    };
  }

  private async pushCreateChatCard(
    chatId: string,
    messageId?: string,
    selectedSessionId?: string,
    openId?: string
  ): Promise<void> {
    const cardData = await this.buildCreateChatCardData(selectedSessionId);
    const card = buildCreateChatCard(cardData);
    let sentCardMessageId: string | null = null;
    if (messageId) {
      sentCardMessageId = await feishuClient.replyCard(messageId, card);
    } else {
      sentCardMessageId = await feishuClient.sendCard(chatId, card);
    }

    this.rememberCreateChatSelection(
      selectedSessionId || CREATE_CHAT_NEW_SESSION_VALUE,
      chatId,
      sentCardMessageId || messageId,
      openId
    );
  }

  private getPrivateSessionShortId(openId: string): string {
    const normalized = openId.startsWith('ou_') ? openId.slice(3) : openId;
    return normalized.slice(0, 4);
  }

  private getPrivateSessionTitle(openId: string): string {
    const shortOpenId = this.getPrivateSessionShortId(openId);
    return `飞书私聊${shortOpenId || '用户'}`;
  }

  private isCreateGroupCommand(text: string): boolean {
    const trimmed = text.trim();
    const lowered = trimmed.toLowerCase();
    return (
      lowered === '/create_chat' ||
      lowered === '/create-chat' ||
      lowered === '/chat new' ||
      lowered === '/group new' ||
      trimmed === '/建群' ||
      trimmed === '建群'
    );
  }

  private async isSessionMissingInOpenCode(sessionId: string): Promise<boolean> {
    try {
      const sessions = await opencodeClient.listSessions();
      return !sessions.some(session => session.id === sessionId);
    } catch (error) {
      console.warn('[P2P] 校验会话存在性失败，保持当前绑定:', error);
      return false;
    }
  }

  private async ensurePrivateSession(chatId: string, senderId: string): Promise<EnsurePrivateSessionResult | null> {
    const current = chatSessionStore.getSession(chatId);
    if (current?.sessionId) {
      const missing = await this.isSessionMissingInOpenCode(current.sessionId);
      if (!missing) {
        return {
          firstBinding: false,
        };
      }

      console.log(`[P2P] 检测到绑定会话已删除，重新初始化: chat=${chatId}, session=${current.sessionId}`);
      chatSessionStore.removeSession(chatId);
    }

    try {
      const sessionTitle = this.getPrivateSessionTitle(senderId);
      const session = await opencodeClient.createSession(sessionTitle);
      chatSessionStore.setSession(chatId, session.id, senderId, sessionTitle);
      return {
        firstBinding: true,
      };
    } catch (error) {
      console.error('[P2P] 初始化私聊会话失败:', error);
      return null;
    }
  }

  private shouldSkipImmediateCommand(command: ParsedCommand): boolean {
    if (command.type === 'help' || command.type === 'panel') {
      return true;
    }

    return command.type === 'session' && command.sessionAction === 'new';
  }

  private async pushFirstContactGuidance(chatId: string, senderId: string, messageId: string): Promise<void> {
    const createChatData = await this.buildCreateChatCardData();
    const card = buildWelcomeCard(senderId, createChatData);
    const welcomeCardMessageId = await feishuClient.sendCard(chatId, card);
    this.rememberCreateChatSelection(
      CREATE_CHAT_NEW_SESSION_VALUE,
      chatId,
      welcomeCardMessageId || undefined,
      senderId
    );
    await this.safeReply(messageId, chatId, getHelpText());

    try {
      await commandHandler.pushPanelCard(chatId, 'p2p');
    } catch (error) {
      console.warn('[P2P] 发送私聊控制面板失败:', error);
    }
  }

  // 处理私聊消息
  async handleMessage(event: FeishuMessageEvent): Promise<void> {
    const { chatId, content, senderId, messageId } = event;
    const trimmedContent = content.trim();

    // 1. 检查命令
    const command = parseCommand(content);

    // 2. 首次私聊（或绑定会话在 OpenCode 中已被删除）时，自动初始化并推送引导
    const ensured = await this.ensurePrivateSession(chatId, senderId);
    if (!ensured) {
      await this.safeReply(messageId, chatId, '❌ 初始化私聊会话失败，请稍后重试');
      return;
    }

    if (ensured.firstBinding) {
      await this.pushFirstContactGuidance(chatId, senderId, messageId);
      if (this.shouldSkipImmediateCommand(command)) {
        return;
      }
    }

    // 3.1 私聊专属建群快捷命令
    if (this.isCreateGroupCommand(trimmedContent)) {
      await this.pushCreateChatCard(chatId, messageId, CREATE_CHAT_NEW_SESSION_VALUE, senderId);
      return;
    }

    // 3. 私聊命令
    if (command.type !== 'prompt') {
      console.log(`[P2P] 收到命令: ${command.type}`);
      await commandHandler.handle(command, {
        chatId,
        messageId,
        senderId,
        chatType: 'p2p'
      });
      return;
    }

    // 4. 私聊普通消息：按群聊同样逻辑转发到 OpenCode
    console.log(`[P2P] 收到私聊消息: user=${senderId}, content=${content.slice(0, 20)}...`);
    await groupHandler.handleMessage(event);
  }

  private async ensureUserInGroup(
    chatId: string,
    openId: string,
    invalidUserIds: string[]
  ): Promise<{ ok: boolean; message?: string }> {
    const userInvalidOnCreate = invalidUserIds.includes(openId);
    if (userInvalidOnCreate) {
      console.warn(`[P2P] 用户 ${openId} 在创建群时被标记为无效，尝试手动拉取...`);
    }

    let members = await feishuClient.getChatMembers(chatId);
    if (members.includes(openId)) {
      return { ok: true };
    }

    console.warn(`[P2P] 用户 ${openId} 未在新建群 ${chatId} 中，尝试手动拉取...`);
    const added = await feishuClient.addChatMembers(chatId, [openId]);
    if (!added) {
      return {
        ok: false,
        message: '❌ 无法将您添加到群聊。请确保机器人具有"获取群组信息"和"更新群组信息"权限，且您在机器人的可见范围内。',
      };
    }

    members = await feishuClient.getChatMembers(chatId);
    if (!members.includes(openId)) {
      return {
        ok: false,
        message: '❌ 创建群聊异常：无法确认成员状态，已自动清理无效群。',
      };
    }

    return { ok: true };
  }

  private async findSessionById(sessionId: string): Promise<OpencodeSession | null> {
    try {
      const sessions = await opencodeClient.listSessions();
      return sessions.find(session => session.id === sessionId) || null;
    } catch (error) {
      console.warn('[P2P] 查询 OpenCode 会话列表失败:', error);
      return null;
    }
  }

  private async createGroupWithSessionSelection(
    openId: string,
    selectedSessionId: string,
    chatId?: string,
    messageId?: string
  ): Promise<void> {
    const bindExistingSession = selectedSessionId !== CREATE_CHAT_NEW_SESSION_VALUE;
    if (bindExistingSession && !userConfig.enableManualSessionBind) {
      await this.safeReply(messageId, chatId, '❌ 当前环境未开启“绑定已有会话”能力');
      return;
    }

    console.log(`[P2P] 用户 ${openId} 请求创建新会话群，模式=${bindExistingSession ? '绑定已有会话' : '新建会话'}`);

    const chatName = `OpenCode会话-${Date.now().toString().slice(-4)}`;
    const createResult = await feishuClient.createChat(chatName, [openId], '由 OpenCode 自动创建的会话群');
    if (!createResult.chatId) {
      await this.safeReply(messageId, chatId, '❌ 创建群聊失败，请重试');
      return;
    }

    const newChatId = createResult.chatId;
    console.log(`[P2P] 群聊已创建，ID: ${newChatId}`);

    const userInGroup = await this.ensureUserInGroup(newChatId, openId, createResult.invalidUserIds);
    if (!userInGroup.ok) {
      await feishuClient.disbandChat(newChatId);
      await this.safeReply(messageId, chatId, userInGroup.message || '❌ 创建群聊失败，请重试');
      return;
    }

    console.log(`[P2P] 用户 ${openId} 已确认在群 ${newChatId} 中`);

    let targetSessionId = '';
    let sessionTitle = `飞书群聊: ${chatName}`;
    let protectSessionDelete = false;

    if (bindExistingSession) {
      const selectedSession = await this.findSessionById(selectedSessionId);
      if (!selectedSession) {
        await feishuClient.disbandChat(newChatId);
        await this.safeReply(messageId, chatId, `❌ 未找到会话: ${selectedSessionId}，请重新选择`);
        return;
      }

      targetSessionId = selectedSession.id;
      sessionTitle = selectedSession.title || sessionTitle;
      protectSessionDelete = true;
    } else {
      const session = await opencodeClient.createSession(sessionTitle);
      if (!session) {
        await feishuClient.disbandChat(newChatId);
        await this.safeReply(messageId, chatId, '❌ 创建 OpenCode 会话失败，请重试');
        return;
      }
      targetSessionId = session.id;
    }

    const previousChatId = chatSessionStore.getChatId(targetSessionId);
    if (previousChatId && previousChatId !== newChatId) {
      chatSessionStore.removeSession(previousChatId);
      console.log(`[P2P] 已迁移会话绑定: session=${targetSessionId}, from=${previousChatId}, to=${newChatId}`);
    }

    chatSessionStore.setSession(
      newChatId,
      targetSessionId,
      openId,
      sessionTitle,
      { protectSessionDelete }
    );
    console.log(`[P2P] 已绑定会话: Chat=${newChatId}, Session=${targetSessionId}`);

    const noticeLines = ['✅ 会话群已创建！', '正在为您跳转...'];
    if (bindExistingSession) {
      noticeLines.push('🔒 该会话已开启“删除保护”：自动清理不会删除 OpenCode 会话。');
    }
    if (previousChatId && previousChatId !== newChatId) {
      noticeLines.push('🔁 已将该会话从旧群迁移到当前新群。');
    }
    await this.safeReply(messageId, chatId, noticeLines.join('\n'));

    const onboardingText = bindExistingSession
      ? [
          '🔗 已绑定已有 OpenCode 会话，直接发送需求即可继续之前上下文。',
          '🎭 使用 /panel 选择角色，使用 /help 查看完整命令。',
        ].join('\n')
      : [
          '👋 会话已就绪，直接发送需求即可开始。',
          '🎭 使用 /panel 选择角色，使用 /help 查看完整命令。',
          '🧩 可创建自定义角色：创建角色 名称=旅行助手; 描述=擅长规划行程; 类型=主; 工具=webfetch',
        ].join('\n');
    await feishuClient.sendText(newChatId, onboardingText);

    try {
      await commandHandler.pushPanelCard(newChatId);
    } catch (error) {
      console.warn('[P2P] 发送开场控制面板失败:', error);
    }

  }

  // 处理私聊中的卡片动作
  async handleCardAction(event: FeishuCardActionEvent): Promise<object | void> {
    const { openId, chatId, messageId } = event;
    const actionValue = event.action.value && typeof event.action.value === 'object'
      ? event.action.value
      : {};
    const actionTag = this.getStringValue(actionValue.action);

    if (!actionTag) {
      return;
    }

    if (!chatId) {
      return {
        toast: {
          type: 'error',
          content: '无法定位私聊会话',
          i18n_content: { zh_cn: '无法定位私聊会话', en_us: 'Failed to locate private chat' },
        },
      };
    }

    if (actionTag === 'create_chat') {
      await this.pushCreateChatCard(chatId, messageId, CREATE_CHAT_NEW_SESSION_VALUE, openId);
      return {
        toast: {
          type: 'success',
          content: '已打开建群选项',
          i18n_content: { zh_cn: '已打开建群选项', en_us: 'Create chat options opened' },
        },
      };
    }

    if (actionTag === 'create_chat_select') {
      const selectedSessionId =
        this.getCardActionOption(event) ||
        this.getStringValue(actionValue.selectedSessionId) ||
        this.getStringValue(actionValue.selected) ||
        CREATE_CHAT_NEW_SESSION_VALUE;

      this.rememberCreateChatSelection(selectedSessionId, chatId, messageId, openId);
      return {
        toast: {
          type: 'success',
          content: '已记录会话选择',
          i18n_content: { zh_cn: '已记录会话选择', en_us: 'Session selection saved' },
        },
      };
    }

    if (actionTag === 'create_chat_submit') {
      const selectedSessionId =
        this.getRememberedCreateChatSelection(chatId, messageId, openId) ||
        this.getStringValue(actionValue.selectedSessionId) ||
        this.getStringValue(actionValue.selected) ||
        CREATE_CHAT_NEW_SESSION_VALUE;
      this.clearCreateChatSelection(chatId, messageId, openId);
      await this.createGroupWithSessionSelection(openId, selectedSessionId, chatId, messageId);
      return;
    }
  }
}

export const p2pHandler = new P2PHandler();
