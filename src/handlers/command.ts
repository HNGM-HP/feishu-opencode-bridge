import { type ParsedCommand, getHelpText } from '../commands/parser.js';
import { feishuClient } from '../feishu/client.js';
import { opencodeClient } from '../opencode/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { buildControlCard, buildStatusCard } from '../feishu/cards.js';
import { modelConfig } from '../config.js';

export class CommandHandler {
  async handle(
    command: ParsedCommand,
    context: {
      chatId: string;
      messageId: string;
      senderId: string;
      chatType: 'p2p' | 'group';
    }
  ): Promise<void> {
    const { chatId, messageId } = context;

    try {
      switch (command.type) {
        case 'help':
          await feishuClient.reply(messageId, getHelpText());
          break;

        case 'status':
          await this.handleStatus(chatId, messageId);
          break;

        case 'session':
          if (command.sessionAction === 'new') {
            await this.handleNewSession(chatId, messageId, context.senderId);
          } else if (command.sessionAction === 'list') {
            await this.handleListSessions(chatId, messageId);
          } else {
            await feishuClient.reply(messageId, '群聊模式下仅支持 /session new (重置并新建)');
          }
          break;

        case 'clear':
          console.log(`[Command] clear 命令, clearScope=${command.clearScope}`);
          if (command.clearScope === 'free_session') {
            // 清理空闲群聊
            await this.handleClearFreeSession(chatId, messageId);
          } else {
            // 清空当前对话上下文（默认行为）
            await this.handleNewSession(chatId, messageId, context.senderId); 
          }
          break;

        case 'stop':
          const sessionId = chatSessionStore.getSessionId(chatId);
          if (sessionId) {
            await opencodeClient.abortSession(sessionId);
            await feishuClient.reply(messageId, '⏹️ 已发送中断请求');
          } else {
            await feishuClient.reply(messageId, '当前没有活跃的会话');
          }
          break;

        case 'command':
          // 未知命令透传到 OpenCode
          await this.handlePassthroughCommand(chatId, messageId, command.commandName || '', command.commandArgs || '');
          break;
        
        // TODO: 其他命令如 model, agent, undo, panel 等可按需添加
        default:
          await feishuClient.reply(messageId, `暂不支持命令: ${command.type}`);
          break;
      }
    } catch (error) {
      console.error('[Command] 执行失败:', error);
      await feishuClient.reply(messageId, `❌ 命令执行出错: ${error}`);
    }
  }

  private async handleStatus(chatId: string, messageId: string): Promise<void> {
    const sessionId = chatSessionStore.getSessionId(chatId);
    // 这里简单返回文本，或者用 StatusCard
    const status = sessionId ? `当前绑定 Session: ${sessionId}` : '未绑定 Session';
    
    // 如果能获取更多信息更好
    let extra = '';
    if (sessionId) {
       // 尝试获取 session 详情? 暂时跳过
    }

    await feishuClient.reply(messageId, `🤖 **OpenCode 状态**\n\n${status}\n${extra}`);
  }

  private async handleNewSession(chatId: string, messageId: string, userId: string): Promise<void> {
    // 1. 创建新会话
    const title = `群聊重置-${Date.now().toString().slice(-4)}`;
    const session = await opencodeClient.createSession(title);
    
    if (session) {
      // 2. 更新绑定
      chatSessionStore.setSession(chatId, session.id, userId, title);
      await feishuClient.reply(messageId, `✅ 已创建新对话\nID: ${session.id}`);
    } else {
      await feishuClient.reply(messageId, '❌ 创建会话失败');
    }
  }

  private async handleListSessions(chatId: string, messageId: string): Promise<void> {
      // 在群聊模式下，列出 session 意义不大，因为是 1:1 绑定的
      const current = chatSessionStore.getSessionId(chatId);
      await feishuClient.reply(messageId, `当前绑定会话: ${current || '无'}`);
  }

  private async handlePassthroughCommand(chatId: string, messageId: string, commandName: string, commandArgs: string): Promise<void> {
    const sessionId = chatSessionStore.getSessionId(chatId);
    if (!sessionId) {
      await feishuClient.reply(messageId, '❌ 当前没有活跃的会话，请先发送消息建立会话');
      return;
    }

    // 构造完整命令字符串
    const fullCommand = commandArgs ? `/${commandName} ${commandArgs}` : `/${commandName}`;
    console.log(`[Command] 透传命令到 OpenCode: ${fullCommand}`);

    try {
      // 发送命令到 OpenCode（作为普通消息发送，OpenCode 会解析斜杠命令）
      const result = await opencodeClient.sendMessage(sessionId, fullCommand, {
        providerId: modelConfig.defaultProvider,
        modelId: modelConfig.defaultModel,
      });

      // 处理返回结果
      if (result && result.parts) {
        const output = this.formatOutput(result.parts);
        await feishuClient.reply(messageId, output);
      } else {
        await feishuClient.reply(messageId, `✅ 命令已发送: ${fullCommand}`);
      }
    } catch (error) {
      console.error('[Command] 透传命令失败:', error);
      await feishuClient.reply(messageId, `❌ 命令执行失败: ${error}`);
    }
  }

  private formatOutput(parts: unknown[]): string {
    if (!parts || !Array.isArray(parts)) return '(无输出)';
    
    const output: string[] = [];
    for (const part of parts) {
      const p = part as Record<string, unknown>;
      if (p.type === 'text' && typeof p.text === 'string') {
        output.push(p.text);
      }
    }
    return output.join('\n\n') || '(无输出)';
  }

  private async handleClearFreeSession(chatId: string, messageId: string): Promise<void> {
    await feishuClient.reply(messageId, '🧹 正在扫描并清理无效群聊...');
    
    // 获取机器人所在的所有群
    const allChats = await feishuClient.getUserChats();
    let cleanedCount = 0;
    let sessionsCleaned = 0;
    
    console.log(`[Cleanup] 开始清理，共扫描 ${allChats.length} 个群聊`);
    
    for (const id of allChats) {
      const members = await feishuClient.getChatMembers(id);
      console.log(`[Cleanup] 群 ${id} 成员数: ${members.length}`);
      
      // 如果群成员 <= 1（即只有机器人自己，或者没人），则解散
      if (members.length <= 1) {
        console.log(`[Cleanup] 发现空闲群 ${id} (成员数: ${members.length})，正在解散...`);
        
        // 清理 OpenCode 会话
        const sessionId = chatSessionStore.getSessionId(id);
        if (sessionId) {
          try {
            await opencodeClient.deleteSession(sessionId);
            sessionsCleaned++;
            console.log(`[Cleanup] 已删除 OpenCode 会话: ${sessionId}`);
          } catch (e) {
            console.warn(`[Cleanup] 删除会话 ${sessionId} 失败:`, e);
          }
          chatSessionStore.removeSession(id);
        }
        
        const disbanded = await feishuClient.disbandChat(id);
        if (disbanded) {
          cleanedCount++;
        }
      }
    }

    await feishuClient.reply(messageId, `✅ 清理完成\n- 解散群聊: ${cleanedCount} 个\n- 清理会话: ${sessionsCleaned} 个`);
  }
}

export const commandHandler = new CommandHandler();
