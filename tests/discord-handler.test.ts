import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiscordHandler } from '../src/handlers/discord.js';
import { permissionHandler } from '../src/permissions/handler.js';
import { opencodeClient } from '../src/opencode/client.js';
import { questionHandler } from '../src/opencode/question-handler.js';
import { chatSessionStore } from '../src/store/chat-session.js';
import type { PlatformMessageEvent, PlatformSender } from '../src/platform/types.js';
import { clearChatSessionStoreData } from './test-utils.js';

const makeEvent = (content: string): PlatformMessageEvent => ({
  platform: 'discord',
  conversationId: 'conv-1',
  messageId: 'msg-1',
  senderId: 'user-1',
  senderType: 'user',
  content,
  msgType: 'text',
  chatType: 'group',
  rawEvent: { source: 'test' },
});

const makeSender = (): PlatformSender => ({
  sendText: vi.fn(async () => 'sent-1'),
  sendCard: vi.fn(async () => 'card-1'),
  updateCard: vi.fn(async () => true),
  deleteMessage: vi.fn(async () => true),
  reply: vi.fn(async () => 'reply-1'),
  replyCard: vi.fn(async () => 'reply-card-1'),
});

describe('DiscordHandler permission text flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearChatSessionStoreData();
    for (const pending of questionHandler.getAll()) {
      questionHandler.remove(pending.request.id);
    }
    permissionHandler.resolveForChat('discord:conv-1', 'perm-invalid');
    permissionHandler.resolveForChat('discord:conv-1', 'perm-allow');
  });

  it('有待确认权限但文本无法识别时，应回复指引文案', async () => {
    permissionHandler.enqueueForChat('discord:conv-1', {
      sessionId: 'session-1',
      permissionId: 'perm-invalid',
      tool: 'bash',
      description: '执行命令',
      userId: 'user-1',
    });

    const sender = makeSender();
    const respondSpy = vi.spyOn(opencodeClient, 'respondToPermission').mockResolvedValue(true);
    const handler = createDiscordHandler(sender);

    await handler.handleMessage(makeEvent('这句不是权限确认语'));

    expect(respondSpy).not.toHaveBeenCalled();
    expect(sender.sendText).toHaveBeenCalledTimes(1);
    expect(permissionHandler.peekForChat('discord:conv-1')).toBeDefined();
  });

  it('有待确认权限且文本为允许时，应回传并出队', async () => {
    permissionHandler.enqueueForChat('discord:conv-1', {
      sessionId: 'session-2',
      permissionId: 'perm-allow',
      tool: 'read',
      description: '读取文件',
      userId: 'user-1',
    });

    const sender = makeSender();
    const respondSpy = vi.spyOn(opencodeClient, 'respondToPermission').mockResolvedValue(true);
    const handler = createDiscordHandler(sender);

    await handler.handleMessage(makeEvent('允许'));

    expect(respondSpy).toHaveBeenCalledWith('session-2', 'perm-allow', true, false, expect.any(Object));
    expect(permissionHandler.peekForChat('discord:conv-1')).toBeUndefined();
    expect(sender.sendText).toHaveBeenCalledTimes(1);
  });

  it('命令 ///create_chat 应触发下拉控制面板卡片回复', async () => {
    const sender = makeSender();
    const handler = createDiscordHandler(sender);
    vi.spyOn(opencodeClient, 'getProviders').mockResolvedValue({ providers: [] } as never);
    vi.spyOn(opencodeClient, 'getAgents').mockResolvedValue([] as never);

    await handler.handleMessage(makeEvent('///create_chat'));

    expect(sender.sendCard).toHaveBeenCalledTimes(1);
    expect(sender.replyCard).not.toHaveBeenCalled();
  });

  it('命令 ///undo 应调用 OpenCode undo 命令', async () => {
    chatSessionStore.setSessionByConversation('discord', 'conv-1', 'session-undo-1', 'user-1');
    const sender = makeSender();
    const handler = createDiscordHandler(sender);
    const listSpy = vi.spyOn(opencodeClient, 'getSessionMessages').mockResolvedValue([
      { info: { id: 'msg-user-1' }, parts: [] },
      { info: { id: 'msg-ai-1' }, parts: [] },
    ] as never);
    const revertSpy = vi.spyOn(opencodeClient, 'revertMessage').mockResolvedValue(true);

    await handler.handleMessage(makeEvent('///undo'));

    expect(listSpy).toHaveBeenCalledWith('session-undo-1');
    expect(revertSpy).toHaveBeenCalledWith('session-undo-1', 'msg-user-1');
    expect(sender.sendText).toHaveBeenCalledTimes(1);
  });

  it('命令 ///stop 应停止活跃会话', async () => {
    chatSessionStore.setSessionByConversation('discord', 'conv-1', 'session-stop-1', 'user-1');
    const sender = makeSender();
    const handler = createDiscordHandler(sender);
    const abortSpy = vi.spyOn(opencodeClient, 'abortSession').mockResolvedValue(true);

    await handler.handleMessage(makeEvent('///stop'));

    expect(abortSpy).toHaveBeenCalledWith('session-stop-1');
    expect(sender.sendText).toHaveBeenCalledTimes(1);
  });

  it('无活跃会话时 ///stop 应返回提示', async () => {
    const sender = makeSender();
    const handler = createDiscordHandler(sender);
    const abortSpy = vi.spyOn(opencodeClient, 'abortSession').mockResolvedValue(true);

    await handler.handleMessage(makeEvent('///stop'));

    expect(abortSpy).not.toHaveBeenCalled();
    expect(sender.sendText).toHaveBeenCalledWith('conv-1', expect.stringContaining('没有活跃会话'));
  });

  it('命令 ///compact 或 ///compat 应触发上下文压缩', async () => {
    chatSessionStore.setSessionByConversation('discord', 'conv-1', 'session-compact-1', 'user-1');
    const sender = makeSender();
    const handler = createDiscordHandler(sender);
    vi.spyOn(opencodeClient, 'getProviders').mockResolvedValue({
      providers: [
        {
          id: 'openai',
          models: [{ id: 'gpt-5' }],
        },
      ],
    } as never);
    const compactSpy = vi.spyOn(opencodeClient, 'summarizeSession').mockResolvedValue(true);

    await handler.handleMessage(makeEvent('///compat'));

    expect(compactSpy).toHaveBeenCalledWith('session-compact-1', 'openai', 'gpt-5');
    expect(sender.sendText).toHaveBeenCalledTimes(1);
  });

  it('命令 ///effort high 应按当前模型能力设置强度', async () => {
    chatSessionStore.setSessionByConversation('discord', 'conv-1', 'session-effort-1', 'user-1');
    chatSessionStore.updateConfigByConversation('discord', 'conv-1', { preferredModel: 'openai:gpt-5' });

    const sender = makeSender();
    const handler = createDiscordHandler(sender);
    vi.spyOn(opencodeClient, 'getProviders').mockResolvedValue({
      providers: [
        {
          id: 'openai',
          models: [
            {
              id: 'gpt-5',
              variants: {
                low: {},
                high: {},
                xhigh: {},
              },
            },
          ],
        },
      ],
    } as never);

    await handler.handleMessage(makeEvent('///effort high'));

    expect(chatSessionStore.getSessionByConversation('discord', 'conv-1')?.preferredEffort).toBe('high');
    expect(sender.sendText).toHaveBeenCalledTimes(1);
  });

  it('消息前缀 #xhigh 应仅对当前消息临时覆盖强度', async () => {
    chatSessionStore.setSessionByConversation('discord', 'conv-1', 'session-prompt-1', 'user-1');
    const sender = makeSender();
    const handler = createDiscordHandler(sender);
    const sendMessageSpy = vi.spyOn(opencodeClient, 'sendMessage').mockResolvedValue({
      info: { id: 'msg-ai-1' },
      parts: [{ type: 'text', text: '分析完成' }],
    } as never);

    await handler.handleMessage(makeEvent('#xhigh 帮我分析代码'));

    expect(sendMessageSpy).toHaveBeenCalledWith(
      'session-prompt-1',
      '帮我分析代码',
      expect.objectContaining({ variant: 'xhigh' })
    );
  });

  it('普通消息走事件流输出时，不应由 handler 再次直出最终答复', async () => {
    chatSessionStore.setSessionByConversation('discord', 'conv-1', 'session-stream-1', 'user-1');
    const sender = makeSender();
    const handler = createDiscordHandler(sender);
    vi.spyOn(opencodeClient, 'sendMessage').mockResolvedValue({
      info: { id: 'msg-ai-2' },
      parts: [{ type: 'text', text: 'OK' }],
    } as never);

    const event = makeEvent('你好，请回复OK');
    event.chatType = 'p2p';
    await handler.handleMessage(event);

    expect(sender.sendText).toHaveBeenCalledTimes(1);
    expect(sender.sendText).toHaveBeenCalledWith('conv-1', expect.stringContaining('正在处理'));
    expect(sender.deleteMessage).toHaveBeenCalledWith('sent-1');
  });

  it('命令 ///bind 应绑定已有会话到当前频道', async () => {
    const sender = makeSender();
    const handler = createDiscordHandler(sender);
    vi.spyOn(opencodeClient, 'findSessionAcrossProjects').mockResolvedValue({
      id: 'ses_bind_001',
      title: '绑定测试会话',
      directory: '/workspace',
    } as never);

    await handler.handleMessage(makeEvent('///bind ses_bind_001'));

    expect(chatSessionStore.getSessionIdByConversation('discord', 'conv-1')).toBe('ses_bind_001');
    expect(chatSessionStore.getSessionByConversation('discord', 'conv-1')?.protectSessionDelete).toBe(true);
    expect(sender.sendText).toHaveBeenCalledTimes(1);
  });

  it('命令 ///new 默认会话名应采用 Discord 群聊 + ID 缩写规则', async () => {
    const sender = makeSender();
    const handler = createDiscordHandler(sender);
    const createSessionSpy = vi.spyOn(opencodeClient, 'createSession').mockResolvedValue({
      id: 'ses_new_001',
      title: 'temp',
      directory: '/workspace',
    } as never);

    const event = makeEvent('///new');
    event.rawEvent = {
      channelId: 'conv-1',
      guildId: 'guild-99',
    };

    await handler.handleMessage(event);

    expect(createSessionSpy).toHaveBeenCalled();
    expect(createSessionSpy.mock.calls[0]?.[0]).toBe('Discord 群聊 guild9 conv1');
    expect(chatSessionStore.getSessionIdByConversation('discord', 'conv-1')).toBe('ses_new_001');
    expect(chatSessionStore.getSessionByConversation('discord', 'conv-1')?.protectSessionDelete).not.toBe(true);
  });

  it('命令 ///create_chat model 2 应支持模型分页面板', async () => {
    const sender = makeSender();
    const handler = createDiscordHandler(sender);
    vi.spyOn(opencodeClient, 'getProviders').mockResolvedValue({
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          models: Array.from({ length: 60 }, (_, index) => ({
            id: `model-${index + 1}`,
            name: `Model ${index + 1}`,
          })),
        },
      ],
    } as never);
    vi.spyOn(opencodeClient, 'getAgents').mockResolvedValue([] as never);

    await handler.handleMessage(makeEvent('///create_chat model 2'));

    expect(sender.sendCard).toHaveBeenCalledTimes(1);
  });

  it('命令 ///unbind 应仅解绑当前频道会话', async () => {
    chatSessionStore.setSessionByConversation('discord', 'conv-1', 'session-unbind-1', 'user-1');
    const sender = makeSender();
    const handler = createDiscordHandler(sender);

    await handler.handleMessage(makeEvent('///unbind'));

    expect(chatSessionStore.getSessionIdByConversation('discord', 'conv-1')).toBeNull();
    expect(sender.sendText).toHaveBeenCalledTimes(1);
  });

  it('存在待回答问题时，文本选择应提交 question 回答', async () => {
    chatSessionStore.setSessionByConversation('discord', 'conv-1', 'session-q-1', 'user-1');
    questionHandler.register(
      {
        id: 'question-1',
        sessionID: 'session-q-1',
        questions: [
          {
            question: '请选择运行模式',
            header: '运行模式',
            options: [
              { label: '快速', description: '低成本' },
              { label: '深度', description: '高质量' },
            ],
          },
        ],
      },
      'chat:discord:conv-1',
      'conv-1'
    );

    const sender = makeSender();
    const handler = createDiscordHandler(sender);
    const replyQuestionSpy = vi.spyOn(opencodeClient, 'replyQuestion').mockResolvedValue(true);

    await handler.handleMessage(makeEvent('深度'));

    expect(replyQuestionSpy).toHaveBeenCalledWith('question-1', [['深度']]);
    expect(questionHandler.get('question-1')).toBeUndefined();
    expect(sender.sendText).toHaveBeenCalledTimes(1);
  });

  it('多题场景下，首题回答后应推进到下一题，不立即提交', async () => {
    chatSessionStore.setSessionByConversation('discord', 'conv-1', 'session-q-2', 'user-1');
    questionHandler.register(
      {
        id: 'question-2',
        sessionID: 'session-q-2',
        questions: [
          {
            question: '选择部署环境',
            header: '环境',
            options: [
              { label: '测试', description: 'staging' },
              { label: '生产', description: 'prod' },
            ],
          },
          {
            question: '补充说明',
            header: '说明',
            options: [
              { label: '无', description: '不补充' },
            ],
          },
        ],
      },
      'chat:discord:conv-1',
      'conv-1'
    );

    const sender = makeSender();
    const handler = createDiscordHandler(sender);
    const replyQuestionSpy = vi.spyOn(opencodeClient, 'replyQuestion').mockResolvedValue(true);

    await handler.handleMessage(makeEvent('测试'));

    const pending = questionHandler.get('question-2');
    expect(replyQuestionSpy).not.toHaveBeenCalled();
    expect(pending?.currentQuestionIndex).toBe(1);
    expect(sender.sendText).toHaveBeenCalledTimes(1);
  });
});
