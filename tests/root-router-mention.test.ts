import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeishuMessageEvent } from '../src/feishu/client.js';

const baseEvent: FeishuMessageEvent = {
  messageId: 'msg-1',
  chatId: 'chat-1',
  chatType: 'group',
  senderId: 'ou_sender',
  senderType: 'user',
  content: 'hello',
  msgType: 'text',
  rawEvent: {
    sender: { sender_type: 'user' },
    message: {
      message_id: 'msg-1',
      create_time: '0',
      chat_id: 'chat-1',
      chat_type: 'group',
      message_type: 'text',
      content: '{"text":"hello"}',
    },
  },
};

const envKeys = ['GROUP_REQUIRE_MENTION', 'GROUP_REPLY_REQUIRE_MENTION'];
const envBackup = new Map<string, string | undefined>();

const backupEnv = (): void => {
  for (const key of envKeys) {
    envBackup.set(key, process.env[key]);
  }
};

const restoreEnv = (): void => {
  for (const key of envKeys) {
    const value = envBackup.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  envBackup.clear();
};

const loadRouterAndGroup = async () => {
  vi.resetModules();
  const [{ rootRouter }, { groupHandler }] = await Promise.all([
    import('../src/router/root-router.js'),
    import('../src/handlers/group.js'),
  ]);
  return { rootRouter, groupHandler };
};

describe('RootRouter mention gate', () => {
  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it('GROUP_REQUIRE_MENTION=true 且无 @ 时应跳过群消息', async () => {
    backupEnv();
    process.env.GROUP_REQUIRE_MENTION = 'true';

    const { rootRouter, groupHandler } = await loadRouterAndGroup();
    const spy = vi.spyOn(groupHandler, 'handleMessage').mockResolvedValue(undefined);

    await rootRouter.onMessage({ ...baseEvent, mentions: undefined });
    expect(spy).not.toHaveBeenCalled();
  });

  it('GROUP_REQUIRE_MENTION=true 且有 @ 时应处理群消息', async () => {
    backupEnv();
    process.env.GROUP_REQUIRE_MENTION = 'true';

    const { rootRouter, groupHandler } = await loadRouterAndGroup();
    const spy = vi.spyOn(groupHandler, 'handleMessage').mockResolvedValue(undefined);

    await rootRouter.onMessage({
      ...baseEvent,
      mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' }, name: '机器人' }],
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('GROUP_REQUIRE_MENTION=false 时无 @ 也应处理群消息', async () => {
    backupEnv();
    process.env.GROUP_REQUIRE_MENTION = 'false';

    const { rootRouter, groupHandler } = await loadRouterAndGroup();
    const spy = vi.spyOn(groupHandler, 'handleMessage').mockResolvedValue(undefined);

    await rootRouter.onMessage({ ...baseEvent, mentions: undefined });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
