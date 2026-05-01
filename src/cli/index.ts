/**
 * CLI 路由入口
 *
 * 调用关系：
 *   bin/opencode-bridge.js → dist/cli/index.js#run(argv)
 *
 * 子命令：
 *   <无>             智能入口（首次未配置 → TUI 向导；已配置 → 启动服务）
 *   init             强制进入 TUI 向导（重新配置）
 *   start            直接启动服务（绕过 TUI）
 *   help / --help    显示用法
 *   --version / -v   显示版本
 *
 * Electron 模式（process.versions.electron 存在 或 ELECTRON_RUN_AS_NODE=1）
 * 不会进入此入口，由 electron/main.ts 直接接管。
 */

import { VERSION } from '../utils/version.js';

function isElectronEnv(): boolean {
  return !!(process.versions as any).electron || process.env.ELECTRON_RUN_AS_NODE === '1';
}

function printHelp(): void {
  const lines = [
    `OpenCode Bridge v${VERSION}`,
    '',
    'Usage:',
    '  opencode-bridge                Start service (or run TUI wizard on first run)',
    '  opencode-bridge init           Re-run the interactive TUI wizard',
    '  opencode-bridge start          Start the bridge service (skip wizard)',
    '  opencode-bridge --version      Print version',
    '  opencode-bridge --help         Show this help',
    '',
    'Common flags:',
    '  --config-dir <path>            Override config directory (default: ./data)',
    '',
    'Docs: https://github.com/HNGM-HP/opencode-bridge#readme',
  ];
  console.log(lines.join('\n'));
}

function printVersion(): void {
  console.log(VERSION);
}

async function startServiceOnly(): Promise<void> {
  // 直接进入 main()
  const mod = await import('../index.js');
  await mod.startBridge();
  // startBridge 内部已注册 SIGINT/SIGTERM；此处返回后事件循环继续保活
}

async function runWizardThenMaybeStart(force: boolean): Promise<void> {
  const { runWizard } = await import('./tui-wizard.js');
  const result = await runWizard({ force });
  if (!result.startService) {
    // 用户选择仅退出 / 仅启动 web 但 web 模式我们仍会启动服务；
    // 因此走到这里基本是"保存配置但不启动桥接"
    if (!result.webStartedInWizard) {
      process.exit(0);
    }
    // 如果在向导里启动了 web 但选了"不启动桥接"，保留进程运行 web
    return;
  }
  await startServiceOnly();
}

export async function run(argv: string[]): Promise<void> {
  const sub = argv[0];

  if (sub === '--version' || sub === '-v') {
    printVersion();
    return;
  }
  if (sub === '--help' || sub === '-h' || sub === 'help') {
    printHelp();
    return;
  }
  if (sub === 'init') {
    await runWizardThenMaybeStart(true);
    return;
  }
  if (sub === 'start') {
    await startServiceOnly();
    return;
  }

  // 无子命令：智能入口
  // - Electron 内置（不应走到这里，但稳健起见保留）：直接启动服务
  // - 无头模式且未配置：TUI 向导
  // - 无头模式且已配置：直接启动服务
  if (isElectronEnv()) {
    await startServiceOnly();
    return;
  }

  // 检查是否是首次运行（无任何平台配置）
  let firstRun = true;
  try {
    const { hasAnyPlatformConfigured } = await import('./tui-wizard.js');
    firstRun = !hasAnyPlatformConfigured();
  } catch {
    firstRun = true;
  }

  if (firstRun) {
    await runWizardThenMaybeStart(false);
  } else {
    await startServiceOnly();
  }
}
