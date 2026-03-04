import * as fs from 'fs';
import * as path from 'path';

// 用户会话映射数据结构
interface UserSessionData {
  userId: string;
  currentSessionId: string;
  sessions: Array<{
    id: string;
    title: string;
    createdAt: string;
  }>;
  lastActiveAt: string;
}

// 存储文件路径
const STORE_FILE = path.join(process.cwd(), '.user-sessions.json');

class UserSessionStore {
  private data: Map<string, UserSessionData> = new Map();

  constructor() {
    this.load();
  }

  // 从文件加载数据
  private load(): void {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const content = fs.readFileSync(STORE_FILE, 'utf-8');
        const parsed = JSON.parse(content);
        this.data = new Map(Object.entries(parsed));
        console.log(`[Store] 已加载 ${this.data.size} 个用户会话`);
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

  // 获取用户当前会话ID
  getCurrentSessionId(userId: string): string | null {
    const userData = this.data.get(userId);
    return userData?.currentSessionId || null;
  }

  // 设置用户当前会话
  setCurrentSession(userId: string, sessionId: string, title?: string): void {
    let userData = this.data.get(userId);

    if (!userData) {
      userData = {
        userId,
        currentSessionId: sessionId,
        sessions: [],
        lastActiveAt: new Date().toISOString(),
      };
      this.data.set(userId, userData);
    }

    userData.currentSessionId = sessionId;
    userData.lastActiveAt = new Date().toISOString();

    // 记录会话
    const existingSession = userData.sessions.find(s => s.id === sessionId);
    if (!existingSession) {
      userData.sessions.push({
        id: sessionId,
        title: title || '未命名对话',
        createdAt: new Date().toISOString(),
      });
    } else if (title) {
      existingSession.title = title;
    }

    this.save();
  }

  // 获取用户的所有会话
  getUserSessions(userId: string): Array<{ id: string; title: string; createdAt: string }> {
    const userData = this.data.get(userId);
    return userData?.sessions || [];
  }

  // 添加会话到用户列表
  addSession(userId: string, sessionId: string, title: string): void {
    let userData = this.data.get(userId);

    if (!userData) {
      userData = {
        userId,
        currentSessionId: sessionId,
        sessions: [],
        lastActiveAt: new Date().toISOString(),
      };
      this.data.set(userId, userData);
    }

    if (!userData.sessions.find(s => s.id === sessionId)) {
      userData.sessions.push({
        id: sessionId,
        title,
        createdAt: new Date().toISOString(),
      });
    }

    this.save();
  }

  // 移除会话
  removeSession(userId: string, sessionId: string): void {
    const userData = this.data.get(userId);
    if (userData) {
      userData.sessions = userData.sessions.filter(s => s.id !== sessionId);
      if (userData.currentSessionId === sessionId) {
        userData.currentSessionId = userData.sessions[0]?.id || '';
      }
      this.save();
    }
  }

  // 清除用户数据
  clearUser(userId: string): void {
    this.data.delete(userId);
    this.save();
  }
}

// 单例导出
export const userSessionStore = new UserSessionStore();
