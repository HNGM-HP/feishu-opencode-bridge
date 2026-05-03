/**
 * 多平台命令处理器
 *
 * 支持非飞书平台（WhatsApp、Telegram、Discord 等）的命令处理。
 * 使用 PlatformSender 接口发送消息，不直接依赖飞书客户端。
 */

import { type ParsedCommand, getHelpText } from '../commands/parser.js';
import { KNOWN_EFFORT_LEVELS, normalizeEffortLevel, type EffortLevel } from '../commands/effort.js';
import { opencodeClient, type OpencodeAgentInfo } from '../opencode/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { DirectoryPolicy } from '../utils/directory-policy.js';
import { buildSessionTimestamp } from '../utils/session-title.js';
import { modelConfig, userConfig } from '../config.js';
import type { PlatformSender } from '../platform/types.js';
import { isChatModelAllowed, parseChatModelReference } from '../utils/chat-model-whitelist.js';

const EFFORT_USAGE_TEXT = '用法: /effort（查看） 或 /effort <low|high|max|xhigh>（设置） 或 /effort default（清除）';
const EFFORT_DISPLAY_ORDER = KNOWN_EFFORT_LEVELS;

interface ProviderModelMeta {
  providerId: string;
  modelId: string;
  modelName?: string;
  variants: EffortLevel[];
}

interface EffortSupportInfo {
  model: { providerId: string; modelId: string } | null;
  supportedEfforts: EffortLevel[];
  modelMatched: boolean;
}

/**
 * 多平台命令处理器
 *
 * 使用方式：
 * ```typescript
 * const handler = new PlatformCommandHandler('whatsapp');
 * await handler.handle(command, { chatId, senderId, chatType: 'p2p' }, sender);
 * ```
 */
export class PlatformCommandHandler {
  constructor(private platform: string) {}

  async handle(
    command: ParsedCommand,
    context: {
      chatId: string;
      senderId: string;
      chatType: 'p2p' | 'group';
    },
    sender: PlatformSender
  ): Promise<void> {
    const { chatId } = context;

    try {
      switch (command.type) {
        case 'help':
          await this.sendText(sender, chatId, this.getPlatformHelpText());
          break;

        case 'status':
          await this.handleStatus(chatId, sender);
          break;

        case 'session':
          if (command.sessionAction === 'new') {
            await this.handleNewSession(chatId, context.senderId, context.chatType, command.sessionDirectory, command.sessionName, sender);
          } else {
            await this.sendText(sender, chatId, '用法: /session new 或 /session <sessionId>（列出会话请用 /sessions）');
          }
          break;

        case 'sessions':
          await this.handleListSessions(chatId, command.listAll ?? false, sender);
          break;

        case 'project':
          if (command.projectAction === 'list') {
            await this.handleProjectList(chatId, sender);
          } else {
            await this.sendText(sender, chatId, '用法: /project list');
          }
          break;

        case 'clear':
          await this.handleNewSession(chatId, context.senderId, context.chatType, undefined, undefined, sender);
          break;

        case 'stop': {
          const sessionId = chatSessionStore.getSessionIdByConversation(this.platform, chatId);
          if (sessionId) {
            await opencodeClient.abortSession(sessionId);
            await this.sendText(sender, chatId, '已发送中断请求');
          } else {
            await this.sendText(sender, chatId, '当前没有活跃的会话');
          }
          break;
        }

        case 'compact':
          await this.handleCompact(chatId, sender);
          break;

        case 'model':
          await this.handleModel(chatId, context.senderId, context.chatType, command.modelName, sender);
          break;

        case 'models':
          await this.handleModels(chatId, command.listAll ?? false, sender);
          break;

        case 'agent':
          await this.handleAgent(chatId, context.senderId, context.chatType, command.agentName, sender);
          break;

        case 'agents':
          await this.handleAgents(chatId, sender);
          break;

        case 'effort':
          await this.handleEffort(chatId, context.senderId, context.chatType, command, sender);
          break;

        case 'panel':
          await this.handlePanel(chatId, sender);
          break;

        case 'undo':
          await this.handleUndo(chatId, sender);
          break;

        case 'rename':
          await this.handleRename(chatId, command.renameTitle, sender);
          break;

        default:
          await this.sendText(sender, chatId, `命令 "${command.type}" 暂不支持，请使用 /help 查看可用命令`);
          break;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[${this.platform}] 命令执行失败:`, errorMessage);
      await this.sendText(sender, chatId, '命令执行出错，请稍后重试');
    }
  }

  private async sendText(sender: PlatformSender, conversationId: string, text: string): Promise<void> {
    await sender.sendText(conversationId, text);
  }

  private getPlatformHelpText(): string {
    const platformName = this.getPlatformDisplayName();
    return `📖 **${platformName} × OpenCode 机器人指南**

💬 **如何对话**
直接发送消息即可与 AI 对话。

🛠️ **常用命令**
• \`/help\` 显示帮助
• \`/model\` 查看当前模型
• \`/model <名称>\` 切换模型
• \`/models\` 列出当前可选模型
• \`/models all\` 列出全部当前可选模型
• \`/agent\` 查看当前角色
• \`/agent <名称>\` 切换角色
• \`/agents\` 列出所有可用角色
• \`/effort\` 查看当前强度
• \`/effort <档位>\` 设置会话强度
• \`/panel\` 显示控制面板
• \`/undo\` 撤回上一轮对话
• \`/stop\` 停止当前回答
• \`/compact\` 压缩上下文

⚙️ **会话管理**
• \`/session new\` 开启新话题
• \`/sessions\` 列出会话
• \`/rename <新名称>\` 重命名会话
• \`/project list\` 列出可用项目
• \`/status\` 查看当前状态
• \`/clear\` 重置对话上下文

💡 **提示**
• 切换的模型/角色仅对当前会话生效。`;
  }

  private getPlatformDisplayName(): string {
    switch (this.platform) {
      case 'whatsapp':
        return 'WhatsApp';
      case 'telegram':
        return 'Telegram';
      case 'discord':
        return 'Discord';
      case 'qq':
        return 'QQ';
      case 'wecom':
        return '企业微信';
      case 'dingtalk':
        return '钉钉';
      default:
        return this.platform;
    }
  }

  private async handleStatus(chatId: string, sender: PlatformSender): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation(this.platform, chatId);
    const session = chatSessionStore.getSessionByConversation(this.platform, chatId);

    const lines: string[] = ['🤖 **OpenCode 状态**\n'];

    if (sessionId) {
      lines.push(`当前会话 ID: ${sessionId}`);
      if (session?.resolvedDirectory) {
        lines.push(`工作目录: ${session.resolvedDirectory}`);
      }
      if (session?.preferredModel) {
        lines.push(`当前模型: ${session.preferredModel}`);
      }
      if (session?.preferredAgent) {
        lines.push(`当前角色: ${session.preferredAgent}`);
      }
      if (session?.preferredEffort) {
        lines.push(`当前强度: ${session.preferredEffort}`);
      }
    } else {
      lines.push('未绑定会话，发送消息将自动创建新会话。');
    }

    await this.sendText(sender, chatId, lines.join('\n'));
  }

  private async handleNewSession(
    chatId: string,
    userId: string,
    chatType: 'p2p' | 'group',
    sessionDirectory?: string,
    sessionName?: string,
    sender?: PlatformSender
  ): Promise<void> {
    if (!sender) return;

    const title = sessionName || `${this.getPlatformDisplayName()}会话-${buildSessionTimestamp()}`;

    let effectiveDir: string | undefined;
    if (sessionDirectory) {
      const dirResult = DirectoryPolicy.resolve({ explicitDirectory: sessionDirectory });
      if (!dirResult.ok) {
        await this.sendText(sender, chatId, dirResult.userMessage);
        return;
      }
      effectiveDir = dirResult.source === 'server_default' ? undefined : dirResult.directory;
    } else {
      const chatDefault = chatSessionStore.getSessionByConversation(this.platform, chatId)?.defaultDirectory;
      const dirResult = DirectoryPolicy.resolve({ chatDefaultDirectory: chatDefault });
      effectiveDir = dirResult.ok && dirResult.source !== 'server_default' ? dirResult.directory : undefined;
    }

    try {
      const session = await opencodeClient.createSession(title, effectiveDir);
      if (session) {
        chatSessionStore.setSessionByConversation(
          this.platform,
          chatId,
          session.id,
          userId,
          title,
          { chatType, resolvedDirectory: session.directory }
        );

        const lines = ['✅ 已创建新会话'];
        lines.push(`ID: ${session.id}`);
        if (session.directory) {
          lines.push(`工作目录: ${session.directory}`);
        }
        await this.sendText(sender, chatId, lines.join('\n'));
      } else {
        await this.sendText(sender, chatId, '❌ 创建会话失败');
      }
    } catch (error) {
      console.error(`[${this.platform}] 创建会话失败:`, error);
      await this.sendText(sender, chatId, '❌ 创建会话失败，请稍后重试');
    }
  }

  private async handleListSessions(chatId: string, listAll: boolean, sender: PlatformSender): Promise<void> {
    const sessionData = chatSessionStore.getSessionByConversation(this.platform, chatId);
    const currentDirectory = sessionData?.resolvedDirectory || sessionData?.defaultDirectory;

    let sessions: Awaited<ReturnType<typeof opencodeClient.listSessions>> = [];

    try {
      if (listAll) {
        const storeKnownDirs = chatSessionStore.getKnownDirectories();
        sessions = await opencodeClient.listAllSessions(storeKnownDirs);
      } else {
        sessions = await opencodeClient.listSessions(currentDirectory ? { directory: currentDirectory } : undefined);
      }
    } catch (error) {
      console.warn(`[${this.platform}] 获取会话列表失败:`, error);
    }

    if (sessions.length === 0) {
      await this.sendText(sender, chatId, '暂无可用会话');
      return;
    }

    const lines = sessions.slice(0, 20).map((session, index) => {
      const title = session.title || '未命名会话';
      const shortId = session.id.slice(0, 8);
      return `${index + 1}. ${title} (${shortId})`;
    });

    const header = `📚 会话列表（总计 ${sessions.length}）`;
    const hint = listAll ? '' : '\n💡 使用 `/sessions all` 查看所有项目会话';

    await this.sendText(sender, chatId, `${header}\n\n${lines.join('\n')}${hint}`);
  }

  private async handleProjectList(chatId: string, sender: PlatformSender): Promise<void> {
    const storeKnownDirs = chatSessionStore.getKnownDirectories();
    const projects = DirectoryPolicy.listAvailableProjects(storeKnownDirs);

    if (projects.length === 0) {
      await this.sendText(sender, chatId, '暂无可用项目');
      return;
    }

    const lines = projects.map((project, index) => {
      const tag = project.source === 'alias' ? '[别名]' : '[目录]';
      return `${index + 1}. ${tag} ${project.name} — ${project.directory}`;
    });

    await this.sendText(sender, chatId, `📋 可用项目列表\n\n${lines.join('\n')}`);
  }

  private async handleCompact(chatId: string, sender: PlatformSender): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation(this.platform, chatId);
    if (!sessionId) {
      await this.sendText(sender, chatId, '当前没有活跃的会话');
      return;
    }

    try {
      // 尝试获取一个支持 summarize 的模型
      const providersResult = await opencodeClient.getProviders();
      const providers = Array.isArray(providersResult.providers) ? providersResult.providers : [];
      const model = this.findCompactionModel(providers);

      if (!model) {
        await this.sendText(sender, chatId, '未找到可用模型，无法执行上下文压缩');
        return;
      }

      await this.sendText(sender, chatId, `正在压缩上下文（模型: ${model.providerId}:${model.modelId}）...`);
      const success = await opencodeClient.summarizeSession(sessionId, model.providerId, model.modelId);
      if (success) {
        await this.sendText(sender, chatId, `上下文压缩完成`);
      } else {
        await this.sendText(sender, chatId, `上下文压缩失败`);
      }
    } catch (error) {
      console.error(`[${this.platform}] 压缩失败:`, error);
      await this.sendText(sender, chatId, '上下文压缩失败');
    }
  }

  private findCompactionModel(providers: unknown[]): { providerId: string; modelId: string } | null {
    for (const provider of providers) {
      if (!provider || typeof provider !== 'object') continue;

      const record = provider as Record<string, unknown>;
      const providerId = typeof record.id === 'string' ? record.id : undefined;
      if (!providerId) continue;

      const models = this.extractProviderModelIds(provider);
      for (const modelId of models) {
        if (modelId.includes('summarize') || modelId.includes('compact')) {
          return { providerId, modelId };
        }
      }
    }

    // 回退到第一个可用模型
    for (const provider of providers) {
      if (!provider || typeof provider !== 'object') continue;
      const record = provider as Record<string, unknown>;
      const providerId = typeof record.id === 'string' ? record.id : undefined;
      if (!providerId) continue;
      const models = this.extractProviderModelIds(provider);
      if (models.length > 0) {
        return { providerId, modelId: models[0] };
      }
    }

    return null;
  }

  private extractProviderModelIds(provider: unknown): string[] {
    if (!provider || typeof provider !== 'object') return [];

    const record = provider as Record<string, unknown>;
    const rawModels = record.models;

    if (Array.isArray(rawModels)) {
      return rawModels
        .filter((m): m is Record<string, unknown> => m && typeof m === 'object')
        .map(m => typeof m.id === 'string' ? m.id : '')
        .filter(Boolean);
    }

    if (rawModels && typeof rawModels === 'object' && !Array.isArray(rawModels)) {
      return Object.keys(rawModels as Record<string, unknown>);
    }

    return [];
  }

  private async handleModel(
    chatId: string,
    userId: string,
    chatType: 'p2p' | 'group',
    modelName: string | undefined,
    sender: PlatformSender
  ): Promise<void> {
    let session = chatSessionStore.getSessionByConversation(this.platform, chatId);

    // 自动创建会话
    if (!session) {
      const title = `${this.getPlatformDisplayName()}会话-${buildSessionTimestamp()}`;
      const newSession = await opencodeClient.createSession(title);
      if (newSession) {
        chatSessionStore.setSessionByConversation(this.platform, chatId, newSession.id, userId, title, { chatType });
        session = chatSessionStore.getSessionByConversation(this.platform, chatId);
      } else {
        await this.sendText(sender, chatId, '❌ 无法创建会话');
        return;
      }
    }

    if (!modelName) {
      const envDefaultModel = modelConfig.defaultProvider && modelConfig.defaultModel
        ? `${modelConfig.defaultProvider}:${modelConfig.defaultModel}`
        : undefined;
      const currentModel = session?.preferredModel || envDefaultModel || '跟随 OpenCode 默认';
      await this.sendText(sender, chatId, `当前模型: ${currentModel}`);
      return;
    }

    try {
      const providersResult = await opencodeClient.getProviders();
      const providers = Array.isArray(providersResult.providers) ? providersResult.providers : [];
      const normalizedModelName = modelName.trim().toLowerCase();

      let matchedModel: ProviderModelMeta | null = null;

      for (const provider of providers) {
        const providerModels = this.extractProviderModels(provider);
        for (const candidate of providerModels) {
          const candidateValues = [
            `${candidate.providerId}:${candidate.modelId}`,
            `${candidate.providerId}/${candidate.modelId}`,
            candidate.modelId,
            candidate.modelName,
          ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

          if (candidateValues.some(item => item.toLowerCase() === normalizedModelName)) {
            matchedModel = candidate;
            break;
          }
        }
        if (matchedModel) break;
      }

      if (matchedModel) {
        const newValue = `${matchedModel.providerId}:${matchedModel.modelId}`;
        chatSessionStore.updateConfigByConversation(this.platform, chatId, { preferredModel: newValue });
        await this.sendText(sender, chatId, `✅ 已切换模型: ${newValue}`);
      } else if (normalizedModelName.includes(':') || normalizedModelName.includes('/')) {
        const parsedModel = parseChatModelReference(modelName);
        if (parsedModel && !isChatModelAllowed(parsedModel.providerId, parsedModel.modelId)) {
          await this.sendText(sender, chatId, `❌ 模型 "${modelName.trim()}" 不在当前允许列表中`);
          return;
        }

        chatSessionStore.updateConfigByConversation(this.platform, chatId, { preferredModel: modelName.trim() });
        await this.sendText(sender, chatId, `⚠️ 已设置模型: ${modelName.trim()}（未在列表中验证）`);
      } else {
        await this.sendText(sender, chatId, `❌ 未找到模型 "${modelName}"`);
      }
    } catch (error) {
      console.error(`[${this.platform}] 设置模型失败:`, error);
      await this.sendText(sender, chatId, `❌ 设置模型失败`);
    }
  }

  private async handleModels(chatId: string, listAll: boolean, sender: PlatformSender): Promise<void> {
    try {
      const providersResult = await opencodeClient.getProviders();
      const providers = Array.isArray(providersResult.providers) ? providersResult.providers : [];

      const lines: string[] = ['📋 **可用模型列表**\n'];
      let totalCount = 0;

      for (const provider of providers) {
        const providerModels = this.extractProviderModels(provider);
        if (providerModels.length === 0) continue;

        const providerName = (provider as Record<string, unknown>).name || (provider as Record<string, unknown>).id || 'Unknown';
        lines.push(`**${providerName}**`);
        totalCount += providerModels.length;

        const visibleModels = listAll ? providerModels : providerModels.slice(0, 20);
        for (const model of visibleModels) {
          const modelDisplay = model.modelName || model.modelId;
          const modelKey = `${model.providerId}:${model.modelId}`;
          lines.push(`  • ${modelDisplay} (\`${modelKey}\`)`);
        }

        if (!listAll && providerModels.length > 20) {
          lines.push(`  _... 共 ${providerModels.length} 个模型_`);
        }
        lines.push('');
      }

      if (totalCount === 0) {
        lines.push('暂无可用模型');
      } else {
        lines.push(`💡 共 ${totalCount} 个模型，使用 \`/model <名称>\` 切换`);
      }

      // 消息可能很长，截断
      let result = lines.join('\n');
      if (result.length > 4000) {
        result = result.slice(0, 3900) + '\n\n... 列表过长，请使用 /model <关键词> 搜索';
      }

      await this.sendText(sender, chatId, result);
    } catch (error) {
      console.error(`[${this.platform}] 获取模型列表失败:`, error);
      await this.sendText(sender, chatId, '❌ 获取模型列表失败');
    }
  }

  private extractProviderModels(provider: unknown): ProviderModelMeta[] {
    if (!provider || typeof provider !== 'object') return [];

    const record = provider as Record<string, unknown>;
    const providerId = typeof record.id === 'string' ? record.id : undefined;
    if (!providerId) return [];

    const rawModels = record.models;
    const models: ProviderModelMeta[] = [];

    if (Array.isArray(rawModels)) {
      for (const m of rawModels) {
        if (!m || typeof m !== 'object') continue;
        const modelRecord = m as Record<string, unknown>;
        const modelId = typeof modelRecord.id === 'string' ? modelRecord.id : undefined;
        if (!modelId) continue;
        if (!isChatModelAllowed(providerId, modelId)) continue;

        models.push({
          providerId,
          modelId,
          modelName: typeof modelRecord.name === 'string' ? modelRecord.name : undefined,
          variants: this.extractEffortVariants(modelRecord),
        });
      }
    } else if (rawModels && typeof rawModels === 'object') {
      const modelMap = rawModels as Record<string, unknown>;
      for (const [key, value] of Object.entries(modelMap)) {
        if (value && typeof value === 'object') {
          const modelRecord = value as Record<string, unknown>;
          if (!isChatModelAllowed(providerId, key)) continue;
          models.push({
            providerId,
            modelId: key,
            modelName: typeof modelRecord.name === 'string' ? modelRecord.name : undefined,
            variants: this.extractEffortVariants(modelRecord),
          });
        }
      }
    }

    return models;
  }

  private extractEffortVariants(modelRecord: Record<string, unknown>): EffortLevel[] {
    const rawVariants = modelRecord.variants;
    if (!rawVariants || typeof rawVariants !== 'object' || Array.isArray(rawVariants)) return [];

    const variants = rawVariants as Record<string, unknown>;
    const efforts: EffortLevel[] = [];

    for (const key of Object.keys(variants)) {
      const normalized = normalizeEffortLevel(key);
      if (normalized && !efforts.includes(normalized)) {
        efforts.push(normalized);
      }
    }

    return this.sortEffortLevels(efforts);
  }

  private sortEffortLevels(efforts: EffortLevel[]): EffortLevel[] {
    const order = new Map<string, number>();
    EFFORT_DISPLAY_ORDER.forEach((value, index) => {
      order.set(value, index);
    });

    return [...efforts].sort((left, right) => {
      const leftOrder = order.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });
  }

  private async handleAgent(
    chatId: string,
    userId: string,
    chatType: 'p2p' | 'group',
    agentName: string | undefined,
    sender: PlatformSender
  ): Promise<void> {
    let session = chatSessionStore.getSessionByConversation(this.platform, chatId);

    if (!session) {
      const title = `${this.getPlatformDisplayName()}会话-${buildSessionTimestamp()}`;
      const newSession = await opencodeClient.createSession(title);
      if (newSession) {
        chatSessionStore.setSessionByConversation(this.platform, chatId, newSession.id, userId, title, { chatType });
        session = chatSessionStore.getSessionByConversation(this.platform, chatId);
      }
    }

    if (!agentName) {
      const currentAgent = session?.preferredAgent || '默认';
      await this.sendText(sender, chatId, `当前角色: ${currentAgent}`);
      return;
    }

    try {
      const config = await opencodeClient.getConfig();
      const agents = Array.isArray(config?.agents) ? config.agents : [];
      const visibleAgents = agents.filter((a: OpencodeAgentInfo) => a.name && !['compaction', 'title', 'summary'].includes(a.name));

      const normalizedAgentName = agentName.trim().toLowerCase();

      if (normalizedAgentName === 'off' || normalizedAgentName === 'default') {
        chatSessionStore.updateConfigByConversation(this.platform, chatId, { preferredAgent: undefined });
        await this.sendText(sender, chatId, '✅ 已切换为默认角色');
        return;
      }

      const matched = visibleAgents.find((a: OpencodeAgentInfo) =>
        a.name.toLowerCase() === normalizedAgentName ||
        (a.name.includes('/') && a.name.split('/').pop()?.toLowerCase() === normalizedAgentName)
      );

      if (matched) {
        chatSessionStore.updateConfigByConversation(this.platform, chatId, { preferredAgent: matched.name });
        await this.sendText(sender, chatId, `✅ 已切换角色: ${matched.name}`);
      } else {
        await this.sendText(sender, chatId, `❌ 未找到角色 "${agentName}"`);
      }
    } catch (error) {
      console.error(`[${this.platform}] 设置角色失败:`, error);
      await this.sendText(sender, chatId, '❌ 设置角色失败');
    }
  }

  private async handleAgents(chatId: string, sender: PlatformSender): Promise<void> {
    try {
      const agents = await opencodeClient.getAgents();
      const visibleAgents = agents.filter((a: OpencodeAgentInfo) =>
        a.name && !['compaction', 'title', 'summary'].includes(a.name)
      );

      if (visibleAgents.length === 0) {
        await this.sendText(sender, chatId, '暂无可用角色');
        return;
      }

      const lines: string[] = ['📋 **可用角色列表**\n'];

      for (const agent of visibleAgents) {
        const desc = agent.description ? ` - ${agent.description.slice(0, 80)}${agent.description.length > 80 ? '...' : ''}` : '';
        lines.push(`• **${agent.name}**${desc}`);
      }

      lines.push(`\n💡 共 ${visibleAgents.length} 个角色，使用 \`/agent <名称>\` 切换`);

      await this.sendText(sender, chatId, lines.join('\n'));
    } catch (error) {
      console.error(`[${this.platform}] 获取角色列表失败:`, error);
      await this.sendText(sender, chatId, '❌ 获取角色列表失败');
    }
  }

  private async handleEffort(
    chatId: string,
    userId: string,
    chatType: 'p2p' | 'group',
    command: ParsedCommand,
    sender: PlatformSender
  ): Promise<void> {
    let session = chatSessionStore.getSessionByConversation(this.platform, chatId);

    if (!session) {
      const title = `${this.getPlatformDisplayName()}会话-${buildSessionTimestamp()}`;
      const newSession = await opencodeClient.createSession(title);
      if (newSession) {
        chatSessionStore.setSessionByConversation(this.platform, chatId, newSession.id, userId, title, { chatType });
        session = chatSessionStore.getSessionByConversation(this.platform, chatId);
      }
    }

    const currentEffort = session?.preferredEffort;
    const support = await this.getEffortSupportInfo(chatId);
    const supportText = this.formatEffortList(support.supportedEfforts);

    if (command.effortReset) {
      chatSessionStore.updateConfigByConversation(this.platform, chatId, { preferredEffort: undefined });
      await this.sendText(sender, chatId, `✅ 已清除会话强度\n可选强度: ${supportText}`);
      return;
    }

    if (command.effortRaw && !command.effortLevel) {
      await this.sendText(sender, chatId, `❌ 不支持的强度: ${command.effortRaw}\n${EFFORT_USAGE_TEXT}\n可选强度: ${supportText}`);
      return;
    }

    if (!command.effortLevel) {
      await this.sendText(sender, chatId, [
        `当前强度: ${currentEffort || '默认'}`,
        `可选强度: ${supportText}`,
      ].join('\n'));
      return;
    }

    chatSessionStore.updateConfigByConversation(this.platform, chatId, { preferredEffort: command.effortLevel });
    await this.sendText(sender, chatId, `✅ 已设置会话强度: ${command.effortLevel}`);
  }

  private async getEffortSupportInfo(chatId: string): Promise<EffortSupportInfo> {
    const session = chatSessionStore.getSessionByConversation(this.platform, chatId);
    const preferredModel = session?.preferredModel;

    if (!preferredModel) {
      return { model: null, supportedEfforts: [...KNOWN_EFFORT_LEVELS], modelMatched: false };
    }

    const [providerId, modelId] = preferredModel.includes(':')
      ? preferredModel.split(':')
      : preferredModel.includes('/')
        ? preferredModel.split('/')
        : [undefined, preferredModel];

    if (!providerId || !modelId) {
      return { model: null, supportedEfforts: [...KNOWN_EFFORT_LEVELS], modelMatched: false };
    }

    try {
      const providersResult = await opencodeClient.getProviders();
      const providers = Array.isArray(providersResult.providers) ? providersResult.providers : [];

      for (const provider of providers) {
        const models = this.extractProviderModels(provider);
        const matched = models.find(m =>
          m.providerId.toLowerCase() === providerId.toLowerCase() &&
          m.modelId.toLowerCase() === modelId.toLowerCase()
        );

        if (matched) {
          return {
            model: { providerId: matched.providerId, modelId: matched.modelId },
            supportedEfforts: matched.variants.length > 0 ? matched.variants : [...KNOWN_EFFORT_LEVELS],
            modelMatched: true,
          };
        }
      }
    } catch (error) {
      console.warn(`[${this.platform}] 获取模型支持强度失败:`, error);
    }

    return { model: { providerId, modelId }, supportedEfforts: [...KNOWN_EFFORT_LEVELS], modelMatched: false };
  }

  private formatEffortList(efforts: EffortLevel[]): string {
    return efforts.join(' / ');
  }

  private async handlePanel(chatId: string, sender: PlatformSender): Promise<void> {
    // WhatsApp 等平台不支持卡片，使用文本形式
    const session = chatSessionStore.getSessionByConversation(this.platform, chatId);

    const lines = ['🎛️ **控制面板**\n'];
    lines.push('**当前状态**');

    if (session) {
      lines.push(`会话 ID: ${session.sessionId?.slice(0, 8) || '未知'}...`);
      lines.push(`模型: ${session.preferredModel || '默认'}`);
      lines.push(`角色: ${session.preferredAgent || '默认'}`);
      lines.push(`强度: ${session.preferredEffort || '默认'}`);
    } else {
      lines.push('未绑定会话');
    }

    lines.push('\n**快捷命令**');
    lines.push('• /model <名称> - 切换模型');
    lines.push('• /agent <名称> - 切换角色');
    lines.push('• /effort <档位> - 设置强度');
    lines.push('• /session new - 新建会话');
    lines.push('• /help - 查看帮助');

    await this.sendText(sender, chatId, lines.join('\n'));
  }

  private async handleUndo(chatId: string, sender: PlatformSender): Promise<void> {
    const sessionId = chatSessionStore.getSessionIdByConversation(this.platform, chatId);
    if (!sessionId) {
      await this.sendText(sender, chatId, '当前没有活跃的会话');
      return;
    }

    try {
      const messages = await opencodeClient.getSessionMessages(sessionId);
      if (!messages || messages.length < 2) {
        await this.sendText(sender, chatId, '没有可撤回的消息');
        return;
      }

      // 找到倒数第二条消息（用户消息）进行撤回
      const targetMessage = messages[messages.length - 2];
      if (targetMessage?.info?.id) {
        await opencodeClient.revertMessage(sessionId, targetMessage.info.id);
        await this.sendText(sender, chatId, '已撤回上一轮对话');
      } else {
        await this.sendText(sender, chatId, '没有可撤回的消息');
      }
    } catch (error) {
      console.error(`[${this.platform}] 撤回失败:`, error);
      await this.sendText(sender, chatId, '撤回失败');
    }
  }

  private async handleRename(chatId: string, newTitle: string | undefined, sender: PlatformSender): Promise<void> {
    const session = chatSessionStore.getSessionByConversation(this.platform, chatId);
    if (!session?.sessionId) {
      await this.sendText(sender, chatId, '❌ 当前没有活跃的会话');
      return;
    }

    if (!newTitle || !newTitle.trim()) {
      await this.sendText(sender, chatId, '用法: /rename <新名称>');
      return;
    }

    const trimmedTitle = newTitle.trim();
    if (trimmedTitle.length > 100) {
      await this.sendText(sender, chatId, `❌ 名称过长（${trimmedTitle.length} 字符），请控制在 100 字符以内`);
      return;
    }

    try {
      const success = await opencodeClient.updateSession(session.sessionId, trimmedTitle);
      if (success) {
        chatSessionStore.updateTitleByConversation(this.platform, chatId, trimmedTitle);
        await this.sendText(sender, chatId, `✅ 会话已重命名为 "${trimmedTitle}"`);
      } else {
        await this.sendText(sender, chatId, '❌ 重命名失败');
      }
    } catch (error) {
      console.error(`[${this.platform}] 重命名失败:`, error);
      await this.sendText(sender, chatId, '❌ 重命名失败');
    }
  }
}
