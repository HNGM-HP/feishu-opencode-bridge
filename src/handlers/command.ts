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
          await this.handleModel(chatId, messageId, context.senderId, command.modelName);
          break;

        case 'agent':
          await this.handleAgent(chatId, messageId, context.senderId, command.agentName);
          break;

        case 'undo':
          await this.handleUndo(chatId, messageId);
          break;

        case 'panel':
          await this.handlePanel(chatId, messageId);
          break;
        
        case 'sessions':
          await this.handleListSessions(chatId, messageId);
          break;

        // 其他命令透传
        default:
          await this.handlePassthroughCommand(chatId, messageId, command.type.replace(/^\//, ''), command.commandArgs || '');
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

  private async handleModel(chatId: string, messageId: string, userId: string, modelName?: string): Promise<void> {
    try {
      // 0. 确保会话存在
      let session = chatSessionStore.getSession(chatId);
      if (!session) {
         // 自动创建会话
         const title = `群聊会话-${chatId.slice(-4)}`;
         const newSession = await opencodeClient.createSession(title);
         if (newSession) {
             chatSessionStore.setSession(chatId, newSession.id, userId, title);
             session = chatSessionStore.getSession(chatId);
         } else {
             await feishuClient.reply(messageId, '❌ 无法创建会话以保存配置');
             return;
         }
      }

      // 1. 如果没有提供模型名称，显示当前状态
      if (!modelName) {
        const currentModel = session?.preferredModel || `${modelConfig.defaultProvider}:${modelConfig.defaultModel}`;
        await feishuClient.reply(messageId, `当前模型: ${currentModel}`);
        return;
      }

      const { providers } = await opencodeClient.getProviders();

      // 2. 解析模型名称 (支持 provider/model 或 model)
      let found = false;
      let targetProvider = '';
      let targetModel = '';

      const safeProviders = Array.isArray(providers) ? providers : [];

      for (const p of safeProviders) {
        // 安全获取 models，兼容数组和对象
        const modelsRaw = (p as any).models;
        const models = Array.isArray(modelsRaw) 
            ? modelsRaw 
            : (modelsRaw && typeof modelsRaw === 'object' ? Object.values(modelsRaw) : []);

        for (const m of models) {
           const modelId = (m as any).id || (m as any).modelID || (m as any).name;
           const providerId = (p as any).id || (p as any).providerID;
           
           if (!modelId || !providerId) continue;

           // 支持 "provider:model", "provider/model" 或直接 "model" (如果唯一)
           if (
               modelName === `${providerId}:${modelId}` || 
               modelName === `${providerId}/${modelId}` || 
               modelName === modelId || 
               modelName === (m as any).name
           ) {
             targetProvider = providerId;
             targetModel = modelId;
             found = true;
             break;
           }
        }
        if (found) break;
      }

      if (found) {
        // 3. 更新配置
        const newValue = `${targetProvider}:${targetModel}`;
        chatSessionStore.updateConfig(chatId, { preferredModel: newValue });
        await feishuClient.reply(messageId, `✅ 已切换模型: ${newValue}`);
      } else {
        // 即使没找到匹配的，如果格式正确也允许强制设置（针对自定义或未列出的模型）
        if (modelName.includes(':') || modelName.includes('/')) {
             const separator = modelName.includes(':') ? ':' : '/';
             const [p, m] = modelName.split(separator);
             const newValue = `${p}:${m}`;
             chatSessionStore.updateConfig(chatId, { preferredModel: newValue });
             await feishuClient.reply(messageId, `⚠️ 未在列表中找到该模型，但已强制设置为: ${newValue}`);
        } else {
             await feishuClient.reply(messageId, `❌ 未找到模型 "${modelName}"\n请使用 /panel 查看可用列表`);
        }
      }

    } catch (error) {
      await feishuClient.reply(messageId, `❌ 设置模型失败: ${error}`);
    }
  }

  private async handleAgent(chatId: string, messageId: string, userId: string, agentName?: string): Promise<void> {
    try {
      // 0. 确保会话存在
      let session = chatSessionStore.getSession(chatId);
      if (!session) {
         // 自动创建会话
         const title = `群聊会话-${chatId.slice(-4)}`;
         const newSession = await opencodeClient.createSession(title);
         if (newSession) {
             chatSessionStore.setSession(chatId, newSession.id, userId, title);
             session = chatSessionStore.getSession(chatId);
         } else {
             await feishuClient.reply(messageId, '❌ 无法创建会话以保存配置');
             return;
         }
      }

      const currentAgent = session?.preferredAgent || '(无)';

      if (!agentName) {
        await feishuClient.reply(messageId, `当前Agent: ${currentAgent}`);
        return;
      }

      // 特殊值处理
      if (agentName === 'none' || agentName === 'off' || agentName === 'default') {
         chatSessionStore.updateConfig(chatId, { preferredAgent: undefined });
         await feishuClient.reply(messageId, `✅ 已关闭 Agent (使用默认)`);
         return;
      }

      // 校验 Agent 是否存在 (这个校验是值得保留的)
      const agents = await opencodeClient.getAgents();
      const exists = agents.find(a => a.name === agentName);
      
      if (!exists) {
        await feishuClient.reply(messageId, '❌ 未找到该Agent\n请使用 /agent 查看可用列表');
        return;
      }

      chatSessionStore.updateConfig(chatId, { preferredAgent: exists.name });
      await feishuClient.reply(messageId, `✅ 已切换Agent: ${exists.name}`);

    } catch (error) {
      await feishuClient.reply(messageId, `❌ 设置Agent失败: ${error}`);
    }
  }

  private async handlePanel(chatId: string, messageId: string): Promise<void> {
      // 简单显示面板说明，或者实现卡片
      // 这里为了简单且符合用户"逻辑"的要求，我们尽量复用旧逻辑的风格
      // 旧逻辑构建了一个 ControlCard
      const session = chatSessionStore.getSession(chatId);
      const currentModel = session?.preferredModel || '默认';
      const currentAgent = session?.preferredAgent || '默认';
      
      const { buildControlCard } = await import('../feishu/cards.js');
      
      // 获取列表供卡片使用
      const { providers } = await opencodeClient.getProviders();
      const agents = await opencodeClient.getAgents();
      
      const modelOptions: { label: string; value: string }[] = [];
      const safeProviders = Array.isArray(providers) ? providers : [];

      for (const p of safeProviders) {
          // 安全获取 models，兼容数组和对象
          const modelsRaw = (p as any).models;
          const models = Array.isArray(modelsRaw) 
              ? modelsRaw 
              : (modelsRaw && typeof modelsRaw === 'object' ? Object.values(modelsRaw) : []);

          for (const m of models) {
              const modelId = (m as any).id || (m as any).modelID || (m as any).name;
              const modelName = (m as any).name || modelId;
              const providerId = (p as any).id || (p as any).providerID;
              
              if (modelId && providerId) {
                  // 在标签中增加 Provider 前缀，例如 "[OpenAI] gpt-4"
                  const label = `[${p.name || providerId}] ${modelName}`;
                  modelOptions.push({ label, value: `${providerId}:${modelId}` });
              }
          }
      }
      
      const agentOptions = Array.isArray(agents) 
        ? agents.map(a => ({ label: a.name, value: a.name })) 
        : [];
      
      const card = buildControlCard({
          conversationKey: `chat:${chatId}`,
          chatId,
          chatType: 'group', // 假设群组
          currentModel,
          currentAgent,
          models: modelOptions.slice(0, 50), // 限制数量
          agents: agentOptions.length > 0 ? agentOptions : [{ label: '无', value: 'none' }]
      });
      
      await feishuClient.replyCard(messageId, card);
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
