/**
 * Resource Management 常量定义
 *
 * 集中管理各 manager 共享的常量，避免硬编码和魔法值。
 */

/** 文件监控去抖时间（毫秒）- 文件变更后延迟多久触发重载 */
export const DEBOUNCE_MS = 200;

/** chokidar awaitWriteFinish 稳定性阈值（毫秒） */
export const FILE_STABILITY_THRESHOLD_MS = 200;

/** chokidar awaitWriteFinish 轮询间隔（毫秒） */
export const FILE_POLL_INTERVAL_MS = 100;

/** 默认 order 值（新建资源时使用） */
export const DEFAULT_ORDER = 1000;

/** Provider 模型缓存刷新间隔（毫秒） - 30分钟 */
export const PROVIDER_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

/** SSE keepalive 间隔（毫秒） - 30秒 */
export const SSE_KEEPALIVE_INTERVAL_MS = 30000;

/** 资源名称最大长度 */
export const MAX_RESOURCE_NAME_LENGTH = 64;

/** 资源名称允许的字符正则 */
export const RESOURCE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
