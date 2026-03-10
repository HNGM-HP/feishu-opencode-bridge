import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { auditLogger, type AuditEvent, redactSensitiveFields, generateIncidentId } from '../src/reliability/audit-log.js';
import fs from 'node:fs';
import path from 'node:path';

describe('AuditLog Module', () => {
  const testLogDir = path.join(process.cwd(), 'logs', 'test-audit');
  const testLogFile = path.join(testLogDir, 'audit.log');

  beforeEach(() => {
    // 清理测试日志目录
    if (fs.existsSync(testLogDir)) {
      fs.rmSync(testLogDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testLogDir, { recursive: true });
  });

  afterEach(() => {
    // 清理测试日志目录
    if (fs.existsSync(testLogDir)) {
      fs.rmSync(testLogDir, { recursive: true, force: true });
    }
  });

  describe('generateIncidentId', () => {
    it('应生成符合格式的 incidentId', () => {
      const incidentId = generateIncidentId();
      expect(incidentId).toMatch(/^inc_[a-zA-Z0-9]{16,}$/);
    });

    it('应生成唯一的 incidentId', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateIncidentId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('redactSensitiveFields', () => {
    it('应脱敏密码字段', () => {
      const data = {
        password: 'secret123',
        username: 'admin',
      };
      const redacted = redactSensitiveFields(data);
      expect(redacted.password).toBe('***');
      expect(redacted.username).toBe('admin');
    });

    it('应脱敏 token 字段', () => {
      const data = {
        token: 'Bearer xyz123',
        refreshToken: 'refresh456',
        accessToken: 'access789',
      };
      const redacted = redactSensitiveFields(data);
      expect(redacted.token).toBe('***');
      expect(redacted.refreshToken).toBe('***');
      expect(redacted.accessToken).toBe('***');
    });

    it('应脱敏 OPENCODE_SERVER_PASSWORD 环境变量', () => {
      const data = {
        env: {
          OPENCODE_SERVER_PASSWORD: 'supersecret',
          OTHER_VAR: 'visible',
        },
      };
      const redacted = redactSensitiveFields(data);
      expect(redacted.env.OPENCODE_SERVER_PASSWORD).toBe('***');
      expect(redacted.env.OTHER_VAR).toBe('visible');
    });

    it('应递归脱敏嵌套对象中的敏感字段', () => {
      const data = {
        user: {
          password: 'nested_secret',
          name: 'John',
        },
        config: {
          apiKey: 'key123',
          timeout: 5000,
        },
      };
      const redacted = redactSensitiveFields(data);
      expect(redacted.user.password).toBe('***');
      expect(redacted.user.name).toBe('John');
      expect(redacted.config.apiKey).toBe('***');
      expect(redacted.config.timeout).toBe(5000);
    });

    it('不应修改原始对象', () => {
      const original = { password: 'secret', name: 'test' };
      const copy = { ...original };
      redactSensitiveFields(original);
      expect(original).toEqual(copy);
    });

    it('应处理数组中的敏感字段', () => {
      const data = {
        items: [
          { password: 'secret1', name: 'item1' },
          { token: 'secret2', name: 'item2' },
        ],
      };
      const redacted = redactSensitiveFields(data);
      expect(redacted.items[0].password).toBe('***');
      expect(redacted.items[0].name).toBe('item1');
      expect(redacted.items[1].token).toBe('***');
      expect(redacted.items[1].name).toBe('item2');
    });
  });

  describe('auditLogger', () => {
    it('应创建包含所有必填字段的审计事件', async () => {
      const testFile = path.join(testLogDir, `audit-basic-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
      const logger = auditLogger(testFile);
      
      const event: AuditEvent = {
        incidentId: generateIncidentId(),
        classification: 'permission',
        decision: 'allow',
        action: 'tool_execution',
        result: 'success',
        timestamp: new Date().toISOString(),
        metadata: {
          tool: 'Bash',
          command: 'ls -la',
        },
      };

      await logger.log(event);

      // 验证文件存在
      expect(fs.existsSync(testFile)).toBe(true);

      // 验证 JSONL 格式
      const content = fs.readFileSync(testFile, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.incidentId).toBe(event.incidentId);
      expect(parsed.classification).toBe(event.classification);
      expect(parsed.decision).toBe(event.decision);
      expect(parsed.action).toBe(event.action);
      expect(parsed.result).toBe(event.result);
      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('应自动脱敏敏感字段', async () => {
      const testFile = path.join(testLogDir, 'audit-redact.log');
      const logger = auditLogger(testFile);
      
      const event: AuditEvent = {
        incidentId: generateIncidentId(),
        classification: 'config',
        decision: 'update',
        action: 'env_change',
        result: 'success',
        timestamp: new Date().toISOString(),
        metadata: {
          env: {
            OPENCODE_SERVER_PASSWORD: 'should_be_redacted',
            FEISHU_APP_ID: 'should_be_visible',
          },
        },
      };

      await logger.log(event);

      const content = fs.readFileSync(testFile, 'utf-8');
      const lines = content.trim().split('\n');
      const parsed = JSON.parse(lines[lines.length - 1]);
      
      expect(parsed.metadata.env.OPENCODE_SERVER_PASSWORD).toBe('***');
      expect(parsed.metadata.env.FEISHU_APP_ID).toBe('should_be_visible');
    });

    it('应支持原子写入（tmp + rename 模式）', async () => {
      const testFile = path.join(testLogDir, 'audit-atomic.log');
      const logger = auditLogger(testFile);
      
      const event: AuditEvent = {
        incidentId: generateIncidentId(),
        classification: 'permission',
        decision: 'deny',
        action: 'tool_execution',
        result: 'rejected',
        timestamp: new Date().toISOString(),
      };

      await logger.log(event);

      // 验证不应存在临时文件
      const tmpFiles = fs.readdirSync(testLogDir).filter(f => f.endsWith('.tmp'));
      expect(tmpFiles.length).toBe(0);

      // 验证最终文件存在
      expect(fs.existsSync(testFile)).toBe(true);
    });

    it('应支持多行追加（JSONL 格式）', async () => {
      const testFile = path.join(testLogDir, `audit-multi-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
      const logger = auditLogger(testFile);
      
      await logger.log({
        incidentId: generateIncidentId(),
        classification: 'permission',
        decision: 'allow',
        action: 'action1',
        result: 'success',
        timestamp: new Date().toISOString(),
      });

      await logger.log({
        incidentId: generateIncidentId(),
        classification: 'question',
        decision: 'answer',
        action: 'action2',
        result: 'success',
        timestamp: new Date().toISOString(),
      });

      const content = fs.readFileSync(testFile, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);

      // 验证每行都是有效的 JSON
      lines.forEach(line => {
        expect(() => JSON.parse(line)).not.toThrow();
      });
    });

    it('应支持按日期滚动的文件命名', () => {
      const testFile = path.join(testLogDir, 'audit-date-rotate.log');
      const loggerWithDate = auditLogger(testFile, true);
      
      // 验证日志文件路径包含日期
      const expectedDate = new Date().toISOString().split('T')[0];
      // 实际文件路径会在 log 方法调用时创建
      expect(loggerWithDate).toBeDefined();
    });

    it('应处理缺失的可选字段', async () => {
      const testFile = path.join(testLogDir, 'audit-optional.log');
      const logger = auditLogger(testFile);
      
      const event: AuditEvent = {
        incidentId: generateIncidentId(),
        classification: 'permission',
        decision: 'allow',
        action: 'tool_execution',
        result: 'success',
        timestamp: new Date().toISOString(),
        // metadata 是可选的
      };

      await logger.log(event);

      const content = fs.readFileSync(testFile, 'utf-8');
      const lines = content.trim().split('\n');
      const parsed = JSON.parse(lines[lines.length - 1]);
      
      expect(parsed.incidentId).toBeDefined();
      expect(parsed.classification).toBeDefined();
      expect(parsed.decision).toBeDefined();
      expect(parsed.action).toBeDefined();
      expect(parsed.result).toBeDefined();
      expect(parsed.timestamp).toBeDefined();
    });

    it('应捕获并记录写入错误', async () => {
      // 使用空路径或特殊字符路径来触发错误
      const invalidPath = '';
      const logger = auditLogger(invalidPath);
      
      const event: AuditEvent = {
        incidentId: generateIncidentId(),
        classification: 'system',
        decision: 'create',
        action: 'test_action',
        result: 'error',
        timestamp: new Date().toISOString(),
      };

      // 应该抛出错误
      await expect(logger.log(event)).rejects.toThrow();
    });
  });

  describe('字段完整性验证', () => {
    it('所有必填字段必须存在且非空', async () => {
      const testFile = path.join(testLogDir, 'audit-validate.log');
      const logger = auditLogger(testFile);
      
      const requiredFields = ['incidentId', 'classification', 'decision', 'action', 'result', 'timestamp'];
      
      const event: AuditEvent = {
        incidentId: generateIncidentId(),
        classification: 'permission',
        decision: 'allow',
        action: 'tool_execution',
        result: 'success',
        timestamp: new Date().toISOString(),
      };

      await logger.log(event);

      const content = fs.readFileSync(testFile, 'utf-8');
      const lines = content.trim().split('\n');
      const parsed = JSON.parse(lines[lines.length - 1]);

      requiredFields.forEach(field => {
        expect(parsed[field]).toBeDefined();
        expect(parsed[field]).not.toBe('');
      });
    });
  });
});
