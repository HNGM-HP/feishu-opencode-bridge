/**
 * 路由器动作处理器
 *
 * 从 index.ts 抽取的权限和问题处理逻辑，
 * 通过依赖注入方式提供给 RootRouter。
 */

import type { FeishuCardActionEvent } from '../feishu/client.js';
import type { FeishuMessageEvent } from '../feishu/client.js';
import type { CardActionResponse } from './root-router.js';
import { chatSessionStore } from '../store/chat-session.js';
import { permissionHandler } from '../permissions/handler.js';
import { opencodeClient } from '../opencode/client.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { feishuClient } from '../feishu/client.js';
import { groupHandler } from '../handlers/group.js';

/**
 * Timeline 回调类型
 */
export type UpsertTimelineNote = (
  bufferKey: string,
  noteKey: string,
  text: string,
  variant?: 'retry' | 'compaction' | 'question' | 'error' | 'permission'
) => void;

// 辅助函数
const toTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toInteger = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : undefined;
  }
  return undefined;
};

type PermissionDecision = {
  allow: boolean;
  remember: boolean;
};

const parsePermissionDecision = (raw: string): PermissionDecision | null => {
  const normalized = raw.normalize('NFKC').trim().toLowerCase();
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

/**
 * 创建权限动作处理器
 */
export function createPermissionActionCallbacks(
  upsertTimelineNote: UpsertTimelineNote
): {
  handlePermissionAction: (
    actionValue: Record<string, unknown>,
    action: 'permission_allow' | 'permission_deny'
  ) => Promise<CardActionResponse>;
  tryHandlePendingPermissionByText: (
    event: FeishuMessageEvent
  ) => Promise<boolean>;
} {
  const resolvePermissionDirectoryOptions = (
    sessionId: string,
    chatIdHint?: string
  ): { directory?: string; fallbackDirectories?: string[] } => {
    const conversation = chatSessionStore.getConversationBySessionId(sessionId);
    const boundSession = conversation
      ? chatSessionStore.getSessionByConversation(conversation.platform, conversation.conversationId)
      : undefined;

    const queueHintSession = chatIdHint
      ? chatSessionStore.getSession(chatIdHint)
      : undefined;

    const directory = boundSession?.resolvedDirectory
      || queueHintSession?.resolvedDirectory
      || boundSession?.defaultDirectory
      || queueHintSession?.defaultDirectory;

    const fallbackDirectories = Array.from(
      new Set(
        [
          boundSession?.resolvedDirectory,
          boundSession?.defaultDirectory,
          queueHintSession?.resolvedDirectory,
          queueHintSession?.defaultDirectory,
          ...chatSessionStore.getKnownDirectories(),
        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    );

    return {
      ...(directory ? { directory } : {}),
      ...(fallbackDirectories.length > 0 ? { fallbackDirectories } : {}),
    };
  };

  const handlePermissionAction = async (
    actionValue: Record<string, unknown>,
    action: 'permission_allow' | 'permission_deny'
  ): Promise<CardActionResponse> => {
    const sessionId = toTrimmedString(actionValue.sessionId);
    const permissionId = toTrimmedString(actionValue.permissionId);

    if (!sessionId || !permissionId) {
      return {
        toast: {
          type: 'error',
          content: '权限参数缺失',
          i18n_content: { zh_cn: '权限参数缺失', en_us: 'Missing permission params' },
        },
      };
    }

    const allow = action === 'permission_allow';
    const rememberRaw = typeof actionValue.remember === 'string'
      ? actionValue.remember.normalize('NFKC').trim().toLowerCase()
      : actionValue.remember;
    const remember =
      rememberRaw === true ||
      rememberRaw === 1 ||
      rememberRaw === '1' ||
      rememberRaw === 'true' ||
      rememberRaw === 'always' ||
      rememberRaw === '始终允许';

    const permissionDirectoryOptions = resolvePermissionDirectoryOptions(sessionId);
    const responded = await opencodeClient.respondToPermission(
      sessionId,
      permissionId,
      allow,
      remember,
      permissionDirectoryOptions
    );

    if (!responded) {
      console.error(`[权限] 响应失败: session=${sessionId}, permission=${permissionId}`);
      return {
        toast: {
          type: 'error',
          content: '权限响应失败',
          i18n_content: { zh_cn: '权限响应失败', en_us: 'Permission response failed' },
        },
      };
    }

    console.log(
      `[权限] 卡片响应成功: session=${sessionId}, permission=${permissionId}, allow=${allow}, remember=${remember}`
    );

    const permissionChatId = chatSessionStore.getChatId(sessionId);
    if (permissionChatId) {
      const bufferKey = `chat:${permissionChatId}`;
      const removed = permissionHandler.resolveForChat(permissionChatId, permissionId);
      if (removed) {
        const resolvedText = allow
          ? remember ? `✅ 已允许并记住权限：${removed.tool}` : `✅ 已允许权限：${removed.tool}`
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
        i18n_content: { zh_cn: allow ? '已允许' : '已拒绝', en_us: allow ? 'Allowed' : 'Denied' },
      },
    };
  };

  const tryHandlePendingPermissionByText = async (
    event: FeishuMessageEvent
  ): Promise<boolean> => {
    if (event.chatType !== 'group') return false;

    const trimmedContent = event.content.trim();
    if (!trimmedContent || trimmedContent.startsWith('/')) return false;

    const pending = permissionHandler.peekForChat(event.chatId);
    if (!pending) return false;

    const decision = parsePermissionDecision(trimmedContent);
    if (!decision) {
      await feishuClient.reply(event.messageId, '当前有待确认权限，请回复：允许 / 拒绝 / 始终允许（也支持 y / n / always）');
      return true;
    }

    const permissionDirectoryOptions = resolvePermissionDirectoryOptions(pending.sessionId, event.chatId);
    const responded = await opencodeClient.respondToPermission(
      pending.sessionId,
      pending.permissionId,
      decision.allow,
      decision.remember,
      permissionDirectoryOptions
    );

    if (!responded) {
      console.error(`[权限] 文本响应失败: chat=${event.chatId}`);
      await feishuClient.reply(event.messageId, '权限响应失败，请重试');
      return true;
    }

    console.log(
      `[权限] 文本响应成功: chat=${event.chatId}, session=${pending.sessionId}, permission=${pending.permissionId}, allow=${decision.allow}, remember=${decision.remember}`
    );

    const removed = permissionHandler.resolveForChat(event.chatId, pending.permissionId);
    const bufferKey = `chat:${event.chatId}`;
    if (!outputBuffer.get(bufferKey)) {
      outputBuffer.getOrCreate(bufferKey, event.chatId, pending.sessionId, event.messageId);
    }

    const toolName = removed?.tool || pending.tool || '工具';
    const resolvedText = decision.allow
      ? decision.remember ? `✅ 已允许并记住权限：${toolName}` : `✅ 已允许权限：${toolName}`
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

  return {
    handlePermissionAction,
    tryHandlePendingPermissionByText,
  };
}

/**
 * 创建问题动作处理器
 */
export function createQuestionActionCallbacks(): {
  handleQuestionSkipAction: (
    event: FeishuCardActionEvent,
    actionValue: Record<string, unknown>
  ) => Promise<CardActionResponse>;
} {
  const handleQuestionSkipAction = async (
    event: FeishuCardActionEvent,
    actionValue: Record<string, unknown>
  ): Promise<CardActionResponse> => {
    const chatId = toTrimmedString(actionValue.chatId) || event.chatId;
    const requestId = toTrimmedString(actionValue.requestId);
    const questionIndex = toInteger(actionValue.questionIndex);

    if (!chatId) {
      return {
        toast: {
          type: 'error',
          content: '无法定位会话',
          i18n_content: { zh_cn: '无法定位会话', en_us: 'Failed to locate chat' },
        },
      };
    }

    const result = await groupHandler.handleQuestionSkipAction({
      chatId,
      messageId: event.messageId,
      requestId,
      questionIndex,
    });

    if (result === 'applied') {
      return { toast: { type: 'success', content: '已跳过本题', i18n_content: { zh_cn: '已跳过本题', en_us: 'Question skipped' } } };
    }
    if (result === 'stale_card') {
      return { toast: { type: 'error', content: '请操作最新问题状态', i18n_content: { zh_cn: '请操作最新问题状态', en_us: 'Please use latest question state' } } };
    }
    if (result === 'not_found') {
      return { toast: { type: 'error', content: '当前没有待回答问题', i18n_content: { zh_cn: '当前没有待回答问题', en_us: 'No pending question' } } };
    }
    return { toast: { type: 'error', content: '跳过失败，请重试', i18n_content: { zh_cn: '跳过失败，请重试', en_us: 'Skip failed, try again' } } };
  };

  return {
    handleQuestionSkipAction,
  };
}
