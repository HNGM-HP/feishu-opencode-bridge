/**
 * 跨平台开机自启管理
 *
 * - Windows：HKCU\Software\Microsoft\Windows\CurrentVersion\Run\OpenCode Bridge
 * - macOS：  ~/Library/LaunchAgents/com.opencode.bridge.plist
 * - Linux：  ~/.config/autostart/opencode-bridge.desktop
 *
 * 设计原则：
 * 1. 只写当前用户作用域，不需要管理员/root；
 * 2. 自启目标 = 当前可执行（Electron 打包后是 OpenCode Bridge.exe；
 *    源码部署时是 node + dist/index.js，这种场景不在 UI 自启范围内）；
 * 3. 失败立即抛错给上层 API 转 500，不静默吞错。
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const APP_NAME = 'OpenCode Bridge';
const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const REG_VALUE = APP_NAME;
const MAC_PLIST_LABEL = 'com.opencode.bridge';
const LINUX_DESKTOP_FILENAME = 'opencode-bridge.desktop';

/**
 * 当前进程是否运行在 Electron 打包后的可执行下。
 * 源码 / 后台部署没有可靠的「自启目标」，UI 应明确禁用。
 */
function detectExecutablePath(): string | null {
  const exec = process.execPath;
  if (!exec) return null;
  const lower = exec.toLowerCase();

  // 源码 / 全局 node：execPath 通常是 node 或 node.exe 本身，没有意义
  if (lower.endsWith(`${path.sep}node`) || lower.endsWith(`${path.sep}node.exe`)) {
    return null;
  }
  if (lower === 'node' || lower === 'node.exe') return null;

  return exec;
}

export function isAutoStartSupported(): boolean {
  return detectExecutablePath() !== null && ['win32', 'darwin', 'linux'].includes(process.platform);
}

// ─────────────────────────── Windows ───────────────────────────
function winQuery(): boolean {
  // 用 reg.exe 查询；非零退出码视为不存在
  const r = spawnSync('reg', ['query', REG_KEY, '/v', REG_VALUE], {
    windowsHide: true,
    encoding: 'utf-8',
  });
  return r.status === 0;
}

function winEnable(execPath: string): void {
  // 注意：注册表值需要带引号包裹路径
  const value = `"${execPath}"`;
  const r = spawnSync(
    'reg',
    ['add', REG_KEY, '/v', REG_VALUE, '/t', 'REG_SZ', '/d', value, '/f'],
    { windowsHide: true, encoding: 'utf-8' }
  );
  if (r.status !== 0) {
    throw new Error(`reg add 失败: ${r.stderr || r.stdout || `exit ${r.status}`}`);
  }
}

function winDisable(): void {
  const r = spawnSync('reg', ['delete', REG_KEY, '/v', REG_VALUE, '/f'], {
    windowsHide: true,
    encoding: 'utf-8',
  });
  // value 不存在也不算错
  if (r.status !== 0 && !/find|找不到|cannot find/i.test(r.stderr || '')) {
    throw new Error(`reg delete 失败: ${r.stderr || r.stdout || `exit ${r.status}`}`);
  }
}

// ──────────────────────────── macOS ─────────────────────────────
function macPlistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${MAC_PLIST_LABEL}.plist`);
}

function macQuery(): boolean {
  return fs.existsSync(macPlistPath());
}

function macEnable(execPath: string): void {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${MAC_PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${execPath}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`;
  const dir = path.dirname(macPlistPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(macPlistPath(), plist, 'utf-8');
  // 尝试 launchctl load；失败不抛（用户下次登录时仍会生效）
  try {
    execFileSync('launchctl', ['load', '-w', macPlistPath()], { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
}

function macDisable(): void {
  const file = macPlistPath();
  if (fs.existsSync(file)) {
    try {
      execFileSync('launchctl', ['unload', '-w', file], { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
    fs.rmSync(file, { force: true });
  }
}

// ──────────────────────────── Linux ─────────────────────────────
function linuxDesktopPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'autostart', LINUX_DESKTOP_FILENAME);
}

function linuxQuery(): boolean {
  return fs.existsSync(linuxDesktopPath());
}

function linuxEnable(execPath: string): void {
  const desktop = `[Desktop Entry]
Type=Application
Name=${APP_NAME}
Exec=${execPath}
X-GNOME-Autostart-enabled=true
NoDisplay=false
Terminal=false
`;
  const dir = path.dirname(linuxDesktopPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(linuxDesktopPath(), desktop, 'utf-8');
}

function linuxDisable(): void {
  const file = linuxDesktopPath();
  if (fs.existsSync(file)) {
    fs.rmSync(file, { force: true });
  }
}

// ──────────────────────────── Public ────────────────────────────
export function getAutoStart(): { enabled: boolean; supported: boolean; platform: NodeJS.Platform } {
  const supported = isAutoStartSupported();
  if (!supported) {
    return { enabled: false, supported: false, platform: process.platform };
  }
  let enabled = false;
  switch (process.platform) {
    case 'win32':
      enabled = winQuery();
      break;
    case 'darwin':
      enabled = macQuery();
      break;
    case 'linux':
      enabled = linuxQuery();
      break;
  }
  return { enabled, supported: true, platform: process.platform };
}

export function setAutoStart(enabled: boolean): void {
  const execPath = detectExecutablePath();
  if (!execPath) {
    throw new Error('当前运行模式（非打包二进制）不支持开机自启，请在 Electron 打包版本中配置。');
  }
  if (!['win32', 'darwin', 'linux'].includes(process.platform)) {
    throw new Error(`不支持的平台：${process.platform}`);
  }

  if (enabled) {
    if (process.platform === 'win32') winEnable(execPath);
    else if (process.platform === 'darwin') macEnable(execPath);
    else linuxEnable(execPath);
  } else {
    if (process.platform === 'win32') winDisable();
    else if (process.platform === 'darwin') macDisable();
    else linuxDisable();
  }
}
