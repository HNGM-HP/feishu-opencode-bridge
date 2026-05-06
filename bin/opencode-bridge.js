#!/usr/bin/env node

/**
 * opencode-bridge CLI 入口
 *
 * 职责（PR3）：
 * 1. 解析顶层标志（--config-dir 等）
 * 2. 设置 BRIDGE_CLI_MODE=1 抑制 dist/index.js 的自动 main()
 * 3. 委托给 dist/cli/index.js 路由各子命令（init / start / help / 默认）
 *
 * 注意：本脚本必须保持纯 ESM 且不依赖外部包，以便 npm install -g 后立即可用。
 */

import path from 'node:path';

const argv = process.argv.slice(2);
const passthroughArgs = [];
let configDir = '';

for (let index = 0; index < argv.length; index += 1) {
  const current = argv[index];
  if (current === '--config-dir') {
    configDir = argv[index + 1] || '';
    index += 1;
    continue;
  }

  if (current.startsWith('--config-dir=')) {
    configDir = current.slice('--config-dir='.length);
    continue;
  }

  passthroughArgs.push(current);
}

if (configDir) {
  process.env.OPENCODE_BRIDGE_CONFIG_DIR = path.resolve(configDir);
}

// 标记 CLI 模式：dist/index.js 见到此变量后不会自动调用 main()
// dist/cli/index.js 内会按子命令显式调用 startBridge() / runWizard()
process.env.BRIDGE_CLI_MODE = '1';

process.argv = [process.argv[0], process.argv[1], ...passthroughArgs];

const cli = await import('../dist/cli/index.js');
await cli.run(passthroughArgs);
