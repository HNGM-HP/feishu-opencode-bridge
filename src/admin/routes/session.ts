/**
 * Session 管理 API 路由
 *
 * 提供平台会话与 OpenCode Session 绑定的 CRUD 操作
 */

import express from 'express';
import { chatSessionStore, type ChatSessionData, type SessionBindingOptions } from '../../store/chat-session.js';
import { opencodeClient } from '../../opencode/client.js';
import type { Session } from '@opencode-ai/sdk';
import { feishuClient } from '../../feishu/client.js';
import { discordAdapter } from '../../platform/adapters/discord-adapter.js';
import { telegramAdapter } from '../../platform/adapters/telegram-adapter.js';
import { qqAdapter } from '../../platform/adapters/qq-adapter.js';

export interface PlatformChat {
  id: string;
  name: string;
  type: 'p2p' | 'group' | 'channel';
  avatar?: string;
  memberCount?: number;
  isBound: boolean;
  boundSessionId?: string;
  boundSessionTitle?: string;
}

export interface SessionBindingItem {
  platform: string;
  conversationId: string;
  sessionId: string;
  title?: string;
  chatType?: 'p2p' | 'group';
  creatorId: string;
  sessionDirectory?: string;
  resolvedDirectory?: string;
  projectName?: string;
  createdAt: number;
}

export interface OpenCodeSessionItem {
  id: string;
  title?: string;
  createdAt?: string;
  updatedAt?: number;
  projectPath?: string;
  directory?: string;
  isBound: boolean;
  bindings: Array<{
    platform: string;
    conversationId: string;
    title?: string;
    chatType?: 'p2p' | 'group';
  }>;
  localOnly?: boolean;
}

export interface CreateBindingRequest {
  platform: string;
  conversationId: string;
  sessionId: string;
  title?: string;
  creatorId?: string;
  chatType?: 'p2p' | 'group';
  sessionDirectory?: string;
}

export interface UpdateBindingRequest {
  sessionId?: string;
  title?: string;
  sessionDirectory?: string;
  resolvedDirectory?: string;
  projectName?: string;
}

export interface BatchOperationRequest {
  action: 'unbind' | 'delete';
  bindings: Array<{ platform: string; conversationId: string }>;
}

export function createSessionRoutes(): express.Router {
  const router = express.Router();

  // ── GET /api/sessions/bindings - 获取所有绑定列表
  router.get('/bindings', (req, res) => {
    try {
      const { platform, chatType, creatorId, page = '1', limit = '20', search } = req.query;

      let bindings = chatSessionStore.getConversationBindings();

      // 按平台筛选
      if (platform && typeof platform === 'string') {
        bindings = bindings.filter(b => b.platform === platform);
      }

      // 按会话类型筛选
      if (chatType && typeof chatType === 'string') {
        bindings = bindings.filter(b => b.session.chatType === chatType);
      }

      // 按创建者筛选
      if (creatorId && typeof creatorId === 'string') {
        bindings = bindings.filter(b => b.session.creatorId === creatorId);
      }

      // 关键词搜索
      if (search && typeof search === 'string') {
        const searchLower = search.toLowerCase();
        bindings = bindings.filter(b =>
          b.conversationId.toLowerCase().includes(searchLower) ||
          b.session.title?.toLowerCase().includes(searchLower) ||
          b.session.sessionId.toLowerCase().includes(searchLower)
        );
      }

      // 按创建时间倒序
      bindings.sort((a, b) => b.session.createdAt - a.session.createdAt);

      const pageNum = parseInt(page as string, 10) || 1;
      const limitNum = Math.min(parseInt(limit as string, 10) || 20, 100);
      const total = bindings.length;
      const startIndex = (pageNum - 1) * limitNum;
      const pagedBindings = bindings.slice(startIndex, startIndex + limitNum);

      const items: SessionBindingItem[] = pagedBindings.map(b => ({
        platform: b.platform,
        conversationId: b.conversationId,
        sessionId: b.session.sessionId,
        title: b.session.title,
        chatType: b.session.chatType,
        creatorId: b.session.creatorId,
        sessionDirectory: b.session.sessionDirectory,
        resolvedDirectory: b.session.resolvedDirectory,
        projectName: b.session.projectName,
        createdAt: b.session.createdAt,
      }));

      res.json({
        bindings: items,
        total,
        page: pageNum,
        limit: limitNum,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Session API] 获取绑定列表失败:', message);
      res.status(500).json({ error: message });
    }
  });

  // ── GET /api/sessions/bindings/stats - 获取绑定统计
  router.get('/bindings/stats', (_req, res) => {
    try {
      const bindings = chatSessionStore.getConversationBindings();

      // 按平台统计
      const platformStats: Record<string, number> = {};
      for (const b of bindings) {
        platformStats[b.platform] = (platformStats[b.platform] || 0) + 1;
      }

      // 按类型统计
      const typeStats = {
        p2p: bindings.filter(b => b.session.chatType === 'p2p').length,
        group: bindings.filter(b => b.session.chatType === 'group').length,
        unknown: bindings.filter(b => !b.session.chatType).length,
      };

      res.json({
        total: bindings.length,
        byPlatform: platformStats,
        byType: typeStats,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // ── POST /api/sessions/bindings - 新增绑定
  router.post('/bindings', (req, res) => {
    try {
      const { platform, conversationId, sessionId, title, creatorId, chatType, sessionDirectory } = req.body as CreateBindingRequest;

      if (!platform || !conversationId || !sessionId) {
        res.status(400).json({ error: '缺少必填字段: platform, conversationId, sessionId' });
        return;
      }

      // 检查是否已存在绑定
      const existing = chatSessionStore.getSessionByConversation(platform, conversationId);
      if (existing) {
        res.status(409).json({ error: '该平台会话已绑定，请使用更新接口修改' });
        return;
      }

      const options: SessionBindingOptions = {};
      if (chatType) options.chatType = chatType;
      if (sessionDirectory) options.sessionDirectory = sessionDirectory;

      chatSessionStore.setSessionByConversation(
        platform,
        conversationId,
        sessionId,
        creatorId || 'admin',
        title,
        options
      );

      res.json({
        ok: true,
        binding: {
          platform,
          conversationId,
          sessionId,
          title,
          chatType,
          creatorId: creatorId || 'admin',
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Session API] 新增绑定失败:', message);
      res.status(500).json({ error: message });
    }
  });

  // ── PUT /api/sessions/bindings/:platform/:conversationId - 更新绑定
  router.put('/bindings/:platform/:conversationId', (req, res) => {
    try {
      const { platform, conversationId } = req.params;
      const { sessionId, title, sessionDirectory, resolvedDirectory, projectName } = req.body as UpdateBindingRequest;

      const existing = chatSessionStore.getSessionByConversation(platform, conversationId);
      if (!existing) {
        res.status(404).json({ error: '绑定不存在' });
        return;
      }

      // 如果要更新 sessionId，需要重新绑定
      if (sessionId && sessionId !== existing.sessionId) {
        chatSessionStore.setSessionByConversation(
          platform,
          conversationId,
          sessionId,
          existing.creatorId,
          title || existing.title,
          {
            chatType: existing.chatType,
            sessionDirectory: sessionDirectory ?? existing.sessionDirectory,
            resolvedDirectory: resolvedDirectory ?? existing.resolvedDirectory,
            projectName: projectName ?? existing.projectName,
          }
        );
      } else {
        // 只更新其他字段
        if (title !== undefined) {
          chatSessionStore.updateTitleByConversation(platform, conversationId, title);
        }
        if (sessionDirectory !== undefined || resolvedDirectory !== undefined || projectName !== undefined) {
          // 直接修改 session 数据
          if (sessionDirectory !== undefined) existing.sessionDirectory = sessionDirectory;
          if (resolvedDirectory !== undefined) existing.resolvedDirectory = resolvedDirectory;
          if (projectName !== undefined) existing.projectName = projectName;
          // 触发保存
          chatSessionStore.updateTitleByConversation(platform, conversationId, existing.title || '');
        }
      }

      res.json({ ok: true, message: '绑定已更新' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Session API] 更新绑定失败:', message);
      res.status(500).json({ error: message });
    }
  });

  // ── DELETE /api/sessions/bindings/:platform/:conversationId - 解除绑定
  router.delete('/bindings/:platform/:conversationId', async (req, res) => {
    try {
      const { platform, conversationId } = req.params;
      const { deleteOpenCode } = req.query;

      const existing = chatSessionStore.getSessionByConversation(platform, conversationId);
      if (!existing) {
        res.status(404).json({ error: '绑定不存在' });
        return;
      }

      const sessionId = existing.sessionId;

      // 解除绑定
      chatSessionStore.removeSessionByConversation(platform, conversationId);

      // 如果需要删除 OpenCode session
      let openCodeDeleted = false;
      if (deleteOpenCode === 'true') {
        try {
          openCodeDeleted = await opencodeClient.deleteSession(sessionId);
          if (!openCodeDeleted) {
            console.warn('[Session API] 删除 OpenCode session 失败:', sessionId);
          }
        } catch (e) {
          console.warn('[Session API] 删除 OpenCode session 失败:', e);
        }
      }

      res.json({
        ok: true,
        message: '绑定已解除',
        openCodeDeleted,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Session API] 解除绑定失败:', message);
      res.status(500).json({ error: message });
    }
  });

  // ── POST /api/sessions/bindings/batch - 批量操作
  router.post('/bindings/batch', async (req, res) => {
    try {
      const { action, bindings } = req.body as BatchOperationRequest;

      if (!action || !bindings || !Array.isArray(bindings) || bindings.length === 0) {
        res.status(400).json({ error: '缺少必填字段: action, bindings' });
        return;
      }

      const results: Array<{ platform: string; conversationId: string; success: boolean; error?: string }> = [];

      for (const { platform, conversationId } of bindings) {
        try {
          const existing = chatSessionStore.getSessionByConversation(platform, conversationId);
          if (!existing) {
            results.push({ platform, conversationId, success: false, error: '绑定不存在' });
            continue;
          }

          // 解除绑定
          chatSessionStore.removeSessionByConversation(platform, conversationId);

          // 如果是删除操作，也删除 OpenCode session
          if (action === 'delete') {
            try {
              await opencodeClient.deleteSession(existing.sessionId);
            } catch (e) {
              console.warn('[Session API] 批量删除 OpenCode session 失败:', e);
            }
          }

          results.push({ platform, conversationId, success: true });
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : 'Unknown error';
          results.push({ platform, conversationId, success: false, error: errorMsg });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      res.json({
        ok: true,
        action,
        total: bindings.length,
        successCount,
        failCount,
        results,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Session API] 批量操作失败:', message);
      res.status(500).json({ error: message });
    }
  });

  // ── GET /api/sessions/opencode/list - 获取 OpenCode session 列表（含绑定状态）
  router.get('/opencode/list', async (_req, res) => {
    try {
      // 获取所有本地绑定关系（无论 OpenCode 是否可用都要返回）
      const bindings = chatSessionStore.getConversationBindings();
      const sessionIdToBindings = new Map<string, typeof bindings>();

      for (const b of bindings) {
        const sid = b.session.sessionId;
        if (!sessionIdToBindings.has(sid)) {
          sessionIdToBindings.set(sid, []);
        }
        sessionIdToBindings.get(sid)!.push(b);
      }

      // 尝试获取 OpenCode sessions
      let openCodeSessions: Array<{
        id: string;
        title?: string;
        createdAt?: string;
        updatedAt?: number;
        projectPath?: string;
        directory?: string;
      }> = [];
      let openCodeAvailable = false;

      try {
        const sessions = await opencodeClient.listSessionsAcrossProjects();
        openCodeSessions = sessions.map((s: Session) => ({
          id: s.id,
          title: s.title,
          createdAt: s.time?.created ? new Date(s.time.created).toISOString() : undefined,
          updatedAt: s.time?.updated
            ? s.time.updated
            : s.time?.created
              ? s.time.created
              : 0,
          projectPath: s.directory,
          directory: s.directory,
        }));
        openCodeAvailable = true;
      } catch (e) {
        console.warn('[Session API] OpenCode 服务不可用:', e);
      }

      // 构建 OpenCode session 集合
      const openCodeSessionIds = new Set(openCodeSessions.map(s => s.id));

      // 构建返回数据：OpenCode sessions + 仅本地绑定的 sessions
      const sessions: OpenCodeSessionItem[] = openCodeSessions.map(s => {
        const boundTo = sessionIdToBindings.get(s.id) || [];
        return {
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          projectPath: s.projectPath,
          directory: s.directory,
          isBound: boundTo.length > 0,
          bindings: boundTo.map(b => ({
            platform: b.platform,
            conversationId: b.conversationId,
            title: b.session.title,
            chatType: b.session.chatType,
          })),
        };
      });

      // 添加仅存在于本地绑定的 sessions（OpenCode 中已不存在）
      for (const [sessionId, boundTo] of sessionIdToBindings) {
        if (!openCodeSessionIds.has(sessionId)) {
          sessions.push({
            id: sessionId,
            title: boundTo[0]?.session.title,
            createdAt: undefined,
            updatedAt: boundTo.reduce((latest, item) => Math.max(latest, item.session.createdAt || 0), 0),
            projectPath: undefined,
            directory: boundTo[0]?.session.sessionDirectory || boundTo[0]?.session.resolvedDirectory,
            isBound: true,
            bindings: boundTo.map(b => ({
              platform: b.platform,
              conversationId: b.conversationId,
              title: b.session.title,
              chatType: b.session.chatType,
            })),
            localOnly: true,
          });
        }
      }

      sessions.sort((left, right) => {
        const updatedDiff = (right.updatedAt || 0) - (left.updatedAt || 0);
        if (updatedDiff !== 0) {
          return updatedDiff;
        }
        return left.id.localeCompare(right.id, 'en');
      });

      res.json({ sessions, openCodeAvailable });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Session API] 获取 sessions 失败:', message);
      res.status(500).json({ error: message, sessions: [] });
    }
  });

  // ── DELETE /api/sessions/opencode/:sessionId - 删除 OpenCode session
  router.delete('/opencode/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;

      // 先删除所有相关绑定
      const bindings = chatSessionStore.getConversationBindings();
      for (const b of bindings) {
        if (b.session.sessionId === sessionId) {
          chatSessionStore.removeSessionByConversation(b.platform, b.conversationId);
        }
      }

      // 调用 OpenCode API 删除 session
      const deleted = await opencodeClient.deleteSession(sessionId);

      if (!deleted) {
        console.warn('[Session API] 删除 OpenCode session 失败:', sessionId);
        res.status(502).json({ error: '删除 OpenCode session 失败' });
        return;
      }

      res.json({ ok: true, message: 'Session 已删除' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Session API] 删除 OpenCode session 失败:', message);
      res.status(500).json({ error: message });
    }
  });

  // ── GET /api/sessions/platforms - 获取支持的平台列表
  router.get('/platforms', (_req, res) => {
    const platforms = [
      { id: 'feishu', name: '飞书', icon: 'feishu' },
      { id: 'discord', name: 'Discord', icon: 'discord' },
      { id: 'wecom', name: '企业微信', icon: 'wecom' },
      { id: 'telegram', name: 'Telegram', icon: 'telegram' },
      { id: 'qq', name: 'QQ', icon: 'qq' },
      { id: 'whatsapp', name: 'WhatsApp', icon: 'whatsapp' },
      { id: 'weixin', name: '个人微信', icon: 'weixin' },
    ];
    res.json({ platforms });
  });

  // ── GET /api/sessions/platform-chats/:platform - 获取指定平台的聊天列表
  router.get('/platform-chats/:platform', async (req, res) => {
    try {
      const { platform } = req.params;
      const chats: PlatformChat[] = [];

      // 获取该平台已有的绑定
      const bindings = chatSessionStore.getConversationBindings();
      const platformBindings = bindings.filter(b => b.platform === platform);
      const bindingMap = new Map(platformBindings.map(b => [b.conversationId, b.session]));

      switch (platform) {
        case 'feishu':
          await fetchFeishuChats(chats, bindingMap);
          break;
        case 'discord':
          await fetchDiscordChats(chats, bindingMap);
          break;
        case 'telegram':
          await fetchTelegramChats(chats, bindingMap);
          break;
        case 'qq':
          await fetchQQChats(chats, bindingMap);
          break;
        default:
          // 对于不支持的平台，返回已绑定的会话
          for (const [conversationId, session] of bindingMap) {
            chats.push({
              id: conversationId,
              name: session.title || conversationId,
              type: session.chatType || 'group',
              isBound: true,
              boundSessionId: session.sessionId,
              boundSessionTitle: session.title,
            });
          }
      }

      res.json({ chats, platform });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Session API] 获取平台聊天列表失败:`, message);
      res.status(500).json({ error: message, chats: [] });
    }
  });

  return router;
}

// ── 平台聊天获取函数

async function fetchFeishuChats(chats: PlatformChat[], bindingMap: Map<string, ChatSessionData>): Promise<void> {
  const appended = new Set<string>();

  try {
    const chatIds = await feishuClient.getUserChats();
    console.log(`[Session API] 获取飞书群列表: ${chatIds.length} 个`);

    for (const chatId of chatIds) {
      const binding = bindingMap.get(chatId);
      const chatInfo = await feishuClient.getChat(chatId).catch(() => null);

      chats.push({
        id: chatId,
        name: chatInfo?.name || chatId,
        type: 'group',
        isBound: !!binding,
        boundSessionId: binding?.sessionId,
        boundSessionTitle: binding?.title,
      });
      appended.add(chatId);
    }
  } catch (e) {
    console.warn('[Session API] 获取飞书聊天列表失败:', e);
  }

  for (const [conversationId, session] of bindingMap) {
    if (appended.has(conversationId)) continue;
    chats.push({
      id: conversationId,
      name: session.title || conversationId,
      type: session.chatType || 'group',
      isBound: true,
      boundSessionId: session.sessionId,
      boundSessionTitle: session.title,
    });
  }

  console.log('[Session API] 飞书 API 无法自动枚举私聊，额外返回已有绑定的私聊/群聊会话');
}

async function fetchDiscordChats(chats: PlatformChat[], bindingMap: Map<string, ChatSessionData>): Promise<void> {
  try {
    const client = (discordAdapter as unknown as { client: { guilds: { cache: Map<string, { id: string; name: string; channels: { cache: Map<string, { id: string; name: string; type: number; isTextBased: () => boolean }> } }> }; isActive: boolean } }).client;

    if (!client) {
      console.warn('[Session API] Discord 客户端未初始化');
      return;
    }

    // 遍历所有服务器
    for (const guild of client.guilds.cache.values()) {
      // 遍历所有频道
      for (const channel of guild.channels.cache.values()) {
        // 只获取文本频道和私信频道
        if (!channel.isTextBased()) continue;

        const binding = bindingMap.get(channel.id);
        const channelType = channel.type === 1 ? 'p2p' : channel.type === 11 ? 'channel' : 'group';

        chats.push({
          id: channel.id,
          name: channel.name || channel.id,
          type: channelType,
          isBound: !!binding,
          boundSessionId: binding?.sessionId,
          boundSessionTitle: binding?.title,
        });
      }
    }

    console.log(`[Session API] 获取 Discord 频道列表: ${chats.length} 个`);
  } catch (e) {
    console.warn('[Session API] 获取 Discord 聊天列表失败:', e);
  }
}

async function fetchTelegramChats(chats: PlatformChat[], bindingMap: Map<string, ChatSessionData>): Promise<void> {
  try {
    // Telegram Bot API 不支持获取所有聊天列表
    // 只能返回已绑定的会话
    console.log('[Session API] Telegram 不支持获取未绑定的聊天列表');

    for (const [conversationId, session] of bindingMap) {
      chats.push({
        id: conversationId,
        name: session.title || conversationId,
        type: session.chatType || 'group',
        isBound: true,
        boundSessionId: session.sessionId,
        boundSessionTitle: session.title,
      });
    }
  } catch (e) {
    console.warn('[Session API] 获取 Telegram 聊天列表失败:', e);
  }
}

async function fetchQQChats(chats: PlatformChat[], bindingMap: Map<string, ChatSessionData>): Promise<void> {
  try {
    // 尝试通过 OneBot 获取群列表
    const onebotClient = (qqAdapter as unknown as { onebotClient: { sendApi: (action: string, params: Record<string, unknown>) => Promise<unknown>; isActiveState: () => boolean } | null }).onebotClient;

    if (onebotClient && onebotClient.isActiveState()) {
      const groups = await onebotClient.sendApi('get_group_list', {}) as Array<{ group_id: number; group_name: string; member_count?: number }>;

      if (Array.isArray(groups)) {
        for (const group of groups) {
          const conversationId = `${group.group_id}_group_`;
          const binding = bindingMap.get(conversationId);

          chats.push({
            id: conversationId,
            name: group.group_name || String(group.group_id),
            type: 'group',
            memberCount: group.member_count,
            isBound: !!binding,
            boundSessionId: binding?.sessionId,
            boundSessionTitle: binding?.title,
          });
        }
        console.log(`[Session API] 获取 QQ 群列表: ${chats.length} 个`);
      }
    } else {
      // QQ 官方 API 或 OneBot 不可用，返回已绑定的会话
      console.log('[Session API] QQ OneBot 不可用，返回已绑定会话');
      for (const [conversationId, session] of bindingMap) {
        chats.push({
          id: conversationId,
          name: session.title || conversationId,
          type: session.chatType || 'group',
          isBound: true,
          boundSessionId: session.sessionId,
          boundSessionTitle: session.title,
        });
      }
    }
  } catch (e) {
    console.warn('[Session API] 获取 QQ 聊天列表失败:', e);
    // 失败时返回已绑定的会话
    for (const [conversationId, session] of bindingMap) {
      chats.push({
        id: conversationId,
        name: session.title || conversationId,
        type: session.chatType || 'group',
        isBound: true,
        boundSessionId: session.sessionId,
        boundSessionTitle: session.title,
      });
    }
  }
}
