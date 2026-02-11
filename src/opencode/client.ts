import { createOpencodeClient, type OpencodeClient as SdkOpencodeClient } from '@opencode-ai/sdk';
import type { Session, Message, Part } from '@opencode-ai/sdk';
import { opencodeConfig, modelConfig } from '../config.js';
import { EventEmitter } from 'events';

// 权限请求事件类型
export interface PermissionRequestEvent {
  sessionId: string;
  permissionId: string;
  tool: string;
  description: string;
  risk?: string;
}

interface PermissionEventProperties {
  sessionID?: string;
  sessionId?: string;
  id?: string;
  tool?: unknown;
  permission?: unknown;
  description?: string;
  risk?: string;
  metadata?: Record<string, unknown>;
}

function getPermissionLabel(props: PermissionEventProperties): string {
  if (typeof props.permission === 'string' && props.permission.trim()) {
    return props.permission;
  }

  if (typeof props.tool === 'string' && props.tool.trim()) {
    return props.tool;
  }

  if (props.tool && typeof props.tool === 'object') {
    const toolObj = props.tool as Record<string, unknown>;
    if (typeof toolObj.name === 'string' && toolObj.name.trim()) {
      return toolObj.name;
    }
  }

  return 'unknown';
}

// 消息部分类型
export interface MessagePart {
  type: string;
  text?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
}

export type AgentMode = 'primary' | 'subagent' | 'all';

export interface OpencodeAgentInfo {
  name: string;
  description?: string;
  mode?: AgentMode;
  hidden?: boolean;
  builtIn?: boolean;
  native?: boolean;
}

export interface OpencodeAgentConfig {
  description?: string;
  mode?: AgentMode;
  prompt?: string;
  tools?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface OpencodeRuntimeConfig {
  agent?: Record<string, OpencodeAgentConfig>;
  [key: string]: unknown;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return undefined;
}

function parseAgentMode(value: unknown): AgentMode | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'primary' || normalized === 'subagent' || normalized === 'all') {
    return normalized;
  }
  return undefined;
}

class OpencodeClientWrapper extends EventEmitter {
  private client: SdkOpencodeClient | null = null;
  private eventAbortController: AbortController | null = null;

  constructor() {
    super();
  }

  // 连接到OpenCode服务器
  async connect(): Promise<boolean> {
    try {
      console.log(`[OpenCode] 正在连接到 ${opencodeConfig.baseUrl}...`);

      this.client = createOpencodeClient({
        baseUrl: opencodeConfig.baseUrl,
      });

      // 通过获取会话列表来检查服务器状态
      try {
        await this.client.session.list();
        console.log('[OpenCode] 已连接');
        
        // 启动事件监听
        this.startEventListener();
        return true;
      } catch {
        console.error('[OpenCode] 服务器状态异常');
        return false;
      }
    } catch (error) {
      console.error('[OpenCode] 连接失败:', error);
      return false;
    }
  }

  // 启动SSE事件监听
  private async startEventListener(): Promise<void> {
    if (!this.client) return;

    this.eventAbortController = new AbortController();

    try {
      const events = await this.client.event.subscribe();
      console.log('[OpenCode] 事件流订阅成功');
      
      // 异步处理事件流
      (async () => {
        try {
          for await (const event of events.stream) {
            // Debug log for permission requests to catch missing ones
            if (event.type.startsWith('permission')) {
                 console.log(`[OpenCode] 收到底层事件: ${event.type}`, JSON.stringify(event.properties || {}).slice(0, 200));
            }
            this.handleEvent(event);
          }
        } catch (error) {

          if (!this.eventAbortController?.signal.aborted) {
            console.error('[OpenCode] 事件流中断:', error);
            // 尝试重连
            setTimeout(() => this.startEventListener(), 5000);
          }
        }
      })();
    } catch (error) {
      console.error('[OpenCode] 无法订阅事件:', error);
    }
  }

  // 处理SSE事件
  private handleEvent(event: { type: string; properties?: Record<string, unknown> }): void {
    // 权限请求事件 (compat: support both 'permission.request' and 'permission.asked')
    if ((event.type === 'permission.request' || event.type === 'permission.asked') && event.properties) {
      const props = event.properties as PermissionEventProperties;

      const permissionEvent: PermissionRequestEvent = {
        sessionId: props.sessionID || props.sessionId || '',
        permissionId: props.id || '',
        // permission.asked 的 tool 常为对象（messageID/callID），显示/判断应优先用 permission
        tool: getPermissionLabel(props),
        // If description is missing, try to construct one from metadata
        description: props.description || (props.metadata ? JSON.stringify(props.metadata) : ''),
        risk: props.risk,
      };

      this.emit('permissionRequest', permissionEvent);
    }


    // 消息更新事件
    if (event.type === 'message.updated' && event.properties) {
      this.emit('messageUpdated', event.properties);
    }

    // 会话状态变化事件
    if (event.type === 'session.status' && event.properties) {
      this.emit('sessionStatus', event.properties);
    }

    // 会话空闲事件（处理完成）
    if (event.type === 'session.idle' && event.properties) {
      this.emit('sessionIdle', event.properties);
    }

    // 会话错误事件
    if (event.type === 'session.error' && event.properties) {
      this.emit('sessionError', event.properties);
    }

    // 消息部分更新事件（流式输出）
    if (event.type === 'message.part.updated' && event.properties) {
      this.emit('messagePartUpdated', event.properties);
    }

    // AI 提问事件
    if (event.type === 'question.asked' && event.properties) {
      this.emit('questionAsked', event.properties);
    }
  }

  // 获取客户端实例
  getClient(): SdkOpencodeClient {
    if (!this.client) {
      throw new Error('OpenCode客户端未连接');
    }
    return this.client;
  }

  // 获取或创建会话
  async getOrCreateSession(title?: string): Promise<Session> {
    const client = this.getClient();
    
    // 尝试获取现有会话列表
    const sessions = await client.session.list();
    
    // 如果有会话，返回最近的一个
    if (sessions.data && sessions.data.length > 0) {
      const latestSession = sessions.data[0];
      return latestSession;
    }

    // 创建新会话
    const newSession = await client.session.create({
      body: { title: title || '飞书对话' },
    });

    return newSession.data!;
  }

  private resolveModelOption(options?: { providerId?: string; modelId?: string }): { providerID: string; modelID: string } | undefined {
    const providerId = options?.providerId?.trim();
    const modelId = options?.modelId?.trim();
    if (providerId && modelId) {
      return {
        providerID: providerId,
        modelID: modelId,
      };
    }

    const defaultProvider = modelConfig.defaultProvider;
    const defaultModel = modelConfig.defaultModel;
    if (defaultProvider && defaultModel) {
      return {
        providerID: defaultProvider,
        modelID: defaultModel,
      };
    }

    return undefined;
  }

  // 发送消息并等待响应
  async sendMessage(
    sessionId: string,
    text: string,
    options?: {
      providerId?: string;
      modelId?: string;
      agent?: string;
    }
  ): Promise<{ info: Message; parts: Part[] }> {
    const client = this.getClient();
    const model = this.resolveModelOption(options);

    const response = await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: 'text', text }],
        ...(options?.agent ? { agent: options.agent } : {}),
        ...(model ? { model } : {}),
      },
    });

    return response.data as { info: Message; parts: Part[] };
  }

  // 发送带多类型 parts 的消息
  async sendMessageParts(
    sessionId: string,
    parts: Array<{ type: 'text'; text: string } | { type: 'file'; mime: string; url: string; filename?: string }>,
    options?: {
      providerId?: string;
      modelId?: string;
      agent?: string;
    },
    messageId?: string
  ): Promise<{ info: Message; parts: Part[] }> {
    const client = this.getClient();
    const model = this.resolveModelOption(options);

    const response = await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts,
        // ...(messageId ? { messageID: messageId } : {}), // 已注释：避免传递飞书 MessageID 导致 Opencode 无法处理
        ...(options?.agent ? { agent: options.agent } : {}),
        ...(model ? { model } : {}),
      },
    });

    return response.data as { info: Message; parts: Part[] };
  }

  // 异步发送消息（不等待响应）
  async sendMessageAsync(
    sessionId: string,
    text: string,
    options?: {
      providerId?: string;
      modelId?: string;
      agent?: string;
    }
  ): Promise<void> {
    this.getClient();
    const model = this.resolveModelOption(options);

    const response = await fetch(`${opencodeConfig.baseUrl}/session/${sessionId}/prompt_async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parts: [{ type: 'text', text }],
        ...(options?.agent ? { agent: options.agent } : {}),
        ...(model ? { model } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const suffix = detail ? `: ${detail.slice(0, 300)}` : '';
      throw new Error(`prompt_async 请求失败 (${response.status} ${response.statusText})${suffix}`);
    }
  }

  // 异步发送多 parts 消息（立即返回，结果通过事件流推送）
  async sendMessagePartsAsync(
    sessionId: string,
    parts: Array<{ type: 'text'; text: string } | { type: 'file'; mime: string; url: string; filename?: string }>,
    options?: {
      providerId?: string;
      modelId?: string;
      agent?: string;
    }
  ): Promise<void> {
    this.getClient();
    const model = this.resolveModelOption(options);

    const response = await fetch(`${opencodeConfig.baseUrl}/session/${sessionId}/prompt_async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parts,
        ...(options?.agent ? { agent: options.agent } : {}),
        ...(model ? { model } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const suffix = detail ? `: ${detail.slice(0, 300)}` : '';
      throw new Error(`prompt_async 请求失败 (${response.status} ${response.statusText})${suffix}`);
    }
  }

  // 发送命令
  async sendCommand(
    sessionId: string,
    command: string,
    args: string
  ): Promise<{ info: Message; parts: Part[] } | null> {
    const client = this.getClient();
    try {
      const result = await client.session.command({
        path: { id: sessionId },
        body: {
          command,
          arguments: args,
        },
      });
      return result.data as { info: Message; parts: Part[] };
    } catch (error) {
      console.error('[OpenCode] 发送命令失败:', error);
      return null;
    }
  }

  // 撤回消息
  async revertMessage(sessionId: string, messageId: string): Promise<boolean> {
    const client = this.getClient();
    try {
      const result = await client.session.revert({
        path: { id: sessionId },
        body: { messageID: messageId },
      });
      return Boolean(result.data);
    } catch (error) {
      console.error('[OpenCode] 撤回消息失败:', error);
      return false;
    }
  }

  // 中断会话执行
  async abortSession(sessionId: string): Promise<boolean> {
    const client = this.getClient();

    try {
      const result = await client.session.abort({
        path: { id: sessionId },
      });
      return result.data === true;
    } catch (error) {
      console.error('[OpenCode] 中断会话失败:', error);
      return false;
    }
  }

  // 响应权限请求
  async respondToPermission(
    sessionId: string,
    permissionId: string,
    allow: boolean,
    remember?: boolean
  ): Promise<boolean> {
    try {
      const responseType = allow ? (remember ? 'always' : 'once') : 'reject';
      const response = await fetch(
        `${opencodeConfig.baseUrl}/session/${sessionId}/permissions/${permissionId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            response: responseType,
          }),
        }
      );
      return response.ok;
    } catch (error) {
      console.error('[OpenCode] 响应权限失败:', error);
      return false;
    }
  }

  // 获取会话列表
  async listSessions(): Promise<Session[]> {
    const client = this.getClient();
    const result = await client.session.list();
    return result.data || [];
  }

  // 创建新会话
  async createSession(title?: string): Promise<Session> {
    const client = this.getClient();
    const result = await client.session.create({
      body: { title: title || '新对话' },
    });
    return result.data!;
  }

  // 删除会话
  async deleteSession(sessionId: string): Promise<boolean> {
    const client = this.getClient();
    try {
      await client.session.delete({
        path: { id: sessionId },
      });
      console.log(`[OpenCode] 已删除会话: ${sessionId}`);
      return true;
    } catch (error) {
      console.error(`[OpenCode] 删除会话失败: ${sessionId}`, error);
      return false;
    }
  }

  // 获取会话消息
  async getSessionMessages(sessionId: string): Promise<Array<{ info: Message; parts: Part[] }>> {
    const client = this.getClient();
    const result = await client.session.messages({
      path: { id: sessionId },
    });
    return result.data || [];
  }

  // 获取配置（含模型列表）
  async getProviders(): Promise<{
    providers: Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>;
    default: Record<string, string>;
  }> {
    const client = this.getClient();
    const result = await client.config.providers();
    return result.data as unknown as {
      providers: Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>;
      default: Record<string, string>;
    };
  }

  // 获取完整配置
  async getConfig(): Promise<OpencodeRuntimeConfig> {
    const client = this.getClient();
    const result = await client.config.get();
    return (result.data || {}) as OpencodeRuntimeConfig;
  }

  // 更新完整配置
  async updateConfig(config: OpencodeRuntimeConfig): Promise<OpencodeRuntimeConfig | null> {
    const client = this.getClient();
    try {
      const result = await client.config.update({
        body: config as unknown as never,
      });
      return (result.data || null) as OpencodeRuntimeConfig | null;
    } catch (error) {
      console.error('[OpenCode] 更新配置失败:', error);
      return null;
    }
  }

  // 获取可用 Agent 列表
  async getAgents(): Promise<OpencodeAgentInfo[]> {
    const client = this.getClient();
    const result = await client.app.agents();
    const rawAgents = Array.isArray(result.data) ? result.data : [];
    const agents: OpencodeAgentInfo[] = [];

    for (const item of rawAgents) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      if (!name) continue;

      const description = typeof record.description === 'string' && record.description.trim().length > 0
        ? record.description.trim()
        : undefined;
      const mode = parseAgentMode(record.mode);
      const hidden = parseBoolean(record.hidden);
      const builtIn = parseBoolean(record.builtIn);
      const native = parseBoolean(record.native);

      agents.push({
        name,
        description,
        mode,
        ...(hidden !== undefined ? { hidden } : {}),
        ...(builtIn !== undefined ? { builtIn } : {}),
        ...(native !== undefined ? { native } : {}),
      });
    }

    return agents;
  }

  // 回复问题 (question 工具)
  // answers 是一个二维数组: [[第一个问题的答案们], [第二个问题的答案们], ...]
  // 每个答案是选项的 label
  async replyQuestion(
    requestId: string,
    answers: string[][]
  ): Promise<boolean> {
    try {
      const response = await fetch(
        `${opencodeConfig.baseUrl}/question/${requestId}/reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers }),
        }
      );
      return response.ok;
    } catch (error) {
      console.error('[OpenCode] 回复问题失败:', error);
      return false;
    }
  }

  // 拒绝/跳过问题
  async rejectQuestion(requestId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${opencodeConfig.baseUrl}/question/${requestId}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      return response.ok;
    } catch (error) {
      console.error('[OpenCode] 拒绝问题失败:', error);
      return false;
    }
  }

  // 断开连接
  disconnect(): void {
    if (this.eventAbortController) {
      this.eventAbortController.abort();
      this.eventAbortController = null;
    }
    this.client = null;
    console.log('[OpenCode] 已断开连接');
  }
}

// 单例导出
export const opencodeClient = new OpencodeClientWrapper();
