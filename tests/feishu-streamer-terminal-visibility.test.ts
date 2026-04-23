import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendCard = vi.fn<(chatId: string, card: object) => Promise<string | null>>();
const updateCard = vi.fn<(messageId: string, card: object) => Promise<boolean>>();
const deleteMessage = vi.fn<(messageId: string) => Promise<boolean>>();
const buildStreamCard = vi.fn((state: object) => ({ ...state }));

vi.mock('../src/feishu/client.js', () => ({
  feishuClient: {
    sendCard,
    updateCard,
    deleteMessage,
  },
}));

vi.mock('../src/feishu/cards-stream.js', () => ({
  buildStreamCard,
}));

describe('Feishu streamer terminal visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendCard.mockResolvedValue('final-message-id');
    updateCard.mockResolvedValue(true);
    deleteMessage.mockResolvedValue(true);
  });

  it('处理中先发送初始卡片，完成时额外发送最终可见卡片并删除旧卡', async () => {
    sendCard.mockResolvedValueOnce('stream-message-id').mockResolvedValueOnce('final-message-id');

    const { CardStreamer } = await import('../src/feishu/streamer.js');
    const streamer = new CardStreamer('oc_chat_123');

    await streamer.start();
    streamer.updateText('最终答案');
    streamer.setStatus('completed');
    await vi.waitFor(() => expect(sendCard).toHaveBeenCalledTimes(2));

    expect(updateCard).toHaveBeenCalledWith(
      'stream-message-id',
      expect.objectContaining({
        text: '最终答案',
        status: 'completed',
      })
    );
    expect(sendCard).toHaveBeenNthCalledWith(
      2,
      'oc_chat_123',
      expect.objectContaining({
        text: '最终答案',
        status: 'completed',
      })
    );
    expect(deleteMessage).toHaveBeenCalledTimes(1);
    expect(deleteMessage).toHaveBeenCalledWith('stream-message-id');

    streamer.close();
  });

  it('终态重复刷新时只发送一次最终可见卡片并只删除一次旧卡', async () => {
    sendCard.mockResolvedValueOnce('stream-message-id').mockResolvedValue('final-message-id');

    const { CardStreamer } = await import('../src/feishu/streamer.js');
    const streamer = new CardStreamer('oc_chat_456');

    await streamer.start();
    streamer.setStatus('failed');
    await vi.waitFor(() => expect(sendCard).toHaveBeenCalledTimes(2));

    streamer.setStatus('failed');
    await Promise.resolve();

    expect(sendCard).toHaveBeenCalledTimes(2);
    expect(deleteMessage).toHaveBeenCalledTimes(1);
    expect(deleteMessage).toHaveBeenCalledWith('stream-message-id');
    expect(sendCard).toHaveBeenLastCalledWith(
      'oc_chat_456',
      expect.objectContaining({ status: 'failed' })
    );

    streamer.close();
  });

  it('删除旧卡失败时不影响最终卡片发送', async () => {
    sendCard.mockResolvedValueOnce('stream-message-id').mockResolvedValueOnce('final-message-id');
    deleteMessage.mockResolvedValueOnce(false);

    const { CardStreamer } = await import('../src/feishu/streamer.js');
    const streamer = new CardStreamer('oc_chat_789');

    await streamer.start();
    streamer.setStatus('completed');
    await vi.waitFor(() => expect(sendCard).toHaveBeenCalledTimes(2));

    expect(deleteMessage).toHaveBeenCalledTimes(1);
    expect(deleteMessage).toHaveBeenCalledWith('stream-message-id');
    expect(sendCard).toHaveBeenLastCalledWith(
      'oc_chat_789',
      expect.objectContaining({ status: 'completed' })
    );

    streamer.close();
  });
});
