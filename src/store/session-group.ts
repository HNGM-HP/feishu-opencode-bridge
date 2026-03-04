import * as fs from 'fs';
import * as path from 'path';

// 用户-群组映射
interface SessionGroupData {
  userId: string;
  activeChatId?: string; // 当前活跃的会话群ID
  groups: Array<{
    chatId: string;
    createdAt: number;
    title?: string;
  }>;
}

const STORE_FILE = path.resolve(process.cwd(), '.session-groups.json');

class SessionGroupStore {
  private data: Map<string, SessionGroupData> = new Map();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const content = fs.readFileSync(STORE_FILE, 'utf-8');
        const parsed = JSON.parse(content);
        this.data = new Map(Object.entries(parsed));
      }
    } catch (error) {
      console.error('[SessionGroupStore] Load failed:', error);
    }
  }

  private save(): void {
    try {
      const obj = Object.fromEntries(this.data);
      fs.writeFileSync(STORE_FILE, JSON.stringify(obj, null, 2));
    } catch (error) {
      console.error('[SessionGroupStore] Save failed:', error);
    }
  }

  getActiveGroup(userId: string): string | undefined {
    return this.data.get(userId)?.activeChatId;
  }

  setActiveGroup(userId: string, chatId: string): void {
    let userData = this.data.get(userId);
    if (!userData) {
      userData = { userId, groups: [] };
      this.data.set(userId, userData);
    }

    userData.activeChatId = chatId;
    if (!userData.groups.find(g => g.chatId === chatId)) {
      userData.groups.push({
        chatId,
        createdAt: Date.now()
      });
    }
    this.save();
  }

  removeGroup(userId: string, chatId: string): void {
    const userData = this.data.get(userId);
    if (!userData) return;

    userData.groups = userData.groups.filter(g => g.chatId !== chatId);
    if (userData.activeChatId === chatId) {
      userData.activeChatId = undefined;
      // 如果还有其他群，设为活跃？暂时不自动切换，等待用户新建
    }
    this.save();
  }

  // 通过群ID反查用户（用于群解散事件）
  findUserByChatId(chatId: string): string | undefined {
    for (const [userId, data] of this.data.entries()) {
      if (data.groups.some(g => g.chatId === chatId)) {
        return userId;
      }
    }
    return undefined;
  }

  // 获取群组信息
  getGroupInfo(chatId: string): { chatId: string; createdAt: number; title?: string } | undefined {
    const userId = this.findUserByChatId(chatId);
    if (!userId) return undefined;
    
    const userData = this.data.get(userId);
    return userData?.groups.find(g => g.chatId === chatId);
  }

  // 更新群组标题
  updateGroupTitle(chatId: string, title: string): void {
    const userId = this.findUserByChatId(chatId);
    if (!userId) return;

    const userData = this.data.get(userId);
    if (!userData) return;

    const group = userData.groups.find(g => g.chatId === chatId);
    if (group) {
      group.title = title;
      this.save();
    }
  }
}

export const sessionGroupStore = new SessionGroupStore();
