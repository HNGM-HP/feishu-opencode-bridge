/**
 * OpenCode 事件分发中心
 *
 * 职责：
 * - 统一管理 OpenCode 事件监听（保持单监听器模式）
 * - 通过上下文注入接收 index.ts 中的闭包状态
 * - 事件分发到内部处理器
 *
 * 设计原则：
 * - 单一入口：每种事件类型仅注册一次监听器
 * - 依赖注入：所有状态通过上下文对象传入
 * - 最小修改：保持语义和行为不变
 */

import type { PermissionRequestEvent } from '../opencode/client.js';
import { opencodeClient } from '../opencode/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { permissionHandler } from '../permissions/handler.js';
import { questionHandler } from '../opencode/question-handler.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { feishuClient } from '../feishu/client.js';
import * as platformRegistry from '../platform/registry.js';

// ==================== 类型定义 ====================

/**
 * Timeline 片段类型
 */
export type TimelineSegment =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; name: string; status: ToolRuntimeState['status']; output?: string; kind?: 'tool' | 'subtask' }
  | { type: 'note'; text: string; variant?: 'retry' | 'compaction' | 'question' | 'error' | 'permission' };

/**
 * 流式卡片数据类型（从 cards-stream 导入）
 */
import type { StreamCardData } from '../feishu/cards-stream.js';

/**
 * 流式卡片数据类型（从 cards-stream 导入）
 */
export type { StreamCardData } from '../feishu/cards-stream.js';

/**
 * 工具运行时状态
 */
export type ToolRuntimeState = {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: string;
  kind?: 'tool' | 'subtask';
};

/**
 * 权限解析结果
 */
export type PermissionChatResolution = {
  chatId?: string;
  source: 'session' | 'parent_session' | 'related_session' | 'tool_call' | 'message' | 'unresolved';
};

/**
 * 相关性缓存条目
 */
export type CorrelationChatRef = {
  chatId: string;
  expiresAt: number;
};

/**
 * OpenCode 事件处理上下文
 * 封装 index.ts 中的所有依赖
 */
export interface OpenCodeEventContext {
  // 常量
  CORRELATION_CACHE_TTL_MS: number;

  // Map 状态
  streamContentMap: Map<string, { text: string; thinking: string }>;
  reasoningSnapshotMap: Map<string, string>;
  textSnapshotMap: Map<string, string>;
  retryNoticeMap: Map<string, string>;
  errorNoticeMap: Map<string, string>;
  streamCardMessageIdsMap: Map<string, string[]>;
  toolCallChatMap: Map<string, CorrelationChatRef>;
  messageChatMap: Map<string, CorrelationChatRef>;
  streamToolStateMap: Map<string, Map<string, ToolRuntimeState>>;
  streamTimelineMap: Map<string, { order: string[]; segments: Map<string, TimelineSegment> }>;

  // 辅助函数
  toSessionId: (value: unknown) => string;
  toNonEmptyString: (value: unknown) => string | undefined;
  setCorrelationChatRef: (map: Map<string, CorrelationChatRef>, key: unknown, chatId: unknown) => void;
  getCorrelationChatRef: (map: Map<string, CorrelationChatRef>, key: unknown) => string | undefined;
  resolvePermissionChat: (event: PermissionRequestEvent) => PermissionChatResolution;
  normalizeToolStatus: (status: unknown) => 'pending' | 'running' | 'completed' | 'failed';
  getToolStatusText: (status: ToolRuntimeState['status']) => string;
  stringifyToolOutput: (value: unknown) => string | undefined;
  asRecord: (value: unknown) => Record<string, unknown> | null;
  pickFirstDefined: (...values: unknown[]) => unknown;
  buildToolTraceOutput: (part: Record<string, unknown>, status: ToolRuntimeState['status'], withInput: boolean) => string | undefined;
  clipToolTrace: (text: string) => string;
  mergeToolOutput: (previous: string | undefined, incoming: string | undefined) => string | undefined;
  getOrCreateToolStateBucket: (bufferKey: string) => Map<string, ToolRuntimeState>;
  syncToolsToBuffer: (bufferKey: string) => void;
  upsertToolState: (bufferKey: string, toolKey: string, state: ToolRuntimeState, kind?: 'tool' | 'subtask') => void;
  markActiveToolsCompleted: (bufferKey: string) => void;
  appendTextFromPart: (sessionID: string, part: { id?: unknown; text?: unknown }, bufferKey: string) => void;
  appendReasoningFromPart: (sessionID: string, part: { id?: unknown; text?: unknown }, bufferKey: string) => void;
  clearPartSnapshotsForSession: (sessionID: string) => void;
  formatProviderError: (raw: unknown) => string;
  upsertLiveCardInteraction: (
    chatId: string,
    replyMessageId: string | null,
    cardData: StreamCardData,
    bodyMessageIds: string[],
    thinkingMessageId: string | null,
    openCodeMsgId: string
  ) => void;
  getTimelineSegments: (bufferKey: string) => TimelineSegment[];
  getPendingPermissionForChat: (chatId: string) => unknown;
  getPendingQuestionForBuffer: (sessionId: string, chatId: string) => unknown;
  applyFailureToSession: (sessionID: string, errorText: string) => Promise<void>;
  upsertTimelineNote: (bufferKey: string, noteKey: string, text: string, variant?: 'retry' | 'compaction' | 'question' | 'error' | 'permission') => void;
  appendTimelineText: (bufferKey: string, segmentKey: string, type: 'text' | 'reasoning', deltaText: string) => void;
  setTimelineText: (bufferKey: string, segmentKey: string, type: 'text' | 'reasoning', text: string) => void;
  upsertTimelineTool: (bufferKey: string, toolKey: string, state: ToolRuntimeState, kind?: 'tool' | 'subtask') => void;
}

/**
 * OpenCode 事件中心
 */
export class OpenCodeEventHub {
  private context: OpenCodeEventContext | null = null;
  private registered: boolean = false;
  private userMessageIdsBySession = new Map<string, Set<string>>();

  private resolveConversationRoute(
    sessionId: string,
    fallbackConversationId: string
  ): {
    platform: string;
    conversationId: string;
    bufferKey: string;
    permissionChatKey: string;
  } {
    const conversation = chatSessionStore.getConversationBySessionId(sessionId);
    const platform = conversation?.platform ?? 'feishu';
    const conversationId = conversation?.conversationId ?? fallbackConversationId;
    const bufferKey = platform === 'feishu'
      ? `chat:${conversationId}`
      : `chat:${platform}:${conversationId}`;
    const permissionChatKey = platform === 'feishu'
      ? conversationId
      : `${platform}:${conversationId}`;

    return {
      platform,
      conversationId,
      bufferKey,
      permissionChatKey,
    };
  }

  private rememberUserMessageId(sessionId: string, messageId: string): void {
    const normalizedMessageId = messageId.trim();
    if (!normalizedMessageId) {
      return;
    }

    const existing = this.userMessageIdsBySession.get(sessionId) || new Set<string>();
    existing.add(normalizedMessageId);
    if (existing.size > 20) {
      const oldest = existing.values().next().value;
      if (typeof oldest === 'string') {
        existing.delete(oldest);
      }
    }
    this.userMessageIdsBySession.set(sessionId, existing);
  }

  private isUserMessagePart(sessionId: string, messageId: string): boolean {
    const existing = this.userMessageIdsBySession.get(sessionId);
    if (!existing) {
      return false;
    }
    return existing.has(messageId);
  }

  private clearUserMessageIds(sessionId: string): void {
    this.userMessageIdsBySession.delete(sessionId);
  }

  /**
   * 注入事件处理上下文
   */
  setContext(context: OpenCodeEventContext): void {
    this.context = context;
  }

  /**
   * 注册所有 OpenCode 事件监听器
   * 确保每种事件类型仅注册一次
   */
  register(): void {
    if (this.registered || !this.context) {
      return;
    }
    this.registered = true;

    // 权限请求
    opencodeClient.on('permissionRequest', (event) => this.handlePermissionRequest(event));

    // 会话状态变化
    opencodeClient.on('sessionStatus', (event) => this.handleSessionStatus(event));

    // 会话空闲
    opencodeClient.on('sessionIdle', (event) => this.handleSessionIdle(event));

    // 消息更新
    opencodeClient.on('messageUpdated', (event) => this.handleMessageUpdated(event));

    // 会话错误
    opencodeClient.on('sessionError', (event) => this.handleSessionError(event));

    // 消息部分更新（流式输出）
    opencodeClient.on('messagePartUpdated', (event) => this.handleMessagePartUpdated(event));

    // AI 提问
    opencodeClient.on('questionAsked', (event) => this.handleQuestionAsked(event));
  }

  // ==================== 私有事件处理器 ====================

  private async handlePermissionRequest(event: PermissionRequestEvent): Promise<void> {
    if (!this.context) return;

    const {
      resolvePermissionChat,
      chatSessionStore,
      permissionHandler,
      opencodeClient,
      outputBuffer,
      CORRELATION_CACHE_TTL_MS,
      setCorrelationChatRef,
      toolCallChatMap,
      messageChatMap,
      upsertTimelineNote,
    } = this.injectedDependencies();

    const resolution = resolvePermissionChat(event);
    const chatId = resolution.chatId;
    const route = chatId ? this.resolveConversationRoute(event.sessionId, chatId) : null;
    const routeSession = route
      ? chatSessionStore.getSessionByConversation(route.platform, route.conversationId)
      : undefined;
    const permissionDirectory = routeSession?.resolvedDirectory || routeSession?.defaultDirectory;
    const permissionFallbackDirectories = Array.from(
      new Set(
        [
          routeSession?.resolvedDirectory,
          routeSession?.defaultDirectory,
          ...chatSessionStore.getKnownDirectories(),
        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    );
    const candidateSessionIds = Array.from(
      new Set(
        [event.sessionId, event.parentSessionId, event.relatedSessionId]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    );

    const enqueuePermissionRequest = (): void => {
      if (!chatId || !route) {
        return;
      }

      const bufferKey = route.bufferKey;
      if (!outputBuffer.get(bufferKey)) {
        outputBuffer.getOrCreate(bufferKey, route.conversationId, event.sessionId, null);
      }

      const permissionInfo = {
        sessionId: event.sessionId,
        permissionId: event.permissionId,
        tool: event.tool,
        description: event.description || event.tool,
        risk: event.risk,
      };
      permissionHandler.enqueueForChat(route.permissionChatKey, {
        sessionId: permissionInfo.sessionId,
        permissionId: permissionInfo.permissionId,
        tool: permissionInfo.tool,
        description: permissionInfo.description,
        risk: permissionInfo.risk,
        userId: '',
        parentSessionId: event.parentSessionId,
        relatedSessionId: event.relatedSessionId,
      });
      console.log(
        `[权限] 已入队: chat=${route.permissionChatKey}, permission=${event.permissionId}, pending=${permissionHandler.getQueueSizeForChat(route.permissionChatKey)}`
      );
      upsertTimelineNote(
        bufferKey,
        `permission:${event.sessionId}:${event.permissionId}`,
        `🔐 权限请求：${event.tool}`,
        'permission'
      );
      outputBuffer.touch(bufferKey);

      // 为 QQ 等不支持卡片的平台发送文本权限请求通知
      if (route.platform === 'qq') {
        const adapter = platformRegistry.get('qq');
        if (adapter) {
          const sender = adapter.getSender();
          const riskText = permissionInfo.risk === 'high' ? '⚠️ 高风险' :
                          permissionInfo.risk === 'medium' ? '⚡ 中等风险' : '✅ 低风险';
          const permissionText = `🔐 权限确认请求

工具名称: ${permissionInfo.tool}
操作描述: ${permissionInfo.description}
风险等级: ${riskText}

请回复以下选项之一:
1 - 允许
2 - 拒绝
3 - 始终允许此工具

也可以直接回复: 允许 / 拒绝 / 始终允许 (或 y / n / always)`;
          sender.sendText(route.conversationId, permissionText).catch(err => {
            console.error('[权限] QQ 权限请求通知发送失败:', err);
          });
        }
      }

      // 为 Telegram 发送带 InlineKeyboard 的权限请求卡片
      if (route.platform === 'telegram') {
        const adapter = platformRegistry.get('telegram');
        if (adapter) {
          const sender = adapter.getSender();
          const riskText = permissionInfo.risk === 'high' ? '⚠️ 高风险' :
                          permissionInfo.risk === 'medium' ? '⚡ 中等风险' : '✅ 低风险';
          const permissionText = `🔐 权限确认请求

工具名称: ${permissionInfo.tool}
操作描述: ${permissionInfo.description}
风险等级: ${riskText}

也可以直接回复: 允许 / 拒绝 / 始终允许 (或 y / n / always)`;

          const allowCallbackData = JSON.stringify({
            action: 'permission_allow',
            sessionId: permissionInfo.sessionId,
            permissionId: permissionInfo.permissionId,
            remember: false,
            ...(event.parentSessionId ? { parentSessionId: event.parentSessionId } : {}),
            ...(event.relatedSessionId ? { relatedSessionId: event.relatedSessionId } : {}),
          });

          const denyCallbackData = JSON.stringify({
            action: 'permission_deny',
            sessionId: permissionInfo.sessionId,
            permissionId: permissionInfo.permissionId,
            ...(event.parentSessionId ? { parentSessionId: event.parentSessionId } : {}),
            ...(event.relatedSessionId ? { relatedSessionId: event.relatedSessionId } : {}),
          });

          const alwaysAllowCallbackData = JSON.stringify({
            action: 'permission_allow',
            sessionId: permissionInfo.sessionId,
            permissionId: permissionInfo.permissionId,
            remember: true,
            ...(event.parentSessionId ? { parentSessionId: event.parentSessionId } : {}),
            ...(event.relatedSessionId ? { relatedSessionId: event.relatedSessionId } : {}),
          });

          const permissionCard = {
            text: permissionText,
            telegramText: permissionText,
            buttons: [
              { text: '✅ 允许', callback_data: allowCallbackData },
              { text: '❌ 拒绝', callback_data: denyCallbackData },
              { text: '📝 始终允许', callback_data: alwaysAllowCallbackData },
            ],
          };

          sender.sendCard(route.conversationId, permissionCard).catch(err => {
            console.error('[权限] Telegram 权限请求卡片发送失败:', err);
          });
        }
      }

      // 为企业微信发送 Markdown 格式的权限请求
      if (route.platform === 'wecom') {
        const adapter = platformRegistry.get('wecom');
        if (adapter) {
          const sender = adapter.getSender();
          const riskText = permissionInfo.risk === 'high' ? '⚠️ **高风险**' :
                          permissionInfo.risk === 'medium' ? '⚡ **中等风险**' : '✅ **低风险**';
          const permissionText = `🔐 **权限确认请求**

**工具名称:** ${permissionInfo.tool}
**操作描述:** ${permissionInfo.description}
**风险等级:** ${riskText}

请回复以下选项之一:
- 1 或 允许 - 允许本次操作
- 2 或 拒绝 - 拒绝本次操作
- 3 或 始终允许 - 始终允许此工具

也可以直接回复: 允许 / 拒绝 / 始终允许 (或 y / n / always)`;
          sender.sendText(route.conversationId, permissionText).catch(err => {
            console.error('[权限] 企业微信权限请求通知发送失败:', err);
          });
        }
      }
    };

    console.log(
      `[权限] 收到请求: ${event.tool}, ID: ${event.permissionId}, Session: ${event.sessionId}, source=${resolution.source}`
    );

    if (chatId) {
      chatSessionStore.rememberSessionAlias(event.sessionId, chatId, CORRELATION_CACHE_TTL_MS);
      if (event.parentSessionId) {
        chatSessionStore.rememberSessionAlias(event.parentSessionId, chatId, CORRELATION_CACHE_TTL_MS);
      }
      if (event.relatedSessionId) {
        chatSessionStore.rememberSessionAlias(event.relatedSessionId, chatId, CORRELATION_CACHE_TTL_MS);
      }
      setCorrelationChatRef(toolCallChatMap, event.callId, chatId);
      setCorrelationChatRef(messageChatMap, event.messageId, chatId);
    }

    // 1. 检查白名单
    if (permissionHandler.isToolWhitelisted(event.tool)) {
      console.log(`[权限] 工具 ${event.tool} 在白名单中，自动允许`);
      let responded = false;
      let respondedSessionId = event.sessionId;

      for (const sessionId of candidateSessionIds) {
        const ok = await opencodeClient.respondToPermission(
          sessionId,
          event.permissionId,
          true,
          false,
          {
            ...(permissionDirectory ? { directory: permissionDirectory } : {}),
            ...(permissionFallbackDirectories.length > 0
              ? { fallbackDirectories: permissionFallbackDirectories }
              : {}),
          }
        );
        if (ok) {
          responded = true;
          respondedSessionId = sessionId;
          break;
        }
      }

      if (responded) {
        if (chatId && route) {
          permissionHandler.resolveForChat(route.permissionChatKey, event.permissionId);
        }
        console.log(
          `[权限] 自动允许成功: permission=${event.permissionId}, session=${respondedSessionId}`
        );
        return;
      }

      console.error(
        `[权限] 自动允许失败: permission=${event.permissionId}, triedSessions=${candidateSessionIds.join(',') || event.sessionId}`
      );
      if (chatId && route) {
        enqueuePermissionRequest();
        upsertTimelineNote(
          route.bufferKey,
          `permission-auto-allow-failed:${event.sessionId}:${event.permissionId}`,
          '⚠️ 自动允许失败，请回复“允许/拒绝”手动确认权限。',
          'permission'
        );
        outputBuffer.touch(route.bufferKey);
      }
      return;
    }

    // 2. 查找聊天 ID
    if (chatId && route) {
      enqueuePermissionRequest();
    } else {
      console.warn(
        `[权限] ⚠️ 未找到关联的群聊 (Session: ${event.sessionId}, parent=${event.parentSessionId || '-'}, related=${event.relatedSessionId || '-'}, call=${event.callId || '-'}, message=${event.messageId || '-'})，无法展示权限交互`
      );
    }
  }

  private handleSessionStatus(event: unknown): void {
    if (!this.context) return;

    const { toSessionId, chatSessionStore, outputBuffer, retryNoticeMap, upsertTimelineNote, markActiveToolsCompleted } = this.injectedDependencies();

    const eventObj = event as Record<string, unknown>;
    const sessionID = toSessionId(eventObj?.sessionID || eventObj?.sessionId);
    const status = eventObj?.status as Record<string, unknown> | undefined;
    if (!sessionID || !status || typeof status !== 'object') return;

    const chatId = chatSessionStore.getChatId(sessionID);
    if (!chatId) return;

    const route = this.resolveConversationRoute(sessionID, chatId);
    const bufferKey = route.bufferKey;
    if (!outputBuffer.get(bufferKey)) {
      outputBuffer.getOrCreate(bufferKey, route.conversationId, sessionID, null);
    }

    if (status.type === 'retry') {
      const attempt = typeof status.attempt === 'number' ? status.attempt : 0;
      const message = typeof status.message === 'string' ? status.message : '上游模型请求失败，正在重试';
      const signature = `${attempt}:${message}`;
      if (retryNoticeMap.get(sessionID) !== signature) {
        retryNoticeMap.set(sessionID, signature);
        upsertTimelineNote(bufferKey, `status-retry:${sessionID}:${signature}`, `⚠️ 模型重试（第 ${attempt} 次）：${message}`, 'retry');
        outputBuffer.touch(bufferKey);
      }
      return;
    }

    if (status.type === 'idle') {
      markActiveToolsCompleted(bufferKey);
      const buffer = outputBuffer.get(bufferKey);
      if (buffer && buffer.status === 'running') {
        outputBuffer.setStatus(bufferKey, 'completed');
      }
    }
  }

  private handleSessionIdle(event: unknown): void {
    if (!this.context) return;

    const { toSessionId, chatSessionStore, outputBuffer, markActiveToolsCompleted } = this.injectedDependencies();

    const eventObj = event as Record<string, unknown>;
    const sessionID = toSessionId(eventObj?.sessionID || eventObj?.sessionId);
    if (!sessionID) return;

    const chatId = chatSessionStore.getChatId(sessionID);
    if (!chatId) return;

    const route = this.resolveConversationRoute(sessionID, chatId);
    const bufferKey = route.bufferKey;
    markActiveToolsCompleted(bufferKey);
    const buffer = outputBuffer.get(bufferKey);
    if (buffer && buffer.status === 'running') {
      outputBuffer.setStatus(bufferKey, 'completed');
    }
    this.clearUserMessageIds(sessionID);
  }

  private async handleMessageUpdated(event: unknown): Promise<void> {
    if (!this.context) return;

    const { toSessionId, chatSessionStore, outputBuffer, CORRELATION_CACHE_TTL_MS, setCorrelationChatRef, messageChatMap, formatProviderError, applyFailureToSession } = this.injectedDependencies();

    const eventObj = event as Record<string, unknown>;
    const info = eventObj?.info as Record<string, unknown> | undefined;
    if (!info || typeof info !== 'object') return;

    const sessionID = toSessionId(info.sessionID);
    if (!sessionID) return;

    const role = typeof info.role === 'string' ? info.role : '';
    if (role === 'user') {
      if (typeof info.id === 'string' && info.id) {
        this.rememberUserMessageId(sessionID, info.id);
      }
      return;
    }

    if (role !== 'assistant') return;

    const chatId = chatSessionStore.getChatId(sessionID);
    if (!chatId) return;

    const route = this.resolveConversationRoute(sessionID, chatId);
    const bufferKey = route.bufferKey;
    if (!outputBuffer.get(bufferKey)) {
      outputBuffer.getOrCreate(bufferKey, route.conversationId, sessionID, null);
    }

    chatSessionStore.rememberSessionAlias(sessionID, chatId, CORRELATION_CACHE_TTL_MS);

    if (typeof info.id === 'string' && info.id) {
      outputBuffer.setOpenCodeMsgId(bufferKey, info.id);
      setCorrelationChatRef(messageChatMap, info.id, chatId);
    }

    if (info.error) {
      const text = formatProviderError(info.error);
      await applyFailureToSession(sessionID, text);
    }
  }

  private async handleSessionError(event: unknown): Promise<void> {
    if (!this.context) return;

    const { toSessionId, formatProviderError, applyFailureToSession } = this.injectedDependencies();

    const eventObj = event as Record<string, unknown>;
    const sessionID = toSessionId(eventObj?.sessionID || eventObj?.sessionId);
    if (!sessionID) return;
    const text = formatProviderError(eventObj?.error);
    await applyFailureToSession(sessionID, text);
    this.clearUserMessageIds(sessionID);
  }

  private handleMessagePartUpdated(event: unknown): void {
    if (!this.context) return;

    const deps = this.injectedDependencies();
    const {
      toSessionId,
      chatSessionStore,
      outputBuffer,
      CORRELATION_CACHE_TTL_MS,
      setCorrelationChatRef,
      toolCallChatMap,
      messageChatMap,
      asRecord,
      normalizeToolStatus,
      buildToolTraceOutput,
      upsertToolState,
      getOrCreateToolStateBucket,
      upsertTimelineNote,
      appendTimelineText,
      setTimelineText,
      reasoningSnapshotMap,
      textSnapshotMap,
      appendTextFromPart,
      appendReasoningFromPart,
      stringifyToolOutput,
      getToolStatusText,
      pickFirstDefined,
    } = deps;

    const eventObj = event as Record<string, unknown>;
    const part = eventObj?.part as Record<string, unknown> | undefined;
    const sessionID = toSessionId(eventObj?.sessionID || part?.sessionID);
    const delta = eventObj?.delta;
    if (!sessionID) return;

    const partMessageId = typeof part?.messageID === 'string' ? part.messageID : '';
    if (partMessageId && this.isUserMessagePart(sessionID, partMessageId)) {
      return;
    }

    const chatId = chatSessionStore.getChatId(sessionID);
    if (!chatId) return;

    const route = this.resolveConversationRoute(sessionID, chatId);
    const bufferKey = route.bufferKey;
    if (!outputBuffer.get(bufferKey)) {
      outputBuffer.getOrCreate(bufferKey, route.conversationId, sessionID, null);
    }

    chatSessionStore.rememberSessionAlias(sessionID, chatId, CORRELATION_CACHE_TTL_MS);

    // Tool 处理
    if (part?.type === 'tool' && typeof part === 'object') {
      const toolPart = part as Record<string, unknown>;
      const rawToolName = toolPart.tool;
      const toolObj = asRecord(rawToolName);
      const toolName = typeof rawToolName === 'string' && rawToolName.trim()
        ? rawToolName.trim()
        : toolObj && typeof toolObj.name === 'string' && toolObj.name.trim()
          ? toolObj.name.trim()
          : 'tool';
      const state = asRecord(toolPart.state);
      const status = normalizeToolStatus(state?.status);
      const toolKey = typeof toolPart.callID === 'string' && toolPart.callID
        ? toolPart.callID
        : typeof toolPart.id === 'string' && toolPart.id
          ? toolPart.id
          : `${toolName}:${Date.now()}`;
      setCorrelationChatRef(toolCallChatMap, toolPart.callID, chatId);
      setCorrelationChatRef(toolCallChatMap, toolPart.callId, chatId);
      setCorrelationChatRef(toolCallChatMap, toolPart.toolCallID, chatId);
      setCorrelationChatRef(toolCallChatMap, toolPart.toolCallId, chatId);
      setCorrelationChatRef(messageChatMap, toolPart.messageID, chatId);
      setCorrelationChatRef(messageChatMap, toolPart.messageId, chatId);
      const previous = getOrCreateToolStateBucket(bufferKey).get(toolKey);
      const output = buildToolTraceOutput(toolPart, status, !previous || !previous.output);

      upsertToolState(bufferKey, toolKey, {
        name: toolName,
        status,
        ...(output ? { output } : {}),
        kind: 'tool',
      }, 'tool');
    }

    // Subtask 处理
    if (part?.type === 'subtask' && typeof part === 'object') {
      const subtaskPart = part as Record<string, unknown>;
      const taskName = typeof subtaskPart.description === 'string' && subtaskPart.description.trim()
        ? subtaskPart.description.trim()
        : 'Subtask';
      const state = asRecord(subtaskPart.state);
      const status = normalizeToolStatus(state?.status);
      const toolKey = typeof subtaskPart.id === 'string' && subtaskPart.id
        ? `subtask:${subtaskPart.id}`
        : `subtask:${Date.now()}`;
      const previous = getOrCreateToolStateBucket(bufferKey).get(toolKey);
      const outputParts: string[] = [];

      if (!previous) {
        if (typeof subtaskPart.agent === 'string' && subtaskPart.agent.trim()) {
          outputParts.push(`agent=${subtaskPart.agent.trim()}`);
        }
        if (typeof subtaskPart.prompt === 'string' && subtaskPart.prompt.trim()) {
          const normalizedPrompt = subtaskPart.prompt.trim().replace(/\s+/g, ' ');
          outputParts.push(`prompt=${normalizedPrompt.slice(0, 200)}`);
        }
      }

      const stateOutput = status === 'failed'
        ? stringifyToolOutput(pickFirstDefined(state?.error, state?.output))
        : stringifyToolOutput(pickFirstDefined(state?.output, state?.result, state?.message));
      if (stateOutput && stateOutput.trim()) {
        outputParts.push(stateOutput.trim());
      } else {
        outputParts.push(`状态更新：${getToolStatusText(status)}`);
      }

      const output = outputParts.join('\n\n');
      upsertToolState(bufferKey, toolKey, {
        name: taskName,
        status,
        ...(output ? { output } : {}),
        kind: 'subtask',
      }, 'subtask');
    }

    // Retry 处理
    if (part?.type === 'retry') {
      const errorObj = (part as Record<string, unknown>).error as Record<string, unknown> | undefined;
      const errorData = errorObj?.data as Record<string, unknown> | undefined;
      const retryMessage = errorData?.message;
      if (typeof retryMessage === 'string' && retryMessage.trim()) {
        const retryKey = typeof (part as Record<string, unknown>).id === 'string' && (part as Record<string, unknown>).id
          ? (part as Record<string, unknown>).id as string
          : retryMessage.trim().slice(0, 80);
        upsertTimelineNote(bufferKey, `part-retry:${sessionID}:${retryKey}`, `⚠️ 模型请求重试：${retryMessage.trim()}`, 'retry');
        outputBuffer.touch(bufferKey);
      }
    }

    // Compaction 处理
    if (part?.type === 'compaction') {
      const compactionKey = typeof (part as Record<string, unknown>).id === 'string' && (part as Record<string, unknown>).id
        ? (part as Record<string, unknown>).id as string
        : `${Date.now()}`;
      upsertTimelineNote(bufferKey, `compaction:${sessionID}:${compactionKey}`, '🗜️ 会话上下文已压缩', 'compaction');
      outputBuffer.touch(bufferKey);
    }

    // Delta 字符串处理
    if (typeof delta === 'string') {
      if (delta.length > 0) {
        if (part?.type === 'reasoning') {
          outputBuffer.appendThinking(bufferKey, delta);
          if (typeof part?.id === 'string') {
            const key = `${sessionID}:${part.id}`;
            const prev = reasoningSnapshotMap.get(key) || '';
            const next = `${prev}${delta}`;
            reasoningSnapshotMap.set(key, next);
            setTimelineText(bufferKey, `reasoning:${key}`, 'reasoning', next);
          } else {
            appendTimelineText(bufferKey, `reasoning:${sessionID}:anonymous`, 'reasoning', delta);
          }
          return;
        }
        if (part?.type === 'text') {
          if (typeof part?.id === 'string' && part.id) {
            const key = `${sessionID}:${part.id}`;
            const prev = textSnapshotMap.get(key) || '';
            const next = `${prev}${delta}`;
            textSnapshotMap.set(key, next);
            setTimelineText(bufferKey, `text:${key}`, 'text', next);
          } else {
            appendTimelineText(bufferKey, `text:${sessionID}:anonymous`, 'text', delta);
          }
          outputBuffer.append(bufferKey, delta);
          return;
        }
        outputBuffer.append(bufferKey, delta);
        return;
      }
    }

    // Delta 对象处理
    if (delta && typeof delta === 'object') {
      const deltaObj = delta as Record<string, unknown>;
      if (deltaObj.type === 'reasoning') {
        const reasoningText =
          typeof deltaObj.text === 'string'
            ? deltaObj.text
            : typeof deltaObj.reasoning === 'string'
              ? deltaObj.reasoning
              : '';
        if (reasoningText) {
          outputBuffer.appendThinking(bufferKey, reasoningText);
          if (typeof part?.id === 'string' && part.id) {
            const key = `${sessionID}:${part.id}`;
            const prev = reasoningSnapshotMap.get(key) || '';
            const next = `${prev}${reasoningText}`;
            reasoningSnapshotMap.set(key, next);
            setTimelineText(bufferKey, `reasoning:${key}`, 'reasoning', next);
          } else {
            appendTimelineText(bufferKey, `reasoning:${sessionID}:anonymous`, 'reasoning', reasoningText);
          }
        }
      } else if (deltaObj.type === 'thinking' && typeof deltaObj.thinking === 'string') {
        outputBuffer.appendThinking(bufferKey, deltaObj.thinking);
        if (typeof part?.id === 'string' && part.id) {
          const key = `${sessionID}:${part.id}`;
          const prev = reasoningSnapshotMap.get(key) || '';
          const next = `${prev}${deltaObj.thinking}`;
          reasoningSnapshotMap.set(key, next);
          setTimelineText(bufferKey, `reasoning:${key}`, 'reasoning', next);
        } else {
          appendTimelineText(bufferKey, `reasoning:${sessionID}:anonymous`, 'reasoning', deltaObj.thinking);
        }
      } else if (deltaObj.type === 'text' && typeof deltaObj.text === 'string' && deltaObj.text.length > 0) {
        outputBuffer.append(bufferKey, deltaObj.text);
        if (typeof part?.id === 'string' && part.id) {
          const key = `${sessionID}:${part.id}`;
          const prev = textSnapshotMap.get(key) || '';
          const next = `${prev}${deltaObj.text}`;
          textSnapshotMap.set(key, next);
          setTimelineText(bufferKey, `text:${key}`, 'text', next);
        } else {
          appendTimelineText(bufferKey, `text:${sessionID}:anonymous`, 'text', deltaObj.text);
        }
      } else if (typeof deltaObj.text === 'string' && deltaObj.text.length > 0) {
        outputBuffer.append(bufferKey, deltaObj.text);
        if (part?.type === 'reasoning') {
          if (typeof part?.id === 'string' && part.id) {
            const key = `${sessionID}:${part.id}`;
            const prev = reasoningSnapshotMap.get(key) || '';
            const next = `${prev}${deltaObj.text}`;
            reasoningSnapshotMap.set(key, next);
            setTimelineText(bufferKey, `reasoning:${key}`, 'reasoning', next);
          } else {
            appendTimelineText(bufferKey, `reasoning:${sessionID}:anonymous`, 'reasoning', deltaObj.text);
          }
        } else if (part?.type === 'text') {
          if (typeof part?.id === 'string' && part.id) {
            const key = `${sessionID}:${part.id}`;
            const prev = textSnapshotMap.get(key) || '';
            const next = `${prev}${deltaObj.text}`;
            textSnapshotMap.set(key, next);
            setTimelineText(bufferKey, `text:${key}`, 'text', next);
          } else {
            appendTimelineText(bufferKey, `text:${sessionID}:anonymous`, 'text', deltaObj.text);
          }
        }
      }
      return;
    }

    // 兜底处理
    if (part?.type === 'reasoning' && typeof (part as Record<string, unknown>).text === 'string') {
      appendReasoningFromPart(sessionID as string, part as { id?: unknown; text?: unknown }, bufferKey);
    } else if (part?.type === 'text' && typeof (part as Record<string, unknown>).text === 'string') {
      appendTextFromPart(sessionID as string, part as { id?: unknown; text?: unknown }, bufferKey);
    }
  }

  private handleQuestionAsked(event: unknown): void {
    if (!this.context) return;

    const { chatSessionStore, questionHandler, outputBuffer, upsertTimelineNote } = this.injectedDependencies();

    const request = event as import('../opencode/question-handler.js').QuestionRequest;
    const chatId = chatSessionStore.getChatId(request.sessionID);

    if (chatId) {
      const route = this.resolveConversationRoute(request.sessionID, chatId);
      console.log(`[问题] 收到提问: ${request.id} (Chat: ${chatId})`);
      const bufferKey = route.bufferKey;
      if (!outputBuffer.get(bufferKey)) {
        outputBuffer.getOrCreate(bufferKey, route.conversationId, request.sessionID, null);
      }

      questionHandler.register(request, bufferKey, route.conversationId);
      upsertTimelineNote(bufferKey, `question:${request.sessionID}:${request.id}`, '🤝 问答交互（请在当前流式卡片中作答）', 'question');
      outputBuffer.touch(bufferKey);

      // 为 QQ 等不支持卡片的平台发送文本问答通知
      if (route.platform === 'qq') {
        const adapter = platformRegistry.get('qq');
        if (adapter) {
          const sender = adapter.getSender();
          const firstQuestion = request.questions[0];
          if (firstQuestion) {
            const questionText = this.buildQuestionText(request);
            sender.sendText(route.conversationId, questionText).catch(err => {
              console.error('[问题] QQ 问答通知发送失败:', err);
            });
          }
        }
      }

      // 为 WhatsApp 平台发送文本问答提示
      if (route.platform === 'whatsapp') {
        const adapter = platformRegistry.get('whatsapp');
        if (adapter) {
          const sender = adapter.getSender();
          const questionText = this.buildQuestionText(request);
          sender.sendText(route.conversationId, questionText).catch(err => {
            console.error('[问题] WhatsApp 问答提示发送失败:', err);
          });
        }
      }

      // 为 Telegram 发送带 InlineKeyboard 的问答卡片
      if (route.platform === 'telegram') {
        this.sendTelegramQuestionCard(route.conversationId, request);
      }

      // 为企业微信发送 Markdown 格式的问答提示
      if (route.platform === 'wecom') {
        const adapter = platformRegistry.get('wecom');
        if (adapter) {
          const sender = adapter.getSender();
          const questionText = this.buildWeComQuestionText(request);
          sender.sendText(route.conversationId, questionText).catch(err => {
            console.error('[问题] 企业微信问答提示发送失败:', err);
          });
        }
      }
    }
  }

  /**
   * 构建问答提示文本消息
   */
  private buildQuestionText(request: import('../opencode/question-handler.js').QuestionRequest): string {
    const totalQuestions = request.questions.length;
    const lines: string[] = ['🤝 AI 需要您回答以下问题：'];

    for (let i = 0; i < totalQuestions; i++) {
      const question = request.questions[i];
      const questionNum = i + 1;
      lines.push(`\n【问题 ${questionNum}/${totalQuestions}】`);
      if (question.header) {
        lines.push(question.header);
      }
      if (question.question) {
        lines.push(question.question);
      }
      if (question.options && question.options.length > 0) {
        lines.push('\n选项：');
        for (let j = 0; j < question.options.length; j++) {
          const option = question.options[j];
          lines.push(`  ${j + 1}. ${option.label}${option.description ? ` - ${option.description}` : ''}`);
        }
        if (question.multiple) {
          lines.push('（可多选，用空格或逗号分隔多个编号）');
        }
      }
    }

    lines.push('\n请回复选项编号（如 1）或直接输入自定义答案');
    lines.push('回复"跳过"可跳过当前问题');

    return lines.join('\n');
  }

  /**
   * 构建企业微信 Markdown 格式的问答提示文本消息
   */
  private buildWeComQuestionText(request: import('../opencode/question-handler.js').QuestionRequest): string {
    const totalQuestions = request.questions.length;
    const lines: string[] = ['🤝 **AI 需要您回答以下问题：**'];

    for (let i = 0; i < totalQuestions; i++) {
      const question = request.questions[i];
      const questionNum = i + 1;
      lines.push(`\n**【问题 ${questionNum}/${totalQuestions}】**`);
      if (question.header) {
        lines.push(`**${question.header}**`);
      }
      if (question.question) {
        lines.push(question.question);
      }
      if (question.options && question.options.length > 0) {
        lines.push('\n**选项：**');
        for (let j = 0; j < question.options.length; j++) {
          const option = question.options[j];
          lines.push(`> ${j + 1}. **${option.label}**${option.description ? ` - ${option.description}` : ''}`);
        }
        if (question.multiple) {
          lines.push('_（可多选，用空格或逗号分隔多个编号）_');
        }
      }
    }

    lines.push('\n---');
    lines.push('请回复选项编号（如 1）或直接输入自定义答案');
    lines.push('回复"跳过"可跳过当前问题');

    return lines.join('\n');
  }

  /**
   * 为 Telegram 发送带 InlineKeyboard 的问答卡片
   */
  private sendTelegramQuestionCard(
    conversationId: string,
    request: import('../opencode/question-handler.js').QuestionRequest
  ): void {
    const adapter = platformRegistry.get('telegram');
    if (!adapter) return;

    const sender = adapter.getSender();
    const questionCount = request.questions.length;

    if (questionCount === 0) return;

    // 获取当前问题（初始为第一个）
    const questionIndex = 0;
    const question = request.questions[questionIndex];
    const questionText = `❓ *${this.escapeTelegramMarkdown(question.header || '问题')}*\n\n${this.escapeTelegramMarkdown(question.question)}`;

    // 构建选项按钮
    const buttons: { text: string; callback_data: string }[] = [];
    const optionLabels = question.options.map(opt => opt.label);

    for (let i = 0; i < optionLabels.length; i++) {
      const label = optionLabels[i];
      const callbackData = JSON.stringify({
        action: 'question_select',
        requestId: request.id,
        sessionId: request.sessionID,
        questionIndex: questionIndex,
        label: label,
      });
      buttons.push({ text: label, callback_data: callbackData });
    }

    // 添加跳过按钮
    const skipCallbackData = JSON.stringify({
      action: 'question_skip',
      requestId: request.id,
      sessionId: request.sessionID,
      questionIndex: questionIndex,
    });
    buttons.push({ text: '⏭️ 跳过', callback_data: skipCallbackData });

    // 如果支持自定义答案，添加自定义按钮
    if (question.custom) {
      const customCallbackData = JSON.stringify({
        action: 'question_custom',
        requestId: request.id,
        sessionId: request.sessionID,
        questionIndex: questionIndex,
      });
      buttons.push({ text: '✏️ 自定义', callback_data: customCallbackData });
    }

    const progressHint = questionCount > 1
      ? `\n\n📋 第 ${questionIndex + 1}/${questionCount} 题`
      : '';

    const questionCard = {
      text: questionText + progressHint + '\n\n💡 也可以直接回复文本作答',
      telegram_text: questionText + progressHint + '\n\n💡 也可以直接回复文本作答',
      buttons,
    };

    sender.sendCard(conversationId, questionCard).catch(err => {
      console.error('[问题] Telegram 问答卡片发送失败:', err);
    });
  }

  /**
   * 转义 Telegram Markdown 特殊字符
   */
  private escapeTelegramMarkdown(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  }

  // ==================== 依赖注入辅助 ====================

  /**
   * 获取注入的外部依赖
   * 这些依赖不通过 context 传递，因为它们是模块级别的单例
   */
  private injectedDependencies(): {
    chatSessionStore: typeof import('../store/chat-session.js').chatSessionStore;
    permissionHandler: typeof import('../permissions/handler.js').permissionHandler;
    questionHandler: typeof import('../opencode/question-handler.js').questionHandler;
    opencodeClient: typeof import('../opencode/client.js').opencodeClient;
    outputBuffer: typeof import('../opencode/output-buffer.js').outputBuffer;
    feishuClient: typeof import('../feishu/client.js').feishuClient;
    // 从 context 解构
    CORRELATION_CACHE_TTL_MS: number;
    streamContentMap: Map<string, { text: string; thinking: string }>;
    reasoningSnapshotMap: Map<string, string>;
    textSnapshotMap: Map<string, string>;
    retryNoticeMap: Map<string, string>;
    errorNoticeMap: Map<string, string>;
    streamCardMessageIdsMap: Map<string, string[]>;
    toolCallChatMap: Map<string, CorrelationChatRef>;
    messageChatMap: Map<string, CorrelationChatRef>;
    streamToolStateMap: Map<string, Map<string, ToolRuntimeState>>;
    streamTimelineMap: Map<string, { order: string[]; segments: Map<string, TimelineSegment> }>;
    toSessionId: (value: unknown) => string;
    toNonEmptyString: (value: unknown) => string | undefined;
    setCorrelationChatRef: (map: Map<string, CorrelationChatRef>, key: unknown, chatId: unknown) => void;
    getCorrelationChatRef: (map: Map<string, CorrelationChatRef>, key: unknown) => string | undefined;
    resolvePermissionChat: (event: PermissionRequestEvent) => PermissionChatResolution;
    normalizeToolStatus: (status: unknown) => 'pending' | 'running' | 'completed' | 'failed';
    getToolStatusText: (status: ToolRuntimeState['status']) => string;
    stringifyToolOutput: (value: unknown) => string | undefined;
    asRecord: (value: unknown) => Record<string, unknown> | null;
    pickFirstDefined: (...values: unknown[]) => unknown;
    buildToolTraceOutput: (part: Record<string, unknown>, status: ToolRuntimeState['status'], withInput: boolean) => string | undefined;
    clipToolTrace: (text: string) => string;
    mergeToolOutput: (previous: string | undefined, incoming: string | undefined) => string | undefined;
    getOrCreateToolStateBucket: (bufferKey: string) => Map<string, ToolRuntimeState>;
    syncToolsToBuffer: (bufferKey: string) => void;
    upsertToolState: (bufferKey: string, toolKey: string, state: ToolRuntimeState, kind?: 'tool' | 'subtask') => void;
    markActiveToolsCompleted: (bufferKey: string) => void;
    appendTextFromPart: (sessionID: string, part: { id?: unknown; text?: unknown }, bufferKey: string) => void;
    appendReasoningFromPart: (sessionID: string, part: { id?: unknown; text?: unknown }, bufferKey: string) => void;
    clearPartSnapshotsForSession: (sessionID: string) => void;
    formatProviderError: (raw: unknown) => string;
    upsertLiveCardInteraction: (
      chatId: string,
      replyMessageId: string | null,
      cardData: StreamCardData,
      bodyMessageIds: string[],
      thinkingMessageId: string | null,
      openCodeMsgId: string
    ) => void;
    getTimelineSegments: (bufferKey: string) => TimelineSegment[];
    getPendingPermissionForChat: (chatId: string) => unknown;
    getPendingQuestionForBuffer: (sessionId: string, chatId: string) => unknown;
    applyFailureToSession: (sessionID: string, errorText: string) => Promise<void>;
    upsertTimelineNote: (bufferKey: string, noteKey: string, text: string, variant?: 'retry' | 'compaction' | 'question' | 'error' | 'permission') => void;
    appendTimelineText: (bufferKey: string, segmentKey: string, type: 'text' | 'reasoning', deltaText: string) => void;
    setTimelineText: (bufferKey: string, segmentKey: string, type: 'text' | 'reasoning', text: string) => void;
    upsertTimelineTool: (bufferKey: string, toolKey: string, state: ToolRuntimeState, kind?: 'tool' | 'subtask') => void;
  } {
    if (!this.context) {
      throw new Error('OpenCodeEventHub context not set');
    }

    return {
      chatSessionStore,
      permissionHandler,
      questionHandler,
      opencodeClient,
      outputBuffer,
      feishuClient,
      ...this.context,
    };
  }
}

// 单例导出
export const openCodeEventHub = new OpenCodeEventHub();
