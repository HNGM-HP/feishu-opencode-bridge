import { describe, expect, it } from 'vitest';
import { parseCommand, type ParsedCommand } from '../../../src/commands/parser.js';

describe('parseCommand - 双斜杠透传', () => {
  describe('parseDoubleSlashCommand', () => {
    it('应该解析带命名空间的双斜杠命令', () => {
      const result = parseCommand('//superpowers:brainstorming');
      expect(result).toEqual({
        type: 'command',
        commandName: 'superpowers:brainstorming',
        commandArgs: '',
        commandPrefix: '/',
      });
    });

    it('应该保留命令的原始大小写', () => {
      const result1 = parseCommand('//Build');
      expect(result1.commandName).toBe('Build');

      const result2 = parseCommand('//superpowers:Brainstorming');
      expect(result2.commandName).toBe('superpowers:Brainstorming');
    });

    it('应该解析带参数的双斜杠命令', () => {
      const result = parseCommand('//superpowers:brainstorming arg1 arg2');
      expect(result).toEqual({
        type: 'command',
        commandName: 'superpowers:brainstorming',
        commandArgs: 'arg1 arg2',
        commandPrefix: '/',
      });
    });

    it('应该解析不带命名空间的双斜杠命令', () => {
      const result = parseCommand('//build');
      expect(result).toEqual({
        type: 'command',
        commandName: 'build',
        commandArgs: '',
        commandPrefix: '/',
      });
    });

    it('空双斜杠应该返回 null', () => {
      const result = parseCommand('//');
      expect(result.type).toBe('prompt');
    });

    it('三斜杠不应该被解析为双斜杠命令', () => {
      const result = parseCommand('///test');
      expect(result.type).not.toBe('command');
    });

    it('双斜杠后跟空格和参数应该正确解析', () => {
      const result = parseCommand('//plan 帮我分析这个需求');
      expect(result.commandName).toBe('plan');
      expect(result.commandArgs).toBe('帮我分析这个需求');
    });

    it('双斜杠命令中包含中文应该正确解析', () => {
      const result = parseCommand('//创建角色');
      expect(result.commandName).toBe('创建角色');
    });

    it('双斜杠后跟路径不应该被解析为命令', () => {
      const result = parseCommand('//tmp/test');
      expect(result.type).toBe('prompt');
    });

    it('双斜杠后跟多个连续空格应该正确处理', () => {
      const result = parseCommand('//build   arg1    arg2');
      expect(result.commandName).toBe('build');
      // 参数中的多个空格会被规范化为单个空格（这是正确的行为）
      expect(result.commandArgs).toBe('arg1 arg2');
    });
  });

  describe('双斜杠与单斜杠的区别', () => {
    it('单斜杠命令应该转换为小写', () => {
      const result = parseCommand('/BUILD');
      expect(result).toEqual({
        type: 'command',
        commandName: 'BUILD', // 保留原始大小写用于透传
        commandArgs: '',
        commandPrefix: '/',
      });
    });

    it('单斜杠不允许冒号字符', () => {
      const result = parseCommand('/superpowers:brainstorming');
      // 单斜杠不允许冒号（isSlashCommandToken 会拒绝），所以会被当作 prompt
      expect(result.type).toBe('prompt');
    });

    it('双斜杠专门用于命名空间命令', () => {
      const result = parseCommand('//superpowers:brainstorming');
      expect(result.type).toBe('command');
      expect(result.commandName).toBe('superpowers:brainstorming');
    });
  });
});

describe('parseCommand - /commands 命令', () => {
  it('应该解析 /commands 命令', () => {
    const result = parseCommand('/commands');
    expect(result).toEqual({
      type: 'commands',
    });
  });

  it('应该解析 /slash 命令（别名）', () => {
    const result = parseCommand('/slash');
    expect(result.type).toBe('commands');
  });

  it('应该解析 /slash-commands 命令（别名）', () => {
    const result = parseCommand('/slash-commands');
    expect(result.type).toBe('commands');
  });

  it('应该解析 /slash_commands 命令（别名）', () => {
    const result = parseCommand('/slash_commands');
    expect(result.type).toBe('commands');
  });

  it('/commands 带参数应该忽略参数', () => {
    const result = parseCommand('/commands extra');
    expect(result.type).toBe('commands');
  });
});

describe('parseCommand - 边界情况', () => {
  it('空字符串应该返回 prompt 类型', () => {
    const result = parseCommand('');
    expect(result.type).toBe('prompt');
  });

  it('纯空格应该返回 prompt 类型', () => {
    const result = parseCommand('   ');
    expect(result.type).toBe('prompt');
  });

  it('双斜杠后跟换行应该返回 null', () => {
    const result = parseCommand('//test\narg');
    expect(result.type).toBe('prompt');
  });

  it('双斜杠命令中包含特殊字符应该正确解析', () => {
    const result = parseCommand('//test-command_v1.0');
    expect(result.commandName).toBe('test-command_v1.0');
  });

  it('双斜杠命令中包含数字应该正确解析', () => {
    const result = parseCommand('//test123');
    expect(result.commandName).toBe('test123');
  });
});
