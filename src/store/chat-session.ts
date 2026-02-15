import * as fs from 'fs';
import * as path from 'path';

// 群组会话数据结构
export type ChatSessionType = 'p2p' | 'group';

interface ChatSessionData {
  chatId: string;
  sessionId: string;
  creatorId: string; // 创建者ID
  createdAt: number;
  title?: string;
  chatType?: ChatSessionType;
  protectSessionDelete?: boolean;
  // Deprecated: use interactionHistory instead
  lastFeishuUserMsgId?: string;
  // Deprecated: use interactionHistory instead
  lastFeishuAiMsgId?: string;
  preferredModel?: string; // e.g., "openai:gpt-4"
  preferredAgent?: string;
  interactionHistory: InteractionRecord[];
}

export interface InteractionRecord {
  userFeishuMsgId: string;
  openCodeMsgId: string; // The ID of the user message in OpenCode (to revert to/from)
  botFeishuMsgIds: string[]; // All bot messages generated in this turn
  type: 'normal' | 'question_prompt' | 'question_answer';
  cardData?: any; // Store StreamCardData or other card data for UI interactions
  timestamp: number;
}

export interface SessionBindingOptions {
  protectSessionDelete?: boolean;
  chatType?: ChatSessionType;
}

// 存储文件路径
const STORE_FILE = path.join(process.cwd(), '.chat-sessions.json');

class ChatSessionStore {
  private data: Map<string, ChatSessionData> = new Map();

  constructor() {
    this.load();
  }

  // 从文件加载数据
  private load(): void {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const content = fs.readFileSync(STORE_FILE, 'utf-8');
        const parsed = JSON.parse(content);
        // 转换 object 到 Map
        this.data = new Map(Object.entries(parsed));
        console.log(`[Store] 已加载 ${this.data.size} 个群组会话`);
      }
    } catch (error) {
      console.error('[Store] 加载数据失败:', error);
    }
  }

  // 保存数据到文件
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
    if (title.startsWith('飞书私聊')) return 'p2p';
    if (title.startsWith('飞书群聊') || title.startsWith('群聊')) return 'group';
    return undefined;
  }

  // 获取群组当前绑定的会话ID
  getSessionId(chatId: string): string | null {
    const data = this.data.get(chatId);
    return data?.sessionId || null;
  }

  // 获取会话详细信息
  getSession(chatId: string): ChatSessionData | undefined {
    return this.data.get(chatId);
  }
  
  // 通过 SessionID 反查 ChatID
  getChatId(sessionId: string): string | undefined {
    for (const [chatId, data] of this.data.entries()) {
      if (data.sessionId === sessionId) {
        return chatId;
      }
    }
    return undefined;
  }

  // 绑定群组和会话
  setSession(
    chatId: string,
    sessionId: string,
    creatorId: string,
    title?: string,
    options?: SessionBindingOptions
  ): void {
    const current = this.data.get(chatId);
    const resolvedChatType =
      options?.chatType
      || current?.chatType
      || this.inferChatTypeFromTitle(title)
      || this.inferChatTypeFromTitle(current?.title);

    const data: ChatSessionData = {
      chatId,
      sessionId,
      creatorId,
      createdAt: Date.now(),
      title,
      ...(resolvedChatType ? { chatType: resolvedChatType } : {}),
      ...(options?.protectSessionDelete ? { protectSessionDelete: true } : {}),
      interactionHistory: [],
    };
    this.data.set(chatId, data);
    this.save();
    console.log(`[Store] 绑定成功: chat=${chatId} -> session=${sessionId}`);
  }

  isSessionDeleteProtected(chatId: string): boolean {
    const session = this.data.get(chatId);
    return session?.protectSessionDelete === true;
  }

  isPrivateChatSession(chatId: string): boolean {
    const session = this.data.get(chatId);
    if (!session) {
      return false;
    }

    if (session.chatType === 'p2p') {
      return true;
    }

    return typeof session.title === 'string' && session.title.startsWith('飞书私聊');
  }

  isGroupChatSession(chatId: string): boolean {
    const session = this.data.get(chatId);
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

    return session.title.startsWith('飞书群聊') || session.title.startsWith('群聊');
  }

  // 更新会话配置 (模型/Agent)
  updateConfig(chatId: string, config: { preferredModel?: string; preferredAgent?: string }): void {
    const session = this.data.get(chatId);
    if (session) {
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

  // Push a new interaction to history
  addInteraction(chatId: string, record: InteractionRecord): void {
    const session = this.data.get(chatId);
    if (session) {
      if (!session.interactionHistory) {
        session.interactionHistory = [];
      }
      session.interactionHistory.push(record);

      // Sync legacy fields for backward compatibility
      this.updateLegacyPointers(session);
      
      // Limit history size (e.g., keep last 20)
      if (session.interactionHistory.length > 20) {
        session.interactionHistory.shift();
        this.updateLegacyPointers(session);
      }
      
      this.save();
    }
  }

  // Pop the last interaction
  popInteraction(chatId: string): InteractionRecord | undefined {
    const session = this.data.get(chatId);
    if (session && session.interactionHistory && session.interactionHistory.length > 0) {
      const record = session.interactionHistory.pop();

      // Update legacy fields
      this.updateLegacyPointers(session);
      
      this.save();
      return record;
    }
    return undefined;
  }

  // Get the last interaction without popping
  getLastInteraction(chatId: string): InteractionRecord | undefined {
    const session = this.data.get(chatId);
    if (session && session.interactionHistory && session.interactionHistory.length > 0) {
      return session.interactionHistory[session.interactionHistory.length - 1];
    }
    return undefined;
  }
  
  // Find interaction by a bot message ID (useful for card actions)
  findInteractionByBotMsgId(chatId: string, msgId: string): InteractionRecord | undefined {
    const session = this.data.get(chatId);
    if (!session || !session.interactionHistory) return undefined;
    return session.interactionHistory.find(r => r.botFeishuMsgIds.includes(msgId));
  }

  // Update an existing interaction (e.g. to update cardData)
  updateInteraction(chatId: string, predicate: (r: InteractionRecord) => boolean, updater: (r: InteractionRecord) => void): void {
      const session = this.data.get(chatId);
      if (session && session.interactionHistory) {
          const record = session.interactionHistory.find(predicate);
          if (record) {
              updater(record);
              this.save();
          }
      }
  }

  // Deprecated: Use addInteraction instead
  updateLastInteraction(chatId: string, userMsgId: string, aiMsgId?: string): void {
    const session = this.data.get(chatId);
    if (session) {
      session.lastFeishuUserMsgId = userMsgId;
      if (aiMsgId) {
        session.lastFeishuAiMsgId = aiMsgId;
      }
      this.save();
    }
  }

  // 移除绑定（通常在群解散时调用）
  removeSession(chatId: string): void {
    if (this.data.has(chatId)) {
      this.data.delete(chatId);
      this.save();
      console.log(`[Store] 移除绑定: chat=${chatId}`);
    }
  }

  // 获取某用户创建的所有会话群（用于管理）
  getChatsByCreator(userId: string): ChatSessionData[] {
    const result: ChatSessionData[] = [];
    for (const data of this.data.values()) {
      if (data.creatorId === userId) {
        result.push(data);
      }
    }
    return result;
  }
  
  // 获取所有群聊ID（用于启动清理）
  getAllChatIds(): string[] {
    return Array.from(this.data.keys());
  }
}

// 单例导出
export const chatSessionStore = new ChatSessionStore();
