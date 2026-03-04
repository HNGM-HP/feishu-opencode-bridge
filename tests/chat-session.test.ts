import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chatSessionStore } from '../src/store/chat-session.js';
import * as fs from 'fs';
import * as path from 'path';
import {
  setChatSessionStoreTestFile,
  clearChatSessionStoreData,
  setChatSessionDataDirectly,
  setChatSessionAlias,
  deleteChatSessionData,
} from './test-utils.js';

const TEST_STORE_FILE = path.join(process.cwd(), '.chat-sessions.test.json');

describe('ChatSessionStore - Namespaced/Legacy Compatibility', () => {
  beforeEach(() => {
    // 备份现有存储文件（如果存在）
    if (fs.existsSync('.chat-sessions.json')) {
      fs.copyFileSync('.chat-sessions.json', '.chat-sessions.backup.json');
    }
    // 使用测试存储文件
    setChatSessionStoreTestFile(TEST_STORE_FILE);
    // 清空数据
    clearChatSessionStoreData();
  });

  afterEach(() => {
    // 清理测试文件
    if (fs.existsSync(TEST_STORE_FILE)) {
      fs.unlinkSync(TEST_STORE_FILE);
    }
    // 恢复原存储文件
    if (fs.existsSync('.chat-sessions.backup.json')) {
      fs.renameSync('.chat-sessions.backup.json', '.chat-sessions.json');
    }
  });

  it('应该支持从旧格式 chatId 读取会话（向后兼容）', () => {
    // 模拟旧数据：直接使用 chatId 作为 key
    const legacyChatId = 'oc_1234567890';
    setChatSessionDataDirectly(legacyChatId, {
      chatId: legacyChatId,
      sessionId: 'session_legacy',
      creatorId: 'user_001',
      createdAt: Date.now(),
      interactionHistory: [],
    });

    const sessionId = chatSessionStore.getSessionId(legacyChatId);
    expect(sessionId).toBe('session_legacy');
  });

  it('应该支持新格式 namespaced key（feishu:chatId）', () => {
    const chatId = 'oc_new123';
    chatSessionStore.setSession(chatId, 'session_namespaced', 'user_002', '测试会话');

    const sessionId = chatSessionStore.getSessionId(chatId);
    expect(sessionId).toBe('session_namespaced');
  });

  it('应该优先读取 namespaced key，其次才读取 legacy key', () => {
    const chatId = 'oc_priority_test';
    const namespacedKey = `feishu:${chatId}`;

    // 先设置 legacy 数据
    setChatSessionDataDirectly(chatId, {
      chatId,
      sessionId: 'legacy_session',
      creatorId: 'user_001',
      createdAt: Date.now(),
      interactionHistory: [],
    });

    // 再设置 namespaced 数据
    chatSessionStore.setSession(chatId, 'namespaced_session', 'user_002', '新会话');

    // 应该返回 namespaced 的 session
    const sessionId = chatSessionStore.getSessionId(chatId);
    expect(sessionId).toBe('namespaced_session');
  });

  it('更新配置应该同时更新 namespaced key 中的数据', () => {
    const chatId = 'oc_config_test';
    chatSessionStore.setSession(chatId, 'session_001', 'user_001', '配置测试');

    // 更新配置
    chatSessionStore.updateConfig(chatId, {
      preferredModel: 'claude-3-5-sonnet',
      defaultDirectory: '/workspace',
    });

    const session = chatSessionStore.getSession(chatId);
    expect(session?.preferredModel).toBe('claude-3-5-sonnet');
    expect(session?.defaultDirectory).toBe('/workspace');
  });

  it('从 legacy key 迁移到 namespaced key 时应该创建会话别名', () => {
    const chatId = 'oc_alias_test';
    const oldSessionId = 'old_session_123';

    // 设置旧数据
    chatSessionStore.setSession(chatId, oldSessionId, 'user_001', '旧会话');
    expect(chatSessionStore.getSessionId(chatId)).toBe(oldSessionId);

    // 重新设置新会话
    const newSessionId = 'new_session_456';
    chatSessionStore.setSession(chatId, newSessionId, 'user_001', '新会话');

    // 当前应该返回新会话
    expect(chatSessionStore.getSessionId(chatId)).toBe(newSessionId);

    // 通过旧 sessionId 应该能找到 chatId（通过别名机制）
    const resolvedChatId = chatSessionStore.getChatId(oldSessionId);
    expect(resolvedChatId).toBe(chatId);
  });

  it('别名应该有过期时间（默认 10 分钟）', () => {
    const chatId = 'oc_alias_expire_test';
    const sessionId = 'session_expiring';

    chatSessionStore.setSession(chatId, sessionId, 'user_001', '过期测试');
    // 强制设置一个已过期的别名
    setChatSessionAlias(sessionId, {
      chatId,
      expiresAt: Date.now() - 1000, // 1秒前就过期了
    });
    // 清除实际的会话数据，只保留过期的别名
    deleteChatSessionData(`feishu:${chatId}`);

    // 别名应该被清理，找不到对应 chatId
    const resolvedChatId = chatSessionStore.getChatId(sessionId);
    expect(resolvedChatId).toBeUndefined();
  });

  it('判断私聊会话应该支持显式 chatType 和隐式 title 推断', () => {
    const chatId1 = 'oc_p2p_explicit';
    chatSessionStore.setSession(chatId1, 'session_1', 'user_001', '私聊测试', {
      chatType: 'p2p',
    });
    expect(chatSessionStore.isPrivateChatSession(chatId1)).toBe(true);
    expect(chatSessionStore.isGroupChatSession(chatId1)).toBe(false);

    const chatId2 = 'oc_p2p_inferred';
    chatSessionStore.setSession(chatId2, 'session_2', 'user_002', '飞书私聊-张三');
    expect(chatSessionStore.isPrivateChatSession(chatId2)).toBe(true);
    expect(chatSessionStore.isGroupChatSession(chatId2)).toBe(false);
  });

  it('判断群聊会话应该支持显式 chatType 和隐式 title 推断', () => {
    const chatId1 = 'oc_group_explicit';
    chatSessionStore.setSession(chatId1, 'session_1', 'user_001', '群聊测试', {
      chatType: 'group',
    });
    expect(chatSessionStore.isGroupChatSession(chatId1)).toBe(true);
    expect(chatSessionStore.isPrivateChatSession(chatId1)).toBe(false);

    const chatId2 = 'oc_group_inferred';
    chatSessionStore.setSession(chatId2, 'session_2', 'user_002', '群聊-开发团队');
    expect(chatSessionStore.isGroupChatSession(chatId2)).toBe(true);
    expect(chatSessionStore.isPrivateChatSession(chatId2)).toBe(false);
  });

  it('getChatId 应该正确解析 namespaced key', () => {
    const chatId = 'oc_reverse_test';
    const sessionId = 'session_reverse';

    chatSessionStore.setSession(chatId, sessionId, 'user_001', '反向查找');

    const resolvedChatId = chatSessionStore.getChatId(sessionId);
    expect(resolvedChatId).toBe(chatId);
  });
});

describe('ChatSessionStore - Platform-Aware Binding (Discord)', () => {
  beforeEach(() => {
    setChatSessionStoreTestFile(TEST_STORE_FILE);
    clearChatSessionStoreData();
  });

  it('应该支持 Discord 会话绑定（discord:channelId）', () => {
    const channelId = 'channel_abc123';
    const sessionId = 'discord_session_xyz';
    const creatorId = 'discord_user_bot';

    chatSessionStore.setSessionByConversation('discord', channelId, sessionId, creatorId);

    const retrievedSessionId = chatSessionStore.getSessionIdByConversation('discord', channelId);
    expect(retrievedSessionId).toBe(sessionId);
  });

  it('应该独立存储 Discord 和 Feishu 会话（相同 raw ID 不冲突）', () => {
    const rawId = 'same_id';
    const feishuSessionId = 'feishu_session';
    const discordSessionId = 'discord_session';

    // 绑定 Feishu 会话
    chatSessionStore.setSession(rawId, feishuSessionId, 'feishu_user', '飞书会话');

    // 绑定 Discord 会话（相同 raw ID）
    chatSessionStore.setSessionByConversation('discord', rawId, discordSessionId, 'discord_user');

    // Feishu 会话不受影响
    const feishuRetrieved = chatSessionStore.getSessionId(rawId);
    expect(feishuRetrieved).toBe(feishuSessionId);

    // Discord 会话独立存在
    const discordRetrieved = chatSessionStore.getSessionIdByConversation('discord', rawId);
    expect(discordRetrieved).toBe(discordSessionId);

    // 验证 Discord 会话正确存储（通过反向查找）
    const discordSession = chatSessionStore.getSessionByConversation('discord', rawId);
    expect(discordSession).toBeDefined();
    expect(discordSession?.sessionId).toBe(discordSessionId);
  });

  it('getConversationBySessionId 应该正确返回 platform 和 conversationId', () => {
    const channelId = 'channel_xyz789';
    const sessionId = 'session_platform_aware';

    chatSessionStore.setSessionByConversation('discord', channelId, sessionId, 'creator');

    const conversation = chatSessionStore.getConversationBySessionId(sessionId);
    expect(conversation).toEqual({ platform: 'discord', conversationId: channelId });
  });

  it('反向查找 sessionId 应该返回 null（当不存在时）', () => {
    const nonExistentSessionId = 'non_existent_session';
    const conversation = chatSessionStore.getConversationBySessionId(nonExistentSessionId);
    expect(conversation).toBeNull();
  });

  it('removeSessionByConversation 应该只移除指定平台会话', () => {
    const sameRawId = 'same_raw_id';
    chatSessionStore.setSessionByConversation('discord', sameRawId, 'discord_sid', 'discord_user');
    chatSessionStore.setSession(sameRawId, 'feishu_sid', 'feishu_user', '飞书会话');

    chatSessionStore.removeSessionByConversation('discord', sameRawId);

    expect(chatSessionStore.getSessionIdByConversation('discord', sameRawId)).toBeNull();
    expect(chatSessionStore.getSessionId(sameRawId)).toBe('feishu_sid');
  });

  it('hasConversationId 应该支持跨平台查找原生会话 ID', () => {
    chatSessionStore.setSession('feishu_only', 'sid_feishu', 'u1', '飞书会话');
    chatSessionStore.setSessionByConversation('discord', 'discord_only', 'sid_discord', 'u2');

    expect(chatSessionStore.hasConversationId('feishu_only')).toBe(true);
    expect(chatSessionStore.hasConversationId('discord_only')).toBe(true);
    expect(chatSessionStore.hasConversationId('missing_id')).toBe(false);
  });
});
