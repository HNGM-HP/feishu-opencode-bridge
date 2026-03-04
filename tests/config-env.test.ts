import { afterEach, describe, expect, it, vi } from 'vitest';

const envKeys = [
  'DISCORD_ENABLED',
  'DISCORD_TOKEN',
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID',
  'GROUP_REQUIRE_MENTION',
  'GROUP_REPLY_REQUIRE_MENTION',
];

const backup = new Map<string, string | undefined>();

const restoreEnv = (): void => {
  for (const key of envKeys) {
    const value = backup.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const snapshotEnv = (): void => {
  for (const key of envKeys) {
    backup.set(key, process.env[key]);
  }
};

const loadConfigModule = async () => {
  vi.resetModules();
  return await import('../src/config.js');
};

describe('Config env compatibility', () => {
  afterEach(() => {
    restoreEnv();
    backup.clear();
  });

  it('GROUP_REQUIRE_MENTION 默认应为 false', async () => {
    snapshotEnv();
    delete process.env.GROUP_REQUIRE_MENTION;
    delete process.env.GROUP_REPLY_REQUIRE_MENTION;

    const { groupConfig } = await loadConfigModule();
    expect(groupConfig.requireMentionInGroup).toBe(false);
  });

  it('GROUP_REQUIRE_MENTION=true 时应启用群聊 @ 开关', async () => {
    snapshotEnv();
    process.env.GROUP_REQUIRE_MENTION = 'true';

    const { groupConfig } = await loadConfigModule();
    expect(groupConfig.requireMentionInGroup).toBe(true);
  });

  it('应兼容 DISCORD_BOT_TOKEN 作为 DISCORD_TOKEN 的回退', async () => {
    snapshotEnv();
    delete process.env.DISCORD_TOKEN;
    process.env.DISCORD_BOT_TOKEN = 'bot-token-from-alias';

    const { discordConfig } = await loadConfigModule();
    expect(discordConfig.token).toBe('bot-token-from-alias');
  });

  it('DISCORD_TOKEN 应优先于 DISCORD_BOT_TOKEN', async () => {
    snapshotEnv();
    process.env.DISCORD_TOKEN = 'primary-token';
    process.env.DISCORD_BOT_TOKEN = 'fallback-token';

    const { discordConfig } = await loadConfigModule();
    expect(discordConfig.token).toBe('primary-token');
  });

  it('应读取 DISCORD_CLIENT_ID', async () => {
    snapshotEnv();
    process.env.DISCORD_CLIENT_ID = '1234567890';

    const { discordConfig } = await loadConfigModule();
    expect(discordConfig.clientId).toBe('1234567890');
  });
});
