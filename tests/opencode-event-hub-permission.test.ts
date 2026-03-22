import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionRequestEvent } from '../src/opencode/client.js';
import { opencodeClient } from '../src/opencode/client.js';
import { permissionHandler } from '../src/permissions/handler.js';
import { chatSessionStore } from '../src/store/chat-session.js';
import { outputBuffer } from '../src/opencode/output-buffer.js';
import { OpenCodeEventHub, type OpenCodeEventContext, type PermissionChatResolution, type ToolRuntimeState } from '../src/router/opencode-event-hub.js';
import { StreamStateManager } from '../src/store/stream-state.js';

function createContext(
  resolvePermissionChat: (event: PermissionRequestEvent) => PermissionChatResolution,
  upsertTimelineNote: OpenCodeEventContext['upsertTimelineNote']
): OpenCodeEventContext {
  return {
    streamStateManager: new StreamStateManager(),
    toSessionId: (value: unknown) => (typeof value === 'string' ? value : ''),
    toNonEmptyString: (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined),
    setToolCallCorrelation: () => undefined,
    setMessageCorrelation: () => undefined,
    getToolCallCorrelation: () => undefined,
    getMessageCorrelation: () => undefined,
    resolvePermissionChat,
    normalizeToolStatus: () => 'running',
    getToolStatusText: () => '执行中',
    stringifyToolOutput: () => undefined,
    asRecord: () => null,
    pickFirstDefined: (...values: unknown[]) => values.find(value => value !== undefined),
    buildToolTraceOutput: () => undefined,
    clipToolTrace: (text: string) => text,
    mergeToolOutput: (previous: string | undefined, incoming: string | undefined) => incoming ?? previous,
    getOrCreateToolStateBucket: () => new Map<string, ToolRuntimeState>(),
    syncToolsToBuffer: () => undefined,
    upsertToolState: () => undefined,
    markActiveToolsCompleted: () => undefined,
    appendTextFromPart: () => undefined,
    appendReasoningFromPart: () => undefined,
    clearPartSnapshotsForSession: () => undefined,
    formatProviderError: () => 'error',
    upsertLiveCardInteraction: () => undefined,
    getTimelineSegments: () => [],
    getPendingPermissionForChat: () => undefined,
    getPendingQuestionForBuffer: () => undefined,
    applyFailureToSession: async () => undefined,
    upsertTimelineNote,
    appendTimelineText: () => undefined,
    setTimelineText: () => undefined,
    upsertTimelineTool: () => undefined,
  };
}

async function runHandlePermissionRequest(hub: OpenCodeEventHub, event: PermissionRequestEvent): Promise<void> {
  const internalHub = hub as unknown as {
    handlePermissionRequest: (permissionEvent: PermissionRequestEvent) => Promise<void>;
  };
  await internalHub.handlePermissionRequest(event);
}

describe('OpenCodeEventHub permission auto-allow fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('白名单自动允许应在主 session 失败后尝试 parent/related session', async () => {
    const hub = new OpenCodeEventHub();
    const upsertTimelineNote = vi.fn<OpenCodeEventContext['upsertTimelineNote']>();
    hub.setContext(createContext(() => ({ chatId: 'conv-1', source: 'session' }), upsertTimelineNote));

    vi.spyOn(permissionHandler, 'isToolWhitelisted').mockReturnValue(true);
    vi.spyOn(opencodeClient, 'respondToPermission')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    vi.spyOn(chatSessionStore, 'rememberSessionAlias').mockImplementation(() => undefined);
    vi.spyOn(chatSessionStore, 'getConversationBySessionId').mockReturnValue({
      platform: 'discord',
      conversationId: 'conv-1',
    });
    vi.spyOn(chatSessionStore, 'getSessionByConversation').mockReturnValue(undefined);
    vi.spyOn(chatSessionStore, 'getKnownDirectories').mockReturnValue([]);
    const enqueueSpy = vi.spyOn(permissionHandler, 'enqueueForChat');

    await runHandlePermissionRequest(hub, {
      sessionId: 'ses-main',
      parentSessionId: 'ses-parent',
      permissionId: 'per-1',
      tool: 'Read',
      description: 'read file',
    });

    expect(opencodeClient.respondToPermission).toHaveBeenNthCalledWith(
      1,
      'ses-main',
      'per-1',
      true,
      false,
      expect.any(Object)
    );
    expect(opencodeClient.respondToPermission).toHaveBeenNthCalledWith(
      2,
      'ses-parent',
      'per-1',
      true,
      false,
      expect.any(Object)
    );
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(upsertTimelineNote).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('permission-auto-allow-failed'),
      expect.any(String),
      'permission'
    );
  });

  it('白名单自动允许全部失败时应回退到权限入队并给出提示', async () => {
    const hub = new OpenCodeEventHub();
    const upsertTimelineNote = vi.fn<OpenCodeEventContext['upsertTimelineNote']>();
    hub.setContext(createContext(() => ({ chatId: 'conv-2', source: 'session' }), upsertTimelineNote));

    vi.spyOn(permissionHandler, 'isToolWhitelisted').mockReturnValue(true);
    vi.spyOn(opencodeClient, 'respondToPermission').mockResolvedValue(false);
    vi.spyOn(chatSessionStore, 'rememberSessionAlias').mockImplementation(() => undefined);
    vi.spyOn(chatSessionStore, 'getConversationBySessionId').mockReturnValue({
      platform: 'discord',
      conversationId: 'conv-2',
    });
    vi.spyOn(chatSessionStore, 'getSessionByConversation').mockReturnValue(undefined);
    vi.spyOn(chatSessionStore, 'getKnownDirectories').mockReturnValue([]);
    vi.spyOn(outputBuffer, 'get').mockReturnValue(undefined);
    vi.spyOn(outputBuffer, 'getOrCreate').mockImplementation(() => ({
      key: 'chat:discord:conv-2',
      chatId: 'conv-2',
      messageId: null,
      thinkingMessageId: null,
      replyMessageId: null,
      sessionId: 'ses-main',
      content: [],
      thinking: [],
      tools: [],
      finalText: '',
      finalThinking: '',
      openCodeMsgId: '',
      showThinking: false,
      dirty: false,
      lastUpdate: Date.now(),
      timer: null,
      status: 'running',
    }));
    const touchSpy = vi.spyOn(outputBuffer, 'touch').mockImplementation(() => undefined);
    const enqueueSpy = vi.spyOn(permissionHandler, 'enqueueForChat').mockImplementation(() => ({
      sessionId: 'ses-main',
      permissionId: 'per-2',
      tool: 'Read',
      description: 'read file',
      chatId: 'discord:conv-2',
      userId: '',
      createdAt: Date.now(),
    }));
    vi.spyOn(permissionHandler, 'getQueueSizeForChat').mockReturnValue(1);

    await runHandlePermissionRequest(hub, {
      sessionId: 'ses-main',
      parentSessionId: 'ses-parent',
      relatedSessionId: 'ses-related',
      permissionId: 'per-2',
      tool: 'Read',
      description: 'read file',
    });

    expect(opencodeClient.respondToPermission).toHaveBeenCalledTimes(3);
    expect(enqueueSpy).toHaveBeenCalledWith('discord:conv-2', expect.objectContaining({
      sessionId: 'ses-main',
      permissionId: 'per-2',
      tool: 'Read',
    }));
    expect(upsertTimelineNote).toHaveBeenCalledWith(
      'chat:discord:conv-2',
      expect.stringContaining('permission-auto-allow-failed'),
      expect.stringContaining('自动允许失败'),
      'permission'
    );
    expect(touchSpy).toHaveBeenCalled();
  });
});
