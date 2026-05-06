/**
 * WebSocket Terminal for OAuth Provider Login
 *
 * 提供WebSocket端点用于执行 opencode providers login 命令
 * 仅允许白名单命令，单连接超时10分钟
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, type ChildProcess } from 'node:child_process';

const CONNECTION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const COMMAND_WHITELIST = new Set([
  'opencode',
]);

// 允许的命令模式
const ALLOWED_PATTERNS = [
  /^opencode\s+providers\s+login(\s.*)?$/,
  /^opencode\s+providers\s+logout(\s.*)?$/,
  /^opencode\s+providers\s+list$/,
];

type TerminalSession = {
  ws: WebSocket;
  process: ChildProcess | null;
  timeout: NodeJS.Timeout;
  command: string | null;
};

const activeSessions = new Map<WebSocket, TerminalSession>();

/**
 * 检查命令是否在白名单中
 */
function isCommandAllowed(command: string): boolean {
  const trimmed = command.trim();
  for (const pattern of ALLOWED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }
  return false;
}

/**
 * 清理会话
 */
function cleanupSession(ws: WebSocket): void {
  const session = activeSessions.get(ws);
  if (!session) {
    return;
  }

  clearTimeout(session.timeout);

  if (session.process) {
    try {
      session.process.kill();
    } catch {
      // Ignore
    }
  }

  activeSessions.delete(ws);
}

/**
 * 设置会话超时
 */
function setupSessionTimeout(ws: WebSocket): void {
  const session = activeSessions.get(ws);
  if (!session) {
    return;
  }

  clearTimeout(session.timeout);
  session.timeout = setTimeout(() => {
    ws.send('\r\n\n⚠️  会话超时（10分钟），连接已关闭\r\n');
    ws.close();
  }, CONNECTION_TIMEOUT_MS);
}

/**
 * 执行命令
 */
function executeCommand(ws: WebSocket, command: string): void {
  const session = activeSessions.get(ws);
  if (!session) {
    ws.send('\r\n❌ 会话不存在\r\n');
    return;
  }

  if (!isCommandAllowed(command)) {
    ws.send(`\r\n❌ 命令不在白名单中: ${command}\r\n`);
    ws.send('允许的命令:\r\n');
    ws.send('  - opencode providers login [provider]\r\n');
    ws.send('  - opencode providers logout [provider]\r\n');
    ws.send('  - opencode providers list\r\n');
    ws.send('$ ');
    return;
  }

  // 停止之前的进程
  if (session.process) {
    try {
      session.process.kill();
    } catch {
      // Ignore
    }
  }

  const args = command.trim().split(/\s+/);
  const cmd = args[0];
  const cmdArgs = args.slice(1);

  ws.send(`\r\n$ ${command}\r\n`);

  try {
    const child = spawn(cmd, cmdArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
    });

    session.process = child;

    // 处理stdout
    child.stdout?.on('data', (data) => {
      const output = data.toString();
      ws.send(output);
    });

    // 处理stderr
    child.stderr?.on('data', (data) => {
      const output = data.toString();
      ws.send(output);
    });

    // 处理退出
    child.on('exit', (code) => {
      session.process = null;
      const exitMsg = code === 0
        ? '\r\n✓ 命令执行完成\r\n'
        : `\r\n❌ 命令退出，代码: ${code}\r\n`;
      ws.send(exitMsg);
      ws.send('$ ');
      setupSessionTimeout(ws);
    });

    child.on('error', (err) => {
      session.process = null;
      ws.send(`\r\n❌ 执行错误: ${err.message}\r\n`);
      ws.send('$ ');
      setupSessionTimeout(ws);
    });

  } catch (err) {
    ws.send(`\r\n❌ 启动进程失败: ${err}\r\n`);
    ws.send('$ ');
    setupSessionTimeout(ws);
  }
}

/**
 * 注册终端路由和WebSocket服务器
 */
export function registerResourcesTerminalRoutes(api: express.Router): void {
  // POST /api/resources/terminal/create - 创建终端会话
  api.post('/resources/terminal/create', async (_req, res) => {
    res.json({
      ok: true,
      message: 'WebSocket terminal available at WS endpoint',
      wsUrl: '/api/resources/terminal/ws',
    });
  });
}

/**
 * 设置WebSocket终端服务器
 */
export function setupResourcesTerminalWebSocket(httpServer: ReturnType<typeof createServer>): void {
  const wss = new WebSocketServer({
    noServer: true,
    path: '/api/resources/terminal/ws',
  });

  // 升级HTTP请求到WebSocket
  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

    if (pathname === '/api/resources/terminal/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws) => {
    console.log('[Resources Terminal] 新连接已建立');

    // 创建会话
    const session: TerminalSession = {
      ws,
      process: null,
      timeout: setTimeout(() => {
        ws.send('\r\n\n⚠️  会话超时（10分钟），连接已关闭\r\n');
        ws.close();
      }, CONNECTION_TIMEOUT_MS),
      command: null,
    };

    activeSessions.set(ws, session);

    // 发送欢迎消息
    ws.send(
      '\r\n' +
      '========================================\r\n' +
      '  OpenCode Bridge - OAuth Login Terminal\r\n' +
      '========================================\r\n' +
      '\r\n' +
      '允许的命令:\r\n' +
      '  - opencode providers login [provider]\r\n' +
      '  - opencode providers logout [provider]\r\n' +
      '  - opencode providers list\r\n' +
      '\r\n' +
      '注意: 会话将在10分钟后自动关闭\r\n' +
      '\r\n' +
      '$ '
    );

    // 处理消息
    ws.on('message', (data) => {
      const message = data.toString();
      const trimmed = message.trim();

      if (!trimmed) {
        return;
      }

      // 重置超时
      setupSessionTimeout(ws);

      // 执行命令
      executeCommand(ws, trimmed);
    });

    // 处理关闭
    ws.on('close', () => {
      console.log('[Resources Terminal] 连接已关闭');
      cleanupSession(ws);
    });

    // 处理错误
    ws.on('error', (err) => {
      console.error('[Resources Terminal] WebSocket错误:', err);
      cleanupSession(ws);
    });
  });

  console.log('[Resources Terminal] WebSocket服务器已就绪');
}
