import { feishuClient, type FeishuMessageEvent } from './feishu/client.js';
import { opencodeClient } from './opencode/client.js';
import { outputBuffer } from './opencode/output-buffer.js';
import { delayedResponseHandler } from './opencode/delayed-handler.js';
import { questionHandler } from './opencode/question-handler.js';
import { permissionHandler } from './permissions/handler.js';
import { chatSessionStore } from './store/chat-session.js';
import { p2pHandler } from './handlers/p2p.js';
import { groupHandler } from './handlers/group.js';
import { lifecycleHandler } from './handlers/lifecycle.js';
import { commandHandler } from './handlers/command.js';
import { cardActionHandler } from './handlers/card-action.js';
import { validateConfig } from './config.js';
import {
  buildStreamCards,
  type StreamCardData,
  type StreamCardSegment,
  type StreamCardPendingPermission,
  type StreamCardPendingQuestion,
} from './feishu/cards-stream.js';

async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║     飞书 × OpenCode 桥接服务 v2.7.0 (Group)    ║');
  console.log('╚════════════════════════════════════════════════╝');

  // 1. 验证配置
  try {
    validateConfig();
  } catch (error) {
    console.error('配置错误:', error);
    process.exit(1);
  }

  // 2. 连接 OpenCode
  const connected = await opencodeClient.connect();
  if (!connected) {
    console.error('无法连接到OpenCode服务器，请确保 opencode serve 已运行');
    process.exit(1);
  }

  // 3. 配置输出缓冲 (流式响应)
  const streamContentMap = new Map<string, { text: string; thinking: string }>();
  const reasoningSnapshotMap = new Map<string, string>();
  const textSnapshotMap = new Map<string, string>();
  const retryNoticeMap = new Map<string, string>();
  const errorNoticeMap = new Map<string, string>();
  const streamCardMessageIdsMap = new Map<string, string[]>();
  const STREAM_CARD_COMPONENT_BUDGET = 180;

  type ToolRuntimeState = {
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    output?: string;
    kind?: 'tool' | 'subtask';
  };

  type TimelineSegment =
    | {
        type: 'text';
        text: string;
      }
    | {
        type: 'reasoning';
        text: string;
      }
    | {
        type: 'tool';
        name: string;
        status: ToolRuntimeState['status'];
        output?: string;
        kind?: 'tool' | 'subtask';
      }
    | {
        type: 'note';
        text: string;
        variant?: 'retry' | 'compaction' | 'question' | 'error' | 'permission';
      };

  type StreamTimelineState = {
    order: string[];
    segments: Map<string, TimelineSegment>;
  };

  const streamToolStateMap = new Map<string, Map<string, ToolRuntimeState>>();
  const streamTimelineMap = new Map<string, StreamTimelineState>();
  const getPendingPermissionForChat = (chatId: string): StreamCardPendingPermission | undefined => {
    const head = permissionHandler.peekForChat(chatId);
    if (!head) return undefined;

    const pendingCount = permissionHandler.getQueueSizeForChat(chatId);
    return {
      sessionId: head.sessionId,
      permissionId: head.permissionId,
      tool: head.tool,
      description: head.description,
      risk: head.risk,
      pendingCount,
    };
  };

  const getOrCreateTimelineState = (bufferKey: string): StreamTimelineState => {
    let timeline = streamTimelineMap.get(bufferKey);
    if (!timeline) {
      timeline = {
        order: [],
        segments: new Map(),
      };
      streamTimelineMap.set(bufferKey, timeline);
    }
    return timeline;
  };

  const trimTimeline = (timeline: StreamTimelineState): void => {
    const limit = 80;
    while (timeline.order.length > limit) {
      const removedKey = timeline.order.shift();
      if (removedKey) {
        timeline.segments.delete(removedKey);
      }
    }
  };

  const upsertTimelineSegment = (bufferKey: string, segmentKey: string, segment: TimelineSegment): void => {
    const timeline = getOrCreateTimelineState(bufferKey);
    if (!timeline.segments.has(segmentKey)) {
      timeline.order.push(segmentKey);
      trimTimeline(timeline);
    }
    timeline.segments.set(segmentKey, segment);
  };

  const appendTimelineText = (
    bufferKey: string,
    segmentKey: string,
    type: 'text' | 'reasoning',
    deltaText: string
  ): void => {
    if (!deltaText) return;
    const timeline = getOrCreateTimelineState(bufferKey);
    const previous = timeline.segments.get(segmentKey);
    if (previous && previous.type === type) {
      timeline.segments.set(segmentKey, {
        type,
        text: `${previous.text}${deltaText}`,
      });
      return;
    }

    if (!timeline.segments.has(segmentKey)) {
      timeline.order.push(segmentKey);
      trimTimeline(timeline);
    }
    timeline.segments.set(segmentKey, {
      type,
      text: deltaText,
    });
  };

  const setTimelineText = (
    bufferKey: string,
    segmentKey: string,
    type: 'text' | 'reasoning',
    text: string
  ): void => {
    const timeline = getOrCreateTimelineState(bufferKey);
    const previous = timeline.segments.get(segmentKey);
    if (previous && previous.type === type && previous.text === text) {
      return;
    }

    if (!timeline.segments.has(segmentKey)) {
      timeline.order.push(segmentKey);
      trimTimeline(timeline);
    }
    timeline.segments.set(segmentKey, { type, text });
  };

  const upsertTimelineTool = (
    bufferKey: string,
    toolKey: string,
    state: ToolRuntimeState,
    kind: 'tool' | 'subtask' = 'tool'
  ): void => {
    const segmentKey = `tool:${toolKey}`;
    const timeline = getOrCreateTimelineState(bufferKey);
    const previous = timeline.segments.get(segmentKey);
    if (previous && previous.type === 'tool') {
      timeline.segments.set(segmentKey, {
        type: 'tool',
        name: state.name,
        status: state.status,
        output: state.output ?? previous.output,
        kind,
      });
      return;
    }

    if (!timeline.segments.has(segmentKey)) {
      timeline.order.push(segmentKey);
      trimTimeline(timeline);
    }
    timeline.segments.set(segmentKey, {
      type: 'tool',
      name: state.name,
      status: state.status,
      ...(state.output !== undefined ? { output: state.output } : {}),
      kind,
    });
  };

  const upsertTimelineNote = (
    bufferKey: string,
    noteKey: string,
    text: string,
    variant?: 'retry' | 'compaction' | 'question' | 'error' | 'permission'
  ): void => {
    upsertTimelineSegment(bufferKey, `note:${noteKey}`, {
      type: 'note',
      text,
      ...(variant ? { variant } : {}),
    });
  };

  const getTimelineSegments = (bufferKey: string): StreamCardSegment[] => {
    const timeline = streamTimelineMap.get(bufferKey);
    if (!timeline) {
      return [];
    }

    const segments: StreamCardSegment[] = [];
    for (const key of timeline.order) {
      const segment = timeline.segments.get(key);
      if (!segment) continue;

      if (segment.type === 'text' || segment.type === 'reasoning') {
        if (!segment.text.trim()) continue;
        segments.push({
          type: segment.type,
          text: segment.text,
        });
        continue;
      }

      if (segment.type === 'tool') {
        segments.push({
          type: 'tool',
          name: segment.name,
          status: segment.status,
          ...(segment.output !== undefined ? { output: segment.output } : {}),
          ...(segment.kind ? { kind: segment.kind } : {}),
        });
        continue;
      }

      if (!segment.text.trim()) continue;
      segments.push({
        type: 'note',
        text: segment.text,
        ...(segment.variant ? { variant: segment.variant } : {}),
      });
    }

    return segments;
  };

  const getPendingQuestionForBuffer = (sessionId: string, chatId: string): StreamCardPendingQuestion | undefined => {
    const pending = questionHandler.getBySession(sessionId);
    if (!pending || pending.chatId !== chatId) {
      return undefined;
    }

    const totalQuestions = pending.request.questions.length;
    if (totalQuestions === 0) {
      return undefined;
    }

    const safeIndex = Math.min(Math.max(pending.currentQuestionIndex, 0), totalQuestions - 1);
    const question = pending.request.questions[safeIndex];
    if (!question) {
      return undefined;
    }

    return {
      requestId: pending.request.id,
      sessionId: pending.request.sessionID,
      chatId: pending.chatId,
      questionIndex: safeIndex,
      totalQuestions,
      header: typeof question.header === 'string' ? question.header : '',
      question: typeof question.question === 'string' ? question.question : '',
      options: Array.isArray(question.options)
        ? question.options.map(option => ({
            label: typeof option.label === 'string' ? option.label : '',
            description: typeof option.description === 'string' ? option.description : '',
          }))
        : [],
      multiple: question.multiple === true,
    };
  };

  const toSessionId = (value: unknown): string => {
    return typeof value === 'string' ? value : '';
  };

  const normalizeToolStatus = (status: unknown): 'pending' | 'running' | 'completed' | 'failed' => {
    if (status === 'pending' || status === 'running' || status === 'completed') {
      return status;
    }
    if (status === 'error' || status === 'failed') {
      return 'failed';
    }
    return 'running';
  };

  const getToolStatusText = (status: ToolRuntimeState['status']): string => {
    if (status === 'pending') return '等待中';
    if (status === 'running') return '执行中';
    if (status === 'completed') return '已完成';
    return '失败';
  };

  const stringifyToolOutput = (value: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  };

  const pickFirstDefined = (...values: unknown[]): unknown => {
    for (const value of values) {
      if (value !== undefined && value !== null) {
        return value;
      }
    }
    return undefined;
  };

  const buildToolTraceOutput = (
    part: Record<string, unknown>,
    status: ToolRuntimeState['status'],
    withInput: boolean
  ): string | undefined => {
    const state = asRecord(part.state);
    const inputValue = withInput
      ? pickFirstDefined(
          part.input,
          part.args,
          part.arguments,
          state?.input,
          state?.args,
          state?.arguments
        )
      : undefined;
    const outputValue = status === 'failed'
      ? pickFirstDefined(state?.error, state?.output, part.error)
      : pickFirstDefined(state?.output, state?.result, state?.message, part.output, part.result);

    const inputText = stringifyToolOutput(inputValue);
    const outputText = stringifyToolOutput(outputValue);
    const blocks: string[] = [];

    if (inputText && inputText.trim()) {
      blocks.push(`调用参数:\n${inputText.trim()}`);
    }

    if (outputText && outputText.trim()) {
      blocks.push(`${status === 'failed' ? '错误输出' : '执行输出'}:\n${outputText.trim()}`);
    }

    if (blocks.length === 0) {
      return `状态更新：${getToolStatusText(status)}`;
    }

    return blocks.join('\n\n');
  };

  const TOOL_TRACE_LIMIT = 20000;
  const clipToolTrace = (text: string): string => {
    if (text.length <= TOOL_TRACE_LIMIT) {
      return text;
    }
    const retained = text.slice(-TOOL_TRACE_LIMIT);
    return `...（历史输出过长，已截断前 ${text.length - TOOL_TRACE_LIMIT} 字）...\n${retained}`;
  };

  const mergeToolOutput = (previous: string | undefined, incoming: string | undefined): string | undefined => {
    if (!incoming || !incoming.trim()) {
      return previous;
    }

    const next = incoming.trim();
    if (!previous || !previous.trim()) {
      return clipToolTrace(next);
    }

    const prev = previous.trim();
    if (prev === next) {
      return previous;
    }

    if (next.startsWith(prev) || next.includes(prev)) {
      return clipToolTrace(next);
    }

    if (prev.startsWith(next) || prev.includes(next)) {
      return previous;
    }

    return clipToolTrace(`${previous}\n\n---\n${next}`);
  };

  const getOrCreateToolStateBucket = (bufferKey: string): Map<string, ToolRuntimeState> => {
    let bucket = streamToolStateMap.get(bufferKey);
    if (!bucket) {
      bucket = new Map();
      streamToolStateMap.set(bufferKey, bucket);
    }
    return bucket;
  };

  const syncToolsToBuffer = (bufferKey: string): void => {
    const bucket = streamToolStateMap.get(bufferKey);
    if (!bucket) {
      outputBuffer.setTools(bufferKey, []);
      return;
    }
    outputBuffer.setTools(bufferKey, Array.from(bucket.values()).map(item => ({
      name: item.name,
      status: item.status,
      ...(item.output !== undefined ? { output: item.output } : {}),
    })));
  };

  const upsertToolState = (
    bufferKey: string,
    toolKey: string,
    nextState: ToolRuntimeState,
    kind: 'tool' | 'subtask' = 'tool'
  ): void => {
    const bucket = getOrCreateToolStateBucket(bufferKey);
    const previous = bucket.get(toolKey);
    const mergedOutput = mergeToolOutput(previous?.output, nextState.output);
    bucket.set(toolKey, {
      name: nextState.name,
      status: nextState.status,
      output: mergedOutput,
      kind: nextState.kind ?? previous?.kind ?? kind,
    });
    upsertTimelineTool(bufferKey, toolKey, {
      name: nextState.name,
      status: nextState.status,
      output: mergedOutput,
      kind: nextState.kind ?? previous?.kind ?? kind,
    }, nextState.kind ?? previous?.kind ?? kind);
    syncToolsToBuffer(bufferKey);
  };

  const markActiveToolsCompleted = (bufferKey: string): void => {
    const bucket = streamToolStateMap.get(bufferKey);
    if (!bucket) return;
    for (const [toolKey, item] of bucket.entries()) {
      if (item.status === 'running' || item.status === 'pending') {
        bucket.set(toolKey, {
          ...item,
          status: 'completed',
        });
        upsertTimelineTool(bufferKey, toolKey, {
          ...item,
          status: 'completed',
        }, item.kind ?? 'tool');
      }
    }
    syncToolsToBuffer(bufferKey);
  };

  const appendTextFromPart = (sessionID: string, part: { id?: unknown; text?: unknown }, bufferKey: string): void => {
    if (typeof part.text !== 'string') return;
    if (typeof part.id !== 'string' || !part.id) {
      outputBuffer.append(bufferKey, part.text);
      appendTimelineText(bufferKey, `text:${sessionID}:anonymous`, 'text', part.text);
      return;
    }

    const key = `${sessionID}:${part.id}`;
    const prev = textSnapshotMap.get(key) || '';
    const current = part.text;
    if (current.startsWith(prev)) {
      const deltaText = current.slice(prev.length);
      if (deltaText) {
        outputBuffer.append(bufferKey, deltaText);
      }
    } else if (current !== prev) {
      outputBuffer.append(bufferKey, current);
    }
    textSnapshotMap.set(key, current);
    setTimelineText(bufferKey, `text:${key}`, 'text', current);
  };

  const appendReasoningFromPart = (sessionID: string, part: { id?: unknown; text?: unknown }, bufferKey: string): void => {
    if (typeof part.text !== 'string') return;
    if (typeof part.id !== 'string' || !part.id) {
      outputBuffer.appendThinking(bufferKey, part.text);
      appendTimelineText(bufferKey, `reasoning:${sessionID}:anonymous`, 'reasoning', part.text);
      return;
    }

    const key = `${sessionID}:${part.id}`;
    const prev = reasoningSnapshotMap.get(key) || '';
    const current = part.text;
    if (current.startsWith(prev)) {
      const deltaText = current.slice(prev.length);
      if (deltaText) {
        outputBuffer.appendThinking(bufferKey, deltaText);
      }
    } else if (current !== prev) {
      outputBuffer.appendThinking(bufferKey, current);
    }
    reasoningSnapshotMap.set(key, current);
    setTimelineText(bufferKey, `reasoning:${key}`, 'reasoning', current);
  };

  const clearPartSnapshotsForSession = (sessionID: string): void => {
    const prefix = `${sessionID}:`;
    for (const key of reasoningSnapshotMap.keys()) {
      if (key.startsWith(prefix)) {
        reasoningSnapshotMap.delete(key);
      }
    }
    for (const key of textSnapshotMap.keys()) {
      if (key.startsWith(prefix)) {
        textSnapshotMap.delete(key);
      }
    }
    retryNoticeMap.delete(sessionID);
    errorNoticeMap.delete(sessionID);
  };

  const formatProviderError = (raw: unknown): string => {
    if (!raw || typeof raw !== 'object') {
      return '模型执行失败';
    }

    const error = raw as { name?: unknown; data?: Record<string, unknown> };
    const name = typeof error.name === 'string' ? error.name : 'UnknownError';
    const data = error.data && typeof error.data === 'object' ? error.data : {};

    if (name === 'APIError') {
      const message = typeof data.message === 'string' ? data.message : '上游接口报错';
      const statusCode = typeof data.statusCode === 'number' ? data.statusCode : undefined;
      if (statusCode === 429) {
        return `模型请求过快（429）：${message}`;
      }
      if (statusCode === 408 || statusCode === 504) {
        return `模型响应超时：${message}`;
      }
      return statusCode ? `模型接口错误（${statusCode}）：${message}` : `模型接口错误：${message}`;
    }

    if (name === 'ProviderAuthError') {
      const providerID = typeof data.providerID === 'string' ? data.providerID : 'unknown';
      const message = typeof data.message === 'string' ? data.message : '鉴权失败';
      return `模型鉴权失败（${providerID}）：${message}`;
    }

    if (name === 'MessageOutputLengthError') {
      return '模型输出超过长度限制，已中断';
    }

    if (name === 'MessageAbortedError') {
      const message = typeof data.message === 'string' ? data.message : '会话已中断';
      return `会话已中断：${message}`;
    }

    const generic = typeof data.message === 'string' ? data.message : '';
    return generic ? `${name}：${generic}` : `${name}`;
  };

  const upsertLiveCardInteraction = (
    chatId: string,
    replyMessageId: string | null,
    cardData: StreamCardData,
    bodyMessageIds: string[],
    thinkingMessageId: string | null,
    openCodeMsgId: string
  ): void => {
    const botMessageIds = [...bodyMessageIds, thinkingMessageId].filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (botMessageIds.length === 0) {
      return;
    }

    let existing;
    for (const msgId of botMessageIds) {
      existing = chatSessionStore.findInteractionByBotMsgId(chatId, msgId);
      if (existing) {
        break;
      }
    }

    if (existing) {
      chatSessionStore.updateInteraction(
        chatId,
        r => r === existing,
        r => {
          if (!r.userFeishuMsgId && replyMessageId) {
            r.userFeishuMsgId = replyMessageId;
          }

          for (const msgId of botMessageIds) {
            if (!r.botFeishuMsgIds.includes(msgId)) {
              r.botFeishuMsgIds.push(msgId);
            }
          }

          r.cardData = { ...cardData };
          r.type = 'normal';
          if (openCodeMsgId) {
            r.openCodeMsgId = openCodeMsgId;
          }
          r.timestamp = Date.now();
        }
      );
      return;
    }

    chatSessionStore.addInteraction(chatId, {
      userFeishuMsgId: replyMessageId || '',
      openCodeMsgId: openCodeMsgId || '',
      botFeishuMsgIds: botMessageIds,
      type: 'normal',
      cardData: { ...cardData },
      timestamp: Date.now(),
    });
  };

  type PermissionDecision = {
    allow: boolean;
    remember: boolean;
  };

  const parsePermissionDecision = (raw: string): PermissionDecision | null => {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return null;

    const compact = normalized
      .replace(/[\s\u3000]+/g, '')
      .replace(/[。！!,.，；;:：\-]/g, '');
    const hasAlways =
      compact.includes('始终') ||
      compact.includes('永久') ||
      compact.includes('always') ||
      compact.includes('记住') ||
      compact.includes('总是');

    const containsAny = (words: string[]): boolean => {
      return words.some(word => compact === word || compact.includes(word));
    };

    const isDeny =
      compact === 'n' ||
      compact === 'no' ||
      compact === '否' ||
      compact === '拒绝' ||
      containsAny(['拒绝', '不同意', '不允许', 'deny']);
    if (isDeny) {
      return { allow: false, remember: false };
    }

    const isAllow =
      compact === 'y' ||
      compact === 'yes' ||
      compact === 'ok' ||
      compact === 'always' ||
      compact === '允许' ||
      compact === '始终允许' ||
      containsAny(['允许', '同意', '通过', '批准', 'allow']);
    if (isAllow) {
      return { allow: true, remember: hasAlways };
    }

    return null;
  };

  const tryHandlePendingPermissionByText = async (event: FeishuMessageEvent): Promise<boolean> => {
    if (event.chatType !== 'group') {
      return false;
    }

    const trimmedContent = event.content.trim();
    if (!trimmedContent || trimmedContent.startsWith('/')) {
      return false;
    }

    const pending = permissionHandler.peekForChat(event.chatId);
    if (!pending) {
      return false;
    }

    const decision = parsePermissionDecision(trimmedContent);
    if (!decision) {
      await feishuClient.reply(
        event.messageId,
        '当前有待确认权限，请回复：允许 / 拒绝 / 始终允许（也支持 y / n / always）'
      );
      return true;
    }

    const responded = await opencodeClient.respondToPermission(
      pending.sessionId,
      pending.permissionId,
      decision.allow,
      decision.remember
    );

    if (!responded) {
      console.error(
        `[权限] 文本响应失败: chat=${event.chatId}, session=${pending.sessionId}, permission=${pending.permissionId}`
      );
      await feishuClient.reply(event.messageId, '权限响应失败，请重试');
      return true;
    }

    const removed = permissionHandler.resolveForChat(event.chatId, pending.permissionId);
    const bufferKey = `chat:${event.chatId}`;
    if (!outputBuffer.get(bufferKey)) {
      outputBuffer.getOrCreate(bufferKey, event.chatId, pending.sessionId, event.messageId);
    }

    const toolName = removed?.tool || pending.tool || '工具';
    const resolvedText = decision.allow
      ? decision.remember
        ? `✅ 已允许并记住权限：${toolName}`
        : `✅ 已允许权限：${toolName}`
      : `❌ 已拒绝权限：${toolName}`;
    upsertTimelineNote(
      bufferKey,
      `permission-result-text:${pending.sessionId}:${pending.permissionId}:${decision.allow ? 'allow' : 'deny'}:${decision.remember ? 'always' : 'once'}`,
      resolvedText,
      'permission'
    );
    outputBuffer.touch(bufferKey);

    await feishuClient.reply(
      event.messageId,
      decision.allow ? (decision.remember ? '已允许并记住该权限' : '已允许该权限') : '已拒绝该权限'
    );
    return true;
  };

  outputBuffer.setUpdateCallback(async (buffer) => {
    const { text, thinking } = outputBuffer.getAndClear(buffer.key);
    const timelineSegments = getTimelineSegments(buffer.key);
    const pendingPermission = getPendingPermissionForChat(buffer.chatId);
    const pendingQuestion = getPendingQuestionForBuffer(buffer.sessionId, buffer.chatId);

    if (
      !text &&
      !thinking &&
      timelineSegments.length === 0 &&
      buffer.tools.length === 0 &&
      !pendingPermission &&
      !pendingQuestion &&
      buffer.status === 'running'
    ) return;

    const current = streamContentMap.get(buffer.key) || { text: '', thinking: '' };
    current.text += text;
    current.thinking += thinking;

    if (buffer.status !== 'running') {
      if (buffer.finalText) {
        current.text = buffer.finalText;
      }
      if (buffer.finalThinking) {
        current.thinking = buffer.finalThinking;
      }
    }

    streamContentMap.set(buffer.key, current);

    const hasVisibleContent =
      current.text.trim().length > 0 ||
      current.thinking.trim().length > 0 ||
      buffer.tools.length > 0 ||
      timelineSegments.length > 0 ||
      Boolean(pendingPermission) ||
      Boolean(pendingQuestion);

    if (!hasVisibleContent && buffer.status === 'running') return;

    const status: StreamCardData['status'] =
      buffer.status === 'failed' || buffer.status === 'aborted'
        ? 'failed'
        : buffer.status === 'completed'
          ? 'completed'
          : 'processing';

    let existingMessageIds = streamCardMessageIdsMap.get(buffer.key) || [];
    if (existingMessageIds.length === 0 && buffer.messageId) {
      existingMessageIds = [buffer.messageId];
    }

    const cardData: StreamCardData = {
      text: current.text,
      thinking: current.thinking,
      chatId: buffer.chatId,
      messageId: existingMessageIds[0] || undefined,
      tools: [...buffer.tools],
      segments: timelineSegments,
      ...(pendingPermission ? { pendingPermission } : {}),
      ...(pendingQuestion ? { pendingQuestion } : {}),
      status,
      showThinking: false,
    };

    const cards = buildStreamCards(
      {
        ...cardData,
        messageId: existingMessageIds[0] || undefined,
      },
      {
        componentBudget: STREAM_CARD_COMPONENT_BUDGET,
      }
    );

    const nextMessageIds: string[] = [];
    for (let index = 0; index < cards.length; index++) {
      const card = cards[index];
      const existingMessageId = existingMessageIds[index];

      if (existingMessageId) {
        const updated = await feishuClient.updateCard(existingMessageId, card);
        if (updated) {
          nextMessageIds.push(existingMessageId);
          continue;
        }

        const replacementMessageId = await feishuClient.sendCard(buffer.chatId, card);
        if (replacementMessageId) {
          void feishuClient.deleteMessage(existingMessageId).catch(() => undefined);
          nextMessageIds.push(replacementMessageId);
        } else {
          nextMessageIds.push(existingMessageId);
        }
        continue;
      }

      const newMessageId = await feishuClient.sendCard(buffer.chatId, card);
      if (newMessageId) {
        nextMessageIds.push(newMessageId);
      }
    }

    for (let index = cards.length; index < existingMessageIds.length; index++) {
      const redundantMessageId = existingMessageIds[index];
      if (!redundantMessageId) {
        continue;
      }
      void feishuClient.deleteMessage(redundantMessageId).catch(() => undefined);
    }

    if (nextMessageIds.length > 0) {
      outputBuffer.setMessageId(buffer.key, nextMessageIds[0]);
      streamCardMessageIdsMap.set(buffer.key, nextMessageIds);
    } else {
      streamCardMessageIdsMap.delete(buffer.key);
    }

    cardData.messageId = nextMessageIds[0] || undefined;
    cardData.thinkingMessageId = undefined;

    upsertLiveCardInteraction(
      buffer.chatId,
      buffer.replyMessageId,
      cardData,
      nextMessageIds,
      null,
      buffer.openCodeMsgId
    );

    if (buffer.status !== 'running') {
      streamContentMap.delete(buffer.key);
      streamToolStateMap.delete(buffer.key);
      streamTimelineMap.delete(buffer.key);
      streamCardMessageIdsMap.delete(buffer.key);
      clearPartSnapshotsForSession(buffer.sessionId);
      outputBuffer.clear(buffer.key);
    }
  });

  // 4. 监听飞书消息
  feishuClient.on('message', async (event) => {
    try {
      if (event.chatType === 'p2p') {
        await p2pHandler.handleMessage(event);
      } else if (event.chatType === 'group') {
        const handledPermission = await tryHandlePendingPermissionByText(event);
        if (handledPermission) {
          return;
        }
        await groupHandler.handleMessage(event);
      }
    } catch (error) {
      console.error('[Index] 消息处理异常:', error);
    }
  });

  feishuClient.on('chatUnavailable', (chatId: string) => {
    console.warn(`[Index] 检测到不可用群聊，移除会话绑定: ${chatId}`);
    chatSessionStore.removeSession(chatId);
  });

  // 5. 监听飞书卡片动作
  feishuClient.setCardActionHandler(async (event) => {
    try {
      const actionValue = event.action.value && typeof event.action.value === 'object'
        ? event.action.value as Record<string, unknown>
        : {};
      const action = typeof actionValue.action === 'string' ? actionValue.action : '';
      const toString = (value: unknown): string | undefined => {
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      };
      const toInteger = (value: unknown): number | undefined => {
        if (typeof value === 'number' && Number.isInteger(value)) {
          return value;
        }
        if (typeof value === 'string' && value.trim().length > 0) {
          const parsed = Number(value);
          return Number.isInteger(parsed) ? parsed : undefined;
        }
        return undefined;
      };

      // 特殊处理私聊建群相关动作
      if (action === 'create_chat' || action === 'create_chat_select' || action === 'create_chat_submit') {
        return await p2pHandler.handleCardAction(event);
      }

      // 处理权限确认
      if (action === 'permission_allow' || action === 'permission_deny') {
        const sessionId = toString(actionValue.sessionId);
        const permissionId = toString(actionValue.permissionId);
        if (!sessionId || !permissionId) {
          return {
            toast: {
              type: 'error',
              content: '权限参数缺失',
              i18n_content: { zh_cn: '权限参数缺失', en_us: 'Missing permission params' }
            }
          };
        }

        const allow = action === 'permission_allow';
        const remember = actionValue.remember === true || actionValue.remember === 'true';
        const responded = await opencodeClient.respondToPermission(
          sessionId,
          permissionId,
          allow,
          remember
        );

        if (!responded) {
          console.error(
            `[权限] 响应失败: session=${sessionId}, permission=${permissionId}, allow=${allow}, remember=${remember}`
          );
          return {
            toast: {
              type: 'error',
              content: '权限响应失败',
              i18n_content: { zh_cn: '权限响应失败', en_us: 'Permission response failed' }
            }
          };
        }

        const permissionChatId = chatSessionStore.getChatId(sessionId);
        if (permissionChatId) {
          const bufferKey = `chat:${permissionChatId}`;
          const removed = permissionHandler.resolveForChat(permissionChatId, permissionId);
          if (removed) {
            const resolvedText = allow
              ? remember
                ? `✅ 已允许并记住权限：${removed.tool}`
                : `✅ 已允许权限：${removed.tool}`
              : `❌ 已拒绝权限：${removed.tool}`;
            upsertTimelineNote(
              bufferKey,
              `permission-result:${sessionId}:${permissionId}:${allow ? 'allow' : 'deny'}:${remember ? 'always' : 'once'}`,
              resolvedText,
              'permission'
            );
          }
          outputBuffer.touch(bufferKey);
        }

        return {
          toast: {
            type: allow ? 'success' : 'error',
            content: allow ? '已允许' : '已拒绝',
            i18n_content: { zh_cn: allow ? '已允许' : '已拒绝', en_us: allow ? 'Allowed' : 'Denied' }
          }
        };
      }

      // 处理 question 跳过按钮
      if (action === 'question_skip') {
        const chatId = toString(actionValue.chatId) || event.chatId;
        const requestId = toString(actionValue.requestId);
        const questionIndex = toInteger(actionValue.questionIndex);

        if (!chatId) {
          return {
            toast: {
              type: 'error',
              content: '无法定位会话',
              i18n_content: { zh_cn: '无法定位会话', en_us: 'Failed to locate chat' }
            }
          };
        }

        const result = await groupHandler.handleQuestionSkipAction({
          chatId,
          messageId: event.messageId,
          requestId,
          questionIndex,
        });

        if (result === 'applied') {
          return {
            toast: {
              type: 'success',
              content: '已跳过本题',
              i18n_content: { zh_cn: '已跳过本题', en_us: 'Question skipped' }
            }
          };
        }

        if (result === 'stale_card') {
          return {
            toast: {
              type: 'error',
              content: '请操作最新问题状态',
              i18n_content: { zh_cn: '请操作最新问题状态', en_us: 'Please use latest question state' }
            }
          };
        }

        if (result === 'not_found') {
          return {
            toast: {
              type: 'error',
              content: '当前没有待回答问题',
              i18n_content: { zh_cn: '当前没有待回答问题', en_us: 'No pending question' }
            }
          };
        }

        return {
          toast: {
            type: 'error',
            content: '跳过失败，请重试',
            i18n_content: { zh_cn: '跳过失败，请重试', en_us: 'Skip failed, try again' }
          }
        };
      }

      // 其他卡片动作统一由 cardActionHandler 处理
      return await cardActionHandler.handle(event);

    } catch (error) {
      console.error('[Index] 卡片动作处理异常:', error);
      return {
        toast: {
          type: 'error',
          content: '处理失败',
          i18n_content: { zh_cn: '处理失败', en_us: 'Failed' }
        }
      };
    }
  });

  // 6. 监听 OpenCode 事件
  // 监听权限请求
  opencodeClient.on('permissionRequest', async (event: any) => {
      console.log(`[权限] 收到请求: ${event.tool}, ID: ${event.permissionId}, Session: ${event.sessionId}`);

      // 1. Check Whitelist
      if (permissionHandler.isToolWhitelisted(event.tool)) {
          console.log(`[权限] 工具 ${event.tool} 在白名单中，自动允许`);
          await opencodeClient.respondToPermission(event.sessionId, event.permissionId, true);
          return;
      }

      // 2. Find Chat ID
      const chatId = chatSessionStore.getChatId(event.sessionId);
      if (chatId) {
          const bufferKey = `chat:${chatId}`;
          if (!outputBuffer.get(bufferKey)) {
            outputBuffer.getOrCreate(bufferKey, chatId, event.sessionId, null);
          }

          const permissionInfo: StreamCardPendingPermission = {
            sessionId: event.sessionId,
            permissionId: event.permissionId,
            tool: event.tool,
            description: event.description || event.tool,
            risk: event.risk,
          };
          permissionHandler.enqueueForChat(chatId, {
            sessionId: permissionInfo.sessionId,
            permissionId: permissionInfo.permissionId,
            tool: permissionInfo.tool,
            description: permissionInfo.description,
            risk: permissionInfo.risk,
            userId: '',
          });
          console.log(
            `[权限] 已入队: chat=${chatId}, permission=${event.permissionId}, pending=${permissionHandler.getQueueSizeForChat(chatId)}`
          );
          upsertTimelineNote(
            bufferKey,
            `permission:${event.sessionId}:${event.permissionId}`,
            `🔐 权限请求：${event.tool}`,
            'permission'
          );
          outputBuffer.touch(bufferKey);
      } else {
          console.warn(`[权限] ⚠️ 未找到关联的群聊 (Session: ${event.sessionId})，无法展示权限交互`);
      }
  });

  const applyFailureToSession = async (sessionID: string, errorText: string): Promise<void> => {
    const chatId = chatSessionStore.getChatId(sessionID);
    if (!chatId) return;

    const dedupeKey = `${sessionID}:${errorText}`;
    if (errorNoticeMap.get(sessionID) === dedupeKey) {
      return;
    }
    errorNoticeMap.set(sessionID, dedupeKey);

    const bufferKey = `chat:${chatId}`;
    const existingBuffer = outputBuffer.get(bufferKey) || outputBuffer.getOrCreate(bufferKey, chatId, sessionID, null);

    upsertTimelineNote(bufferKey, `error:${sessionID}:${errorText}`, `❌ ${errorText}`, 'error');
    outputBuffer.append(bufferKey, `\n\n❌ ${errorText}`);
    outputBuffer.touch(bufferKey);
    outputBuffer.setStatus(bufferKey, 'failed');

    if (!existingBuffer.messageId) {
      await feishuClient.sendText(chatId, `❌ ${errorText}`);
    }
  };

  // 监听会话状态变化（重试提示）
  opencodeClient.on('sessionStatus', (event: any) => {
    const sessionID = toSessionId(event?.sessionID || event?.sessionId);
    const status = event?.status;
    if (!sessionID || !status || typeof status !== 'object') return;

    const chatId = chatSessionStore.getChatId(sessionID);
    if (!chatId) return;

    const bufferKey = `chat:${chatId}`;
    if (!outputBuffer.get(bufferKey)) {
      outputBuffer.getOrCreate(bufferKey, chatId, sessionID, null);
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
  });

  // 监听会话空闲事件（完成兜底）
  opencodeClient.on('sessionIdle', (event: any) => {
    const sessionID = toSessionId(event?.sessionID || event?.sessionId);
    if (!sessionID) return;

    const chatId = chatSessionStore.getChatId(sessionID);
    if (!chatId) return;

    const bufferKey = `chat:${chatId}`;
    markActiveToolsCompleted(bufferKey);
    const buffer = outputBuffer.get(bufferKey);
    if (buffer && buffer.status === 'running') {
      outputBuffer.setStatus(bufferKey, 'completed');
    }
  });

  // 监听消息更新（记录 openCodeMsgId / 处理 assistant error）
  opencodeClient.on('messageUpdated', async (event: any) => {
    const info = event?.info;
    if (!info || typeof info !== 'object') return;

    const role = typeof info.role === 'string' ? info.role : '';
    if (role !== 'assistant') return;

    const sessionID = toSessionId(info.sessionID);
    if (!sessionID) return;

    const chatId = chatSessionStore.getChatId(sessionID);
    if (!chatId) return;

    const bufferKey = `chat:${chatId}`;
    if (!outputBuffer.get(bufferKey)) {
      outputBuffer.getOrCreate(bufferKey, chatId, sessionID, null);
    }

    if (typeof info.id === 'string' && info.id) {
      outputBuffer.setOpenCodeMsgId(bufferKey, info.id);
    }

    if (info.error) {
      const text = formatProviderError(info.error);
      await applyFailureToSession(sessionID, text);
    }
  });

  // 监听会话级错误（网络超时、模型限流等）
  opencodeClient.on('sessionError', async (event: any) => {
    const sessionID = toSessionId(event?.sessionID || event?.sessionId);
    if (!sessionID) return;
    const text = formatProviderError(event?.error);
    await applyFailureToSession(sessionID, text);
  });
  
  // 监听流式输出
  opencodeClient.on('messagePartUpdated', (event: any) => {
      const part = event?.part;
      const sessionID = event?.sessionID || part?.sessionID;
      const delta = event?.delta;
      if (!sessionID) return;

      const chatId = chatSessionStore.getChatId(sessionID);
      if (!chatId) return;

      const bufferKey = `chat:${chatId}`;
      if (!outputBuffer.get(bufferKey)) {
        outputBuffer.getOrCreate(bufferKey, chatId, sessionID, null);
      }

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
          const previous = getOrCreateToolStateBucket(bufferKey).get(toolKey);
          const output = buildToolTraceOutput(toolPart, status, !previous || !previous.output);

          upsertToolState(bufferKey, toolKey, {
            name: toolName,
            status,
            ...(output ? { output } : {}),
            kind: 'tool',
          }, 'tool');
      }

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

      if (part?.type === 'retry') {
          const retryMessage = part?.error?.data?.message;
          if (typeof retryMessage === 'string' && retryMessage.trim()) {
            const retryKey = typeof part.id === 'string' && part.id ? part.id : retryMessage.trim().slice(0, 80);
            upsertTimelineNote(bufferKey, `part-retry:${sessionID}:${retryKey}`, `⚠️ 模型请求重试：${retryMessage.trim()}`, 'retry');
            outputBuffer.touch(bufferKey);
          }
      }

      if (part?.type === 'compaction') {
          const compactionKey = typeof part.id === 'string' && part.id ? part.id : `${Date.now()}`;
          upsertTimelineNote(bufferKey, `compaction:${sessionID}:${compactionKey}`, '🗜️ 会话上下文已压缩', 'compaction');
          outputBuffer.touch(bufferKey);
      }

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

          if (part?.type === 'reasoning') {
            appendReasoningFromPart(sessionID, part, bufferKey);
            return;
          }

          if (part?.type === 'text') {
            appendTextFromPart(sessionID, part, bufferKey);
            return;
          }
      }

      if (delta && typeof delta === 'object') {
          if (delta.type === 'reasoning') {
              const reasoningText =
                typeof delta.text === 'string'
                  ? delta.text
                  : typeof delta.reasoning === 'string'
                    ? delta.reasoning
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
          } else if (delta.type === 'thinking' && typeof delta.thinking === 'string') {
              outputBuffer.appendThinking(bufferKey, delta.thinking);
              if (typeof part?.id === 'string' && part.id) {
                const key = `${sessionID}:${part.id}`;
                const prev = reasoningSnapshotMap.get(key) || '';
                const next = `${prev}${delta.thinking}`;
                reasoningSnapshotMap.set(key, next);
                setTimelineText(bufferKey, `reasoning:${key}`, 'reasoning', next);
              } else {
                appendTimelineText(bufferKey, `reasoning:${sessionID}:anonymous`, 'reasoning', delta.thinking);
              }
          } else if (delta.type === 'text' && typeof delta.text === 'string' && delta.text.length > 0) {
              outputBuffer.append(bufferKey, delta.text);
              if (typeof part?.id === 'string' && part.id) {
                const key = `${sessionID}:${part.id}`;
                const prev = textSnapshotMap.get(key) || '';
                const next = `${prev}${delta.text}`;
                textSnapshotMap.set(key, next);
                setTimelineText(bufferKey, `text:${key}`, 'text', next);
              } else {
                appendTimelineText(bufferKey, `text:${sessionID}:anonymous`, 'text', delta.text);
              }
          } else if (typeof delta.text === 'string' && delta.text.length > 0) {
              outputBuffer.append(bufferKey, delta.text);
              if (part?.type === 'reasoning') {
                if (typeof part?.id === 'string' && part.id) {
                  const key = `${sessionID}:${part.id}`;
                  const prev = reasoningSnapshotMap.get(key) || '';
                  const next = `${prev}${delta.text}`;
                  reasoningSnapshotMap.set(key, next);
                  setTimelineText(bufferKey, `reasoning:${key}`, 'reasoning', next);
                } else {
                  appendTimelineText(bufferKey, `reasoning:${sessionID}:anonymous`, 'reasoning', delta.text);
                }
              } else if (part?.type === 'text') {
                if (typeof part?.id === 'string' && part.id) {
                  const key = `${sessionID}:${part.id}`;
                  const prev = textSnapshotMap.get(key) || '';
                  const next = `${prev}${delta.text}`;
                  textSnapshotMap.set(key, next);
                  setTimelineText(bufferKey, `text:${key}`, 'text', next);
                } else {
                  appendTimelineText(bufferKey, `text:${sessionID}:anonymous`, 'text', delta.text);
                }
              }
          }
          return;
      }

      // 某些事件不带 delta，只带最新 part，做兜底
      if (part?.type === 'reasoning' && typeof part.text === 'string') {
          appendReasoningFromPart(sessionID, part, bufferKey);
      } else if (part?.type === 'text' && typeof part.text === 'string') {
          appendTextFromPart(sessionID, part, bufferKey);
      }
  });

  // 监听 AI 提问事件
  opencodeClient.on('questionAsked', (event: any) => {
      const request = event as import('./opencode/question-handler.js').QuestionRequest;
      const chatId = chatSessionStore.getChatId(request.sessionID);

      if (chatId) {
          console.log(`[问题] 收到提问: ${request.id} (Chat: ${chatId})`);
          const bufferKey = `chat:${chatId}`;
          if (!outputBuffer.get(bufferKey)) {
            outputBuffer.getOrCreate(bufferKey, chatId, request.sessionID, null);
          }

          questionHandler.register(request, `chat:${chatId}`, chatId);
          upsertTimelineNote(bufferKey, `question:${request.sessionID}:${request.id}`, '🤝 问答交互（请在当前流式卡片中作答）', 'question');
          outputBuffer.touch(bufferKey);
      }
  });

  // 7. 监听生命周期事件 (需要在启动后注册)
  feishuClient.onMemberLeft(async (chatId, memberId) => {
    await lifecycleHandler.handleMemberLeft(chatId, memberId);
  });

  feishuClient.onChatDisbanded(async (chatId) => {
    console.log(`[Index] 群 ${chatId} 已解散`);
    chatSessionStore.removeSession(chatId);
  });
  
  feishuClient.onMessageRecalled(async (event) => {
    // 处理撤回
    // event.message_id, event.chat_id
    // 如果撤回的消息是该会话最后一条 User Message，则触发 Undo
    const chatId = event.chat_id;
    const recalledMsgId = event.message_id;
    
    if (chatId && recalledMsgId) {
       const session = chatSessionStore.getSession(chatId);
       if (session && session.lastFeishuUserMsgId === recalledMsgId) {
          console.log(`[Index] 检测到用户撤回最后一条消息: ${recalledMsgId}`);
          await commandHandler.handleUndo(chatId);
       }
    }
  });

  // 8. 启动飞书客户端
  await feishuClient.start();

  // 9. 启动清理检查
  await lifecycleHandler.cleanUpOnStart();

  console.log('✅ 服务已就绪');
  
  // 优雅退出处理
  const gracefulShutdown = (signal: string) => {
    console.log(`\n[${signal}] 正在关闭服务...`);

    // 停止飞书连接
    try {
      feishuClient.stop();
    } catch (e) {
      console.error('停止飞书连接失败:', e);
    }

    // 断开 OpenCode 连接
    try {
      opencodeClient.disconnect();
    } catch (e) {
      console.error('断开 OpenCode 失败:', e);
    }

    // 清理所有缓冲区和定时器
    try {
      outputBuffer.clearAll();
      delayedResponseHandler.cleanupExpired(0);
      questionHandler.cleanupExpired(0);
    } catch (e) {
      console.error('清理资源失败:', e);
    }

    // 延迟退出以确保所有清理完成
    setTimeout(() => {
      console.log('✅ 服务已安全关闭');
      process.exit(0);
    }, 500);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // nodemon 重启信号
}

main().catch(error => {
  console.error('Fatal Error:', error);
  process.exit(1);
});
