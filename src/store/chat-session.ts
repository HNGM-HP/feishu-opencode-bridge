import * as fs from 'fs';
import * as path from 'path';
import type { EffortLevel } from '../commands/effort.js';

export type ChatSessionType = 'p2p' | 'group';

export interface ChatSessionData {
  chatId: string;
  sessionId: string;
  sessionDirectory?: string;
  creatorId: string;
  createdAt: number;
  title?: string;
  chatType?: ChatSessionType;
  protectSessionDelete?: boolean;
  lastFeishuUserMsgId?: string;
  lastFeishuAiMsgId?: string;
  preferredModel?: string;
  preferredAgent?: string;
  preferredEffort?: EffortLevel;
  resolvedDirectory?: string;
  projectName?: string;
  defaultDirectory?: string;
  reminderSent?: boolean;
  interactionHistory: InteractionRecord[];
}

interface SessionAliasRecord {
  chatId: string;
  expiresAt: number;
}

export interface InteractionRecord {
  userFeishuMsgId: string;
  openCodeMsgId: string;
  botFeishuMsgIds: string[];
  type: 'normal' | 'question_prompt' | 'question_answer';
  cardData?: any;
  timestamp: number;
}

export interface SessionBindingOptions {
  protectSessionDelete?: boolean;
  chatType?: ChatSessionType;
  sessionDirectory?: string;
  resolvedDirectory?: string;
  projectName?: string;
}

export interface ConversationBindingRecord {
  platform: string;
  conversationId: string;
  session: ChatSessionData;
}

const STORE_FILE = path.join(process.cwd(), '.chat-sessions.json');
const SESSION_ALIAS_TTL_MS = 10 * 60 * 1000;
const NAMESPACE_SEPARATOR = ':';
type PlatformId = string;

class ChatSessionStore {
  private data: Map<string, ChatSessionData> = new Map();
  private sessionAliases: Map<string, SessionAliasRecord> = new Map();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const content = fs.readFileSync(STORE_FILE, 'utf-8');
        const parsed = JSON.parse(content) as Record<string, ChatSessionData>;
        const migratedEntries: Array<[string, ChatSessionData]> = [];
        for (const [key, value] of Object.entries(parsed)) {
          const normalizedKey = this.isNamespacedKey(key) ? key : this.legacyToNamespacedKey(key);
          migratedEntries.push([normalizedKey, value]);
        }
        this.data = new Map(migratedEntries);
        console.log(`[Store] 已加载 ${this.data.size} 个群组会话`);
        this.save();
      }
    } catch (error) {
      console.error('[Store] 加载数据失败:', error);
    }
  }

  private save(): void {
    try {
      const obj = Object.fromEntries(this.data);
      fs.writeFileSync(STORE_FILE, JSON.stringify(obj, null, 2));
    } catch (error) {
      console.error('[Store] 保存数据失败:', error);
    }
  }

  private inferChatTypeFromTitle(title?: string): ChatSessionType | undefined {
    if (!title) return undefined;
    if (title.startsWith('飞书私聊') || title.startsWith('私聊-')) return 'p2p';
    if (title.startsWith('飞书群聊') || title.startsWith('群聊-') || title.startsWith('群聊会话')) return 'group';
    return undefined;
  }

  private makeConversationKey(platform: string, chatId: string): string {
    return `${platform}:${chatId}`;
  }

  private parseConversationKey(key: string): { platform: string; chatId: string } | null {
    const idx = key.indexOf(NAMESPACE_SEPARATOR);
    if (idx <= 0) return null;
    return { platform: key.slice(0, idx), chatId: key.slice(idx + 1) };
  }

  private isNamespacedKey(key: string): boolean {
    return key.includes(NAMESPACE_SEPARATOR);
  }

  private legacyToNamespacedKey(chatId: string): string {
    return this.makeConversationKey('feishu', chatId);
  }

  private hasLegacyKey(chatId: string): boolean {
    return this.data.has(chatId);
  }

  private getChatDataLegacyOrNamespaced(chatId: string): ChatSessionData | undefined {
    const namespacedKey = this.legacyToNamespacedKey(chatId);
    if (this.data.has(namespacedKey)) {
      return this.data.get(namespacedKey);
    }
    return this.data.get(chatId);
  }

  /**
   * 获取会话 ID（平台感知版本）
   * @param platform 平台标识（如 'feishu', 'discord'）
   * @param conversationId 平台原生会话 ID
   * @returns sessionId 或 null
   */
  getSessionIdByConversation(platform: string, conversationId: string): string | null {
    const key = this.makeConversationKey(platform, conversationId);
    const data = this.data.get(key);
    return data?.sessionId || null;
  }

  /**
   * 获取会话数据（平台感知版本）
   * @param platform 平台标识
   * @param conversationId 平台原生会话 ID
   * @returns ChatSessionData 或 undefined
   */
  getSessionByConversation(platform: string, conversationId: string): ChatSessionData | undefined {
    const key = this.makeConversationKey(platform, conversationId);
    return this.data.get(key);
  }

  /**
   * 反向查找：通过 sessionId 获取 {platform, conversationId}
   * @param sessionId 会话 ID
   * @returns { platform, conversationId } 或 null
   */
  getConversationBySessionId(sessionId: string): { platform: string; conversationId: string } | null {
    for (const [key, data] of this.data.entries()) {
      if (data.sessionId === sessionId) {
        const parsed = this.parseConversationKey(key);
        if (parsed) {
          return { platform: parsed.platform, conversationId: parsed.chatId };
        }
      }
    }
    return null;
  }

  /**
   * 旧版 getSessionId（兼容 Feishu 调用方）
   * 读取时优先 namespaced key，回退到 legacy key
   */
  getSessionId(chatId: string): string | null {
    const namespacedKey = this.legacyToNamespacedKey(chatId);
    if (this.data.has(namespacedKey)) {
      const data = this.data.get(namespacedKey);
      return data?.sessionId || null;
    }
    const data = this.data.get(chatId);
    return data?.sessionId || null;
  }

  /**
   * 旧版 getSession（兼容 Feishu 调用方）
   * 读取时优先 namespaced key，回退到 legacy key
   */
  getSession(chatId: string): ChatSessionData | undefined {
    const namespacedKey = this.legacyToNamespacedKey(chatId);
    if (this.data.has(namespacedKey)) {
      return this.data.get(namespacedKey);
    }
    return this.data.get(chatId);
  }

  getKnownDirectories(): string[] {
    const dirs = new Set<string>();
    for (const data of this.data.values()) {
      if (data.resolvedDirectory) dirs.add(data.resolvedDirectory);
      if (data.defaultDirectory) dirs.add(data.defaultDirectory);
    }
    return [...dirs];
  }

  getChatId(sessionId: string): string | undefined {
    this.cleanupExpiredSessionAliases();

    for (const [storageKey, data] of this.data.entries()) {
      if (data.sessionId === sessionId) {
        const parsed = this.parseConversationKey(storageKey);
        if (parsed) {
          return parsed.chatId;
        }
        return storageKey;
      }
    }

    const alias = this.sessionAliases.get(sessionId);
    if (!alias) {
      return undefined;
    }

    if (alias.expiresAt <= Date.now()) {
      this.sessionAliases.delete(sessionId);
      return undefined;
    }

    const hasMatchingKey = Array.from(this.data.keys()).some(key => {
      const parsed = this.parseConversationKey(key);
      return parsed ? parsed.chatId === alias.chatId : key === alias.chatId;
    });

    if (!hasMatchingKey) {
      this.sessionAliases.delete(sessionId);
      return undefined;
    }

    console.log(`[Store] 命中会话别名: session=${sessionId} -> chat=${alias.chatId}`);
    return alias.chatId;
  }

  private cleanupExpiredSessionAliases(): void {
    const now = Date.now();
    for (const [sessionId, alias] of this.sessionAliases.entries()) {
      const hasMatchingKey = Array.from(this.data.keys()).some(key => {
        const parsed = this.parseConversationKey(key);
        return parsed ? parsed.chatId === alias.chatId : key === alias.chatId;
      });
      if (alias.expiresAt <= now || !hasMatchingKey) {
        this.sessionAliases.delete(sessionId);
      }
    }
  }

  private removeExistingBindingsForSession(sessionId: string, exceptKey: string): void {
    for (const [key, existing] of this.data.entries()) {
      if (key === exceptKey || existing.sessionId !== sessionId) {
        continue;
      }

      this.data.delete(key);
      const parsed = this.parseConversationKey(key);
      if (parsed) {
        console.log(`[Store] 会话 ${sessionId} 已改绑，移除旧绑定: ${parsed.platform}:${parsed.chatId}`);
      } else {
        console.log(`[Store] 会话 ${sessionId} 已改绑，移除旧绑定: ${key}`);
      }
    }
  }

  /**
   * 设置会话（平台感知版本）
   * @param platform 平台标识
   * @param conversationId 平台原生会话 ID
   * @param sessionId 会话 ID
   * @param creatorId 创建者 ID
   * @param title 会话标题
   * @param options 绑定选项
   */
  setSessionByConversation(
    platform: string,
    conversationId: string,
    sessionId: string,
    creatorId: string,
    title?: string,
    options?: SessionBindingOptions
  ): void {
    const key = this.makeConversationKey(platform, conversationId);
    this.cleanupExpiredSessionAliases();

    const current = this.data.get(key);

    if (current?.sessionId && current.sessionId !== sessionId) {
      this.sessionAliases.set(current.sessionId, {
        chatId: conversationId,
        expiresAt: Date.now() + SESSION_ALIAS_TTL_MS,
      });
      console.log(`[Store] 创建会话别名: session=${current.sessionId} -> chat=${conversationId} (platform: ${platform})`);
    }
    this.sessionAliases.delete(sessionId);

    const resolvedChatType =
      options?.chatType
      || current?.chatType
      || this.inferChatTypeFromTitle(title)
      || this.inferChatTypeFromTitle(current?.title);

    const data: ChatSessionData = {
      chatId: conversationId,
      sessionId,
      ...(options?.sessionDirectory?.trim() ? { sessionDirectory: options.sessionDirectory.trim() } : {}),
      creatorId,
      createdAt: Date.now(),
      title,
      ...(resolvedChatType ? { chatType: resolvedChatType } : {}),
      ...(options?.protectSessionDelete ? { protectSessionDelete: true } : {}),
      ...(options?.resolvedDirectory ? { resolvedDirectory: options.resolvedDirectory } : {}),
      ...(options?.projectName ? { projectName: options.projectName } : {}),
      ...(current?.defaultDirectory ? { defaultDirectory: current.defaultDirectory } : {}),
      ...(current?.preferredModel ? { preferredModel: current.preferredModel } : {}),
      ...(current?.preferredAgent ? { preferredAgent: current.preferredAgent } : {}),
      ...(current?.preferredEffort ? { preferredEffort: current.preferredEffort } : {}),
      interactionHistory: [],
    };

    this.removeExistingBindingsForSession(sessionId, key);
    this.data.set(key, data);
    this.save();
    console.log(`[Store] 绑定成功: platform=${platform}, conversation=${conversationId} -> session=${sessionId}`);
  }

  /**
   * 旧版 setSession（兼容 Feishu 调用方）
   * 写入时使用命名空间键（feishu 为默认平台）
   */
  setSession(
    chatId: string,
    sessionId: string,
    creatorId: string,
    title?: string,
    options?: SessionBindingOptions
  ): void {
    this.cleanupExpiredSessionAliases();

    const namespacedKey = this.legacyToNamespacedKey(chatId);
    const current = this.getChatDataLegacyOrNamespaced(chatId);

    if (current?.sessionId && current.sessionId !== sessionId) {
      this.sessionAliases.set(current.sessionId, {
        chatId,
        expiresAt: Date.now() + SESSION_ALIAS_TTL_MS,
      });
      console.log(`[Store] 创建会话别名: session=${current.sessionId} -> chat=${chatId}`);
    }
    this.sessionAliases.delete(sessionId);

    const resolvedChatType =
      options?.chatType
      || current?.chatType
      || this.inferChatTypeFromTitle(title)
      || this.inferChatTypeFromTitle(current?.title);

    const data: ChatSessionData = {
      chatId,
      sessionId,
      ...(options?.sessionDirectory?.trim() ? { sessionDirectory: options.sessionDirectory.trim() } : {}),
      creatorId,
      createdAt: Date.now(),
      title,
      ...(resolvedChatType ? { chatType: resolvedChatType } : {}),
      ...(options?.protectSessionDelete ? { protectSessionDelete: true } : {}),
      ...(options?.resolvedDirectory ? { resolvedDirectory: options.resolvedDirectory } : {}),
      ...(options?.projectName ? { projectName: options.projectName } : {}),
      ...(current?.defaultDirectory ? { defaultDirectory: current.defaultDirectory } : {}),
      ...(current?.preferredModel ? { preferredModel: current.preferredModel } : {}),
      ...(current?.preferredAgent ? { preferredAgent: current.preferredAgent } : {}),
      ...(current?.preferredEffort ? { preferredEffort: current.preferredEffort } : {}),
      interactionHistory: [],
    };

    this.removeExistingBindingsForSession(sessionId, namespacedKey);
    this.data.set(namespacedKey, data);
    this.save();
    console.log(`[Store] 绑定成功: chat=${chatId} (namespaced: ${namespacedKey}) -> session=${sessionId}`);
  }

  rememberSessionAlias(sessionId: string, chatId: string, ttlMs: number = SESSION_ALIAS_TTL_MS): void {
    const normalizedSessionId = sessionId.trim();
    const normalizedChatId = chatId.trim();
    if (!normalizedSessionId || !normalizedChatId) {
      return;
    }

    this.cleanupExpiredSessionAliases();
    const chat = this.getChatDataLegacyOrNamespaced(normalizedChatId);
    if (!chat) {
      return;
    }

    if (chat.sessionId === normalizedSessionId) {
      return;
    }

    const safeTtl = Number.isFinite(ttlMs) ? Math.max(60000, Math.floor(ttlMs)) : SESSION_ALIAS_TTL_MS;
    this.sessionAliases.set(normalizedSessionId, {
      chatId: normalizedChatId,
      expiresAt: Date.now() + safeTtl,
    });
    console.log(`[Store] 记录临时会话别名: session=${normalizedSessionId} -> chat=${normalizedChatId}`);
  }

  isSessionDeleteProtected(chatId: string): boolean {
    const session = this.getChatDataLegacyOrNamespaced(chatId);
    return session?.protectSessionDelete === true;
  }

  isPrivateChatSession(chatId: string): boolean {
    const session = this.getChatDataLegacyOrNamespaced(chatId);
    if (!session) {
      return false;
    }

    if (session.chatType === 'p2p') {
      return true;
    }

    return typeof session.title === 'string' && (session.title.startsWith('飞书私聊') || session.title.startsWith('私聊-'));
  }

  isGroupChatSession(chatId: string): boolean {
    const session = this.getChatDataLegacyOrNamespaced(chatId);
    if (!session) {
      return false;
    }

    if (session.chatType === 'group') {
      return true;
    }

    if (session.chatType === 'p2p') {
      return false;
    }

    if (typeof session.title !== 'string') {
      return false;
    }

    return session.title.startsWith('飞书群聊') || session.title.startsWith('群聊-') || session.title.startsWith('群聊会话');
  }

  updateConfig(
    chatId: string,
    config: {
      preferredModel?: string;
      preferredAgent?: string;
      preferredEffort?: EffortLevel;
      defaultDirectory?: string;
    }
  ): void {
    const session = this.getChatDataLegacyOrNamespaced(chatId);
    if (!session) return;

    if ('preferredModel' in config) {
      if (config.preferredModel) {
        session.preferredModel = config.preferredModel;
      } else {
        delete session.preferredModel;
      }
    }

    if ('preferredAgent' in config) {
      if (config.preferredAgent) {
        session.preferredAgent = config.preferredAgent;
      } else {
        delete session.preferredAgent;
      }
    }

    if ('preferredEffort' in config) {
      if (config.preferredEffort) {
        session.preferredEffort = config.preferredEffort;
      } else {
        delete session.preferredEffort;
      }
    }

    if ('defaultDirectory' in config) {
      if (config.defaultDirectory) {
        session.defaultDirectory = config.defaultDirectory;
      } else {
        delete session.defaultDirectory;
      }
    }
    this.save();
  }

  updateConfigByConversation(
    platform: string,
    conversationId: string,
    config: {
      preferredModel?: string;
      preferredAgent?: string;
      preferredEffort?: EffortLevel;
      defaultDirectory?: string;
    }
  ): void {
    const session = this.getSessionByConversation(platform, conversationId);
    if (!session) return;

    if ('preferredModel' in config) {
      if (config.preferredModel) {
        session.preferredModel = config.preferredModel;
      } else {
        delete session.preferredModel;
      }
    }

    if ('preferredAgent' in config) {
      if (config.preferredAgent) {
        session.preferredAgent = config.preferredAgent;
      } else {
        delete session.preferredAgent;
      }
    }

    if ('preferredEffort' in config) {
      if (config.preferredEffort) {
        session.preferredEffort = config.preferredEffort;
      } else {
        delete session.preferredEffort;
      }
    }

    if ('defaultDirectory' in config) {
      if (config.defaultDirectory) {
        session.defaultDirectory = config.defaultDirectory;
      } else {
        delete session.defaultDirectory;
      }
    }

    this.save();
  }

  updateTitle(chatId: string, title: string): void {
    const session = this.getChatDataLegacyOrNamespaced(chatId);
    if (session) {
      session.title = title;
      this.save();
    }
  }

  updateResolvedDirectory(chatId: string, directory: string): void {
    const session = this.getChatDataLegacyOrNamespaced(chatId);
    if (session) {
      session.resolvedDirectory = directory;
      this.save();
    }
  }

  private updateLegacyPointers(session: ChatSessionData): void {
    let lastUserMsgId: string | undefined;
    for (let i = session.interactionHistory.length - 1; i >= 0; i--) {
      const msgId = session.interactionHistory[i].userFeishuMsgId;
      if (msgId) {
        lastUserMsgId = msgId;
        break;
      }
    }

    let lastAiMsgId: string | undefined;
    for (let i = session.interactionHistory.length - 1; i >= 0; i--) {
      const msgIds = session.interactionHistory[i].botFeishuMsgIds;
      if (msgIds.length > 0) {
        lastAiMsgId = msgIds[msgIds.length - 1];
        break;
      }
    }

    session.lastFeishuUserMsgId = lastUserMsgId;
    session.lastFeishuAiMsgId = lastAiMsgId;
  }

  addInteraction(chatId: string, record: InteractionRecord): void {
    const session = this.getChatDataLegacyOrNamespaced(chatId);
    if (session) {
      if (!session.interactionHistory) {
        session.interactionHistory = [];
      }
      session.interactionHistory.push(record);

      this.updateLegacyPointers(session);

      if (session.interactionHistory.length > 20) {
        session.interactionHistory.shift();
        this.updateLegacyPointers(session);
      }

      this.save();
    }
  }

  popInteraction(chatId: string): InteractionRecord | undefined {
    const session = this.getChatDataLegacyOrNamespaced(chatId);
    if (session && session.interactionHistory && session.interactionHistory.length > 0) {
      const record = session.interactionHistory.pop();

      this.updateLegacyPointers(session);
      this.save();
      return record;
    }
    return undefined;
  }

  getLastInteraction(chatId: string): InteractionRecord | undefined {
    const session = this.getChatDataLegacyOrNamespaced(chatId);
    if (session && session.interactionHistory && session.interactionHistory.length > 0) {
      return session.interactionHistory[session.interactionHistory.length - 1];
    }
    return undefined;
  }

  findInteractionByBotMsgId(chatId: string, msgId: string): InteractionRecord | undefined {
    const session = this.getChatDataLegacyOrNamespaced(chatId);
    if (!session || !session.interactionHistory) return undefined;
    return session.interactionHistory.find(r => r.botFeishuMsgIds.includes(msgId));
  }

  updateInteraction(chatId: string, predicate: (r: InteractionRecord) => boolean, updater: (r: InteractionRecord) => void): void {
    const session = this.getChatDataLegacyOrNamespaced(chatId);
    if (session && session.interactionHistory) {
      const record = session.interactionHistory.find(predicate);
      if (record) {
        updater(record);
        this.save();
      }
    }
  }

  updateLastInteraction(chatId: string, userMsgId: string, aiMsgId?: string): void {
    const session = this.getChatDataLegacyOrNamespaced(chatId);
    if (session) {
      session.lastFeishuUserMsgId = userMsgId;
      if (aiMsgId) {
        session.lastFeishuAiMsgId = aiMsgId;
      }
      this.save();
    }
  }

  removeSession(chatId: string): void {
    const namespacedKey = this.legacyToNamespacedKey(chatId);

    if (this.data.has(namespacedKey)) {
      const session = this.data.get(namespacedKey);
      if (session?.sessionId) {
        for (const [sid, alias] of this.sessionAliases.entries()) {
          if (alias.chatId === chatId) {
            this.sessionAliases.delete(sid);
          }
        }
      }
      this.data.delete(namespacedKey);
      this.save();
      console.log(`[Store] 移除绑定 (namespaced): chat=${chatId} -> ${namespacedKey}`);
      return;
    }

    if (this.data.has(chatId)) {
      for (const [sessionId, alias] of this.sessionAliases.entries()) {
        if (alias.chatId === chatId) {
          this.sessionAliases.delete(sessionId);
        }
      }
      this.data.delete(chatId);
      this.save();
      console.log(`[Store] 移除绑定 (legacy): chat=${chatId}`);
    }
  }

  removeSessionByConversation(platform: string, conversationId: string): void {
    const key = this.makeConversationKey(platform, conversationId);
    if (!this.data.has(key)) {
      return;
    }

    const existing = this.data.get(key);
    if (existing?.sessionId) {
      this.sessionAliases.delete(existing.sessionId);
    }

    this.data.delete(key);
    this.save();
    console.log(`[Store] 移除绑定 (platform): ${platform}:${conversationId}`);
  }

  markReminderSent(platform: string, conversationId: string): void {
    const session = this.getSessionByConversation(platform, conversationId);
    if (!session) return;

    session.reminderSent = true;
    this.save();
  }

  getChatsByCreator(userId: string): ChatSessionData[] {
    const result: ChatSessionData[] = [];
    for (const data of this.data.values()) {
      if (data.creatorId === userId) {
        result.push(data);
      }
    }
    return result;
  }

  getConversationBindings(): ConversationBindingRecord[] {
    const result: ConversationBindingRecord[] = [];
    for (const [key, session] of this.data.entries()) {
      const parsed = this.parseConversationKey(key);
      if (!parsed) {
        result.push({
          platform: 'feishu',
          conversationId: key,
          session,
        });
        continue;
      }

      result.push({
        platform: parsed.platform,
        conversationId: parsed.chatId,
        session,
      });
    }
    return result;
  }

  findPrivateConversationByCreator(userId: string, preferredPlatform?: string): ConversationBindingRecord | null {
    const bindings = this.getConversationBindings().filter(item => item.session.creatorId === userId);
    if (bindings.length === 0) {
      return null;
    }

    const samePlatform = preferredPlatform
      ? bindings.filter(item => item.platform === preferredPlatform)
      : bindings;
    const candidates = samePlatform.length > 0 ? samePlatform : bindings;
    const privateBinding = candidates.find(item => item.session.chatType === 'p2p')
      || candidates.find(item => this.isPrivateChatSession(item.conversationId));
    return privateBinding || null;
  }

  getAllChatIds(): string[] {
    return Array.from(this.data.keys()).map(key => {
      const parsed = this.parseConversationKey(key);
      if (parsed) {
        return parsed.chatId;
      }
      return key;
    });
  }

  /**
   * 获取指定平台的所有会话 ID
   * @param platform 平台标识（如 'feishu', 'discord'）
   * @returns 该平台所有会话的 chatId 列表
   */
  getChatIdsByPlatform(platform: string): string[] {
    const result: string[] = [];
    for (const key of this.data.keys()) {
      const parsed = this.parseConversationKey(key);
      if (parsed && parsed.platform === platform) {
        result.push(parsed.chatId);
      }
    }
    return result;
  }

  hasConversationId(conversationId: string): boolean {
    for (const key of this.data.keys()) {
      const parsed = this.parseConversationKey(key);
      if (parsed) {
        if (parsed.chatId === conversationId) {
          return true;
        }
        continue;
      }

      if (key === conversationId) {
        return true;
      }
    }
    return false;
  }

}

export const chatSessionStore = new ChatSessionStore();
