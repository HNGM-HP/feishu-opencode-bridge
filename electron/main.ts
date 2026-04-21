/**
 * Electron 主进程
 *
 * 职责：
 * - 启动后端服务（作为子进程）
 * - 系统托盘图标
 * - 自动更新检查
 *
 * 内存优化：
 * - 不创建 Electron 窗口，使用默认浏览器打开管理面板
 * - 后台运行，内存占用最小化
 */

import { app, Tray, Menu, nativeImage, shell, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 后端服务进程
let backendProcess: ChildProcess | null = null;
// 托盘图标
let tray: Tray | null = null;

// ---------------------------------------------------------------------------
// 日志落盘（修复：GUI 启动时 stdout/stderr 没地方看的问题）
// ---------------------------------------------------------------------------
// 所有 [Electron] / [Backend] / [Backend Error] / [Admin] 输出都会写入
// <userData>/logs/electron-main.log，并在进程崩溃、启动失败时保留足够上下文，
// 让用户无需命令行运行 exe 即可定位问题。
let logStream: fs.WriteStream | null = null;
let logFilePath = '';
// 保留最近的后端输出，弹窗时直接显示最后几行，省去翻日志的步骤
const recentBackendOutput: string[] = [];
const MAX_RECENT_LINES = 40;

// 日志轮转参数：单文件上限 1MB，保留 .1 / .2 共 3 份，总占用 ≤ 3MB
const LOG_MAX_BYTES = 1 * 1024 * 1024; // 1 MB
const LOG_BACKUPS   = 2;               // .1 和 .2，循环覆盖
let logBytesWritten = 0;               // 追踪当前文件本次累计写入量（近似值）

/** 将旧日志文件循环后移：.2 删除，.1→.2，当前→.1，重建当前 */
function rotateLogFile(): void {
  try { logStream?.end(); } catch { /* ignore */ }
  logStream = null;

  // 循环右移备份：先删最老的 .2，再逐级重命名
  for (let i = LOG_BACKUPS; i >= 1; i--) {
    const older = `${logFilePath}.${i}`;
    const newer = i === 1 ? logFilePath : `${logFilePath}.${i - 1}`;
    try { fs.unlinkSync(older); } catch { /* 不存在时忽略 */ }
    try { fs.renameSync(newer, older); } catch { /* 不存在时忽略 */ }
  }

  logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  logBytesWritten = 0;
}

function initFileLogger(): void {
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    logFilePath = path.join(logsDir, 'electron-main.log');

    // 启动时若当前文件已超限，立即轮转一次，避免带着上次的大文件继续追加
    try {
      const st = fs.statSync(logFilePath);
      if (st.size > LOG_MAX_BYTES) {
        // 临时创建 stream 指向旧文件，rotateLogFile 会关闭并移走它
        logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
        rotateLogFile();
      }
    } catch {
      // 文件不存在，忽略
    }

    if (!logStream) {
      logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    }

    const header = `\n===== OpenCode Bridge started at ${new Date().toISOString()} =====\n` +
      `pid=${process.pid} platform=${process.platform} electron=${process.versions.electron}\n` +
      `userData=${app.getPath('userData')}\n` +
      `execPath=${process.execPath}\n`;
    logStream.write(header);
    logBytesWritten += Buffer.byteLength(header);

    // 劫持 console 的四个常用方法，让任何 console.log/error 同时落盘
    const origLog = console.log.bind(console);
    const origErr = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    const origInfo = console.info.bind(console);

    const writeLine = (level: string, args: unknown[]) => {
      const line = `[${new Date().toISOString()}] [${level}] ` +
        args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n';
      try {
        // 运行时超限检测：写入前先检查，确保单次长会话也不会无限增长
        if (logBytesWritten + Buffer.byteLength(line) > LOG_MAX_BYTES) {
          rotateLogFile();
        }
        logStream?.write(line);
        logBytesWritten += Buffer.byteLength(line);
      } catch { /* ignore */ }
    };

    console.log = (...args: unknown[]) => { writeLine('log', args); origLog(...args); };
    console.error = (...args: unknown[]) => { writeLine('error', args); origErr(...args); };
    console.warn = (...args: unknown[]) => { writeLine('warn', args); origWarn(...args); };
    console.info = (...args: unknown[]) => { writeLine('info', args); origInfo(...args); };

    // 捕获未处理异常，否则主进程崩溃时用户只看到弹窗没有线索
    process.on('uncaughtException', (err) => {
      console.error('[Electron] uncaughtException:', err?.stack || err);
    });
    process.on('unhandledRejection', (reason) => {
      console.error('[Electron] unhandledRejection:', reason);
    });
  } catch (err) {
    // 日志系统自身失败不应该阻止主程序启动
    // eslint-disable-next-line no-console
    console.error('[Electron] Failed to init file logger:', err);
  }
}

function rememberBackendLine(line: string): void {
  recentBackendOutput.push(line);
  if (recentBackendOutput.length > MAX_RECENT_LINES) {
    recentBackendOutput.shift();
  }
}

// 开发模式检测
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// 后端服务端口（默认 3000，仅用于内部服务）
const BACKEND_PORT = parseInt(process.env.PORT || '3000', 10);
// Admin 管理面板端口（前端页面从这里加载）
const ADMIN_PORT = parseInt(process.env.ADMIN_PORT || '4098', 10);

// 获取用户数据目录
function getUserDataPath(): string {
  // 在打包后，使用 Electron 的 userData 目录
  // Windows: %APPDATA%/opencode-bridge
  // macOS: ~/Library/Application Support/opencode-bridge
  // Linux: ~/.config/opencode-bridge
  return app.getPath('userData');
}

/**
 * 启动后端服务（Admin 独立进程，管理 Bridge 子进程）
 */
function startBackend() {
  if (backendProcess) {
    return;
  }

  // 获取应用根目录
  // 打包后，extraResources 将 dist 复制到 app.asar 外的 app/dist/ 目录
  // 需要使用 process.resourcesPath 访问这些文件
  let backendPath: string;
  if (isDev) {
    backendPath = path.resolve(__dirname, '../dist/admin/index.js');
  } else {
    // macOS: /Applications/OpenCode Bridge.app/Contents/Resources/app/dist/admin/index.js
    // Windows: C:\Program Files\OpenCode Bridge\resources\app\dist\admin\index.js
    // Linux: /opt/opencode-bridge/resources/app/dist/admin/index.js
    backendPath = path.join(process.resourcesPath, 'app', 'dist', 'admin', 'index.js');
  }

  const dataPath = getUserDataPath();
  console.log('[Electron] __dirname:', __dirname);
  console.log('[Electron] isDev:', isDev);
  console.log('[Electron] process.resourcesPath:', process.resourcesPath);
  console.log('[Electron] App path:', app.getAppPath());
  console.log('[Electron] Data directory:', dataPath);
  console.log('[Electron] Starting backend from:', backendPath);

  backendProcess = spawn(process.execPath, [backendPath], {
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      ELECTRON_RUN_AS_NODE: '1',
      // 设置配置目录为用户数据目录
      OPENCODE_BRIDGE_CONFIG_DIR: dataPath,
      // 设置工作目录
      NODE_ENV: isDev ? 'development' : 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: dataPath, // 设置工作目录
  });

  backendProcess.stdout?.on('data', (data) => {
    const text = data.toString();
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      const formatted = `[Backend] ${line}`;
      rememberBackendLine(formatted);
      console.log(formatted);
    }
  });

  backendProcess.stderr?.on('data', (data) => {
    const text = data.toString();
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      const formatted = `[Backend Error] ${line}`;
      rememberBackendLine(formatted);
      console.error(formatted);
    }
  });

  // 关键：监听 spawn 自身的失败（exe 找不到、权限不足等），原代码会静默
  backendProcess.on('error', (err) => {
    const msg = `[Backend] spawn error: ${err?.stack || err}`;
    rememberBackendLine(msg);
    console.error(msg);
  });

  backendProcess.on('exit', (code, signal) => {
    const msg = `[Backend] Exited with code=${code} signal=${signal ?? 'null'}`;
    rememberBackendLine(msg);
    console.log(msg);
    backendProcess = null;
  });
}

/**
 * 停止后端服务
 */
function stopBackend() {
  if (backendProcess) {
    console.log('[Electron] Stopping backend...');
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

/**
 * 等待 Admin Server 就绪
 */
function waitForAdminServer(port: number, maxRetries = 30, interval = 500): Promise<boolean> {
  return new Promise((resolve) => {
    let retries = 0;

    const check = () => {
      const req = http.request({
        hostname: 'localhost',
        port,
        path: '/',
        method: 'GET',
        timeout: 1000,
      }, (res) => {
        if (res.statusCode === 200 || res.statusCode === 302) {
          console.log(`[Electron] Admin Server is ready (port ${port})`);
          resolve(true);
        } else {
          retry();
        }
      });

      req.on('error', () => retry());
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
      req.end();
    };

    const retry = () => {
      retries++;
      if (retries >= maxRetries) {
        console.error(`[Electron] Admin Server not ready after ${maxRetries} retries`);
        resolve(false);
      } else {
        setTimeout(check, interval);
      }
    };

    check();
  });
}

/**
 * 创建托盘图标
 */
function createTray() {
  const iconPath = isDev
    ? path.join(__dirname, '../assets/icon-256.png')
    : path.join(process.resourcesPath, 'app/assets/icon-256.png');

  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开管理面板',
      click: () => {
        shell.openExternal(`http://localhost:${ADMIN_PORT}`);
      },
    },
    { type: 'separator' },
    {
      label: '启动服务',
      click: () => {
        startBackend();
      },
    },
    {
      label: '停止服务',
      click: () => {
        stopBackend();
      },
    },
    {
      label: '重启服务',
      click: () => {
        stopBackend();
        setTimeout(() => startBackend(), 1000);
      },
    },
    {
      label: '打开数据目录',
      click: () => {
        shell.openPath(getUserDataPath());
      },
    },
    { type: 'separator' },
    {
      label: '重置管理密码',
      click: async () => {
        const result = await dialog.showMessageBox(null, {
          type: 'warning',
          title: '重置管理密码',
          message: '确定要重置管理密码吗？',
          detail: '重置后需要重新设置密码才能访问管理面板。\n密码文件位于数据目录中的 config.db。',
          buttons: ['确定重置', '取消'],
          defaultId: 1,
          cancelId: 1,
        });

        if (result.response === 0) {
          // 通过 HTTP API 重置密码
          try {
            const req = http.request({
              hostname: 'localhost',
              port: ADMIN_PORT,
              path: '/api/admin/reset-password',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
            }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                if (res.statusCode === 200) {
                  dialog.showMessageBox(null, {
                    type: 'info',
                    title: '密码已重置',
                    message: '管理密码已重置，请在浏览器中打开管理面板设置新密码。',
                    buttons: ['打开管理面板', '确定'],
                  }).then((result) => {
                    if (result.response === 0) {
                      shell.openExternal(`http://localhost:${ADMIN_PORT}`);
                    }
                  });
                } else {
                  dialog.showMessageBox(null, {
                    type: 'error',
                    title: '重置失败',
                    message: `密码重置失败: ${data || '请检查服务是否运行。'}`,
                    buttons: ['确定'],
                  });
                }
              });
            });
            req.on('error', (err) => {
              dialog.showMessageBox(null, {
                type: 'error',
                title: '重置失败',
                message: `无法连接到服务: ${err.message}`,
                buttons: ['确定'],
              });
            });
            req.end();
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : '密码重置操作失败。';
            dialog.showMessageBox(null, {
              type: 'error',
              title: '重置失败',
              message: errorMsg,
              buttons: ['确定'],
            });
          }
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        (app as any).isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('OpenCode Bridge');
  tray.setContextMenu(contextMenu);

  // 点击托盘图标打开管理面板
  tray.on('click', () => {
    shell.openExternal(`http://localhost:${ADMIN_PORT}`);
  });
}

/**
 * 检查更新（通过 GitHub Releases API）
 */
async function checkForUpdates() {
  if (isDev) {
    console.log('[Electron] Skipping update check in development mode');
    return;
  }

  const GITHUB_REPO = 'HNGM-HP/opencode-bridge';
  const currentVersion = app.getVersion();

  try {
    // 获取 GitHub 最新 Release
    const latestRelease = await fetchGitHubRelease(GITHUB_REPO);
    if (!latestRelease) {
      console.log('[Electron] No release found');
      return;
    }

    const latestVersion = latestRelease.tag_name.replace(/^v/, '');
    console.log(`[Electron] Current: ${currentVersion}, Latest: ${latestVersion}`);

    // 比较版本
    if (compareVersions(latestVersion, currentVersion) <= 0) {
      console.log('[Electron] Already up to date');
      return;
    }

    // 找到对应平台的下载文件
    const downloadUrl = getPlatformDownloadUrl(latestRelease, latestVersion);
    if (!downloadUrl) {
      console.error('[Electron] No suitable download found for platform');
      return;
    }

    // 提示用户下载
    const result = await dialog.showMessageBox(null, {
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 ${latestVersion}（当前 ${currentVersion}），是否前往下载？`,
      buttons: ['前往下载', '稍后提醒'],
      defaultId: 0,
    });

    if (result.response === 0) {
      shell.openExternal(downloadUrl);
    }
  } catch (error) {
    console.error('[Electron] Update check failed:', error);
  }
}

/**
 * 获取 GitHub 最新 Release 信息
 */
function fetchGitHubRelease(repo: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    https.get(url, {
      headers: { 'User-Agent': 'OpenCode-Bridge-Updater' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * 获取对应平台的下载 URL
 */
function getPlatformDownloadUrl(release: any, version: string): string | null {
  const platform = process.platform;
  const arch = process.arch;

  // 根据平台确定文件名模式
  let patterns: string[] = [];
  if (platform === 'win32') {
    patterns = [`OpenCode.Bridge.Setup-${version}.exe`];
  } else if (platform === 'darwin') {
    // macOS: arm64 或 x64
    if (arch === 'arm64') {
      patterns = [`OpenCode.Bridge-${version}-arm64.dmg`, `OpenCode.Bridge-${version}.dmg`];
    } else {
      patterns = [`OpenCode.Bridge-${version}-x64.dmg`, `OpenCode.Bridge-${version}.dmg`];
    }
  } else if (platform === 'linux') {
    patterns = [`OpenCode.Bridge-${version}.AppImage`];
  }

  // 从 release assets 中查找
  for (const pattern of patterns) {
    const asset = release.assets?.find((a: any) => a.name === pattern);
    if (asset) {
      return asset.browser_download_url;
    }
  }

  // 如果找不到精确匹配，尝试模糊匹配
  const fallbackPatterns: Record<string, RegExp[]> = {
    win32: [/OpenCode\.Bridge\.Setup.*\.exe$/],
    darwin: [/OpenCode\.Bridge.*\.dmg$/],
    linux: [/OpenCode\.Bridge.*\.AppImage$/],
  };

  for (const pattern of fallbackPatterns[platform] || []) {
    const asset = release.assets?.find((a: any) => pattern.test(a.name));
    if (asset) {
      return asset.browser_download_url;
    }
  }

  return null;
}

/**
 * 版本号比较（返回: 1 表示 a > b, -1 表示 a < b, 0 表示相等）
 */
function compareVersions(a: string, b: string): number {
  const parseVersion = (v: string) => {
    // 移除 beta/alpha 后缀，只比较数字部分
    const parts = v.split('-')[0].split('.');
    return parts.map(p => parseInt(p, 10) || 0);
  };

  const aParts = parseVersion(a);
  const bParts = parseVersion(b);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    if (aVal > bVal) return 1;
    if (aVal < bVal) return -1;
  }
  return 0;
}

// 单实例锁：防止多开
const gotTheLock = app.requestSingleInstanceLock();

async function killOldBridgeProcesses(): Promise<number[]> {
  // 使用 process-manager.mjs 终止旧的 Bridge 进程
  let scriptPath: string;
  if (isDev) {
    scriptPath = path.resolve(__dirname, '../scripts/process-manager.mjs');
  } else {
    // 打包后 scripts 在 resources/app/scripts/
    scriptPath = path.join(process.resourcesPath, 'app', 'scripts', 'process-manager.mjs');
  }
  console.log('[Electron] 脚本路径:', scriptPath);

  try {
    const result = spawnSync(process.execPath, [scriptPath, 'kill-bridge'], {
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true,
    });
    if (result.status === 0) {
      console.log('[Electron] 已终止旧 Bridge 进程');
      return [];
    }
    if (result.stderr) {
      console.error('[Electron] 终止脚本错误:', result.stderr);
    }
  } catch (e) {
    console.error('[Electron] 终止旧进程失败:', e);
  }
  return [];
}

/**
 * 处理单实例锁失败的情况（需要在 app ready 之后调用）
 */
async function handleSingleInstanceLockFailure() {
  const result = await dialog.showMessageBox(null, {
    type: 'warning',
    title: '程序已在运行',
    message: 'OpenCode Bridge 已在运行中，请勿重复启动。',
    detail: '同时运行多个实例可能导致数据冲突或端口冲突。\n建议：点击托盘图标打开管理面板。',
    buttons: ['强制终止旧进程并启动', '退出'],
    defaultId: 1,
    cancelId: 1,
  });

  if (result.response === 0) {
    // 用户选择强制终止旧进程
    console.log('[Electron] User chose to kill old process and start');

    // 先释放当前的请求，然后尝试终止旧进程
    // 注意：此时我们无法真正获取锁，因为旧进程还在运行
    // 需要先强制终止旧进程
    await killOldBridgeProcesses();

    // 等待一秒后重新尝试启动
    setTimeout(() => {
      // 重新启动当前实例（退出后再启动）
      app.relaunch();
      app.exit(0);
    }, 1000);
  } else {
    // 用户选择退出
    app.exit(0);
  }
}

// 应用就绪后处理初始化逻辑
app.whenReady().then(async () => {
  // 先初始化文件日志，这样下面任何输出都会落盘
  initFileLogger();

  // 检查单实例锁
  if (!gotTheLock) {
    // 检测到另一个实例正在运行，在 app ready 后弹窗提示
    console.log('[Electron] Another instance is already running');
    await handleSingleInstanceLockFailure();
    return;
  }

  app.on('second-instance', () => {
    // 当运行第二个实例时，打开管理面板
    shell.openExternal(`http://localhost:${ADMIN_PORT}`);
  });

  // 启动后端服务
  startBackend();

  // 等待 Admin Server 就绪
  console.log('[Electron] Waiting for Admin Server...');
  const isReady = await waitForAdminServer(ADMIN_PORT);

  if (!isReady) {
    console.error('[Electron] Admin Server failed to start');

    // 把最后几行后端输出拼进 detail，用户不用命令行也能看到原因
    const tail = recentBackendOutput.slice(-20).join('\n') || '(子进程没有任何输出，可能 spawn 本身就失败了)';
    const detail =
      `端口: ${ADMIN_PORT}\n` +
      `日志文件: ${logFilePath || '(未初始化)'}\n` +
      `数据目录: ${getUserDataPath()}\n` +
      `\n最近的后端输出：\n${tail}`;

    const result = await dialog.showMessageBox(null, {
      type: 'error',
      title: '服务启动失败',
      message: '管理面板服务未能正常启动。',
      detail,
      buttons: ['打开日志文件', '打开日志目录', '退出'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });

    if (result.response === 0 && logFilePath) {
      shell.openPath(logFilePath);
    } else if (result.response === 1) {
      shell.openPath(path.join(getUserDataPath(), 'logs'));
    } else {
      app.exit(1);
      return;
    }
  }

  // 创建托盘（始终创建，作为主要交互入口）
  createTray();

  // 无论开发模式还是生产模式，启动时都主动打开管理面板
  console.log('[Electron] Opening admin panel on startup');
  shell.openExternal(`http://localhost:${ADMIN_PORT}`);

  // 检查更新（非开发模式）
  checkForUpdates();
});

// 应用退出前清理
app.on('before-quit', () => {
  (app as any).isQuitting = true;
  stopBackend();
  try {
    logStream?.end(`===== OpenCode Bridge exited at ${new Date().toISOString()} =====\n`);
  } catch {
    // ignore
  }
});