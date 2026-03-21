import { afterEach, describe, expect, it, vi } from 'vitest';

const envKeys = [
  'DISCORD_ENABLED',
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'GROUP_REQUIRE_MENTION',
  'GROUP_REPLY_REQUIRE_MENTION',
  // 可见性开关环境变量
  'SHOW_THINKING_CHAIN',
  'SHOW_TOOL_CHAIN',
  'FEISHU_SHOW_THINKING_CHAIN',
  'FEISHU_SHOW_TOOL_CHAIN',
  'DISCORD_SHOW_THINKING_CHAIN',
  'DISCORD_SHOW_TOOL_CHAIN',
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

  it('应读取 DISCORD_TOKEN', async () => {
    snapshotEnv();
    process.env.DISCORD_TOKEN = 'test-token';

    const { discordConfig } = await loadConfigModule();
    expect(discordConfig.token).toBe('test-token');
  });

  it('应读取 DISCORD_CLIENT_ID', async () => {
    snapshotEnv();
    process.env.DISCORD_CLIENT_ID = '1234567890';

    const { discordConfig } = await loadConfigModule();
    expect(discordConfig.clientId).toBe('1234567890');
  });
});

describe('OutputConfig visibility switches', () => {
  afterEach(() => {
    restoreEnv();
    backup.clear();
  });

  it('默认情况下应显示思维链和工具链', async () => {
    snapshotEnv();
    // 清除所有可见性开关
    delete process.env.SHOW_THINKING_CHAIN;
    delete process.env.SHOW_TOOL_CHAIN;
    delete process.env.FEISHU_SHOW_THINKING_CHAIN;
    delete process.env.FEISHU_SHOW_TOOL_CHAIN;
    delete process.env.DISCORD_SHOW_THINKING_CHAIN;
    delete process.env.DISCORD_SHOW_TOOL_CHAIN;

    const { outputConfig } = await loadConfigModule();
    expect(outputConfig.showThinkingChain).toBe(true);
    expect(outputConfig.showToolChain).toBe(true);
    expect(outputConfig.feishu.showThinkingChain).toBe(true);
    expect(outputConfig.feishu.showToolChain).toBe(true);
    expect(outputConfig.discord.showThinkingChain).toBe(true);
    expect(outputConfig.discord.showToolChain).toBe(true);
  });

  it('SHOW_THINKING_CHAIN=false 时全局思维链应隐藏', async () => {
    snapshotEnv();
    process.env.SHOW_THINKING_CHAIN = 'false';
    delete process.env.FEISHU_SHOW_THINKING_CHAIN;
    delete process.env.DISCORD_SHOW_THINKING_CHAIN;

    const { outputConfig } = await loadConfigModule();
    expect(outputConfig.showThinkingChain).toBe(false);
    expect(outputConfig.feishu.showThinkingChain).toBe(false);
    expect(outputConfig.discord.showThinkingChain).toBe(false);
  });

  it('SHOW_TOOL_CHAIN=false 时全局工具链应隐藏', async () => {
    snapshotEnv();
    process.env.SHOW_TOOL_CHAIN = 'false';
    delete process.env.FEISHU_SHOW_TOOL_CHAIN;
    delete process.env.DISCORD_SHOW_TOOL_CHAIN;

    const { outputConfig } = await loadConfigModule();
    expect(outputConfig.showToolChain).toBe(false);
    expect(outputConfig.feishu.showToolChain).toBe(false);
    expect(outputConfig.discord.showToolChain).toBe(false);
  });

  it('FEISHU_SHOW_THINKING_CHAIN=false 时飞书思维链应隐藏', async () => {
    snapshotEnv();
    process.env.FEISHU_SHOW_THINKING_CHAIN = 'false';

    const { outputConfig } = await loadConfigModule();
    expect(outputConfig.feishu.showThinkingChain).toBe(false);
    // 全局开关不受影响
    expect(outputConfig.showThinkingChain).toBe(true);
  });

  it('FEISHU_SHOW_TOOL_CHAIN=false 时飞书工具链应隐藏', async () => {
    snapshotEnv();
    process.env.FEISHU_SHOW_TOOL_CHAIN = 'false';

    const { outputConfig } = await loadConfigModule();
    expect(outputConfig.feishu.showToolChain).toBe(false);
    // 全局开关不受影响
    expect(outputConfig.showToolChain).toBe(true);
  });

  it('DISCORD_SHOW_THINKING_CHAIN=false 时 Discord 思维链应隐藏', async () => {
    snapshotEnv();
    process.env.DISCORD_SHOW_THINKING_CHAIN = 'false';

    const { outputConfig } = await loadConfigModule();
    expect(outputConfig.discord.showThinkingChain).toBe(false);
    // 全局开关不受影响
    expect(outputConfig.showThinkingChain).toBe(true);
  });

  it('DISCORD_SHOW_TOOL_CHAIN=false 时 Discord 工具链应隐藏', async () => {
    snapshotEnv();
    process.env.DISCORD_SHOW_TOOL_CHAIN = 'false';

    const { outputConfig } = await loadConfigModule();
    expect(outputConfig.discord.showToolChain).toBe(false);
    // 全局开关不受影响
    expect(outputConfig.showToolChain).toBe(true);
  });

  it('平台开关独立于全局开关（全开平台关）', async () => {
    snapshotEnv();
    process.env.SHOW_THINKING_CHAIN = 'true';
    process.env.SHOW_TOOL_CHAIN = 'true';
    process.env.FEISHU_SHOW_THINKING_CHAIN = 'false';
    process.env.FEISHU_SHOW_TOOL_CHAIN = 'false';
    process.env.DISCORD_SHOW_THINKING_CHAIN = 'false';
    process.env.DISCORD_SHOW_TOOL_CHAIN = 'false';

    const { outputConfig } = await loadConfigModule();
    // 全局开关为 true
    expect(outputConfig.showThinkingChain).toBe(true);
    expect(outputConfig.showToolChain).toBe(true);
    // 平台特定开关为 false
    expect(outputConfig.feishu.showThinkingChain).toBe(false);
    expect(outputConfig.feishu.showToolChain).toBe(false);
    expect(outputConfig.discord.showThinkingChain).toBe(false);
    expect(outputConfig.discord.showToolChain).toBe(false);
  });

  it('平台开关独立于全局开关（全关平台开）', async () => {
    snapshotEnv();
    process.env.SHOW_THINKING_CHAIN = 'false';
    process.env.SHOW_TOOL_CHAIN = 'false';
    process.env.FEISHU_SHOW_THINKING_CHAIN = 'true';
    process.env.FEISHU_SHOW_TOOL_CHAIN = 'true';
    process.env.DISCORD_SHOW_THINKING_CHAIN = 'true';
    process.env.DISCORD_SHOW_TOOL_CHAIN = 'true';

    const { outputConfig } = await loadConfigModule();
    // 全局开关为 false
    expect(outputConfig.showThinkingChain).toBe(false);
    expect(outputConfig.showToolChain).toBe(false);
    // 平台特定开关为 true
    expect(outputConfig.feishu.showThinkingChain).toBe(true);
    expect(outputConfig.feishu.showToolChain).toBe(true);
    expect(outputConfig.discord.showThinkingChain).toBe(true);
    expect(outputConfig.discord.showToolChain).toBe(true);
  });

  it('应支持多种布尔值格式', async () => {
    snapshotEnv();
    process.env.SHOW_THINKING_CHAIN = '1';
    process.env.SHOW_TOOL_CHAIN = 'yes';
    process.env.FEISHU_SHOW_THINKING_CHAIN = 'on';
    process.env.DISCORD_SHOW_TOOL_CHAIN = '0';

    const { outputConfig } = await loadConfigModule();
    expect(outputConfig.showThinkingChain).toBe(true);
    expect(outputConfig.showToolChain).toBe(true);
    expect(outputConfig.feishu.showThinkingChain).toBe(true);
    expect(outputConfig.discord.showToolChain).toBe(false);
  });

  it('应兼容带行内注释的布尔值', async () => {
    snapshotEnv();
    process.env.SHOW_THINKING_CHAIN = 'false # hide thinking';
    process.env.SHOW_TOOL_CHAIN = 'false // hide tools';
    delete process.env.FEISHU_SHOW_THINKING_CHAIN;
    delete process.env.FEISHU_SHOW_TOOL_CHAIN;
    delete process.env.DISCORD_SHOW_THINKING_CHAIN;
    delete process.env.DISCORD_SHOW_TOOL_CHAIN;

    const { outputConfig } = await loadConfigModule();
    expect(outputConfig.showThinkingChain).toBe(false);
    expect(outputConfig.showToolChain).toBe(false);
    expect(outputConfig.feishu.showThinkingChain).toBe(false);
    expect(outputConfig.feishu.showToolChain).toBe(false);
    expect(outputConfig.discord.showThinkingChain).toBe(false);
    expect(outputConfig.discord.showToolChain).toBe(false);
  });
});
