/**
 * 故障分类与救援状态机类型定义
 * 
 * 本模块定义桥接服务可靠性相关的故障分类体系和救援状态机。
 * 用于统一故障检测、状态管理和恢复策略。
 */

/**
 * 故障类型分类
 * 
 * 按故障来源和性质分为：
 * - 桥接启动故障 (bridge_boot_failed): 桥接服务自身启动失败
 * - 桥接陈旧故障 (bridge_stale): 桥接会话/状态过期
 * - OpenCode TCP 连接故障 (opencode_tcp_down): TCP 层连接超时/拒绝
 * - OpenCode HTTP 服务故障 (opencode_http_down): HTTP 层响应异常
 * - OpenCode 认证故障 (opencode_auth_invalid): 401/403 认证失败
 * - 事件流陈旧故障 (event_stream_stale): SSE 事件流停滞
 */
export enum FailureType {
  /** 桥接启动失败 - 端口占用/配置错误等 */
  BRIDGE_BOOT_FAILED = 'bridge_boot_failed',
  
  /** 桥接状态陈旧 - 会话映射过期/缓存失效 */
  BRIDGE_STALE = 'bridge_stale',
  
  /** OpenCode TCP 连接故障 - 连接超时/拒绝/重置 */
  OPENCODE_TCP_DOWN = 'opencode_tcp_down',
  
  /** OpenCode HTTP 服务故障 - HTTP 响应超时/5xx 错误 */
  OPENCODE_HTTP_DOWN = 'opencode_http_down',
  
  /** OpenCode 认证失败 - 401/403 认证无效 */
  OPENCODE_AUTH_INVALID = 'opencode_auth_invalid',
  
  /** 事件流陈旧 - SSE 连接停滞/心跳丢失 */
  EVENT_STREAM_STALE = 'event_stream_stale'
}

/**
 * 救援状态机状态
 * 
 * 状态跃迁规则：
 * - healthy -> suspect: 检测到潜在故障
 * - suspect -> healthy: 故障消失/自愈
 * - suspect -> degraded: 故障确认
 * - degraded -> repairing: 启动自动修复
 * - degraded -> manual_required: 需要人工介入
 * - repairing -> recovered: 修复成功
 * - repairing -> degraded: 修复失败回退
 * - repairing -> manual_required: 修复失败需人工
 * - recovered -> healthy: 观察期结束后恢复正常
 * - manual_required -> healthy: 人工处理后恢复
 */
export enum RescueState {
  /** 健康状态 - 所有系统正常 */
  HEALTHY = 'healthy',
  
  /** 可疑状态 - 检测到潜在异常待确认 */
  SUSPECT = 'suspect',
  
  /** 降级状态 - 故障确认但服务仍可用 */
  DEGRADED = 'degraded',
  
  /** 修复中状态 - 正在执行自动恢复流程 */
  REPAIRING = 'repairing',
  
  /** 已恢复状态 - 修复完成待观察确认 */
  RECOVERED = 'recovered',
  
  /** 需人工介入 - 自动修复失败需人工处理 */
  MANUAL_REQUIRED = 'manual_required'
}

/**
 * 状态跃迁规则定义
 * 
 * 禁止的跃迁：
 * - healthy -> repairing: 健康状态不能直接跳修复
 * - healthy -> recovered: 健康状态不能直接跳已恢复
 * - healthy -> manual_required: 健康状态不能直接跳人工
 * - suspect -> repairing: 可疑状态需先确认故障
 * - suspect -> recovered: 可疑状态不能直接跳已恢复
 * - degraded -> healthy: 降级状态需经过修复流程
 * - repairing -> healthy: 修复中需先确认恢复再观察
 * - manual_required -> 任意状态 (除 healthy): 人工介入后必须观察
 */
export const VALID_STATE_TRANSITIONS: Record<RescueState, RescueState[]> = {
  [RescueState.HEALTHY]: [
    RescueState.SUSPECT
  ],
  [RescueState.SUSPECT]: [
    RescueState.HEALTHY,
    RescueState.DEGRADED
  ],
  [RescueState.DEGRADED]: [
    RescueState.REPAIRING,
    RescueState.MANUAL_REQUIRED
  ],
  [RescueState.REPAIRING]: [
    RescueState.RECOVERED,
    RescueState.DEGRADED,
    RescueState.MANUAL_REQUIRED
  ],
  [RescueState.RECOVERED]: [
    RescueState.HEALTHY,
    RescueState.SUSPECT
  ],
  [RescueState.MANUAL_REQUIRED]: [
    RescueState.HEALTHY
  ]
};

/**
 * 故障到初始救援状态的映射
 * 
 * 不同故障类型触发不同的初始响应策略
 */
export const FAILURE_TO_INITIAL_STATE: Record<FailureType, RescueState> = {
  [FailureType.BRIDGE_BOOT_FAILED]: RescueState.MANUAL_REQUIRED,
  [FailureType.BRIDGE_STALE]: RescueState.SUSPECT,
  [FailureType.OPENCODE_TCP_DOWN]: RescueState.SUSPECT,
  [FailureType.OPENCODE_HTTP_DOWN]: RescueState.SUSPECT,
  [FailureType.OPENCODE_AUTH_INVALID]: RescueState.DEGRADED,
  [FailureType.EVENT_STREAM_STALE]: RescueState.SUSPECT
};

/**
 * 验证状态跃迁是否合法
 * 
 * @param from 当前状态
 * @param to 目标状态
 * @returns 是否允许跃迁
 */
export function isValidStateTransition(from: RescueState, to: RescueState): boolean {
  const validTargets = VALID_STATE_TRANSITIONS[from];
  if (!validTargets) {
    return false;
  }
  return validTargets.includes(to);
}

/**
 * 状态跃迁验证器类
 * 
 * 提供带错误信息的跃迁验证
 */
export class StateTransitionValidator {
  private currentState: RescueState;

  constructor(initialState: RescueState = RescueState.HEALTHY) {
    if (!Object.values(RescueState).includes(initialState)) {
      throw new Error(`无效的初始状态：${initialState}`);
    }
    this.currentState = initialState;
  }

  /**
   * 尝试执行状态跃迁
   * 
   * @param nextState 目标状态
   * @returns 是否成功
   * @throws 当跃迁非法时抛出错误
   */
  transitionTo(nextState: RescueState): boolean {
    if (!isValidStateTransition(this.currentState, nextState)) {
      throw new Error(
        `非法的状态跃迁：${this.currentState} -> ${nextState}。` +
        `允许的跃迁：${VALID_STATE_TRANSITIONS[this.currentState].join(', ') || '无'}`
      );
    }
    this.currentState = nextState;
    return true;
  }

  /**
   * 检查跃迁是否合法（不执行实际跃迁）
   * 
   * @param nextState 目标状态
   * @returns 是否允许
   */
  canTransitionTo(nextState: RescueState): boolean {
    return isValidStateTransition(this.currentState, nextState);
  }

  /**
   * 获取当前状态
   */
  getState(): RescueState {
    return this.currentState;
  }

  /**
   * 重置状态
   */
  reset(initialState: RescueState = RescueState.HEALTHY): void {
    this.currentState = initialState;
  }
}

/**
 * 故障事件接口
 * 
 * 用于在系统内部传递故障信息
 */
export interface FailureEvent {
  /** 故障类型 */
  type: FailureType;
  /** 故障发生时间戳 */
  timestamp: number;
  /** 故障详细描述 */
  message: string;
  /** 相关错误对象（可选） */
  error?: Error;
  /** 附加上下文信息 */
  context?: Record<string, unknown>;
}

/**
 * 救援状态变更事件接口
 */
export interface StateChangeEvent {
  /** 变更前状态 */
  from: RescueState;
  /** 变更后状态 */
  to: RescueState;
  /** 变更原因 */
  reason: string;
  /** 变更时间戳 */
  timestamp: number;
}
