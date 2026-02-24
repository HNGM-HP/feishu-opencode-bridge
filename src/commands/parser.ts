import { normalizeEffortLevel, stripPromptEffortPrefix, type EffortLevel } from './effort.js';

// 命令类型定义
export type CommandType =
  | 'prompt'       // 普通消息，发送给AI
  | 'stop'         // 中断执行
  | 'undo'         // 撤回上一步
  | 'compact'      // 压缩上下文
  | 'model'        // 切换模型
  | 'agent'        // 切换Agent
  | 'role'         // 角色相关操作
  | 'session'      // 会话操作
  | 'project'      // 项目/目录操作
  | 'sessions'     // 列出会话
  | 'clear'        // 清空对话
  | 'panel'        // 控制面板
  | 'effort'       // 调整推理强度
  | 'admin'        // 管理员设置
  | 'help'         // 显示帮助
  | 'status'       // 查看状态
  | 'command'      // 透传命令
  | 'permission'   // 权限响应
  | 'send_file'    // 发送文件到飞书
  | 'rename';      // 重命名当前会话

// 解析后的命令
export interface ParsedCommand {
  type: CommandType;
  text?: string;           // prompt类型的文本内容
  modelName?: string;      // model类型的模型名称
  agentName?: string;      // agent类型的名称
  roleAction?: 'create';
  roleSpec?: string;
  sessionAction?: 'new' | 'switch' | 'list';
  sessionId?: string;      // session switch的目标ID
  sessionDirectory?: string;
  sessionName?: string;    // session new --name 参数指定的会话名称
  listAll?: boolean;
  projectAction?: 'list' | 'default_set' | 'default_clear' | 'default_show';
  projectValue?: string;
  clearScope?: 'all' | 'free_session'; // 清理范围
  permissionResponse?: 'y' | 'n' | 'yes' | 'no';
  commandName?: string;    // 透传命令名称
  commandArgs?: string;    // 透传命令参数
  commandPrefix?: '/' | '!'; // 透传命令前缀
  effortLevel?: EffortLevel;
  effortRaw?: string;
  effortReset?: boolean;
  promptEffort?: EffortLevel;
  adminAction?: 'add';
  renameTitle?: string;    // rename 类型的新会话名称（可选，无参数时弹卡片）
}

const BANG_SHELL_ALLOWED_COMMANDS = new Set([
  'cd', 'ls', 'pwd', 'mkdir', 'rmdir',
  'touch', 'cp', 'mv', 'rm',
  'cat', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut',
  'grep', 'find', 'tree',
  'du', 'df', 'which', 'whereis', 'whoami',
  'ps', 'kill', 'date', 'echo', 'env', 'printenv',
  'chmod', 'chown', 'ln', 'stat',
  'tar', 'zip', 'unzip', 'gzip', 'gunzip',
  'git',
]);

const BANG_SHELL_BLOCKED_COMMANDS = new Set([
  'vi', 'vim', 'nvim', 'nano',
]);

// 命令解析器
function isSlashCommandToken(token: string): boolean {
  const normalized = token.trim();
  if (!normalized) {
    return false;
  }

  // 路径通常包含 / 或 \\，应当按普通文本处理
  if (normalized.includes('/') || normalized.includes('\\')) {
    return false;
  }

  // 仅允许常见命令字符：字母/数字/下划线/连字符/点/问号/中文
  return /^[\p{L}\p{N}_.?-]+$/u.test(normalized);
}

function parseBangShellCommand(trimmed: string): ParsedCommand | null {
  if (!trimmed.startsWith('!')) {
    return null;
  }

  const body = trimmed.slice(1).trimStart();
  if (!body || body.includes('\n')) {
    return null;
  }

  const parts = body.split(/\s+/);
  const first = parts[0]?.trim().toLowerCase() || '';
  if (!first) {
    return null;
  }

  // 路径/复杂 token（如 !/tmp/a.sh）按普通文本处理，避免误判
  if (!/^[a-z][a-z0-9._-]*$/i.test(first)) {
    return null;
  }

  if (BANG_SHELL_BLOCKED_COMMANDS.has(first)) {
    return null;
  }

  if (!BANG_SHELL_ALLOWED_COMMANDS.has(first)) {
    return null;
  }

  return {
    type: 'command',
    commandName: '!',
    commandArgs: body,
    commandPrefix: '!',
  };
}

export function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // ! 开头的 shell 透传（白名单）
  const bangCommand = parseBangShellCommand(trimmed);
  if (bangCommand) {
    return bangCommand;
  }

  // 中文自然语言创建角色（不带 /）
  const textRoleCreateMatch = trimmed.match(/^创建角色\s+([\s\S]+)$/);
  if (textRoleCreateMatch) {
    return {
      type: 'role',
      roleAction: 'create',
      roleSpec: textRoleCreateMatch[1].trim(),
    };
  }

  // 中文自然语言发送文件（不带 /）
  const sendFileMatch = trimmed.match(/^发送文件\s+([\s\S]+)$/);
  if (sendFileMatch) {
    return { type: 'send_file', text: sendFileMatch[1].trim() };
  }

  // 中文自然语言新建会话窗口（不带 /）
  if (trimmed === '新建会话窗口' || trimmed === '创建新会话') {
    return {
      type: 'session',
      sessionAction: 'new',
    };
  }

  // 权限响应（单独处理y/n）
  if (lower === 'y' || lower === 'yes') {
    return { type: 'permission', permissionResponse: 'y' };
  }
  if (lower === 'n' || lower === 'no') {
    return { type: 'permission', permissionResponse: 'n' };
  }

  // 斜杠命令
  if (trimmed.startsWith('/')) {
    const body = trimmed.slice(1).trimStart();
    if (!body) {
      return { type: 'prompt', text: trimmed };
    }

    const parts = body.split(/\s+/);
    if (!isSlashCommandToken(parts[0])) {
      return { type: 'prompt', text: trimmed };
    }

    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case 'stop':
      case 'abort':
      case 'cancel':
        return { type: 'stop' };

      case 'undo':
      case 'revert':
        return { type: 'undo' };

      case 'model':
        if (args.length > 0) {
          return { type: 'model', modelName: args.join(' ') };
        }
        return { type: 'model' }; // 无参数时显示当前模型

      case 'agent':
        if (args.length > 0) {
          return { type: 'agent', agentName: args.join(' ') };
        }
        return { type: 'agent' }; // 无参数时显示当前agent

      case 'role':
      case '角色': {
        if (args.length > 0 && (args[0].toLowerCase() === 'create' || args[0] === '创建')) {
          return {
            type: 'role',
            roleAction: 'create',
            roleSpec: args.slice(1).join(' ').trim(),
          };
        }
        return { type: 'role' };
      }

      case 'session':
        if (args.length === 0) {
          return { type: 'session', sessionAction: 'list' };
        }
        if (args[0].toLowerCase() === 'new') {
          const rest = args.slice(1);
          // 解析可选的 --name <名称> 参数
          let sessionName: string | undefined;
          const nameIndex = rest.findIndex(arg => arg.toLowerCase() === '--name');
          let remainingArgs = rest;
          if (nameIndex !== -1) {
            sessionName = rest.slice(nameIndex + 1).join(' ').trim() || undefined;
            remainingArgs = rest.slice(0, nameIndex);
          }
          const sessionDirectory = remainingArgs.join(' ').trim();
          return {
            type: 'session',
            sessionAction: 'new',
            ...(sessionDirectory ? { sessionDirectory } : {}),
            ...(sessionName ? { sessionName } : {}),
          };
        }
        // 切换到指定会话
        return { type: 'session', sessionAction: 'switch', sessionId: args[0] };

      case 'sessions':
      case 'list':
        return { type: 'sessions', listAll: args.length > 0 && args[0].toLowerCase() === 'all' };

      case 'project':
        if (args.length === 0) {
          return { type: 'project', projectAction: 'list' };
        }
        if (args[0].toLowerCase() === 'list') {
          return { type: 'project', projectAction: 'list' };
        }
        if (args[0].toLowerCase() === 'default') {
          if (args.length === 1) {
            return { type: 'project', projectAction: 'default_show' };
          }
          const action = args[1].toLowerCase();
          if (action === 'set') {
            const projectValue = args.slice(2).join(' ').trim();
            return {
              type: 'project',
              projectAction: 'default_set',
              ...(projectValue ? { projectValue } : {}),
            };
          }
          if (action === 'clear') {
            return { type: 'project', projectAction: 'default_clear' };
          }
          return { type: 'project', projectAction: 'default_show' };
        }
        return { type: 'project' };

      case 'clear':
      case 'reset':
        if (args.length > 0 && args[0].toLowerCase() === 'free' && args[1]?.toLowerCase() === 'session') {
          return { type: 'clear', clearScope: 'free_session' };
        }
        return { type: 'clear' };

      case 'panel':
      case 'controls':
        return { type: 'panel' };

      case 'effort':
      case 'strength': {
        if (args.length === 0) {
          return { type: 'effort' };
        }

        const rawEffort = args[0].trim();
        const normalized = rawEffort.toLowerCase();
        if (normalized === 'off' || normalized === 'reset' || normalized === 'default' || normalized === 'auto') {
          return { type: 'effort', effortReset: true };
        }

        const effort = normalizeEffortLevel(rawEffort);
        if (effort) {
          return { type: 'effort', effortLevel: effort };
        }

        return {
          type: 'effort',
          effortRaw: rawEffort,
        };
      }

      case 'fast':
        return { type: 'effort', effortLevel: 'low' };

      case 'balanced':
        return { type: 'effort', effortLevel: 'high' };

      case 'deep':
        return { type: 'effort', effortLevel: 'xhigh' };

      case 'make_admin':
      case 'add_admin':
        return { type: 'admin', adminAction: 'add' };

      case 'help':
      case 'h':
      case '?':
        return { type: 'help' };

      case 'status':
        return { type: 'status' };

      case 'compact':
      case 'session.compact':
        return { type: 'compact' };

      case 'send_file':
      case 'send-file':
      case 'sendfile':
        return { type: 'send_file', text: args.join(' ') };

      case 'rename': {
        const renameTitle = args.join(' ').trim();
        return {
          type: 'rename',
          ...(renameTitle ? { renameTitle } : {}),
        };
      }

      default:
        // 未知命令透传到OpenCode
        return {
          type: 'command',
          commandName: cmd,
          commandArgs: args.join(' '),
          commandPrefix: '/',
        };
    }
  }

  // 普通消息
  const promptResult = stripPromptEffortPrefix(trimmed);
  return {
    type: 'prompt',
    text: promptResult.text,
    ...(promptResult.effort ? { promptEffort: promptResult.effort } : {}),
  };
}

// 生成帮助文本
export function getHelpText(): string {
  return `📖 **飞书 × OpenCode 机器人指南**

💬 **如何对话**
群聊中 @机器人 或回复机器人消息，私聊中直接发送内容，即可与 AI 对话。

🪄 **私聊首次使用**
首次私聊会自动完成会话绑定（标题：私聊-MM-DD-HH-MM），并推送建群卡片、帮助文档和 /panel 卡片。

🛠️ **常用命令**
• \`/model\` 查看当前模型
• \`/model <名称>\` 切换模型 (e.g. \`/model gpt-4\`)
• \`/agent\` 查看当前角色
• \`/agent <名称>\` 切换角色 (e.g. \`/agent general\`)
• \`/agent off\` 切回默认角色
• \`/effort\` 查看当前强度
• \`/effort <档位>\` 设置会话默认强度 (e.g. \`/effort high\`)
• \`/effort default\` 清除会话强度，恢复模型默认
• \`#xhigh 帮我深度分析这段代码\` 仅当前消息临时覆盖强度
• \`创建角色 名称=旅行助手; 描述=帮我做行程规划; 类型=主; 工具=webfetch\` 新建自定义角色
• \`/panel\` 推送交互式控制面板卡片 ✨
• \`/undo\` 撤回上一轮对话 (如果你发错或 AI 答错)
• \`/stop\` 停止当前正在生成的回答
• \`/compact\` 压缩当前会话上下文（调用 OpenCode summarize）

⚙️ **会话管理**
• \`/session\` 或 \`/sessions\` 列出当前项目的会话；\`/sessions all\` 列出全部项目
• \`/session new\` 开启新话题（重置上下文）；\`/session new <别名或路径>\` 指定项目
• \`/session new --name <名称>\` 创建时直接命名 (e.g. \`/session new --name 技术架构评审\`)
• \`/rename <新名称>\` 随时重命名当前会话 (e.g. \`/rename Q3后端API设计讨论\`)
• \`/session <sessionId>\` 手动绑定已有会话（需开启 \`ENABLE_MANUAL_SESSION_BIND\`）
• \`/create_chat\` 或 \`/建群\` 私聊中调出建群卡片（新建或绑定已有会话）
• \`/project list\` 列出可用项目；\`/project default\` 查看/设置/清除群默认项目
• \`/clear\` 等价 \`/session new\`；\`/clear free session\` 清理空闲群聊
• \`/status\` 查看当前绑定状态和群聊生命周期信息

🧹 **群聊生命周期**
• 空群（仅剩机器人）默认有 24 小时宽限期，之后自动解散
• 可通过环境变量 \`EMPTY_CHAT_RETENTION_MS\` 调整：
  - \`0\` = 立即解散
  - \`-1\` = 永不自动解散
  - 正数 = 宽限期毫秒数（默认 86400000 = 24小时）

💡 **提示**
• 切换的模型/角色仅对**当前会话**生效。
• 强度优先级：\`#临时覆盖\` > \`/effort 会话默认\` > OpenCode 默认。
• 其他未知 \`/xxx\` 命令会自动透传给 OpenCode（会话已绑定时生效）。
• 支持透传白名单 shell 命令：\`!cd\`、\`!ls\`、\`!mkdir\`、\`!rm\`、\`!cp\`、\`!mv\`、\`!git\` 等；\`!vi\` / \`!vim\` / \`!nano\` 不会透传。
• 如果遇到问题，试着使用 \`/panel\` 面板操作更方便。

📤 **文件发送**
• \`/send_file <路径>\` 直接发送文件到群聊 (e.g. \`/send_file /path/to/file.png\`)
• \`/send_file <描述>\` 让 AI 搜索文件后发送 (e.g. \`/send_file 刚才生成的截图\`)
• \`发送文件 <路径或描述>\` 中文自然语言触发（同上）`;
}
