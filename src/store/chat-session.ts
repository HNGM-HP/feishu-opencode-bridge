import * as fs from 'fs';
import * as path from 'path';

// 群组会话数据结构
interface ChatSessionData {
  chatId: string;
  sessionId: string;
  creatorId: string; // 创建者ID
  createdAt: number;
  title?: string;
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
  setSession(chatId: string, sessionId: string, creatorId: string, title?: string): void {
    const data: ChatSessionData = {
      chatId,
      sessionId,
      creatorId,
      createdAt: Date.now(),
      title,
    };
    this.data.set(chatId, data);
    this.save();
    console.log(`[Store] 绑定成功: chat=${chatId} -> session=${sessionId}`);
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
