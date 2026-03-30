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
import { spawn, ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 后端服务进程
let backendProcess: ChildProcess | null = null;
// 托盘图标
let tray: Tray | null = null;

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
  const appPath = isDev ? path.resolve(__dirname, '..') : app.getAppPath();
  // 启动 Admin 独立进程，它会管理 Bridge 子进程
  const backendPath = path.join(appPath, 'dist/admin/index.js');

  const dataPath = getUserDataPath();
  console.log('[Electron] __dirname:', __dirname);
  console.log('[Electron] App path:', appPath);
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
    console.log(`[Backend] ${data.toString().trim()}`);
  });

  backendProcess.stderr?.on('data', (data) => {
    console.error(`[Backend Error] ${data.toString().trim()}`);
  });

  backendProcess.on('exit', (code) => {
    console.log(`[Backend] Exited with code ${code}`);
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
if (!gotTheLock) {
  console.log('[Electron] Another instance is already running, quitting...');
  app.quit();
} else {
  app.on('second-instance', () => {
    // 当运行第二个实例时，打开管理面板
    shell.openExternal(`http://localhost:${ADMIN_PORT}`);
  });

  // 应用就绪
  app.whenReady().then(async () => {
    // 启动后端服务
    startBackend();

    // 等待 Admin Server 就绪
    console.log('[Electron] Waiting for Admin Server...');
    const isReady = await waitForAdminServer(ADMIN_PORT);

    if (!isReady) {
      console.error('[Electron] Admin Server failed to start');
      // 服务启动失败时弹窗提示
      dialog.showMessageBox(null, {
        type: 'error',
        title: '服务启动失败',
        message: '管理面板服务未能正常启动，请检查日志。',
        buttons: ['确定'],
      });
    }

    // 创建托盘（始终创建，作为主要交互入口）
    createTray();

    // 开发模式下自动打开管理面板
    if (isDev) {
      console.log('[Electron] Development mode, auto-opening admin panel');
      shell.openExternal(`http://localhost:${ADMIN_PORT}`);
    } else {
      console.log('[Electron] Running in background, click tray to open admin panel');
    }

    // 检查更新（非开发模式）
    checkForUpdates();
  });
}

// 应用退出前清理
app.on('before-quit', () => {
  (app as any).isQuitting = true;
  stopBackend();
});