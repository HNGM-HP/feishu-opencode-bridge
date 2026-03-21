/**
 * 平台注册中心
 *
 * 用于注册和管理不同平台的适配器，支持按环境变量过滤启用的平台。
 * 默认保持 Feishu 启用以确保向后兼容。
 */

import type { PlatformAdapter } from './types.js';

// 环境变量前缀
const PLATFORM_ENV_PREFIX = 'PLATFORM_';
const ENABLED_SUFFIX = '_ENABLED';

// 注册表
const registry = new Map<string, PlatformAdapter>();

/**
 * 注册平台适配器
 *
 * @param adapter - 平台适配器实例
 * @throws Error - 如果 platformId 已存在
 */
export function register(adapter: PlatformAdapter): void {
  const platformId = adapter.platform;

  if (!platformId || typeof platformId !== 'string') {
    throw new Error('无效的 platformId');
  }

  if (registry.has(platformId)) {
    throw new Error(`平台 ${platformId} 已注册`);
  }

  registry.set(platformId, adapter);
}

/**
 * 获取平台适配器
 *
 * @param platformId - 平台唯一标识
 * @returns 平台适配器，如果不存在则返回 undefined
 */
export function get(platformId: string): PlatformAdapter | undefined {
  return registry.get(platformId);
}

/**
 * 列出所有已注册的平台
 *
 * @returns 平台适配器列表
 */
export function list(): PlatformAdapter[] {
  return Array.from(registry.values());
}

/**
 * 解析环境变量判断平台是否启用
 *
 * 优先级：
 * 1. 环境变量 PLATFORM_{PLATFORM_ID}_ENABLED
 * 2. 默认值：所有平台默认禁用，需显式配置或通过配置验证
 *
 * @param platformId - 平台唯一标识
 * @returns 是否启用
 */
function isPlatformEnabled(platformId: string): boolean {
  const envKey = `${PLATFORM_ENV_PREFIX}${platformId.toUpperCase()}${ENABLED_SUFFIX}`;
  const envValue = process.env[envKey];

  // 如果有环境变量配置，优先使用
  if (envValue !== undefined) {
    const normalized = envValue.trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  }

  // 默认策略：所有平台默认禁用
  // 平台启动由各适配器的 start() 方法根据配置决定
  return false;
}

/**
 * 列出启用的平台
 *
 * @returns 启用的平台适配器列表
 */
export function listEnabled(): PlatformAdapter[] {
  return Array.from(registry.values()).filter(
    adapter => isPlatformEnabled(adapter.platform)
  );
}

/**
 * 检查平台是否启用
 *
 * @param platformId - 平台唯一标识
 * @returns 是否启用
 */
export function isEnabled(platformId: string): boolean {
  // 未注册的平台视为禁用
  if (!registry.has(platformId)) {
    return false;
  }
  return isPlatformEnabled(platformId);
}