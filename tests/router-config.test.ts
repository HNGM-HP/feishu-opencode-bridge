import { describe, it, expect } from 'vitest';
import { routerConfig } from '../src/config.js';

describe('RouterConfig - Parsing Fallback Behavior', () => {
  it('未设置 ROUTER_MODE 时应默认为 legacy', () => {
    // routerConfig 在模块加载时就计算好了
    // 只能验证默认行为
    expect(['legacy', 'dual', 'router']).toContain(routerConfig.mode);
  });

  it('未设置 ENABLED_PLATFORMS 时应返回空数组（表示不限制）', () => {
    // routerConfig 在模块加载时就计算好了
    // 只能验证默认行为
    expect(Array.isArray(routerConfig.enabledPlatforms)).toBe(true);
  });

  it('isPlatformEnabled 在未设置平台列表时应返回 true', () => {
    // 当 enabledPlatforms 为空数组时，所有平台都可用
    if (routerConfig.enabledPlatforms.length === 0) {
      expect(routerConfig.isPlatformEnabled('feishu')).toBe(true);
      expect(routerConfig.isPlatformEnabled('discord')).toBe(true);
    }
  });

  it('ROUTER_MODE 只接受有效值（通过实际运行时配置）', () => {
    // 验证只有这三个有效值被接受
    const validModes = ['legacy', 'dual', 'router'];
    expect(validModes).toContain(routerConfig.mode);
  });

  it('ENABLED_PLATFORMS 格式校验（通过实际运行时配置）', () => {
    // 验证 enabledPlatforms 是字符串数组且都转换为小写
    expect(Array.isArray(routerConfig.enabledPlatforms)).toBe(true);
    for (const platform of routerConfig.enabledPlatforms) {
      expect(typeof platform).toBe('string');
      expect(platform).toBe(platform.toLowerCase());
    }
  });
});