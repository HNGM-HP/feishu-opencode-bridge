// 命令类型定义
export type CommandType =
  | 'prompt'       // 普通消息，发送给AI
  | 'stop'         // 中断执行
  | 'undo'         // 撤回上一步
  | 'model'        // 切换模型
  | 'agent'        // 切换Agent
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
  return `📖 **飞书 × OpenCode 机器人命令**

**消息发送**
直接输入文字即可发送给AI

**控制命令**
/stop - 中断当前执行
/undo - 撤回上一轮（包括您的提问和AI的回复）
/model - 查看可用模型列表 /model <name> - 切换当前会话模型
/agent - 查看可用Agent列表 /agent <name> - 切换当前会话Agent
/panel - 打开控制面板 (需前端支持)

**会话管理**
/session new - 创建新对话 (重置上下文)
/clear - 清空当前对话上下文

**其他**
/status - 查看当前连接状态
/help - 显示此帮助

**注意**
- 切换模型/Agent 仅对当前会话生效
- 撤回消息需要机器人拥有管理员权限`;
}
