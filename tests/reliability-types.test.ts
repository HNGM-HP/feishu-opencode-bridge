/**
 * 可靠性类型测试 - 故障分类与状态机
 * 
 * 测试内容：
 * 1. FailureType 枚举稳定性
 * 2. RescueState 枚举完整性
 * 3. 状态跃迁合法性验证
 * 4. 故障到状态映射正确性
 * 5. 边界情况：HTTP 状态码到故障分类映射
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FailureType,
  RescueState,
  VALID_STATE_TRANSITIONS,
  FAILURE_TO_INITIAL_STATE,
  isValidStateTransition,
  StateTransitionValidator,
  type FailureEvent,
  type StateChangeEvent
} from '../src/reliability/types.js';

describe('可靠性类型 - 故障分类与状态机', () => {
  describe('FailureType 枚举', () => {
    it('应包含所有预定义的故障类型', () => {
      expect(Object.values(FailureType)).toEqual([
        FailureType.BRIDGE_BOOT_FAILED,
        FailureType.BRIDGE_STALE,
        FailureType.OPENCODE_TCP_DOWN,
        FailureType.OPENCODE_HTTP_DOWN,
        FailureType.OPENCODE_AUTH_INVALID,
        FailureType.EVENT_STREAM_STALE
      ]);
    });

    it('枚举值应稳定且不可变', () => {
      expect(FailureType.OPENCODE_AUTH_INVALID).toBe('opencode_auth_invalid');
      expect(FailureType.OPENCODE_TCP_DOWN).toBe('opencode_tcp_down');
      expect(FailureType.OPENCODE_HTTP_DOWN).toBe('opencode_http_down');
      expect(FailureType.BRIDGE_BOOT_FAILED).toBe('bridge_boot_failed');
      expect(FailureType.BRIDGE_STALE).toBe('bridge_stale');
      expect(FailureType.EVENT_STREAM_STALE).toBe('event_stream_stale');
    });

    it('不应包含未定义的类型', () => {
      const values = Object.values(FailureType);
      expect(values.length).toBe(6);
      expect(values).not.toContain('unknown');
      expect(values).not.toContain('network_error');
    });
  });

  describe('RescueState 枚举', () => {
    it('应包含所有预定义的救援状态', () => {
      expect(Object.values(RescueState)).toEqual([
        RescueState.HEALTHY,
        RescueState.SUSPECT,
        RescueState.DEGRADED,
        RescueState.REPAIRING,
        RescueState.RECOVERED,
        RescueState.MANUAL_REQUIRED
      ]);
    });

    it('枚举值应稳定且不可变', () => {
      expect(RescueState.HEALTHY).toBe('healthy');
      expect(RescueState.SUSPECT).toBe('suspect');
      expect(RescueState.DEGRADED).toBe('degraded');
      expect(RescueState.REPAIRING).toBe('repairing');
      expect(RescueState.RECOVERED).toBe('recovered');
      expect(RescueState.MANUAL_REQUIRED).toBe('manual_required');
    });

    it('状态数量应为 6 个', () => {
      expect(Object.values(RescueState).length).toBe(6);
    });
  });

  describe('故障分类边界', () => {
    it('401/403 应映射到 opencode_auth_invalid', () => {
      // 认证故障专门处理 401/403 状态码
      expect(FAILURE_TO_INITIAL_STATE[FailureType.OPENCODE_AUTH_INVALID])
        .toBe(RescueState.DEGRADED);
    });

    it('TCP 连接超时/拒绝应映射到 opencode_tcp_down', () => {
      expect(FAILURE_TO_INITIAL_STATE[FailureType.OPENCODE_TCP_DOWN])
        .toBe(RescueState.SUSPECT);
    });

    it('HTTP 5xx 错误应映射到 opencode_http_down', () => {
      expect(FAILURE_TO_INITIAL_STATE[FailureType.OPENCODE_HTTP_DOWN])
        .toBe(RescueState.SUSPECT);
    });

    it('桥接启动失败应直接进入 manual_required', () => {
      // 启动失败无法自动恢复，需要人工介入
      expect(FAILURE_TO_INITIAL_STATE[FailureType.BRIDGE_BOOT_FAILED])
        .toBe(RescueState.MANUAL_REQUIRED);
    });
  });

  describe('状态跃迁规则 - isValidStateTransition', () => {
    it('healthy 只能跃迁到 suspect', () => {
      expect(isValidStateTransition(RescueState.HEALTHY, RescueState.SUSPECT)).toBe(true);
      expect(isValidStateTransition(RescueState.HEALTHY, RescueState.DEGRADED)).toBe(false);
      expect(isValidStateTransition(RescueState.HEALTHY, RescueState.REPAIRING)).toBe(false);
      expect(isValidStateTransition(RescueState.HEALTHY, RescueState.RECOVERED)).toBe(false);
      expect(isValidStateTransition(RescueState.HEALTHY, RescueState.MANUAL_REQUIRED)).toBe(false);
    });

    it('suspect 可以跃迁到 healthy 或 degraded', () => {
      expect(isValidStateTransition(RescueState.SUSPECT, RescueState.HEALTHY)).toBe(true);
      expect(isValidStateTransition(RescueState.SUSPECT, RescueState.DEGRADED)).toBe(true);
      expect(isValidStateTransition(RescueState.SUSPECT, RescueState.REPAIRING)).toBe(false);
      expect(isValidStateTransition(RescueState.SUSPECT, RescueState.RECOVERED)).toBe(false);
    });

    it('degraded 可以跃迁到 repairing 或 manual_required', () => {
      expect(isValidStateTransition(RescueState.DEGRADED, RescueState.REPAIRING)).toBe(true);
      expect(isValidStateTransition(RescueState.DEGRADED, RescueState.MANUAL_REQUIRED)).toBe(true);
      expect(isValidStateTransition(RescueState.DEGRADED, RescueState.HEALTHY)).toBe(false);
      expect(isValidStateTransition(RescueState.DEGRADED, RescueState.RECOVERED)).toBe(false);
    });

    it('repairing 可以跃迁到 recovered、degraded 或 manual_required', () => {
      expect(isValidStateTransition(RescueState.REPAIRING, RescueState.RECOVERED)).toBe(true);
      expect(isValidStateTransition(RescueState.REPAIRING, RescueState.DEGRADED)).toBe(true);
      expect(isValidStateTransition(RescueState.REPAIRING, RescueState.MANUAL_REQUIRED)).toBe(true);
      expect(isValidStateTransition(RescueState.REPAIRING, RescueState.HEALTHY)).toBe(false);
    });

    it('recovered 可以跃迁到 healthy 或 suspect', () => {
      expect(isValidStateTransition(RescueState.RECOVERED, RescueState.HEALTHY)).toBe(true);
      expect(isValidStateTransition(RescueState.RECOVERED, RescueState.SUSPECT)).toBe(true);
      expect(isValidStateTransition(RescueState.RECOVERED, RescueState.DEGRADED)).toBe(false);
    });

    it('manual_required 只能跃迁到 healthy', () => {
      expect(isValidStateTransition(RescueState.MANUAL_REQUIRED, RescueState.HEALTHY)).toBe(true);
      expect(isValidStateTransition(RescueState.MANUAL_REQUIRED, RescueState.SUSPECT)).toBe(false);
      expect(isValidStateTransition(RescueState.MANUAL_REQUIRED, RescueState.DEGRADED)).toBe(false);
    });
  });

  describe('VALID_STATE_TRANSITIONS 完整性', () => {
    it('应为所有状态定义跃迁规则', () => {
      const allStates = Object.values(RescueState);
      const definedStates = Object.keys(VALID_STATE_TRANSITIONS);
      
      expect(definedStates.length).toBe(allStates.length);
      allStates.forEach(state => {
        expect(definedStates).toContain(state);
      });
    });

    it('每个状态的跃迁目标应为有效状态数组', () => {
      Object.entries(VALID_STATE_TRANSITIONS).forEach(([from, targets]) => {
        expect(Array.isArray(targets)).toBe(true);
        targets.forEach(target => {
          expect(Object.values(RescueState)).toContain(target);
        });
      });
    });
  });

  describe('FAILURE_TO_INITIAL_STATE 映射', () => {
    it('应为所有故障类型定义初始状态', () => {
      const allFailures = Object.values(FailureType);
      const definedFailures = Object.keys(FAILURE_TO_INITIAL_STATE);
      
      expect(definedFailures.length).toBe(allFailures.length);
      allFailures.forEach(failure => {
        expect(definedFailures).toContain(failure);
      });
    });

    it('映射的目标状态应为有效状态', () => {
      Object.values(FAILURE_TO_INITIAL_STATE).forEach(state => {
        expect(Object.values(RescueState)).toContain(state);
      });
    });
  });

  describe('StateTransitionValidator 类', () => {
    let validator: StateTransitionValidator;

    beforeEach(() => {
      validator = new StateTransitionValidator();
    });

    it('默认初始状态应为 healthy', () => {
      expect(validator.getState()).toBe(RescueState.HEALTHY);
    });

    it('可以指定初始状态', () => {
      const customValidator = new StateTransitionValidator(RescueState.SUSPECT);
      expect(customValidator.getState()).toBe(RescueState.SUSPECT);
    });

    it('应拒绝无效的初始状态', () => {
      expect(() => new StateTransitionValidator('invalid' as any)).toThrow('无效的初始状态');
    });

    describe('transitionTo 方法', () => {
      it('应允许合法的状态跃迁', () => {
        expect(() => validator.transitionTo(RescueState.SUSPECT)).not.toThrow();
        expect(validator.getState()).toBe(RescueState.SUSPECT);
      });

      it('应拒绝非法的状态跃迁并抛出错误', () => {
        expect(() => validator.transitionTo(RescueState.DEGRADED)).toThrow('非法的状态跃迁');
        expect(validator.getState()).toBe(RescueState.HEALTHY); // 状态未改变
      });

      it('错误信息应包含允许的跃迁目标', () => {
        try {
          validator.transitionTo(RescueState.DEGRADED);
        } catch (error) {
          expect((error as Error).message).toContain('允许的跃迁');
          expect((error as Error).message).toContain('suspect');
        }
      });

      it('应支持连续合法跃迁', () => {
        validator.transitionTo(RescueState.SUSPECT);
        validator.transitionTo(RescueState.DEGRADED);
        validator.transitionTo(RescueState.REPAIRING);
        validator.transitionTo(RescueState.RECOVERED);
        validator.transitionTo(RescueState.HEALTHY);
        
        expect(validator.getState()).toBe(RescueState.HEALTHY);
      });

      it('在连续跃迁中拒绝非法跳步', () => {
        validator.transitionTo(RescueState.SUSPECT);
        validator.transitionTo(RescueState.DEGRADED);
        
        // 从 degraded 不能直接到 healthy
        expect(() => validator.transitionTo(RescueState.HEALTHY)).toThrow();
      });
    });

    describe('canTransitionTo 方法', () => {
      it('应返回跃迁是否合法（不改变状态）', () => {
        expect(validator.canTransitionTo(RescueState.SUSPECT)).toBe(true);
        expect(validator.canTransitionTo(RescueState.DEGRADED)).toBe(false);
        expect(validator.getState()).toBe(RescueState.HEALTHY); // 状态未改变
      });

      it('在不同状态下返回正确结果', () => {
        validator.transitionTo(RescueState.SUSPECT);
        expect(validator.canTransitionTo(RescueState.HEALTHY)).toBe(true);
        expect(validator.canTransitionTo(RescueState.DEGRADED)).toBe(true);
        expect(validator.canTransitionTo(RescueState.REPAIRING)).toBe(false);
      });
    });

    describe('reset 方法', () => {
      it('应重置状态到初始值', () => {
        validator.transitionTo(RescueState.SUSPECT);
        validator.transitionTo(RescueState.DEGRADED);
        
        validator.reset();
        expect(validator.getState()).toBe(RescueState.HEALTHY);
      });

      it('可以重置到指定状态', () => {
        validator.transitionTo(RescueState.SUSPECT);
        validator.reset(RescueState.SUSPECT);
        expect(validator.getState()).toBe(RescueState.SUSPECT);
      });
    });
  });

  describe('类型定义', () => {
    it('FailureEvent 接口应包含必要字段', () => {
      const event: FailureEvent = {
        type: FailureType.OPENCODE_TCP_DOWN,
        timestamp: Date.now(),
        message: 'Connection timeout',
        error: new Error('ETIMEDOUT'),
        context: { host: 'localhost', port: 4096 }
      };
      
      expect(event.type).toBe(FailureType.OPENCODE_TCP_DOWN);
      expect(event.timestamp).toBeGreaterThan(0);
      expect(event.message).toBe('Connection timeout');
    });

    it('StateChangeEvent 接口应包含必要字段', () => {
      const event: StateChangeEvent = {
        from: RescueState.HEALTHY,
        to: RescueState.SUSPECT,
        reason: 'Detected connection timeout',
        timestamp: Date.now()
      };
      
      expect(event.from).toBe(RescueState.HEALTHY);
      expect(event.to).toBe(RescueState.SUSPECT);
      expect(event.reason).toBe('Detected connection timeout');
    });
  });

  describe('边界情况测试', () => {
    it('应处理所有非法跃迁组合', () => {
      const illegalTransitions: [RescueState, RescueState][] = [
        [RescueState.HEALTHY, RescueState.DEGRADED],
        [RescueState.HEALTHY, RescueState.REPAIRING],
        [RescueState.HEALTHY, RescueState.RECOVERED],
        [RescueState.HEALTHY, RescueState.MANUAL_REQUIRED],
        [RescueState.SUSPECT, RescueState.REPAIRING],
        [RescueState.SUSPECT, RescueState.RECOVERED],
        [RescueState.SUSPECT, RescueState.MANUAL_REQUIRED],
        [RescueState.DEGRADED, RescueState.HEALTHY],
        [RescueState.DEGRADED, RescueState.RECOVERED],
        [RescueState.REPAIRING, RescueState.HEALTHY],
        [RescueState.REPAIRING, RescueState.SUSPECT],
        [RescueState.RECOVERED, RescueState.DEGRADED],
        [RescueState.RECOVERED, RescueState.REPAIRING],
        [RescueState.RECOVERED, RescueState.MANUAL_REQUIRED],
        [RescueState.MANUAL_REQUIRED, RescueState.SUSPECT],
        [RescueState.MANUAL_REQUIRED, RescueState.DEGRADED],
        [RescueState.MANUAL_REQUIRED, RescueState.REPAIRING],
        [RescueState.MANUAL_REQUIRED, RescueState.RECOVERED]
      ];

      illegalTransitions.forEach(([from, to]) => {
        expect(isValidStateTransition(from, to)).toBe(false);
      });
    });

    it('应处理所有合法跃迁组合', () => {
      const legalTransitions: [RescueState, RescueState][] = [
        [RescueState.HEALTHY, RescueState.SUSPECT],
        [RescueState.SUSPECT, RescueState.HEALTHY],
        [RescueState.SUSPECT, RescueState.DEGRADED],
        [RescueState.DEGRADED, RescueState.REPAIRING],
        [RescueState.DEGRADED, RescueState.MANUAL_REQUIRED],
        [RescueState.REPAIRING, RescueState.RECOVERED],
        [RescueState.REPAIRING, RescueState.DEGRADED],
        [RescueState.REPAIRING, RescueState.MANUAL_REQUIRED],
        [RescueState.RECOVERED, RescueState.HEALTHY],
        [RescueState.RECOVERED, RescueState.SUSPECT],
        [RescueState.MANUAL_REQUIRED, RescueState.HEALTHY]
      ];

      legalTransitions.forEach(([from, to]) => {
        expect(isValidStateTransition(from, to)).toBe(true);
      });
    });
  });

  describe('状态机完整流程', () => {
    it('应支持完整故障恢复流程', () => {
      const validator = new StateTransitionValidator();
      
      // healthy -> suspect (检测到异常)
      validator.transitionTo(RescueState.SUSPECT);
      expect(validator.getState()).toBe(RescueState.SUSPECT);
      
      // suspect -> degraded (故障确认)
      validator.transitionTo(RescueState.DEGRADED);
      expect(validator.getState()).toBe(RescueState.DEGRADED);
      
      // degraded -> repairing (启动修复)
      validator.transitionTo(RescueState.REPAIRING);
      expect(validator.getState()).toBe(RescueState.REPAIRING);
      
      // repairing -> recovered (修复成功)
      validator.transitionTo(RescueState.RECOVERED);
      expect(validator.getState()).toBe(RescueState.RECOVERED);
      
      // recovered -> healthy (观察期结束)
      validator.transitionTo(RescueState.HEALTHY);
      expect(validator.getState()).toBe(RescueState.HEALTHY);
    });

    it('应支持人工介入流程', () => {
      const validator = new StateTransitionValidator();
      
      // healthy -> suspect -> degraded
      validator.transitionTo(RescueState.SUSPECT);
      validator.transitionTo(RescueState.DEGRADED);
      
      // degraded -> manual_required (自动修复失败)
      validator.transitionTo(RescueState.MANUAL_REQUIRED);
      expect(validator.getState()).toBe(RescueState.MANUAL_REQUIRED);
      
      // manual_required -> healthy (人工处理完成)
      validator.transitionTo(RescueState.HEALTHY);
      expect(validator.getState()).toBe(RescueState.HEALTHY);
    });

    it('应支持修复失败回退流程', () => {
      const validator = new StateTransitionValidator();
      
      validator.transitionTo(RescueState.SUSPECT);
      validator.transitionTo(RescueState.DEGRADED);
      validator.transitionTo(RescueState.REPAIRING);
      
      // repairing -> degraded (修复失败回退)
      validator.transitionTo(RescueState.DEGRADED);
      expect(validator.getState()).toBe(RescueState.DEGRADED);
    });
  });
});
