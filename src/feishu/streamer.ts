import { feishuClient } from './client.js';
import { buildStreamCard } from './cards-stream.js';

export interface StreamState {
  text: string;
  thinking: string;
  tools: Array<{
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    output?: string;
  }>;
  status: 'processing' | 'completed' | 'failed';
}

export class CardStreamer {
  private chatId: string;
  private messageId: string | null = null;
  private state: StreamState = {
    text: '',
    thinking: '',
    tools: [],
    status: 'processing',
  };
  private lastUpdate: number = 0;
  private throttleMs: number = 500;
  private pendingUpdate: NodeJS.Timeout | null = null;

  constructor(chatId: string) {
    this.chatId = chatId;
  }

  async start(): Promise<void> {
    const card = this.buildCard();
    this.messageId = await feishuClient.sendCard(this.chatId, card);
  }

  updateText(delta: string): void {
    this.state.text += delta;
    this.scheduleUpdate();
  }

  updateThinking(delta: string): void {
    this.state.thinking += delta;
    this.scheduleUpdate();
  }

  addTool(name: string): void {
    this.state.tools.push({ name, status: 'pending' });
    this.scheduleUpdate();
  }

  updateToolStatus(name: string, status: 'running' | 'completed' | 'failed', output?: string): void {
    const tool = this.state.tools.find(t => t.name === name && t.status !== 'completed' && t.status !== 'failed');
    if (tool) {
      tool.status = status;
      if (output) tool.output = output;
      this.scheduleUpdate();
    }
  }

  setStatus(status: 'completed' | 'failed'): void {
    this.state.status = status;
    this.scheduleUpdate(true); // 立即更新
  }

  private scheduleUpdate(immediate = false): void {
    if (!this.messageId) return;

    if (immediate) {
      if (this.pendingUpdate) clearTimeout(this.pendingUpdate);
      this.doUpdate();
      return;
    }

    if (this.pendingUpdate) return;

    const now = Date.now();
    if (now - this.lastUpdate > this.throttleMs) {
      this.doUpdate();
    } else {
      this.pendingUpdate = setTimeout(() => {
        this.pendingUpdate = null;
        this.doUpdate();
      }, this.throttleMs);
    }
  }

  private async doUpdate(): Promise<void> {
    if (!this.messageId) return;
    this.lastUpdate = Date.now();
    const card = this.buildCard();
    await feishuClient.updateCard(this.messageId, card);
  }

  private buildCard(): object {
    // 复用 cards.ts 中的 buildStreamCard，但可能需要扩展它以支持更复杂的工具状态
    // 这里简单构造一个对象，或者稍后修改 cards.ts
    // 现有的 buildStreamCard 主要针对文本和简单的工具状态
    return buildStreamCard({
      thinking: this.state.thinking,
      text: this.state.text,
      tools: this.state.tools,
      status: this.state.status,
    });
  }
}
