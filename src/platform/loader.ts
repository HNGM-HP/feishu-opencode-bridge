/**
 * 平台动态加载器
 *
 * 根据 isPlatformConfigured() 判断，只加载已配置的平台适配器。
 * 避免 SDK 全量加载导致内存浪费。
 */

import type { PlatformAdapter, PlatformSender } from './types.js';
import { isPlatformConfigured } from '../config/platform.js';

// 平台适配器缓存（动态加载后存入）
const adapterCache = new Map<string, PlatformAdapter>();

// 平台适配器路径映射
const PLATFORM_ADAPTER_PATHS: Record<string, string> = {
  feishu: './adapters/feishu-adapter.js',
  discord: './adapters/discord-adapter.js',
  wecom: './adapters/wecom-adapter.js',
  telegram: './adapters/telegram-adapter.js',
  qq: './adapters/qq-adapter.js',
  whatsapp: './adapters/whatsapp-adapter.js',
  weixin: './adapters/weixin-adapter.js',
  dingtalk: './adapters/dingtalk/dingtalk-adapter.js',
};

// 所有支持的平台列表
export const ALL_PLATFORMS = Object.keys(PLATFORM_ADAPTER_PATHS);

/**
 * 获取已配置的平台列表
 */
export function getConfiguredPlatforms(): string[] {
  return ALL_PLATFORMS.filter(platform => isPlatformConfigured(platform as any));
}

/**
 * 动态加载平台适配器
 *
 * @param platform - 平台标识
 * @returns 平台适配器，如果未配置或加载失败返回 null
 */
export async function loadAdapter(platform: string): Promise<PlatformAdapter | null> {
  // 已缓存则直接返回
  if (adapterCache.has(platform)) {
    return adapterCache.get(platform)!;
  }

  // 检查是否已配置
  if (!isPlatformConfigured(platform as any)) {
    console.log(`[PlatformLoader] 平台 ${platform} 未配置，跳过加载`);
    return null;
  }

  const adapterPath = PLATFORM_ADAPTER_PATHS[platform];
  if (!adapterPath) {
    console.warn(`[PlatformLoader] 未知的平台: ${platform}`);
    return null;
  }

  try {
    console.log(`[PlatformLoader] 动态加载平台适配器: ${platform}`);
    const module = await import(adapterPath);

    // 各适配器导出名称格式: {platform}Adapter (小驼峰)
    const exportName = `${platform}Adapter`;
    const adapter = module[exportName] || module.default || module.adapter;

    if (!adapter) {
      console.warn(`[PlatformLoader] 无法从模块中获取适配器: ${platform}，尝试导出名: ${exportName}`);
      return null;
    }

    adapterCache.set(platform, adapter);
    console.log(`[PlatformLoader] 平台适配器已加载: ${platform}`);
    return adapter;
  } catch (err) {
    console.error(`[PlatformLoader] 加载平台适配器失败: ${platform}`, err);
    return null;
  }
}

/**
 * 批量加载所有已配置的平台适配器
 *
 * @returns 已加载的适配器列表
 */
export async function loadAllConfigured(): Promise<PlatformAdapter[]> {
  const configuredPlatforms = getConfiguredPlatforms();

  if (configuredPlatforms.length === 0) {
    console.warn('[PlatformLoader] 没有配置任何平台');
    return [];
  }

  console.log(`[PlatformLoader] 将加载以下平台: ${configuredPlatforms.join(', ')}`);

  const adapters: PlatformAdapter[] = [];

  for (const platform of configuredPlatforms) {
    const adapter = await loadAdapter(platform);
    if (adapter) {
      adapters.push(adapter);
    }
  }

  console.log(`[PlatformLoader] 已加载 ${adapters.length} 个平台适配器`);
  return adapters;
}

/**
 * 获取已缓存的适配器
 */
export function getCachedAdapter(platform: string): PlatformAdapter | null {
  return adapterCache.get(platform) || null;
}

/**
 * 根据平台获取 Sender（用于消息路由）
 */
export function getSenderByPlatform(platform: string): PlatformSender | null {
  const adapter = getCachedAdapter(platform);
  if (adapter) {
    return adapter.getSender();
  }

  // 未加载的平台尝试 fallback 到飞书
  const feishuAdapter = getCachedAdapter('feishu');
  if (feishuAdapter) {
    console.warn(`[PlatformLoader] 平台 ${platform} 未加载，使用飞书作为 fallback`);
    return feishuAdapter.getSender();
  }

  return null;
}

/**
 * 清除适配器缓存
 */
export function clearCache(): void {
  adapterCache.clear();
}