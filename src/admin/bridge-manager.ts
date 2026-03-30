/**
 * Bridge 进程管理器
 *
 * 职责：
 * 1. spawn/kill/restart Bridge 子进程
 * 2. 监控 Bridge 进程状态
 * 3. 处理 Bridge 进程退出/崩溃
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

  constructor() {
    // 监听进程退出事件
    process.on('exit', () => this.kill());
  }

  /**
   * 启动 Bridge 进程
   */
  async start(): Promise<{ success: boolean; pid?: number; error?: string }> {
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
   * 停止 Bridge 进程
   */
  async stop(): Promise<{ success: boolean; error?: string }> {
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
   * 重启 Bridge 进程
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
   * 终止 Bridge 进程（强制）
   */
  kill(): void {
    if (this.child) {
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

export const bridgeManager = new BridgeManager();