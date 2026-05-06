import crypto from 'node:crypto';
import express from 'express';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Response } from 'express';
import { getWorkspaceDirectoryInput, resolveWorkspaceDirectory } from './workspace-utils.js';

const COMMAND_TIMEOUT_MS = 120_000;
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
const CWD_PREFIX = '__OPENCODE_BRIDGE_CWD__';
const EXIT_PREFIX = '__OPENCODE_BRIDGE_EXIT__';
const BOOTSTRAP_PREFIX = '__OPENCODE_BRIDGE_BOOTSTRAP__';

type PendingCommand = {
  id: string;
  stdout: string;
  stderr: string;
  resolve: (result: { ok: boolean; exitCode: number; stdout: string; stderr: string; cwd: string }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type TerminalSession = {
  id: string;
  directory: string;
  currentDirectory: string;
  shellLabel: string;
  process: ChildProcessWithoutNullStreams;
  pending: PendingCommand | null;
  ready: Promise<void>;
  readyResolve: () => void;
  readyReject: (error: Error) => void;
  bootstrapId: string;
  bootstrapStdout: string;
  bootstrapStderr: string;
  bootstrapPending: boolean;
  lastUsedAt: number;
};

function sendTerminalError(res: Response, error: unknown, fallbackMessage: string, status = 502): void {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`[Workspace Terminal] ${fallbackMessage}:`, error);
  res.status(status).json({ error: message || fallbackMessage });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeOutput(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function getShellConfig(): { shell: string; args: string[]; label: string } {
  if (process.platform === 'win32') {
    return {
      shell: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-Command', '-'],
      label: 'powershell',
    };
  }

  return {
    shell: '/bin/bash',
    args: ['-l'],
    label: 'bash',
  };
}

function buildBootstrapCommand(bootstrapId: string): string | null {
  if (process.platform === 'win32') {
    return null;
  }

  return `export PS1='\\$ '
shopt -s expand_aliases >/dev/null 2>&1 || true
for __ocb_file in /etc/bash.bashrc /etc/bashrc "$HOME/.bashrc" "$HOME/.bash_aliases"; do
  [ -f "$__ocb_file" ] || continue
  . "$__ocb_file" >/dev/null 2>&1 || true
done
alias ll >/dev/null 2>&1 || alias ll='ls -alF'
alias la >/dev/null 2>&1 || alias la='ls -A'
alias l >/dev/null 2>&1 || alias l='ls -CF'
printf '%s%s__ready\n' '${BOOTSTRAP_PREFIX}' '${bootstrapId}'
`;
}

function buildWrappedCommand(commandId: string, command: string): string {
  if (process.platform === 'win32') {
    return `${command}
$__ocb_status = if ($?) { 0 } elseif ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 1 }
Write-Output "${CWD_PREFIX}${commandId}__$((Get-Location).Path)"
Write-Output "${EXIT_PREFIX}${commandId}__$__ocb_status"
`;
  }

  return `${command}
__ocb_status=$?
printf '%s%s__%s\n' '${CWD_PREFIX}' '${commandId}' "$PWD"
printf '%s%s__%s\n' '${EXIT_PREFIX}' '${commandId}' "$__ocb_status"
`;
}

class WorkspaceTerminalManager {
  private readonly sessions = new Map<string, TerminalSession>();

  constructor() {
    const cleanupTimer = setInterval(() => this.cleanupIdleSessions(), 5 * 60 * 1000);
    cleanupTimer.unref?.();
  }

  open(directory: string): { sessionId: string; shell: string; cwd: string } {
    const { shell, args, label } = getShellConfig();
    const childProcess = spawn(shell, args, {
      cwd: directory,
      env: {
        ...process.env,
        TERM: process.env.TERM || 'xterm-256color',
      },
      stdio: 'pipe',
      windowsHide: true,
    });

    const sessionId = crypto.randomUUID();
    const bootstrapId = crypto.randomUUID();
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const session: TerminalSession = {
      id: sessionId,
      directory,
      currentDirectory: directory,
      shellLabel: label,
      process: childProcess,
      pending: null,
      ready,
      readyResolve,
      readyReject,
      bootstrapId,
      bootstrapStdout: '',
      bootstrapStderr: '',
      bootstrapPending: process.platform !== 'win32',
      lastUsedAt: Date.now(),
    };

    childProcess.stdout.setEncoding('utf8');
    childProcess.stderr.setEncoding('utf8');

    childProcess.stdout.on('data', chunk => {
      this.handleStdout(session, String(chunk));
    });

    childProcess.stderr.on('data', chunk => {
      this.handleStderr(session, String(chunk));
    });

    childProcess.on('error', error => {
      this.failSession(session.id, error instanceof Error ? error : new Error(String(error)));
    });

    childProcess.on('exit', (code, signal) => {
      const reason = code !== null
        ? `shell 已退出（exit code ${code}）`
        : `shell 已退出（signal ${signal || 'unknown'}）`;
      this.failSession(session.id, new Error(reason));
    });

    this.sessions.set(sessionId, session);
    this.startBootstrap(session);
    return {
      sessionId,
      shell: label,
      cwd: directory,
    };
  }

  async execute(sessionId: string, command: string): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string; cwd: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('终端会话不存在或已关闭');
    }

    await session.ready;

    if (session.pending) {
      throw new Error('终端正在执行上一条命令，请稍后再试');
    }

    const trimmed = command.trim();
    if (!trimmed) {
      throw new Error('缺少命令');
    }

    session.lastUsedAt = Date.now();

    return new Promise((resolve, reject) => {
      const commandId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        this.failSession(sessionId, new Error(`命令执行超时（${COMMAND_TIMEOUT_MS / 1000} 秒），已关闭当前终端会话`));
      }, COMMAND_TIMEOUT_MS);

      session.pending = {
        id: commandId,
        stdout: '',
        stderr: '',
        resolve,
        reject,
        timeout,
      };

      session.process.stdin.write(buildWrappedCommand(commandId, command));
    });
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const pending = session.pending;
    if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('终端会话已关闭'));
      session.pending = null;
    }

    session.process.kill();
    this.sessions.delete(sessionId);
  }

  private cleanupIdleSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastUsedAt > SESSION_IDLE_TTL_MS) {
        this.close(sessionId);
      }
    }
  }

  private handleStdout(session: TerminalSession, chunk: string): void {
    if (session.bootstrapPending) {
      session.bootstrapStdout += chunk;
      const marker = `${BOOTSTRAP_PREFIX}${session.bootstrapId}__ready`;
      const markerIndex = session.bootstrapStdout.indexOf(marker);
      if (markerIndex >= 0) {
        session.bootstrapPending = false;
        session.bootstrapStdout = session.bootstrapStdout.slice(markerIndex + marker.length);
        session.readyResolve();
      }
      return;
    }

    const pending = session.pending;
    if (!pending) {
      return;
    }

    pending.stdout += chunk;
    const parsed = this.tryExtractCommandResult(pending.stdout, pending.id, session.currentDirectory);
    if (!parsed) {
      return;
    }

    pending.stdout = parsed.remainder;
    session.currentDirectory = parsed.cwd;
    session.lastUsedAt = Date.now();
    this.resolvePending(session, {
      ok: true,
      exitCode: parsed.exitCode,
      stdout: parsed.stdout,
      stderr: normalizeOutput(pending.stderr),
      cwd: parsed.cwd,
    });
  }

  private handleStderr(session: TerminalSession, chunk: string): void {
    if (session.bootstrapPending) {
      session.bootstrapStderr += chunk;
      return;
    }

    if (!session.pending) {
      return;
    }

    session.pending.stderr += chunk;
  }

  private tryExtractCommandResult(
    rawStdout: string,
    commandId: string,
    fallbackCwd: string
  ): { exitCode: number; stdout: string; cwd: string; remainder: string } | null {
    const exitPattern = new RegExp(`${escapeRegExp(EXIT_PREFIX)}${escapeRegExp(commandId)}__(-?\\d+)(?:\\r?\\n|$)`);
    const exitMatch = exitPattern.exec(rawStdout);
    if (!exitMatch) {
      return null;
    }

    const exitEnd = exitMatch.index + exitMatch[0].length;
    const relevantOutput = rawStdout.slice(0, exitEnd);
    const remainder = rawStdout.slice(exitEnd);

    const cwdPattern = new RegExp(`${escapeRegExp(CWD_PREFIX)}${escapeRegExp(commandId)}__(.*?)(?:\\r?\\n|$)`);
    const cwdMatch = cwdPattern.exec(relevantOutput);
    const cwd = cwdMatch?.[1]?.trim() || fallbackCwd;
    const stdout = normalizeOutput(
      relevantOutput
        .replace(cwdPattern, '')
        .replace(exitPattern, '')
    ).replace(/^\n+/, '');

    return {
      exitCode: Number.parseInt(exitMatch[1], 10) || 0,
      stdout,
      cwd,
      remainder,
    };
  }

  private resolvePending(
    session: TerminalSession,
    result: { ok: boolean; exitCode: number; stdout: string; stderr: string; cwd: string }
  ): void {
    const pending = session.pending;
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    session.pending = null;
    pending.resolve(result);
  }

  private failSession(sessionId: string, error: Error): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.bootstrapPending) {
      session.bootstrapPending = false;
      session.readyReject(error);
    }

    const pending = session.pending;
    if (pending) {
      clearTimeout(pending.timeout);
      session.pending = null;
      pending.reject(error);
    }

    session.process.kill();
    this.sessions.delete(sessionId);
  }

  private startBootstrap(session: TerminalSession): void {
    const bootstrapCommand = buildBootstrapCommand(session.bootstrapId);
    if (!bootstrapCommand) {
      session.bootstrapPending = false;
      session.readyResolve();
      return;
    }

    session.process.stdin.write(bootstrapCommand, error => {
      if (error) {
        this.failSession(session.id, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

const terminalManager = new WorkspaceTerminalManager();

export function registerWorkspaceTerminalRoutes(api: express.Router): void {
  api.post('/workspace/terminal/open', async (req, res) => {
    const resolvedDirectory = resolveWorkspaceDirectory(getWorkspaceDirectoryInput(req));
    if (!resolvedDirectory.ok) {
      res.status(resolvedDirectory.status).json({ error: resolvedDirectory.error });
      return;
    }

    try {
      const session = terminalManager.open(resolvedDirectory.directory);
      res.json({
        ok: true,
        sessionId: session.sessionId,
        shell: session.shell,
        cwd: session.cwd,
      });
    } catch (error) {
      sendTerminalError(res, error, '创建终端会话失败');
    }
  });

  api.post('/workspace/terminal/execute', async (req, res) => {
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
    const command = typeof req.body?.command === 'string' ? req.body.command : '';

    if (!sessionId) {
      res.status(400).json({ error: '缺少 sessionId' });
      return;
    }

    if (!command.trim()) {
      res.status(400).json({ error: '缺少命令' });
      return;
    }

    try {
      const result = await terminalManager.execute(sessionId, command);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '命令执行失败';
      const status = /不存在|已关闭/.test(message) ? 404 : message.includes('上一条命令') ? 409 : 502;
      sendTerminalError(res, error, '命令执行失败', status);
    }
  });

  api.post('/workspace/terminal/close', async (req, res) => {
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
    if (!sessionId) {
      res.status(400).json({ error: '缺少 sessionId' });
      return;
    }

    terminalManager.close(sessionId);
    res.json({ ok: true });
  });
}
