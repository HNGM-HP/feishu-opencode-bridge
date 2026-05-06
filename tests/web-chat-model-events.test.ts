import { describe, expect, it } from 'vitest';
import { applyChatEvent, buildConversationTurns, finalizeStreamingMessages, type ChatMessageVm } from '../web/src/composables/chat-model.ts';

describe('web chat model event handling', () => {
  it('user message_start 应把最新 optimistic user 对齐成真实消息 ID', () => {
    const messages: ChatMessageVm[] = [
      {
        id: 'optimistic-user-1',
        role: 'user',
        createdAt: 1500,
        text: '请解释这个问题',
        reasoning: '',
        tools: [],
        status: 'done',
        optimistic: true,
      },
    ];

    applyChatEvent(messages, {
      type: 'message_start',
      msg: {
        id: 'user-real-1',
        role: 'user',
        createdAt: 1000,
        model: { providerId: 'openai', modelId: 'gpt-5.4' },
        agent: 'chat',
      },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'user-real-1',
      role: 'user',
      text: '请解释这个问题',
      optimistic: false,
      model: { providerId: 'openai', modelId: 'gpt-5.4' },
      agent: 'chat',
    });
    expect(messages[0].createdAt).toBe(1500);
  });

  it('assistant 实时事件时间戳较早时，仍应排在对应用户消息之后', () => {
    const messages: ChatMessageVm[] = [
      {
        id: 'user-1',
        role: 'user',
        createdAt: 1000,
        text: '第一问',
        reasoning: '',
        tools: [],
        status: 'done',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 1000,
        text: '第一答',
        reasoning: '',
        tools: [],
        status: 'done',
      },
      {
        id: 'optimistic-user-2',
        role: 'user',
        createdAt: 1800,
        text: '第二问',
        reasoning: '',
        tools: [],
        status: 'done',
        optimistic: true,
      },
    ];

    applyChatEvent(messages, {
      type: 'message_start',
      msg: {
        id: 'assistant-2',
        role: 'assistant',
        createdAt: 1000,
        parentId: 'user-real-2',
      },
    });

    expect(messages.map(message => message.id)).toEqual([
      'user-1',
      'assistant-1',
      'optimistic-user-2',
      'assistant-2',
    ]);
    expect(messages[3]).toMatchObject({
      id: 'assistant-2',
      createdAt: 1800,
      status: 'streaming',
    });
  });

  it('应按 assistant.parentId 把延迟到达的回复归到正确轮次，而不是最后一轮', () => {
    const messages: ChatMessageVm[] = [
      {
        id: 'user-1',
        role: 'user',
        createdAt: 1000,
        text: '第一问',
        reasoning: '',
        tools: [],
        status: 'done',
      },
      {
        id: 'user-2',
        role: 'user',
        createdAt: 2000,
        text: '第二问',
        reasoning: '',
        tools: [],
        status: 'done',
      },
      {
        id: 'assistant-late',
        role: 'assistant',
        createdAt: 2500,
        parentId: 'user-1',
        text: '第一问的延迟回复',
        reasoning: '',
        tools: [],
        status: 'done',
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        createdAt: 2600,
        parentId: 'user-2',
        text: '第二答',
        reasoning: '',
        tools: [],
        status: 'done',
      },
    ];

    const turns = buildConversationTurns(messages);

    expect(turns).toHaveLength(2);
    expect(turns[0].userMessage?.id).toBe('user-1');
    expect(turns[0].assistantMessages.map(message => message.id)).toEqual(['assistant-late']);
    expect(turns[1].userMessage?.id).toBe('user-2');
    expect(turns[1].assistantMessages.map(message => message.id)).toEqual(['assistant-2']);
  });

  it('空白真实 user 占位不应单独渲染成窄蓝条，而应并回上一条用户消息', () => {
    const messages: ChatMessageVm[] = [
      {
        id: 'optimistic-user-1',
        role: 'user',
        createdAt: 1000,
        text: '请解释这个问题',
        reasoning: '',
        tools: [],
        status: 'done',
        optimistic: true,
      },
      {
        id: 'user-real-1',
        role: 'user',
        createdAt: 1001,
        text: '',
        reasoning: '',
        tools: [],
        status: 'done',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 1002,
        parentId: 'user-real-1',
        text: '这是解释',
        reasoning: '',
        tools: [],
        status: 'done',
      },
    ];

    const turns = buildConversationTurns(messages);

    expect(turns).toHaveLength(1);
    expect(turns[0].userMessage?.id).toBe('optimistic-user-1');
    expect(turns[0].userMessage?.text).toBe('请解释这个问题');
    expect(turns[0].assistantMessages.map(message => message.id)).toEqual(['assistant-1']);
  });

  it('message_start 重放时不应清空已经收到的回复文本', () => {
    const messages: ChatMessageVm[] = [];

    applyChatEvent(messages, { type: 'text_delta', msgId: 'assistant-1', text: 'Hello' });
    applyChatEvent(messages, {
      type: 'message_start',
      msg: {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 123,
        parentId: 'user-real-1',
        model: { providerId: 'openai', modelId: 'gpt-5.4' },
        agent: 'chat',
      },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'assistant-1',
      text: 'Hello',
      status: 'streaming',
      parentId: 'user-real-1',
      model: { providerId: 'openai', modelId: 'gpt-5.4' },
      agent: 'chat',
    });
    expect(messages[0].createdAt).toBeGreaterThanOrEqual(123);
  });

  it('重复的 message_start 不应把已完成消息退回到 streaming', () => {
    const messages: ChatMessageVm[] = [];

    applyChatEvent(messages, {
      type: 'message_start',
      msg: {
        id: 'assistant-2',
        role: 'assistant',
        createdAt: 100,
      },
    });
    applyChatEvent(messages, { type: 'text_delta', msgId: 'assistant-2', text: 'Done' });
    applyChatEvent(messages, {
      type: 'message_end',
      msgId: 'assistant-2',
      finish: 'stop',
    });

    applyChatEvent(messages, {
      type: 'message_start',
      msg: {
        id: 'assistant-2',
        role: 'assistant',
        createdAt: 100,
      },
    });

    expect(messages[0]).toMatchObject({
      id: 'assistant-2',
      text: 'Done',
      status: 'done',
      finish: 'stop',
    });
  });

  it('text_delta 先到后 message_start 时，不应把 assistant 重新排到用户消息前面', () => {
    const messages: ChatMessageVm[] = [
      {
        id: 'optimistic-user-3',
        role: 'user',
        createdAt: 2500,
        text: '第三问',
        reasoning: '',
        tools: [],
        status: 'done',
        optimistic: true,
      },
    ];

    applyChatEvent(messages, { type: 'text_delta', msgId: 'assistant-3', text: '第三答' });
    applyChatEvent(messages, {
      type: 'message_start',
      msg: {
        id: 'assistant-3',
        role: 'assistant',
        createdAt: 2000,
      },
    });

    expect(messages.map(message => message.id)).toEqual([
      'optimistic-user-3',
      'assistant-3',
    ]);
    expect(messages[1]).toMatchObject({
      id: 'assistant-3',
      text: '第三答',
      createdAt: expect.any(Number),
    });
    expect(messages[1].createdAt).toBeGreaterThanOrEqual(messages[0].createdAt);
  });

  it('session idle 收到后应收口残留的 streaming assistant 消息', () => {
    const messages: ChatMessageVm[] = [
      {
        id: 'assistant-4',
        role: 'assistant',
        createdAt: 3000,
        text: '最终回复',
        reasoning: '',
        tools: [],
        status: 'streaming',
      },
    ];

    finalizeStreamingMessages(messages);

    expect(messages[0]).toMatchObject({
      id: 'assistant-4',
      status: 'done',
      text: '最终回复',
    });
  });
});
