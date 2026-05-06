import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { feishuClient } from '../src/feishu/client.js';

type InternalFeishuClient = typeof feishuClient & {
  eventDispatcher: object;
  cardActionHandler?: (event: unknown) => Promise<unknown>;
  cardUpdateQueue: Map<string, Promise<boolean>>;
  handleCardAction: (event: unknown) => Promise<unknown>;
};

describe('FeishuClient stop state reset', () => {
  const internalClient = feishuClient as InternalFeishuClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    feishuClient.removeAllListeners('cardAction');
  });

  afterEach(() => {
    feishuClient.removeAllListeners('cardAction');
    internalClient.stop();
  });

  it('stop 应重置卡片处理器、更新队列与事件分发器', async () => {
    const previousDispatcher = internalClient.eventDispatcher;
    const previousHandler = vi.fn(async () => ({ msg: 'handled' }));
    const cardActionSpy = vi.fn();

    feishuClient.on('cardAction', cardActionSpy);
    internalClient.setCardActionHandler(previousHandler);
    internalClient.cardUpdateQueue.set('msg-1', Promise.resolve(true));

    internalClient.stop();

    expect(internalClient.eventDispatcher).not.toBe(previousDispatcher);
    expect(internalClient.cardActionHandler).toBeUndefined();
    expect(internalClient.cardUpdateQueue.size).toBe(0);

    const response = await internalClient.handleCardAction({
      operator: { open_id: 'ou_test_user' },
      action: { tag: 'button', value: { action: 'restart' } },
      token: 'card-token',
      open_message_id: 'om_msg_1',
      open_chat_id: 'oc_chat_1',
      open_thread_id: 'ot_thread_1',
    });

    expect(previousHandler).not.toHaveBeenCalled();
    expect(cardActionSpy).toHaveBeenCalledTimes(1);
    expect(cardActionSpy).toHaveBeenCalledWith(expect.objectContaining({
      openId: 'ou_test_user',
      messageId: 'om_msg_1',
      chatId: 'oc_chat_1',
      threadId: 'ot_thread_1',
    }));
    expect(response).toEqual({ msg: 'ok' });
  });
});
