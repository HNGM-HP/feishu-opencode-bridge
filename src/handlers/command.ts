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

        case 'model':
          await this.handleModel(chatId, messageId, command.modelName);
          break;

        case 'agent':
          await this.handleAgent(chatId, messageId, command.agentName);
          break;

        case 'undo':
          await this.handleUndo(chatId, messageId);
          break;

        case 'panel':
          await this.handlePassthroughCommand(chatId, messageId, 'panel', '');
          break;
        
        // 其他命令如 model, agent, undo, panel 等直接透传
        default:
          // 尝试构建通用参数（虽然 ParsedCommand 是联合类型，但在运行时我们只能尽力）
          // @ts-ignore
          const args = command.commandArgs || command.text || ''; 
          await this.handlePassthroughCommand(chatId, messageId, command.type.replace(/^\//, ''), args);
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

  private async handleModel(chatId: string, messageId: string, modelName?: string): Promise<void> {
    try {
      const { providers, default: defaults } = await opencodeClient.getProviders();
      const currentSession = chatSessionStore.getSession(chatId);
      const currentModel = currentSession?.preferredModel || `${modelConfig.defaultProvider}:${modelConfig.defaultModel}`;

      if (modelName) {
        // 尝试匹配模型
        let found = false;
        let targetProvider = '';
        let targetModel = '';

        for (const p of providers) {
          for (const m of p.models) {
             // 支持 "provider:model" 或直接 "model" (如果唯一)
             if (modelName === `${p.id}:${m.id}` || modelName === m.id || modelName === m.name) {
               targetProvider = p.id;
               targetModel = m.id;
               found = true;
               break;
             }
          }
          if (found) break;
        }

        if (found) {
          chatSessionStore.updateConfig(chatId, { preferredModel: `${targetProvider}:${targetModel}` });
          await feishuClient.reply(messageId, `✅ 已切换模型为: ${targetProvider}:${targetModel}`);
        } else {
          await feishuClient.reply(messageId, `❌ 未找到模型 "${modelName}"\n请使用 /model 查看可用列表`);
        }
      } else {
        // 列出模型
        let listText = `🤖 **当前模型**: ${currentModel}\n\n**可用模型列表**:`;
        for (const p of providers) {
          listText += `\n**${p.name} (${p.id})**:\n`;
          for (const m of p.models) {
            listText += `- ${m.name} (\`${m.id}\`)\n`;
          }
        }
        listText += `\n使用 \`/model <name>\` 切换`;
        await feishuClient.reply(messageId, listText);
      }
    } catch (error) {
      await feishuClient.reply(messageId, `❌获取模型列表失败: ${error}`);
    }
  }

  private async handleAgent(chatId: string, messageId: string, agentName?: string): Promise<void> {
    try {
      const agents = await opencodeClient.getAgents();
      const currentSession = chatSessionStore.getSession(chatId);
      const currentAgent = currentSession?.preferredAgent || '(无)';

      if (agentName) {
        if (agentName === 'none' || agentName === 'off') {
           chatSessionStore.updateConfig(chatId, { preferredAgent: undefined }); // how to clear? let's assume undefined
           await feishuClient.reply(messageId, `✅ 已关闭 Agent`);
           return;
        }

        const found = agents.find(a => a.name === agentName);
        if (found) {
          chatSessionStore.updateConfig(chatId, { preferredAgent: found.name });
          await feishuClient.reply(messageId, `✅ 已切换 Agent 为: ${found.name}`);
        } else {
          await feishuClient.reply(messageId, `❌ 未找到 Agent "${agentName}"\n请使用 /agent 查看可用列表`);
        }
      } else {
        let listText = `🕵️ **当前 Agent**: ${currentAgent}\n\n**可用 Agent 列表**:`;
        if (agents.length === 0) {
            listText += '\n(暂无可用 Agent)';
        } else {
            for (const a of agents) {
                listText += `\n- **${a.name}**: ${a.description || '无描述'}`;
            }
        }
        listText += `\n\n使用 \`/agent <name>\` 切换，使用 \`/agent off\` 关闭`;
        await feishuClient.reply(messageId, listText);
      }
    } catch (error) {
      await feishuClient.reply(messageId, `❌获取 Agent 列表失败: ${error}`);
    }
  }

  private async handlePassthroughCommand(chatId: string, messageId: string, commandName: string, commandArgs: string): Promise<void> {
    const sessionId = chatSessionStore.getSessionId(chatId);
    if (!sessionId) {
      await feishuClient.reply(messageId, '❌ 当前没有活跃的会话，请先发送消息建立会话');
      return;
    }

    console.log(`[Command] 透传命令到 OpenCode: /${commandName} ${commandArgs}`);

    try {
      // 使用专门的 sendCommand 方法
      const result = await opencodeClient.sendCommand(sessionId, commandName, commandArgs);

      // 处理返回结果
      if (result && result.parts) {
        const output = this.formatOutput(result.parts);
        await feishuClient.reply(messageId, output);
      } else {
        await feishuClient.reply(messageId, `✅ 命令已发送: /${commandName} ${commandArgs}`);
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

  // 公开以供外部调用（如消息撤回事件）
  public async handleUndo(chatId: string, replyMessageId?: string): Promise<void> {
    const session = chatSessionStore.getSession(chatId);
    if (!session || !session.sessionId) {
      if (replyMessageId) await feishuClient.reply(replyMessageId, '❌ 当前没有活跃的会话');
      return;
    }

    console.log(`[Undo] 尝试撤回会话 ${session.sessionId} 的最后一条消息`);

    try {
      // 1. 获取会话消息历史
      const messages = await opencodeClient.getSessionMessages(session.sessionId);
      
      // 2. 找到最后一条 User 消息
      // OpenCode SDK Message 类型: { role: 'user' | 'assistant' | ... }
      const reversed = [...messages].reverse();
      // @ts-ignore
      const lastUserMsg = reversed.find(m => m.info.role === 'user');

      if (!lastUserMsg) {
        if (replyMessageId) await feishuClient.reply(replyMessageId, '⚠️ 未找到可撤回的用户消息');
        return;
      }

      // 3. 调用 Revert
      // @ts-ignore
      const success = await opencodeClient.revertMessage(session.sessionId, lastUserMsg.info.id);

      if (success) {
        // 4. 尝试撤回飞书上的 AI 回复
        if (session.lastFeishuAiMsgId) {
          try {
              await feishuClient.deleteMessage(session.lastFeishuAiMsgId);
          } catch(e) {
              // ignore
          }
        }
        
        // 5. 尝试撤回飞书上的 用户 消息 (如果存在且机器人有权限)
        if (session.lastFeishuUserMsgId) {
           try {
              await feishuClient.deleteMessage(session.lastFeishuUserMsgId);
           } catch(e) {
              // 可能是权限不足或消息已被撤回
              console.warn(`[Undo] 撤回用户消息失败: ${e}`);
           }
        }

        // 清除记录
        // @ts-ignore
        chatSessionStore.updateLastInteraction(chatId, '', ''); 
        
        if (replyMessageId) {
             // 如果是通过 /undo 触发，提示成功
             // 如果用户消息被撤回了，这个提示可能看起来有点奇怪（悬空），但还是提示一下比较好
             // 或者短暂提示后撤回? 暂时保持原样
             await feishuClient.reply(replyMessageId, '✅ 已撤回上一轮对话');
        }
      } else {
        if (replyMessageId) await feishuClient.reply(replyMessageId, '❌ 撤回失败: OpenCode 拒绝');
      }
    } catch (error) {
      console.error('[Undo] 执行失败:', error);
      if (replyMessageId) await feishuClient.reply(replyMessageId, `❌ 撤回出错: ${error}`);
    }
  }
}

export const commandHandler = new CommandHandler();
