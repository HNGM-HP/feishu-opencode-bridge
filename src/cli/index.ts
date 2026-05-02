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
 *   bridge resource  资源管理子命令
 *   help / --help    显示用法
 *   --version / -v   显示版本
 *
 * Electron 模式（process.versions.electron 存在 或 ELECTRON_RUN_AS_NODE=1）
 * 不会进入此入口，由 electron/main.ts 直接接管。
 */

import { VERSION } from '../utils/version.js';

// Import resource commands
import {
  skillList,
  skillCreate,
  skillEdit,
  skillDelete,
  skillEnable,
  skillDisable,
} from './commands/resources.js';
import {
  mcpList,
  mcpAdd,
  mcpEdit,
  mcpDelete,
  mcpEnable,
  mcpDisable,
} from './commands/resources.js';
import {
  agentList,
  agentCreate,
  agentEdit,
  agentDelete,
} from './commands/resources.js';
import {
  modelProviders,
  modelSetKey,
  modelRemoveKey,
  modelModels,
  modelRefresh,
  modelLogin,
  modelLogout,
} from './commands/resources.js';

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
    '  opencode-bridge bridge resource <subcommand>  Manage resources',
    '  opencode-bridge --version      Print version',
    '  opencode-bridge --help         Show this help',
    '',
    'Resource Management:',
    '  opencode-bridge bridge resource skill list                     List all skills',
    '  opencode-bridge bridge resource skill create <name> [options]  Create new skill',
    '  opencode-bridge bridge resource skill edit <name>              Edit skill (opens editor)',
    '  opencode-bridge bridge resource skill delete <name>            Delete skill',
    '  opencode-bridge bridge resource skill enable <name>            Enable skill',
    '  opencode-bridge bridge resource skill disable <name>           Disable skill',
    '',
    '  opencode-bridge bridge resource mcp list                       List all MCP servers',
    '  opencode-bridge bridge resource mcp add <name> [options]       Add MCP server',
    '  opencode-bridge bridge resource mcp edit <name>                Edit MCP config',
    '  opencode-bridge bridge resource mcp delete <name>              Delete MCP server',
    '  opencode-bridge bridge resource mcp enable <name>              Enable MCP server',
    '  opencode-bridge bridge resource mcp disable <name>             Disable MCP server',
    '',
    '  opencode-bridge bridge resource agent list                     List all agents',
    '  opencode-bridge bridge resource agent create <name> [options]  Create agent',
    '  opencode-bridge bridge resource agent edit <name>              Edit agent',
    '  opencode-bridge bridge resource agent delete <name>            Delete agent',
    '',
    '  opencode-bridge bridge resource model providers                List model providers',
    '  opencode-bridge bridge resource model set-key <id> <key>       Set API key',
    '  opencode-bridge bridge resource model remove-key <id>          Remove API key',
    '  opencode-bridge bridge resource model models [provider]        Show models',
    '  opencode-bridge bridge resource model refresh                  Refresh models cache',
    '  opencode-bridge bridge resource model login <provider>         OAuth login (opens browser)',
    '  opencode-bridge bridge resource model logout <provider>        OAuth logout',
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

  // Handle "bridge resource" subcommands
  if (sub === 'bridge' && argv[1] === 'resource') {
    await handleResourceCommand(argv.slice(2));
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

/**
 * Handle "bridge resource" subcommands
 */
async function handleResourceCommand(args: string[]): Promise<void> {
  const resourceType = args[0];
  const action = args[1];
  const target = args[2];
  const rest = args.slice(3);

  try {
    // Skills
    if (resourceType === 'skill') {
      switch (action) {
        case 'list':
          await skillList();
          break;
        case 'create':
          if (!target) {
            console.error('Usage: bridge resource skill create <name> [options]');
            process.exit(1);
          }
          await skillCreate(target, parseOptions(rest));
          break;
        case 'edit':
          if (!target) {
            console.error('Usage: bridge resource skill edit <name>');
            process.exit(1);
          }
          await skillEdit(target, parseOptions(rest));
          break;
        case 'delete':
          if (!target) {
            console.error('Usage: bridge resource skill delete <name>');
            process.exit(1);
          }
          await skillDelete(target, parseOptions(rest));
          break;
        case 'enable':
          if (!target) {
            console.error('Usage: bridge resource skill enable <name>');
            process.exit(1);
          }
          await skillEnable(target, parseOptions(rest));
          break;
        case 'disable':
          if (!target) {
            console.error('Usage: bridge resource skill disable <name>');
            process.exit(1);
          }
          await skillDisable(target, parseOptions(rest));
          break;
        default:
          console.error(`Unknown skill action: ${action}`);
          printResourceHelp('skill');
          process.exit(1);
      }
      return;
    }

    // MCP
    if (resourceType === 'mcp') {
      switch (action) {
        case 'list':
          await mcpList();
          break;
        case 'add':
          if (!target) {
            console.error('Usage: bridge resource mcp add <name> [options]');
            process.exit(1);
          }
          await mcpAdd(target, parseMcpOptions(rest));
          break;
        case 'edit':
          if (!target) {
            console.error('Usage: bridge resource mcp edit <name>');
            process.exit(1);
          }
          await mcpEdit(target, parseOptions(rest));
          break;
        case 'delete':
          if (!target) {
            console.error('Usage: bridge resource mcp delete <name>');
            process.exit(1);
          }
          await mcpDelete(target, parseOptions(rest));
          break;
        case 'enable':
          if (!target) {
            console.error('Usage: bridge resource mcp enable <name>');
            process.exit(1);
          }
          await mcpEnable(target, parseOptions(rest));
          break;
        case 'disable':
          if (!target) {
            console.error('Usage: bridge resource mcp disable <name>');
            process.exit(1);
          }
          await mcpDisable(target, parseOptions(rest));
          break;
        default:
          console.error(`Unknown mcp action: ${action}`);
          printResourceHelp('mcp');
          process.exit(1);
      }
      return;
    }

    // Agents
    if (resourceType === 'agent') {
      switch (action) {
        case 'list':
          await agentList();
          break;
        case 'create':
          if (!target) {
            console.error('Usage: bridge resource agent create <name> [options]');
            process.exit(1);
          }
          await agentCreate(target, parseOptions(rest));
          break;
        case 'edit':
          if (!target) {
            console.error('Usage: bridge resource agent edit <name>');
            process.exit(1);
          }
          await agentEdit(target, parseOptions(rest));
          break;
        case 'delete':
          if (!target) {
            console.error('Usage: bridge resource agent delete <name>');
            process.exit(1);
          }
          await agentDelete(target, parseOptions(rest));
          break;
        default:
          console.error(`Unknown agent action: ${action}`);
          printResourceHelp('agent');
          process.exit(1);
      }
      return;
    }

    // Model/Providers
    if (resourceType === 'model') {
      switch (action) {
        case 'providers':
          await modelProviders();
          break;
        case 'set-key':
          if (!target || !rest[0]) {
            console.error('Usage: bridge resource model set-key <provider-id> <api-key>');
            process.exit(1);
          }
          await modelSetKey(target, rest[0]);
          break;
        case 'remove-key':
          if (!target) {
            console.error('Usage: bridge resource model remove-key <provider-id>');
            process.exit(1);
          }
          await modelRemoveKey(target);
          break;
        case 'models':
          await modelModels(target);
          break;
        case 'refresh':
          await modelRefresh();
          break;
        case 'login':
          if (!target) {
            console.error('Usage: bridge resource model login <provider-id>');
            process.exit(1);
          }
          await modelLogin(target);
          break;
        case 'logout':
          if (!target) {
            console.error('Usage: bridge resource model logout <provider-id>');
            process.exit(1);
          }
          await modelLogout(target);
          break;
        default:
          console.error(`Unknown model action: ${action}`);
          printResourceHelp('model');
          process.exit(1);
      }
      return;
    }

    console.error(`Unknown resource type: ${resourceType}`);
    printResourceHelp();
    process.exit(1);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Parse command-line options (e.g., --scope user --description "My skill")
 */
function parseOptions(args: string[]): Record<string, string | boolean> {
  const options: Record<string, string | boolean> = {};
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith('--')) {
        // Option with value
        options[key] = nextArg;
        i += 2;
      } else {
        // Flag without value
        options[key] = true;
        i += 1;
      }
    } else {
      i += 1;
    }
  }

  return options;
}

/**
 * Parse MCP-specific options with proper typing
 */
function parseMcpOptions(args: string[]): {
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  url?: string;
  scope?: string;
  description?: string;
  enabled?: boolean;
} {
  const options = parseOptions(args);

  // Check for required transport option
  const transport = options.transport;
  if (!transport || typeof transport !== 'string' || !['stdio', 'sse', 'http'].includes(transport)) {
    console.error('Error: --transport is required and must be one of: stdio, sse, http');
    process.exit(1);
  }

  return {
    transport: transport as 'stdio' | 'sse' | 'http',
    command: options.command as string | undefined,
    url: options.url as string | undefined,
    scope: options.scope as string | undefined,
    description: options.description as string | undefined,
    enabled: options.enabled as boolean | undefined,
  };
}

/**
 * Print help for resource subcommands
 */
function printResourceHelp(resourceType?: string): void {
  if (resourceType === 'skill') {
    console.log(`
Skill Management:
  bridge resource skill list                     List all skills
  bridge resource skill create <name> [options]  Create new skill
  bridge resource skill edit <name>              Edit skill (opens $EDITOR)
  bridge resource skill delete <name>            Delete skill
  bridge resource skill enable <name>            Enable skill
  bridge resource skill disable <name>           Disable skill

Options for create:
  --description <text>     Skill description
  --markdown <path>        Path to markdown file
  --scope <project|user>   Scope (default: project)
  --enabled                Enable on creation (default)
  --disabled               Disable on creation
`);
  } else if (resourceType === 'mcp') {
    console.log(`
MCP Server Management:
  bridge resource mcp list                       List all MCP servers
  bridge resource mcp add <name> [options]       Add MCP server
  bridge resource mcp edit <name>                Edit MCP config (opens $EDITOR)
  bridge resource mcp delete <name>              Delete MCP server
  bridge resource mcp enable <name>              Enable MCP server
  bridge resource mcp disable <name>             Disable MCP server

Options for add:
  --transport <stdio|sse|http>  Transport type (required)
  --command <cmd>               Command for stdio transport
  --url <url>                   URL for sse/http transport
  --description <text>          Server description
  --scope <project|user>        Scope (default: project)
  --enabled                     Enable on creation (default)
  --disabled                    Disable on creation
`);
  } else if (resourceType === 'agent') {
    console.log(`
Agent Management:
  bridge resource agent list                     List all agents
  bridge resource agent create <name> [options]  Create agent
  bridge resource agent edit <name>              Edit agent (opens $EDITOR)
  bridge resource agent delete <name>            Delete agent

Options for create:
  --description <text>     Agent description
  --mode <primary|subagent|all>  Agent mode
  --prompt <text>          System prompt
  --scope <project|user>   Scope (default: project)
  --enabled                Enable on creation (default)
  --disabled               Disable on creation
`);
  } else if (resourceType === 'model') {
    console.log(`
Model/Provider Management:
  bridge resource model providers                List all providers
  bridge resource model set-key <id> <key>       Set API key for provider
  bridge resource model remove-key <id>          Remove API key for provider
  bridge resource model models [provider]        Show models (all or by provider)
  bridge resource model refresh                  Refresh models cache from OpenCode
  bridge resource model login <provider>         OAuth login (opens browser)
  bridge resource model logout <provider>        OAuth logout
`);
  } else {
    console.log(`
Resource Management:
  bridge resource skill ...    Manage skills
  bridge resource mcp ...      Manage MCP servers
  bridge resource agent ...    Manage agents
  bridge resource model ...    Manage model providers

Use 'bridge resource <type> --help' for more details on each resource type.
`);
  }
}
