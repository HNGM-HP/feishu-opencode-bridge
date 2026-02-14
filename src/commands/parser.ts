// 命令类型定义
export type CommandType =
  | 'prompt'       // 普通消息，发送给AI
  | 'stop'         // 中断执行
  | 'undo'         // 撤回上一步
  | 'model'        // 切换模型
  | 'agent'        // 切换Agent
  | 'role'         // 角色相关操作
  | 'session'      // 会话操作
  | 'sessions'     // 列出会话
  | 'clear'        // 清空对话
  | 'panel'        // 控制面板
  | 'admin'        // 管理员设置
  | 'help'         // 显示帮助
  | 'status'       // 查看状态
  | 'command'      // 透传命令
  | 'permission';  // 权限响应

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
  clearScope?: 'all' | 'free_session'; // 清理范围
  permissionResponse?: 'y' | 'n' | 'yes' | 'no';
  commandName?: string;    // 透传命令名称
  commandArgs?: string;    // 透传命令参数
  adminAction?: 'add';
}

// 命令解析器
export function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // 中文自然语言创建角色（不带 /）
  const textRoleCreateMatch = trimmed.match(/^创建角色\s+([\s\S]+)$/);
  if (textRoleCreateMatch) {
    return {
      type: 'role',
      roleAction: 'create',
      roleSpec: textRoleCreateMatch[1].trim(),
    };
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
    const parts = trimmed.slice(1).split(/\s+/);
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
          return { type: 'session', sessionAction: 'new' };
        }
        // 切换到指定会话
        return { type: 'session', sessionAction: 'switch', sessionId: args[0] };

      case 'sessions':
      case 'list':
        return { type: 'sessions' };

      case 'clear':
      case 'reset':
        if (args.length > 0 && args[0].toLowerCase() === 'free' && args[1]?.toLowerCase() === 'session') {
          return { type: 'clear', clearScope: 'free_session' };
        }
        return { type: 'clear' };

      case 'panel':
      case 'controls':
        return { type: 'panel' };

      case 'make_admin':
      case 'add_admin':
        return { type: 'admin', adminAction: 'add' };

      case 'help':
      case 'h':
      case '?':
        return { type: 'help' };

      case 'status':
        return { type: 'status' };

      default:
        // 未知命令透传到OpenCode
        return {
          type: 'command',
          commandName: cmd,
          commandArgs: args.join(' '),
        };
    }
  }

  // 普通消息
  return { type: 'prompt', text: trimmed };
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
• \`创建角色 名称=旅行助手; 描述=帮我做行程规划; 类型=主; 工具=webfetch\` 新建自定义角色
• \`/panel\` 推送交互式控制面板卡片 ✨
• \`/undo\` 撤回上一轮对话 (如果你发错或 AI 答错)
• \`/stop\` 停止当前正在生成的回答
• \`/compact\` 压缩当前会话上下文（透传 OpenCode）

⚙️ **会话管理**
• \`/create_chat\` 或 \`/建群\` 打开建群卡片（下拉选择新建或绑定已有会话）
• \`/session new\` 开启新话题 (重置上下文)
• \`/session <sessionId>\` 手动绑定已有会话（需开启 \`ENABLE_MANUAL_SESSION_BIND\`）
• \`新建会话窗口\` 自然语言触发 \`/session new\`
• \`/clear\` 清空当前上下文 (同上)
• \`/clear free session\` 清理所有空闲/无人群聊
• \`/status\` 查看连接状态

💡 **提示**
• 切换的模型/角色仅对**当前会话**生效。
• 其他未知 \`/xxx\` 命令会自动透传给 OpenCode（会话已绑定时生效）。
• 如果遇到问题，试着使用 \`/panel\` 面板操作更方便。`;
}
