import * as fs from 'fs';
import * as path from 'path';

// 会话-目录映射
interface SessionDirectoryData {
  sessionId: string;
  path: string;
  createdAt: number;
}

const STORE_FILE = path.resolve(process.cwd(), '.session-directories.json');

class SessionDirectoryStore {
  private data: Map<string, SessionDirectoryData> = new Map();

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
      console.error('[SessionDirectoryStore] Load failed:', error);
    }
  }

  private save(): void {
    try {
      const obj = Object.fromEntries(this.data);
      fs.writeFileSync(STORE_FILE, JSON.stringify(obj, null, 2));
    } catch (error) {
      console.error('[SessionDirectoryStore] Save failed:', error);
    }
  }

  get(sessionId: string): string | undefined {
    return this.data.get(sessionId)?.path;
  }

  set(sessionId: string, directoryPath: string): void {
    this.data.set(sessionId, {
      sessionId,
      path: directoryPath,
      createdAt: Date.now(),
    });
    this.save();
  }

  remove(sessionId: string): void {
    this.data.delete(sessionId);
    this.save();
  }
}

export const sessionDirectoryStore = new SessionDirectoryStore();
