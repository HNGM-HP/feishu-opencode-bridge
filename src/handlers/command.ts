import { type ParsedCommand, getHelpText } from '../commands/parser.js';
import { feishuClient } from '../feishu/client.js';
import {
  opencodeClient,
  type OpencodeAgentConfig,
  type OpencodeAgentInfo,
  type OpencodeRuntimeConfig,
} from '../opencode/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { buildControlCard, buildStatusCard } from '../feishu/cards.js';
import { modelConfig } from '../config.js';

const SUPPORTED_ROLE_TOOLS = [
  'bash',
  'read',
  'write',
  'edit',
  'list',
  'glob',
  'grep',
  'webfetch',
  'task',
  'todowrite',
  'todoread',
] as const;

type RoleTool = typeof SUPPORTED_ROLE_TOOLS[number];

const ROLE_TOOL_ALIAS: Record<string, RoleTool> = {
  bash: 'bash',
  shell: 'bash',
  命令行: 'bash',
  终端: 'bash',
  read: 'read',
  读取: 'read',
  阅读: 'read',
  write: 'write',
  写入: 'write',
  edit: 'edit',
  编辑: 'edit',
  list: 'list',
  列表: 'list',
  glob: 'glob',
  文件匹配: 'glob',
  grep: 'grep',
  搜索: 'grep',
  webfetch: 'webfetch',
  网页: 'webfetch',
  抓取网页: 'webfetch',
  task: 'task',
  子代理: 'task',
  todowrite: 'todowrite',
  待办写入: 'todowrite',
  todoread: 'todoread',
  待办读取: 'todoread',
};

const ROLE_CREATE_USAGE = '用法: 创建角色 名称=旅行助手; 描述=擅长制定旅行计划; 类型=主; 工具=webfetch; 提示词=先给出预算再做路线';
const INTERNAL_HIDDEN_AGENT_NAMES = new Set(['compaction', 'title', 'summary']);

interface RoleCreatePayload {
  name: string;
  description: string;
  mode: 'primary' | 'subagent';
  tools?: Record<string, boolean>;
  prompt?: string;
}

type RoleCreateParseResult =
  | { ok: true; payload: RoleCreatePayload }
  | { ok: false; message: string };

type RoleToolsParseResult =
  | { ok: true; tools?: Record<string, boolean> }
  | { ok: false; message: string };

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeRoleMode(value: string): 'primary' | 'subagent' | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === '主' || normalized === 'primary') return 'primary';
  if (normalized === '子' || normalized === 'subagent') return 'subagent';
  return undefined;
}

function buildToolsConfig(value: string): RoleToolsParseResult {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === '默认' || normalized === 'default' || normalized === '继承' || normalized === 'all' || normalized === '全部') {
    return { ok: true };
  }

  const toolsConfig: Record<string, boolean> = Object.fromEntries(
    SUPPORTED_ROLE_TOOLS.map(tool => [tool, false])
  );

  if (normalized === 'none' || normalized === '无' || normalized === '关闭' || normalized === 'off') {
    return { ok: true, tools: toolsConfig };
  }

  const rawItems = value.split(/[，,\s]+/).map(item => item.trim()).filter(Boolean);
  if (rawItems.length === 0) {
    return { ok: true };
  }

  const unsupported: string[] = [];
  for (const rawItem of rawItems) {
    const aliasKey = rawItem.toLowerCase();
    const mapped = ROLE_TOOL_ALIAS[aliasKey] || ROLE_TOOL_ALIAS[rawItem];
    if (!mapped) {
      unsupported.push(rawItem);
      continue;
    }
    toolsConfig[mapped] = true;
  }

  if (unsupported.length > 0) {
    return {
      ok: false,
      message: `不支持的工具: ${unsupported.join(', ')}\n可用工具: ${SUPPORTED_ROLE_TOOLS.join(', ')}`,
    };
  }

  return { ok: true, tools: toolsConfig };
}

function parseRoleCreateSpec(spec: string): RoleCreateParseResult {
  const raw = spec.trim();
  if (!raw) {
    return { ok: false, message: `缺少角色参数\n${ROLE_CREATE_USAGE}` };
  }

  const segments = raw.split(/[;；\n]+/).map(item => item.trim()).filter(Boolean);
  if (segments.length === 0) {
    return { ok: false, message: `缺少角色参数\n${ROLE_CREATE_USAGE}` };
  }

  let name = '';
  let description = '';
  let modeRaw = '';
  let toolsRaw = '';
  let prompt = '';

  for (const segment of segments) {
    const sepIndex = segment.search(/[=:：]/);
    if (sepIndex < 0) {
      if (!name) {
        name = stripWrappingQuotes(segment);
      }
      continue;
    }

    const key = segment.slice(0, sepIndex).trim().toLowerCase();
    const value = stripWrappingQuotes(segment.slice(sepIndex + 1));
    if (!value) continue;

    if (key === '名称' || key === '名字' || key === '角色' || key === 'name' || key === 'role') {
      name = value;
      continue;
    }

    if (key === '描述' || key === '说明' || key === 'description' || key === 'desc') {
      description = value;
      continue;
    }

    if (key === '类型' || key === '模式' || key === 'mode') {
      modeRaw = value;
      continue;
    }

    if (key === '工具' || key === 'tools' || key === 'tool') {
      toolsRaw = value;
      continue;
    }

    if (key === '提示词' || key === 'prompt' || key === '系统提示' || key === '指令') {
      prompt = value;
    }
  }

  name = name.trim();
  if (!name) {
    return { ok: false, message: `缺少角色名称\n${ROLE_CREATE_USAGE}` };
  }

  if (/\s/.test(name)) {
    return { ok: false, message: '角色名称不能包含空格，请使用连续字符（可含中文）。' };
  }

  if (name.length > 40) {
    return { ok: false, message: '角色名称长度不能超过 40 个字符。' };
  }

  let mode: 'primary' | 'subagent' = 'primary';
  if (modeRaw) {
    const parsedMode = normalizeRoleMode(modeRaw);
    if (!parsedMode) {
      return { ok: false, message: '角色类型仅支持 主 / 子（或 primary / subagent）。' };
    }
    mode = parsedMode;
  }

  const toolsResult = buildToolsConfig(toolsRaw);
  if (!toolsResult.ok) return toolsResult;

  return {
    ok: true,
    payload: {
      name,
      description: description || `${name}（自定义角色）`,
      mode,
      ...(toolsResult.tools ? { tools: toolsResult.tools } : {}),
      ...(prompt ? { prompt } : {}),
    },
  };
}

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

        case 'role':
          if (command.roleAction === 'create') {
            await this.handleRoleCreate(chatId, messageId, context.senderId, command.roleSpec || '');
          } else {
            await feishuClient.reply(messageId, `支持的角色命令:\n- ${ROLE_CREATE_USAGE}`);
          }
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

  private getVisibleAgents(agents: OpencodeAgentInfo[]): OpencodeAgentInfo[] {
    return agents.filter(agent => agent.hidden !== true && !INTERNAL_HIDDEN_AGENT_NAMES.has(agent.name));
  }

  private getAgentModePrefix(agent: OpencodeAgentInfo): string {
    return agent.mode === 'subagent' ? '（子）' : '（主）';
  }

  private getAgentDisplayName(agent: OpencodeAgentInfo): string {
    const description = typeof agent.description === 'string' ? agent.description.trim() : '';
    return description || agent.name;
  }

  private getAgentDisplayText(agent: OpencodeAgentInfo): string {
    return `${this.getAgentModePrefix(agent)} ${this.getAgentDisplayName(agent)}`;
  }

  private resolveAgentByInput(agents: OpencodeAgentInfo[], rawInput: string): OpencodeAgentInfo | undefined {
    const input = rawInput.trim();
    if (!input) return undefined;

    const lowered = input.toLowerCase();
    const byName = agents.find(agent => agent.name.toLowerCase() === lowered);
    if (byName) return byName;

    const byDescription = agents.find(agent => {
      const description = typeof agent.description === 'string' ? agent.description.trim().toLowerCase() : '';
      return description.length > 0 && description === lowered;
    });
    if (byDescription) return byDescription;

    return agents.find(agent => this.getAgentDisplayText(agent).toLowerCase() === lowered);
  }

  private getCurrentRoleDisplay(currentAgentName: string | undefined, agents: OpencodeAgentInfo[]): string {
    if (!currentAgentName) return '默认角色';
    const found = agents.find(agent => agent.name === currentAgentName);
    if (found) return this.getAgentDisplayText(found);
    return currentAgentName;
  }

  private getRoleAgentMap(config: OpencodeRuntimeConfig): Record<string, OpencodeAgentConfig> {
    if (!config.agent || typeof config.agent !== 'object') {
      return {};
    }
    return config.agent;
  }

  private async handleRoleCreate(chatId: string, messageId: string, userId: string, roleSpec: string): Promise<void> {
    const parsed = parseRoleCreateSpec(roleSpec);
    if (!parsed.ok) {
      await feishuClient.reply(messageId, `❌ 创建角色失败\n${parsed.message}`);
      return;
    }

    let session = chatSessionStore.getSession(chatId);
    if (!session) {
      const title = `群聊会话-${chatId.slice(-4)}`;
      const newSession = await opencodeClient.createSession(title);
      if (!newSession) {
        await feishuClient.reply(messageId, '❌ 无法创建会话以保存角色设置');
        return;
      }
      chatSessionStore.setSession(chatId, newSession.id, userId, title);
      session = chatSessionStore.getSession(chatId);
    }

    const payload = parsed.payload;
    const [agents, config] = await Promise.all([
      opencodeClient.getAgents(),
      opencodeClient.getConfig(),
    ]);

    const roleAgentMap = this.getRoleAgentMap(config);
    const existingConfig = roleAgentMap[payload.name];
    const nameConflict = agents.find(agent => agent.name.toLowerCase() === payload.name.toLowerCase());
    if (nameConflict && !existingConfig) {
      await feishuClient.reply(messageId, `❌ 角色名称已被占用: ${payload.name}\n请更换一个名称后重试。`);
      return;
    }

    const nextAgentConfig: OpencodeAgentConfig = {
      description: payload.description,
      mode: payload.mode,
      ...(payload.prompt ? { prompt: payload.prompt } : {}),
      ...(payload.tools ? { tools: payload.tools } : {}),
    };

    const nextConfig: OpencodeRuntimeConfig = {
      ...config,
      agent: {
        ...roleAgentMap,
        [payload.name]: nextAgentConfig,
      },
    };

    const updated = await opencodeClient.updateConfig(nextConfig);
    if (!updated) {
      await feishuClient.reply(messageId, '❌ 创建角色失败：写入 OpenCode 配置失败');
      return;
    }

    if (session) {
      chatSessionStore.updateConfig(chatId, { preferredAgent: payload.name });
    }
    const actionText = existingConfig ? '已更新' : '已创建';
    const modeText = payload.mode === 'subagent' ? '子角色' : '主角色';
    await feishuClient.reply(
      messageId,
      `✅ ${actionText}角色: ${payload.name}\n类型: ${modeText}\n当前群已切换到该角色。\n若 /panel 未立即显示新角色，请重启 OpenCode。`
    );
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

      const visibleAgents = this.getVisibleAgents(await opencodeClient.getAgents());
      const currentAgent = session?.preferredAgent;

      if (!agentName) {
        await feishuClient.reply(messageId, `当前角色: ${this.getCurrentRoleDisplay(currentAgent, visibleAgents)}`);
        return;
      }

      // 特殊值处理
      if (agentName === 'none' || agentName === 'off' || agentName === 'default') {
        chatSessionStore.updateConfig(chatId, { preferredAgent: undefined });
        await feishuClient.reply(messageId, '✅ 已切换为默认角色');
        return;
      }

      const matched = this.resolveAgentByInput(visibleAgents, agentName);
      if (!matched) {
        await feishuClient.reply(messageId, '❌ 未找到该角色\n请使用 /panel 查看可用角色');
        return;
      }

      chatSessionStore.updateConfig(chatId, { preferredAgent: matched.name });
      await feishuClient.reply(messageId, `✅ 已切换角色: ${this.getAgentDisplayText(matched)}`);
    } catch (error) {
      await feishuClient.reply(messageId, `❌ 设置角色失败: ${error}`);
    }
  }

  private async buildPanelCard(chatId: string): Promise<object> {
    const session = chatSessionStore.getSession(chatId);
    const currentModel = session?.preferredModel || '默认';

    // 获取列表供卡片使用
    const { providers } = await opencodeClient.getProviders();
    const allAgents = await opencodeClient.getAgents();
    const visibleAgents = this.getVisibleAgents(allAgents);
    const currentAgent = this.getCurrentRoleDisplay(session?.preferredAgent, visibleAgents);

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
          const label = `[${p.name || providerId}] ${modelName}`;
          modelOptions.push({ label, value: `${providerId}:${modelId}` });
        }
      }
    }

    const agentOptions = [
      { label: '（主）默认角色', value: 'none' },
      ...visibleAgents.map(agent => ({
        label: this.getAgentDisplayText(agent),
        value: agent.name,
      })),
    ];

    return buildControlCard({
      conversationKey: `chat:${chatId}`,
      chatId,
      chatType: 'group',
      currentModel,
      currentAgent,
      models: modelOptions.slice(0, 100),
      agents: agentOptions,
    });
  }

  public async pushPanelCard(chatId: string): Promise<void> {
    const card = await this.buildPanelCard(chatId);
    await feishuClient.sendCard(chatId, card);
  }

  private async handlePanel(chatId: string, messageId: string): Promise<void> {
    const card = await this.buildPanelCard(chatId);
    if (messageId) {
      await feishuClient.replyCard(messageId, card);
      return;
    }

    await feishuClient.sendCard(chatId, card);
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
  public async handleUndo(chatId: string, triggerMessageId?: string): Promise<void> {
    // 0. 删除触发 undo 的命令消息（如果存在）
    if (triggerMessageId) {
        try {
            await feishuClient.deleteMessage(triggerMessageId);
        } catch (e) {
            // ignore (might not have permission or already deleted)
        }
    }

    const session = chatSessionStore.getSession(chatId);
    if (!session || !session.sessionId) {
      // 撤回事件触发时，如果会话已失效则静默返回，避免在不可用群里再次报错。
      if (!triggerMessageId) {
        console.warn(`[Undo] 跳过撤回: chat=${chatId} 无活跃会话`);
        return;
      }

      const msg = await feishuClient.sendText(chatId, '❌ 当前没有活跃的会话');
      setTimeout(() => msg && feishuClient.deleteMessage(msg), 5000);
      return;
    }

    console.log(`[Undo] 尝试撤回会话 ${session.sessionId} 的最后一次交互`);

    // 递归撤回函数
    const performUndo = async (skipOpenCodeRevert: boolean = false): Promise<boolean> => {
        // 1. Pop interaction
        const lastInteraction = chatSessionStore.popInteraction(chatId);
        if (!lastInteraction) {
            return false; // No history
        }

        // 2. Revert in OpenCode
        if (!skipOpenCodeRevert) {
            let targetRevertId = '';
            try {
                const messages = await opencodeClient.getSessionMessages(session.sessionId);
                
                // Find the AI message
                // For question_answer type, openCodeMsgId is empty, so this will be -1
                const aiMsgIndex = messages.findIndex(m => m.info.id === lastInteraction.openCodeMsgId);
                
                if (aiMsgIndex !== -1) {
                    // We want to remove the User Message and the AI Message.
                    // To remove a message in OpenCode (revert), we pass the ID of the message to remove.
                    // Revert removes the target message and all subsequent messages.
                    // So we target the User Message (aiMsgIndex - 1).
                    if (aiMsgIndex >= 1) {
                        targetRevertId = messages[aiMsgIndex - 1].info.id;
                    } else {
                        // AI message is at index 0? User message missing?
                        // Fallback to removing AI message itself.
                        targetRevertId = messages[aiMsgIndex].info.id;
                    }
                } else {
                    // Fallback: usually for question_answer or if ID not found.
                    // Structure: [..., User/Question, Answer].
                    // We want to remove both.
                    // Target User/Question (index N-2).
                    if (messages.length >= 2) {
                        targetRevertId = messages[messages.length - 2].info.id;
                    } else if (messages.length === 1) {
                        targetRevertId = messages[0].info.id;
                    }
                }
            } catch (e) {
                console.warn('[Undo] Failed to fetch messages for revert calculation', e);
            }

            if (targetRevertId) {
                 await opencodeClient.revertMessage(session.sessionId, targetRevertId);
            }
        }

        // 3. Delete Feishu messages
        // Delete AI replies
        for (const msgId of lastInteraction.botFeishuMsgIds) {
            try { await feishuClient.deleteMessage(msgId); } catch (e) {}
        }
        // Delete User message
        if (lastInteraction.userFeishuMsgId) {
            try { await feishuClient.deleteMessage(lastInteraction.userFeishuMsgId); } catch (e) {}
        }
        
        // 4. Recursive check for question answer
        if (lastInteraction.type === 'question_answer') {
            // Question 回答通常会在本地历史里对应若干 question_prompt 卡片。
            // 这里仅清理 question_prompt，避免误删上一轮 normal 交互。
            while (chatSessionStore.getLastInteraction(chatId)?.type === 'question_prompt') {
                await performUndo(true);
            }
        }
        
        return true;
    };


    try {
        const success = await performUndo();
        if (success) {
             const msg = await feishuClient.sendText(chatId, '✅ 已撤回上一轮对话');
             setTimeout(() => msg && feishuClient.deleteMessage(msg), 3000);
        } else {
             const msg = await feishuClient.sendText(chatId, '⚠️ 没有可撤回的消息');
             setTimeout(() => msg && feishuClient.deleteMessage(msg), 3000);
        }
    } catch (error) {
       console.error('[Undo] 执行失败:', error);
       const msg = await feishuClient.sendText(chatId, `❌ 撤回出错: ${error}`);
       setTimeout(() => msg && feishuClient.deleteMessage(msg), 5000);
    }
  }
}

export const commandHandler = new CommandHandler();
