/**
 * 结构化审计日志模块
 * 
 * 功能特性：
 * - JSONL 格式（每行一个 JSON 对象），便于追加和解析
 * - 原子写入模式（先写 tmp 文件，再 rename），防止崩溃导致数据损坏
 * - 敏感字段自动脱敏（password、token、OPENCODE_SERVER_PASSWORD 等）
 * - 支持按日期滚动的文件命名
 * - 完整的字段完整性保证
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * 审计事件分类
 */
export type AuditClassification =
  | 'permission'      // 权限请求/决策
  | 'question'        // 问题交互
  | 'config'          // 配置变更
  | 'session'         // 会话管理
  | 'security'        // 安全事件
  | 'system'          // 系统事件
  | 'error';         // 错误事件

/**
 * 审计决策类型
 */
export type AuditDecision =
  | 'allow'           // 允许
  | 'deny'            // 拒绝
  | 'answer'          // 回答问题
  | 'skip'            // 跳过
  | 'update'          // 更新配置
  | 'create'          // 创建资源
  | 'delete'          // 删除资源
  | 'rollback';      // 回滚操作

/**
 * 审计结果状态
 */
export type AuditResult =
  | 'success'         // 成功
  | 'failed'          // 失败
  | 'rejected'        // 被拒绝
  | 'timeout'         // 超时
  | 'error';         // 错误

/**
 * 审计事件接口
 */
export interface AuditEvent {
  /** 唯一事件 ID */
  incidentId: string;
  /** 事件分类 */
  classification: AuditClassification;
  /** 决策类型 */
  decision: AuditDecision;
  /** 动作描述 */
  action: string;
  /** 结果状态 */
  result: AuditResult;
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** 可选元数据（会自动脱敏敏感字段） */
  metadata?: Record<string, unknown>;
}

/**
 * 敏感字段关键词列表（用于脱敏）
 */
const SENSITIVE_FIELD_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'api_key',
  'auth',
  'credential',
  'privateKey',
  'OPENCODE_SERVER_PASSWORD',
];

/**
 * 生成唯一的 incident ID
 * @returns 格式：inc_<uuid>（去掉连字符）
 */
export function generateIncidentId(): string {
  const uuid = randomUUID().replace(/-/g, '');
  return `inc_${uuid}`;
}

/**
 * 递归脱敏敏感字段
 * @param data 原始数据对象
 * @returns 脱敏后的新对象（不修改原对象）
 */
export function redactSensitiveFields<T extends Record<string, unknown>>(data: T): T {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const keyLower = key.toLowerCase();
    
    // 检查是否是敏感字段
    const isSensitive = SENSITIVE_FIELD_PATTERNS.some(pattern => 
      keyLower.includes(pattern.toLowerCase())
    );

    if (isSensitive) {
      result[key] = '***';
    } else if (value && typeof value === 'object') {
      // 递归处理嵌套对象
      if (Array.isArray(value)) {
        result[key] = value.map(item => 
          item && typeof item === 'object' 
            ? redactSensitiveFields(item as Record<string, unknown>)
            : item
        );
      } else {
        result[key] = redactSensitiveFields(value as Record<string, unknown>);
      }
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * 获取日期格式字符串（YYYY-MM-DD）
 */
function getDateString(date: Date = new Date()): string {
  return date.toISOString().split('T')[0];
}

/**
 * 生成带日期的日志文件路径
 * @param basePath 基础路径
 * @param date 日期
 * @returns 带日期的文件路径
 */
function buildDateRotatedPath(basePath: string, date: Date = new Date()): string {
  const dir = path.dirname(basePath);
  const ext = path.extname(basePath);
  const base = path.basename(basePath, ext);
  const dateStr = getDateString(date);
  return path.join(dir, `${base}.${dateStr}${ext}`);
}

/**
 * 原子写入文件（先写临时文件，再 rename）
 * @param filePath 目标文件路径
 * @param content 文件内容
 */
async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tmpFile = `${filePath}.${process.pid}.tmp`;

  try {
    // 确保目录存在
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 写入临时文件
    await fs.promises.writeFile(tmpFile, content, 'utf-8');

    // 原子重命名
    await fs.promises.rename(tmpFile, filePath);
  } catch (error) {
    // 清理临时文件（如果存在）
    try {
      await fs.promises.unlink(tmpFile);
    } catch {
      // 忽略清理错误
    }
    throw error;
  }
}

/**
 * 追加写入 JSONL 日志（使用原子写入模式）
 * @param filePath 日志文件路径
 * @param line JSON 字符串行
 */
async function appendJsonLine(filePath: string, line: string): Promise<void> {
  const dir = path.dirname(filePath);

  try {
    // 确保目录存在
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 读取现有内容（如果存在）
    let existingContent = '';
    if (fs.existsSync(filePath)) {
      existingContent = await fs.promises.readFile(filePath, 'utf-8');
    }

    // 拼接新内容
    const newContent = existingContent ? `${existingContent}${line}\n` : `${line}\n`;

    // 原子写入（先写 tmp 再 rename）
    await atomicWriteFile(filePath, newContent);
  } catch (error) {
    throw new Error(`写入审计日志失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 审计日志记录器接口
 */
export interface AuditLogger {
  /**
   * 记录审计事件
   * @param event 审计事件
   */
  log(event: AuditEvent): Promise<void>;
}

/**
 * 创建审计日志记录器
 * @param logFilePath 日志文件路径
 * @param useDateRotation 是否启用日期滚动（默认 false）
 * @returns 审计日志记录器
 */
export function auditLogger(
  logFilePath: string,
  useDateRotation: boolean = false
): AuditLogger {
  return {
    async log(event: AuditEvent): Promise<void> {
      try {
        // 确定实际日志文件路径
        const actualPath = useDateRotation
          ? buildDateRotatedPath(logFilePath)
          : logFilePath;

        // 构建审计事件对象（确保必填字段）
        const auditEvent: Record<string, unknown> = {
          incidentId: event.incidentId,
          classification: event.classification,
          decision: event.decision,
          action: event.action,
          result: event.result,
          timestamp: event.timestamp || new Date().toISOString(),
        };

        // 添加元数据（如果存在）并脱敏
        if (event.metadata) {
          auditEvent.metadata = redactSensitiveFields(event.metadata);
        }

        // 序列化为 JSON 字符串
        const jsonLine = JSON.stringify(auditEvent);

        // 追加写入日志文件
        await appendJsonLine(actualPath, jsonLine);
      } catch (error) {
        // 记录错误但不阻塞主流程
        console.error('[AuditLogger] 写入审计日志失败:', error);
        throw error;
      }
    },
  };
}

/**
 * 验证审计事件字段完整性
 * @param event 审计事件
 * @returns 验证结果（包含错误信息）
 */
export function validateAuditEvent(event: Partial<AuditEvent>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const requiredFields: (keyof AuditEvent)[] = [
    'incidentId',
    'classification',
    'decision',
    'action',
    'result',
    'timestamp',
  ];

  for (const field of requiredFields) {
    if (!event[field]) {
      errors.push(`缺少必填字段：${field}`);
    }
  }

  // 验证时间戳格式
  if (event.timestamp && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(event.timestamp)) {
    errors.push('时间戳格式无效，应为 ISO 8601 格式');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 解析 JSONL 日志文件
 * @param filePath 日志文件路径
 * @returns 审计事件数组
 */
export async function parseAuditLogFile(filePath: string): Promise<AuditEvent[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`日志文件不存在：${filePath}`);
  }

  const content = await fs.promises.readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.trim());

  const events: AuditEvent[] = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as AuditEvent;
      events.push(event);
    } catch (error) {
      console.error('[AuditLogger] 解析日志行失败:', line, error);
      // 跳过无效行
    }
  }

  return events;
}

// 默认导出
export default {
  auditLogger,
  generateIncidentId,
  redactSensitiveFields,
  validateAuditEvent,
  parseAuditLogFile,
};
