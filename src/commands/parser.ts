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
  | 'send';        // 发送文件到飞书

// 解析后的命令
export interface ParsedCommand {
  type: CommandType;
  text?: string;           // prompt类型的文本内容
  modelName?: string;      // model类型的模型名称
  agentName?: string;      // agent类型的名称
  roleAction?: 'create';
  roleSpec?: string;
  sessionAction?: 'new' | 'switch';
  sessionId?: string;      // session switch的目标ID
  sessionDirectory?: string; // session new 时指定的目录
  listAll?: boolean;
  projectAction?: 'list' | 'default_set' | 'default_clear' | 'default_show';
  projectValue?: string;
  clearScope?: 'all' | 'free_session'; // 清理范围
  clearSessionId?: string;
  permissionResponse?: 'y' | 'n' | 'yes' | 'no';
  commandName?: string;    // 透传命令名称
  commandArgs?: string;    // 透传命令参数
  commandPrefix?: '/' | '!'; // 透传命令前缀
  effortLevel?: EffortLevel;
  effortRaw?: string;
  effortReset?: boolean;
  promptEffort?: EffortLevel;
  adminAction?: 'add';
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
    return { type: 'send', text: sendFileMatch[1].trim() };
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
          // 无参数的 /session 直接等同于 /sessions（向后兼容）
          return { type: 'sessions', listAll: false };
        }
        if (args[0].toLowerCase() === 'new') {
          const sessionDirectory = args.slice(1).join(' ').trim();
          return {
            type: 'session',
            sessionAction: 'new',
            ...(sessionDirectory ? { sessionDirectory } : {}),
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
          return {
            type: 'clear',
            clearScope: 'free_session',
            ...(args[2] ? { clearSessionId: args[2] } : {}),
          };
        }
        if (args.length > 0 && args[0].toLowerCase() === 'free_session') {
          return {
            type: 'clear',
            clearScope: 'free_session',
            ...(args[1] ? { clearSessionId: args[1] } : {}),
          };
        }
        return { type: 'clear' };

      case 'clear_free_session':
      case 'clear-free-session':
        return {
          type: 'clear',
          clearScope: 'free_session',
          ...(args[0] ? { clearSessionId: args[0] } : {}),
        };

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

      case 'send':
      case 'send-file':
      case 'sendfile':
      case 'send_file':
        return { type: 'send', text: args.join(' ') };

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
首次私聊会自动完成会话绑定（标题：飞书私聊{OpenID去掉 ou_ 前缀后的前4位}），并推送建群卡片、帮助文档和 /panel 卡片。

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
• \`/create_chat\` 或 \`/建群\` 打开建群卡片（下拉按 工作区/Session短ID/简介 展示，支持跨工作区）
• \`/sessions\` 列出当前项目的会话
• \`/sessions all\` 列出所有项目的全部会话
• \`/session new\` 或 \`/session new <项目别名或绝对路径>\` 开启新话题 (重置上下文)
• \`/session <sessionId>\` 手动绑定已有会话（支持 Web 端会话，需开启 \`ENABLE_MANUAL_SESSION_BIND\`）
• \`新建会话窗口\` 自然语言触发 \`/session new\`
• \`/project list\` 列出可用项目（含别名与历史目录）
• \`/project default\` 查看当前群默认项目
• \`/project default set <项目名或路径>\` 设置当前群默认项目
• \`/project default clear\` 清除当前群默认项目
• \`/clear\` 清空当前上下文 (同上)
• \`/clear free session\` 或 \`/clear_free_session\` 清理所有空闲/无人群聊
• \`/clear free session <sessionId>\` 或 \`/clear_free_session <sessionId>\` 删除指定 OpenCode 会话并移除本地映射
• \`/status\` 查看连接状态

💡 **提示**
• 切换的模型/角色仅对**当前会话**生效。
• 强度优先级：\`#临时覆盖\` > \`/effort 会话默认\` > OpenCode 默认。
• 其他未知 \`/xxx\` 命令会自动透传给 OpenCode（会话已绑定时生效）。
• 支持透传白名单 shell 命令：\`!cd\`、\`!ls\`、\`!mkdir\`、\`!rm\`、\`!cp\`、\`!mv\`、\`!git\` 等；\`!vi\` / \`!vim\` / \`!nano\` 不会透传。
• 如果遇到问题，试着使用 \`/panel\` 面板操作更方便。

📤 **文件发送**
• \`/send <绝对路径>\` 直接发送文件到群聊 (e.g. \`/send /path/to/file.png\` 或 \`/send C:\\Users\\你\\Desktop\\图片.jpg\`)
• \`发送文件 <路径或描述>\` 中文自然语言触发（同上）`;
}
