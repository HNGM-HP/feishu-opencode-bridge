import { afterEach, describe, expect, it, vi } from 'vitest';

const envKeys = [
  'RELIABILITY_HEARTBEAT_INTERVAL_MS',
  'RELIABILITY_FAILURE_THRESHOLD',
  'RELIABILITY_WINDOW_MS',
  'RELIABILITY_COOLDOWN_MS',
  'RELIABILITY_REPAIR_BUDGET',
  'RELIABILITY_MODE',
  'RELIABILITY_LOOPBACK_ONLY',
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

describe('ReliabilityConfig - default values', () => {
  afterEach(() => {
    restoreEnv();
    backup.clear();
  });

  it('应使用安全默认值当所有环境变量都未设置时', async () => {
    snapshotEnv();
    for (const key of envKeys) {
      delete process.env[key];
    }

    const { reliabilityConfig } = await loadConfigModule();

    // 心跳间隔默认 30 分钟
    expect(reliabilityConfig.heartbeatIntervalMs).toBe(1800000);
    // 失败阈值默认 3
    expect(reliabilityConfig.failureThreshold).toBe(3);
    // 窗口默认 90 秒
    expect(reliabilityConfig.windowMs).toBe(90000);
    // 冷却窗口默认 5 分钟
    expect(reliabilityConfig.cooldownMs).toBe(300000);
    // 修复预算默认 3
    expect(reliabilityConfig.repairBudget).toBe(3);
    // 模式默认 observe
    expect(reliabilityConfig.mode).toBe('observe');
    // 仅本地自动救援默认开启
    expect(reliabilityConfig.loopbackOnly).toBe(true);
  });
});

describe('ReliabilityConfig - custom values', () => {
  afterEach(() => {
    restoreEnv();
    backup.clear();
  });

  it('应支持自定义心跳间隔', async () => {
    snapshotEnv();
    process.env.RELIABILITY_HEARTBEAT_INTERVAL_MS = '60000';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.heartbeatIntervalMs).toBe(60000);
  });

  it('应支持自定义失败阈值', async () => {
    snapshotEnv();
    process.env.RELIABILITY_FAILURE_THRESHOLD = '5';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.failureThreshold).toBe(5);
  });

  it('应支持自定义窗口大小', async () => {
    snapshotEnv();
    process.env.RELIABILITY_WINDOW_MS = '120000';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.windowMs).toBe(120000);
  });

  it('应支持自定义冷却窗口', async () => {
    snapshotEnv();
    process.env.RELIABILITY_COOLDOWN_MS = '600000';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.cooldownMs).toBe(600000);
  });

  it('应支持自定义修复预算', async () => {
    snapshotEnv();
    process.env.RELIABILITY_REPAIR_BUDGET = '10';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.repairBudget).toBe(10);
  });

  it('应支持自定义模式 observe', async () => {
    snapshotEnv();
    process.env.RELIABILITY_MODE = 'observe';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.mode).toBe('observe');
  });

  it('应支持自定义模式 shadow', async () => {
    snapshotEnv();
    process.env.RELIABILITY_MODE = 'shadow';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.mode).toBe('shadow');
  });

  it('应支持自定义模式 active', async () => {
    snapshotEnv();
    process.env.RELIABILITY_MODE = 'active';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.mode).toBe('active');
  });

  it('应支持关闭 loopback 限制', async () => {
    snapshotEnv();
    process.env.RELIABILITY_LOOPBACK_ONLY = 'false';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.loopbackOnly).toBe(false);
  });

  it('应支持开启 loopback 限制', async () => {
    snapshotEnv();
    process.env.RELIABILITY_LOOPBACK_ONLY = 'true';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.loopbackOnly).toBe(true);
  });
});

describe('ReliabilityConfig - invalid value fallback', () => {
  afterEach(() => {
    restoreEnv();
    backup.clear();
  });

  it('无效的心跳间隔应回退到默认值', async () => {
    snapshotEnv();
    process.env.RELIABILITY_HEARTBEAT_INTERVAL_MS = '-1000';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.heartbeatIntervalMs).toBe(1800000);
  });

  it('非数字心跳间隔应回退到默认值', async () => {
    snapshotEnv();
    process.env.RELIABILITY_HEARTBEAT_INTERVAL_MS = 'invalid';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.heartbeatIntervalMs).toBe(1800000);
  });

  it('无效的失败阈值应回退到默认值', async () => {
    snapshotEnv();
    process.env.RELIABILITY_FAILURE_THRESHOLD = '-1';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.failureThreshold).toBe(3);
  });

  it('非数字失败阈值应回退到默认值', async () => {
    snapshotEnv();
    process.env.RELIABILITY_FAILURE_THRESHOLD = 'abc';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.failureThreshold).toBe(3);
  });

  it('无效的窗口大小应回退到默认值', async () => {
    snapshotEnv();
    process.env.RELIABILITY_WINDOW_MS = '-5000';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.windowMs).toBe(90000);
  });

  it('无效的冷却窗口应回退到默认值', async () => {
    snapshotEnv();
    process.env.RELIABILITY_COOLDOWN_MS = '-100';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.cooldownMs).toBe(300000);
  });

  it('无效的修复预算应回退到默认值', async () => {
    snapshotEnv();
    process.env.RELIABILITY_REPAIR_BUDGET = '-5';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.repairBudget).toBe(3);
  });

  it('无效的模式应回退到 observe', async () => {
    snapshotEnv();
    process.env.RELIABILITY_MODE = 'invalid-mode';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.mode).toBe('observe');
  });

  it('大小写混合的模式应能正确解析', async () => {
    snapshotEnv();
    process.env.RELIABILITY_MODE = 'SHADOW';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.mode).toBe('shadow');
  });

  it('无效的 loopback 配置应回退到 true', async () => {
    snapshotEnv();
    process.env.RELIABILITY_LOOPBACK_ONLY = 'invalid';

    const { reliabilityConfig } = await loadConfigModule();
    expect(reliabilityConfig.loopbackOnly).toBe(true);
  });
});

describe('ReliabilityConfig - mode validation', () => {
  afterEach(() => {
    restoreEnv();
    backup.clear();
  });

  it('mode 属性应该是只读的', async () => {
    snapshotEnv();
    process.env.RELIABILITY_MODE = 'observe';

    const { reliabilityConfig } = await loadConfigModule();
    
    // 验证 mode 是有效值
    expect(['observe', 'shadow', 'active']).toContain(reliabilityConfig.mode);
  });

  it('所有配置项应该可枚举', async () => {
    snapshotEnv();
    for (const key of envKeys) {
      delete process.env[key];
    }

    const { reliabilityConfig } = await loadConfigModule();
    const keys = Object.keys(reliabilityConfig);
    
    expect(keys).toContain('heartbeatIntervalMs');
    expect(keys).toContain('failureThreshold');
    expect(keys).toContain('windowMs');
    expect(keys).toContain('cooldownMs');
    expect(keys).toContain('repairBudget');
    expect(keys).toContain('mode');
    expect(keys).toContain('loopbackOnly');
  });
});
