/**
 * Bridge 进程管理器
 *
 * 支持两种模式：
 * 1. 内嵌模式（默认）：Bridge 逻辑在同一进程中运行，节省内存
 * 2. 子进程模式：Bridge 作为独立子进程运行，提供进程隔离
 */

import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface BridgeStatus {
  running: boolean;
  pid?: number;
  startedAt?: Date;
  exitCode?: number;
  exitReason?: string;
}

export type BridgeStatusCallback = (status: BridgeStatus) => void;

export class BridgeManager {
  private child: ChildProcess | null = null;
  private startedAt: Date | null = null;
  private statusCallbacks: Set<BridgeStatusCallback> = new Set();
  private autoRestart: boolean = true;
  private restarting: boolean = false;

  // 内嵌模式状态
  private embeddedMode: boolean = true;
  private embeddedStopFn: (() => Promise<void>) | null = null;

  constructor(embeddedMode: boolean = true) {
    this.embeddedMode = embeddedMode;
    // 监听进程退出事件
    process.on('exit', () => this.kill());
  }

  /**
   * 启动 Bridge（内嵌模式或子进程模式）
   */
  async start(): Promise<{ success: boolean; pid?: number; error?: string }> {
    if (this.child || this.embeddedStopFn) {
      return { success: false, error: 'Bridge 已在运行' };
    }

    if (this.embeddedMode) {
      return this.startEmbedded();
    } else {
      return this.startChildProcess();
    }
  }

  /**
   * 内嵌模式启动
   */
  private async startEmbedded(): Promise<{ success: boolean; pid?: number; error?: string }> {
    try {
      console.log('[BridgeManager] 内嵌模式启动 Bridge...');

      // 动态导入 Bridge 模块
      const { startBridge } = await import('../index.js');

      this.startedAt = new Date();
      const controller = await startBridge();
      this.embeddedStopFn = controller.stop;

      this.notifyStatusChange({
        running: true,
        pid: process.pid,
        startedAt: this.startedAt,
      });

      console.log(`[BridgeManager] Bridge 已在内嵌模式下启动 (PID=${process.pid})`);
      return { success: true, pid: process.pid };

    } catch (err: any) {
      console.error('[BridgeManager] 内嵌模式启动失败:', err);
      this.startedAt = null;
      return { success: false, error: err.message };
    }
  }

  /**
   * 子进程模式启动
   */
  private async startChildProcess(): Promise<{ success: boolean; pid?: number; error?: string }> {
    if (this.child && !this.restarting) {
      return { success: false, error: 'Bridge 进程已在运行' };
    }

    this.restarting = false;

    const bridgeEntry = path.resolve(__dirname, '../index.js');
    const isWindows = process.platform === 'win32';

    return new Promise((resolve) => {
      try {
        // Windows 下使用 pipe 而非 inherit，避免 I/O 流绑定问题导致子进程阻塞
        this.child = spawn(process.execPath, [bridgeEntry], {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
          windowsHide: isWindows,
          env: {
            ...process.env,
            BRIDGE_SPAWNED_BY_ADMIN: '1',
          },
        });

        this.startedAt = new Date();

        // 处理子进程 stdout 输出
        this.child.stdout?.on('data', (data) => {
          console.log(`[Bridge] ${data.toString().trim()}`);
        });

        // 处理子进程 stderr 输出
        this.child.stderr?.on('data', (data) => {
          console.error(`[Bridge Error] ${data.toString().trim()}`);
        });

        this.child.on('error', (err) => {
          console.error('[BridgeManager] Bridge 进程错误:', err);
          this.notifyStatusChange({
            running: false,
            exitReason: err.message,
          });
          this.child = null;
          this.startedAt = null;
        });

        this.child.on('exit', (code, signal) => {
          const wasRunning = this.child !== null;
          this.child = null;
          this.startedAt = null;

          const reason = signal ? `信号 ${signal}` : `退出码 ${code}`;
          console.log(`[BridgeManager] Bridge 进程已退出: ${reason}`);

          this.notifyStatusChange({
            running: false,
            exitCode: code ?? undefined,
            exitReason: reason,
          });

          // 自动重启（仅当非手动停止且非重启中）
          if (wasRunning && this.autoRestart && code !== 0 && !this.restarting) {
            console.log('[BridgeManager] 检测到异常退出，3 秒后自动重启...');
            setTimeout(() => this.start(), 3000);
          }
        });

        // 等待一小段时间确认进程启动成功
        setTimeout(() => {
          if (this.child && this.child.pid) {
            this.notifyStatusChange({ running: true, pid: this.child.pid, startedAt: this.startedAt! });
            resolve({ success: true, pid: this.child.pid });
          } else {
            resolve({ success: false, error: '进程启动后立即退出' });
          }
        }, 500);

      } catch (err: any) {
        console.error('[BridgeManager] 启动 Bridge 失败:', err);
        resolve({ success: false, error: err.message });
      }
    });
  }

  /**
   * 停止 Bridge
   */
  async stop(): Promise<{ success: boolean; error?: string }> {
    if (this.embeddedMode) {
      return this.stopEmbedded();
    } else {
      return this.stopChildProcess();
    }
  }

  /**
   * 内嵌模式停止
   */
  private async stopEmbedded(): Promise<{ success: boolean; error?: string }> {
    if (!this.embeddedStopFn) {
      return { success: true };
    }

    try {
      console.log('[BridgeManager] 正在停止内嵌模式 Bridge...');
      await this.embeddedStopFn();
      this.embeddedStopFn = null;
      this.startedAt = null;

      this.notifyStatusChange({ running: false });
      console.log('[BridgeManager] 内嵌模式 Bridge 已停止');
      return { success: true };

    } catch (err: any) {
      console.error('[BridgeManager] 停止内嵌模式 Bridge 失败:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * 子进程模式停止
   */
  private async stopChildProcess(): Promise<{ success: boolean; error?: string }> {
    if (!this.child) {
      return { success: true }; // 已经停止
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.child) {
          console.log('[BridgeManager] Bridge 未响应 SIGTERM，强制终止');
          this.child.kill('SIGKILL');
        }
      }, 5000);

      this.child!.on('exit', () => {
        clearTimeout(timeout);
        this.child = null;
        this.startedAt = null;
        this.notifyStatusChange({ running: false });
        resolve({ success: true });
      });

      console.log('[BridgeManager] 发送 SIGTERM 终止 Bridge');
      this.child!.kill('SIGTERM');
    });
  }

  /**
   * 重启 Bridge
   */
  async restart(): Promise<{ success: boolean; pid?: number; error?: string }> {
    console.log('[BridgeManager] 开始重启 Bridge...');
    this.restarting = true;
    this.autoRestart = false; // 重启过程中禁用自动重启

    await this.stop();

    // 等待 1 秒
    await new Promise(resolve => setTimeout(resolve, 1000));

    const result = await this.start();

    this.restarting = false;
    this.autoRestart = true;

    return result;
  }

  /**
   * 获取 Bridge 状态
   */
  getStatus(): BridgeStatus {
    if (this.embeddedMode) {
      if (this.embeddedStopFn) {
        return {
          running: true,
          pid: process.pid,
          startedAt: this.startedAt ?? undefined,
        };
      }
      return { running: false };
    }

    if (!this.child || !this.child.pid) {
      return { running: false };
    }

    return {
      running: true,
      pid: this.child.pid,
      startedAt: this.startedAt ?? undefined,
    };
  }

  /**
   * 订阅状态变化
   */
  onStatusChange(callback: BridgeStatusCallback): () => void {
    this.statusCallbacks.add(callback);
    return () => this.statusCallbacks.delete(callback);
  }

  /**
   * 设置自动重启
   */
  setAutoRestart(enabled: boolean): void {
    this.autoRestart = enabled;
  }

  /**
   * 终止 Bridge（强制）
   */
  kill(): void {
    if (this.embeddedMode) {
      // 内嵌模式下无法强制终止，只能调用停止函数
      if (this.embeddedStopFn) {
        this.autoRestart = false;
        this.embeddedStopFn().catch(() => {});
      }
    } else if (this.child) {
      this.autoRestart = false;
      this.child.kill('SIGTERM');
    }
  }

  private notifyStatusChange(status: BridgeStatus): void {
    for (const callback of this.statusCallbacks) {
      try {
        callback(status);
      } catch (err) {
        console.error('[BridgeManager] 状态回调错误:', err);
      }
    }
  }
}

// 默认使用内嵌模式
export const bridgeManager = new BridgeManager(true);