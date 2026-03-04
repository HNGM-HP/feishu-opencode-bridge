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
    expect(sender.reply).toHaveBeenCalledTimes(1);
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

    expect(respondSpy).toHaveBeenCalledWith('session-2', 'perm-allow', true, false);
    expect(permissionHandler.peekForChat('discord:conv-1')).toBeUndefined();
    expect(sender.reply).toHaveBeenCalledTimes(1);
  });

  it('命令 //panel 应触发下拉控制面板卡片回复', async () => {
    const sender = makeSender();
    const handler = createDiscordHandler(sender);

    await handler.handleMessage(makeEvent('//panel'));

    expect(sender.replyCard).toHaveBeenCalledTimes(1);
    expect(sender.reply).not.toHaveBeenCalled();
  });

  it('命令 //bind 应绑定已有会话到当前频道', async () => {
    const sender = makeSender();
    const handler = createDiscordHandler(sender);
    vi.spyOn(opencodeClient, 'findSessionAcrossProjects').mockResolvedValue({
      id: 'ses_bind_001',
      title: '绑定测试会话',
      directory: '/workspace',
    } as never);

    await handler.handleMessage(makeEvent('//bind ses_bind_001'));

    expect(chatSessionStore.getSessionIdByConversation('discord', 'conv-1')).toBe('ses_bind_001');
    expect(sender.reply).toHaveBeenCalledTimes(1);
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
    expect(sender.reply).toHaveBeenCalledTimes(1);
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
    expect(sender.reply).toHaveBeenCalledTimes(1);
  });
});
