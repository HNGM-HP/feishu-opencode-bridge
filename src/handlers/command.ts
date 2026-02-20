import { type ParsedCommand, getHelpText } from '../commands/parser.js';
import { KNOWN_EFFORT_LEVELS, normalizeEffortLevel, type EffortLevel } from '../commands/effort.js';
import { feishuClient } from '../feishu/client.js';
import {
  opencodeClient,
  type OpencodeAgentConfig,
  type OpencodeAgentInfo,
  type OpencodeRuntimeConfig,
} from '../opencode/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { buildControlCard, buildStatusCard } from '../feishu/cards.js';
import { modelConfig, userConfig } from '../config.js';
import { lifecycleHandler } from './lifecycle.js';

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
const PANEL_MODEL_OPTION_LIMIT = 500;
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

interface BuiltinAgentTranslationRule {
  names: string[];
  descriptionStartsWith: string;
  translated: string;
}

const BUILTIN_AGENT_TRANSLATION_RULES: BuiltinAgentTranslationRule[] = [
  {
    names: ['build', 'default'],
    descriptionStartsWith: 'the default agent. executes tools based on configured permissions.',
    translated: '默认执行角色（按权限自动调用工具）',
  },
  {
    names: ['plan'],
    descriptionStartsWith: 'plan mode. disallows all edit tools.',
    translated: '规划模式（禁用编辑类工具）',
  },
  {
    names: ['general'],
    descriptionStartsWith: 'general-purpose agent for researching complex questions and executing multi-step tasks.',
    translated: '通用研究子角色（复杂任务/并行执行）',
  },
  {
    names: ['explore'],
    descriptionStartsWith: 'fast agent specialized for exploring codebases.',
    translated: '代码库探索子角色（快速检索与定位）',
  },
];

function normalizeAgentText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

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
  private parseProviderModel(raw?: string): { providerId: string; modelId: string } | null {
    if (!raw) {
      return null;
    }

    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }

    const separator = trimmed.includes(':') ? ':' : (trimmed.includes('/') ? '/' : '');
    if (!separator) {
      return null;
    }

    const splitIndex = trimmed.indexOf(separator);
    const providerId = trimmed.slice(0, splitIndex).trim();
    const modelId = trimmed.slice(splitIndex + 1).trim();
    if (!providerId || !modelId) {
      return null;
    }

    return { providerId, modelId };
  }

  private extractProviderId(provider: unknown): string | undefined {
    if (!provider || typeof provider !== 'object') {
      return undefined;
    }

    const record = provider as Record<string, unknown>;
    const rawId = record.id;
    if (typeof rawId !== 'string') {
      return undefined;
    }

    const normalized = rawId.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private extractProviderModelIds(provider: unknown): string[] {
    if (!provider || typeof provider !== 'object') {
      return [];
    }

    const record = provider as Record<string, unknown>;
    const rawModels = record.models;
    if (Array.isArray(rawModels)) {
      const modelIds: string[] = [];
      for (const model of rawModels) {
        if (!model || typeof model !== 'object') {
          continue;
        }
        const modelRecord = model as Record<string, unknown>;
        const modelId = typeof modelRecord.id === 'string' ? modelRecord.id.trim() : '';
        if (modelId) {
          modelIds.push(modelId);
        }
      }
      return modelIds;
    }

    if (!rawModels || typeof rawModels !== 'object') {
      return [];
    }

    const modelMap = rawModels as Record<string, unknown>;
    const modelIds: string[] = [];
    for (const [key, value] of Object.entries(modelMap)) {
      if (value && typeof value === 'object') {
        const modelRecord = value as Record<string, unknown>;
        const modelId = typeof modelRecord.id === 'string' ? modelRecord.id.trim() : '';
        if (modelId) {
          modelIds.push(modelId);
          continue;
        }
      }

      const normalizedKey = key.trim();
      if (normalizedKey) {
        modelIds.push(normalizedKey);
      }
    }

    return modelIds;
  }

  private extractEffortVariants(modelRecord: Record<string, unknown>): EffortLevel[] {
    const rawVariants = modelRecord.variants;
    if (!rawVariants || typeof rawVariants !== 'object' || Array.isArray(rawVariants)) {
      return [];
    }

    const variants = rawVariants as Record<string, unknown>;
    const efforts: EffortLevel[] = [];
    for (const key of Object.keys(variants)) {
      const normalized = normalizeEffortLevel(key);
      if (!normalized || efforts.includes(normalized)) {
        continue;
      }
      efforts.push(normalized);
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
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.localeCompare(right);
    });
  }

  private extractProviderModels(provider: unknown): ProviderModelMeta[] {
    if (!provider || typeof provider !== 'object') {
      return [];
    }

    const providerId = this.extractProviderId(provider);
    if (!providerId) {
      return [];
    }

    const record = provider as Record<string, unknown>;
    const rawModels = record.models;
    const models: ProviderModelMeta[] = [];
    const dedupe = new Set<string>();

    const pushModel = (rawModel: unknown, fallbackId?: string): void => {
      const fallbackNormalized = typeof fallbackId === 'string' ? fallbackId.trim() : '';
      if (!rawModel || typeof rawModel !== 'object') {
        if (!fallbackNormalized) {
          return;
        }

        const key = `${providerId.toLowerCase()}:${fallbackNormalized.toLowerCase()}`;
        if (dedupe.has(key)) {
          return;
        }
        dedupe.add(key);
        models.push({
          providerId,
          modelId: fallbackNormalized,
          variants: [],
        });
        return;
      }

      const modelRecord = rawModel as Record<string, unknown>;
      const modelId = typeof modelRecord.id === 'string' && modelRecord.id.trim()
        ? modelRecord.id.trim()
        : fallbackNormalized;
      if (!modelId) {
        return;
      }

      const modelName = typeof modelRecord.name === 'string' && modelRecord.name.trim()
        ? modelRecord.name.trim()
        : undefined;
      const variants = this.extractEffortVariants(modelRecord);
      const key = `${providerId.toLowerCase()}:${modelId.toLowerCase()}`;
      if (dedupe.has(key)) {
        return;
      }

      dedupe.add(key);
      models.push({
        providerId,
        modelId,
        ...(modelName ? { modelName } : {}),
        variants,
      });
    };

    if (Array.isArray(rawModels)) {
      for (const rawModel of rawModels) {
        pushModel(rawModel);
      }
      return models;
    }

    if (!rawModels || typeof rawModels !== 'object') {
      return models;
    }

    const modelMap = rawModels as Record<string, unknown>;
    for (const [modelKey, rawModel] of Object.entries(modelMap)) {
      pushModel(rawModel, modelKey);
    }

    return models;
  }

  private isSameIdentifier(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
  }

  private findProviderModel(
    providers: unknown[],
    providerId: string,
    modelId: string
  ): ProviderModelMeta | null {
    for (const provider of providers) {
      const providerModels = this.extractProviderModels(provider);
      for (const model of providerModels) {
        if (!this.isSameIdentifier(model.providerId, providerId)) {
          continue;
        }
        if (!this.isSameIdentifier(model.modelId, modelId)) {
          continue;
        }
        return model;
      }
    }
    return null;
  }

  private resolveModelFromProviderPayload(
    chatId: string,
    providersResult: Awaited<ReturnType<typeof opencodeClient.getProviders>>
  ): { providerId: string; modelId: string } | null {
    const session = chatSessionStore.getSession(chatId);
    const preferredModel = this.parseProviderModel(session?.preferredModel);
    if (preferredModel) {
      return preferredModel;
    }

    if (modelConfig.defaultProvider && modelConfig.defaultModel) {
      return {
        providerId: modelConfig.defaultProvider,
        modelId: modelConfig.defaultModel,
      };
    }

    const providersRaw = Array.isArray(providersResult.providers) ? providersResult.providers : [];
    const defaultsRaw = providersResult.default;
    const defaults = defaultsRaw && typeof defaultsRaw === 'object'
      ? defaultsRaw as Record<string, unknown>
      : {};

    const availableProviderIds = new Set<string>();
    for (const provider of providersRaw) {
      const providerId = this.extractProviderId(provider);
      if (providerId) {
        availableProviderIds.add(providerId);
      }
    }

    const preferredProviders = ['openai', 'opencode'];
    for (const providerId of preferredProviders) {
      const defaultModel = defaults[providerId];
      if (typeof defaultModel === 'string' && defaultModel.trim() && availableProviderIds.has(providerId)) {
        return {
          providerId,
          modelId: defaultModel.trim(),
        };
      }
    }

    for (const provider of providersRaw) {
      const providerId = this.extractProviderId(provider);
      if (!providerId) {
        continue;
      }

      const defaultModel = defaults[providerId];
      if (typeof defaultModel === 'string' && defaultModel.trim()) {
        return {
          providerId,
          modelId: defaultModel.trim(),
        };
      }
    }

    for (const provider of providersRaw) {
      const providerId = this.extractProviderId(provider);
      if (!providerId) {
        continue;
      }

      const modelIds = this.extractProviderModelIds(provider);
      if (modelIds.length > 0) {
        return {
          providerId,
          modelId: modelIds[0],
        };
      }
    }

    return null;
  }

  private async getEffortSupportInfo(chatId: string): Promise<EffortSupportInfo> {
    const providersResult = await opencodeClient.getProviders();
    const model = this.resolveModelFromProviderPayload(chatId, providersResult);
    if (!model) {
      return {
        model: null,
        supportedEfforts: [],
        modelMatched: false,
      };
    }

    const providersRaw = Array.isArray(providersResult.providers) ? providersResult.providers : [];
    const matchedModel = this.findProviderModel(providersRaw, model.providerId, model.modelId);
    if (!matchedModel) {
      return {
        model,
        supportedEfforts: [],
        modelMatched: false,
      };
    }

    return {
      model,
      supportedEfforts: matchedModel.variants,
      modelMatched: true,
    };
  }

  private formatModelLabel(model: { providerId: string; modelId: string } | null): string {
    if (!model) {
      return '未知';
    }
    return `${model.providerId}:${model.modelId}`;
  }

  private formatEffortList(efforts: EffortLevel[]): string {
    if (efforts.length === 0) {
      return '该模型未公开可选强度';
    }
    return efforts.join(' / ');
  }

  public async reconcilePreferredEffort(chatId: string): Promise<{ clearedEffort?: EffortLevel; support: EffortSupportInfo }> {
    const session = chatSessionStore.getSession(chatId);
    const currentEffort = session?.preferredEffort;
    const support = await this.getEffortSupportInfo(chatId);
    if (!currentEffort || !support.modelMatched) {
      return { support };
    }

    if (support.supportedEfforts.includes(currentEffort)) {
      return { support };
    }

    chatSessionStore.updateConfig(chatId, { preferredEffort: undefined });
    return {
      clearedEffort: currentEffort,
      support,
    };
  }

  private async resolveCompactModel(chatId: string): Promise<{ providerId: string; modelId: string } | null> {
    const providersResult = await opencodeClient.getProviders();
    return this.resolveModelFromProviderPayload(chatId, providersResult);
  }

  private async resolveShellAgent(chatId: string): Promise<string> {
    const fallbackAgent = 'general';
    const preferredAgentRaw = chatSessionStore.getSession(chatId)?.preferredAgent;
    const preferredAgent = typeof preferredAgentRaw === 'string' ? preferredAgentRaw.trim() : '';

    if (!preferredAgent) {
      return fallbackAgent;
    }

    try {
      const agents = await opencodeClient.getAgents();
      if (!Array.isArray(agents) || agents.length === 0) {
        return fallbackAgent;
      }

      const exact = agents.find(item => item.name === preferredAgent);
      if (exact) {
        return exact.name;
      }

      const preferredLower = preferredAgent.toLowerCase();
      const caseInsensitive = agents.find(item => item.name.toLowerCase() === preferredLower);
      if (caseInsensitive) {
        return caseInsensitive.name;
      }

      const hasFallback = agents.some(item => item.name === fallbackAgent);
      if (hasFallback) {
        return fallbackAgent;
      }

      return agents[0].name;
    } catch {
      return fallbackAgent;
    }
  }

  private async handleCompact(chatId: string, messageId: string): Promise<void> {
    const sessionId = chatSessionStore.getSessionId(chatId);
    if (!sessionId) {
      await feishuClient.reply(messageId, '❌ 当前没有活跃的会话，请先发送消息建立会话');
      return;
    }

    const model = await this.resolveCompactModel(chatId);
    if (!model) {
      await feishuClient.reply(messageId, '❌ 未找到可用模型，无法执行上下文压缩');
      return;
    }

    const compacted = await opencodeClient.summarizeSession(sessionId, model.providerId, model.modelId);
    if (!compacted) {
      await feishuClient.reply(messageId, `❌ 上下文压缩失败（模型: ${model.providerId}:${model.modelId}）`);
      return;
    }

    await feishuClient.reply(messageId, `✅ 上下文压缩完成（模型: ${model.providerId}:${model.modelId}）`);
  }

  private getPrivateSessionShortId(userId: string): string {
    const normalized = userId.startsWith('ou_') ? userId.slice(3) : userId;
    return normalized.slice(0, 4);
  }

  private buildSessionTitle(chatType: 'p2p' | 'group', userId: string): string {
    if (chatType === 'p2p') {
      const shortUserId = this.getPrivateSessionShortId(userId);
      return `飞书私聊${shortUserId || '用户'}`;
    }

    return `群聊重置-${Date.now().toString().slice(-4)}`;
  }

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
            await this.handleNewSession(chatId, messageId, context.senderId, context.chatType);
          } else if (command.sessionAction === 'list') {
            await this.handleListSessions(chatId, messageId);
          } else if (command.sessionAction === 'switch' && command.sessionId) {
            await this.handleSwitchSession(chatId, messageId, context.senderId, command.sessionId, context.chatType);
          } else {
            await feishuClient.reply(messageId, '用法: /session（列出会话） 或 /session new 或 /session <sessionId>');
          }
          break;

        case 'clear':
          console.log(`[Command] clear 命令, clearScope=${command.clearScope}`);
          if (command.clearScope === 'free_session') {
            // 清理空闲群聊
            await this.handleClearFreeSession(chatId, messageId);
          } else {
            // 清空当前对话上下文（默认行为）
            await this.handleNewSession(chatId, messageId, context.senderId, context.chatType); 
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

        case 'compact':
          await this.handleCompact(chatId, messageId);
          break;

        case 'command':
          // 未知命令透传到 OpenCode
          await this.handlePassthroughCommand(
            chatId,
            messageId,
            command.commandName || '',
            command.commandArgs || '',
            command.commandPrefix || '/'
          );
          break;

        case 'model':
          await this.handleModel(chatId, messageId, context.senderId, context.chatType, command.modelName);
          break;

        case 'agent':
          await this.handleAgent(chatId, messageId, context.senderId, context.chatType, command.agentName);
          break;

        case 'effort':
          await this.handleEffort(chatId, messageId, context.senderId, context.chatType, command);
          break;

        case 'role':
          if (command.roleAction === 'create') {
            await this.handleRoleCreate(chatId, messageId, context.senderId, context.chatType, command.roleSpec || '');
          } else {
            await feishuClient.reply(messageId, `支持的角色命令:\n- ${ROLE_CREATE_USAGE}`);
          }
          break;

        case 'undo':
          await this.handleUndo(chatId, messageId);
          break;

        case 'panel':
          await this.handlePanel(chatId, messageId, context.chatType);
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

  private async handleNewSession(
    chatId: string,
    messageId: string,
    userId: string,
    chatType: 'p2p' | 'group'
  ): Promise<void> {
    // 1. 创建新会话
    const title = this.buildSessionTitle(chatType, userId);
    const session = await opencodeClient.createSession(title);
    
    if (session) {
      // 2. 更新绑定
      chatSessionStore.setSession(chatId, session.id, userId, title, { chatType });
      await feishuClient.reply(messageId, `✅ 已创建新会话窗口\nID: ${session.id}`);
    } else {
      await feishuClient.reply(messageId, '❌ 创建会话失败');
    }
  }

  private async handleSwitchSession(
    chatId: string,
    messageId: string,
    userId: string,
    targetSessionId: string,
    chatType: 'p2p' | 'group'
  ): Promise<void> {
    if (!userConfig.enableManualSessionBind) {
      await feishuClient.reply(messageId, '❌ 当前环境未开启“绑定已有会话”能力');
      return;
    }

    const normalizedSessionId = targetSessionId.trim();
    if (!normalizedSessionId) {
      await feishuClient.reply(messageId, '❌ 会话 ID 不能为空');
      return;
    }

    const sessions = await opencodeClient.listSessions();
    const targetSession = sessions.find(item => item.id === normalizedSessionId);
    if (!targetSession) {
      await feishuClient.reply(messageId, `❌ 未找到会话: ${normalizedSessionId}`);
      return;
    }

    const previousChatId = chatSessionStore.getChatId(normalizedSessionId);
    const migrated = previousChatId && previousChatId !== chatId;
    if (migrated && previousChatId) {
      chatSessionStore.removeSession(previousChatId);
    }

    const title = targetSession.title && targetSession.title.trim().length > 0
      ? targetSession.title
      : `手动绑定-${normalizedSessionId.slice(-4)}`;

    chatSessionStore.setSession(
      chatId,
      normalizedSessionId,
      userId,
      title,
      { protectSessionDelete: true, chatType }
    );

    const replyLines = [
      '✅ 已切换到指定会话',
      `ID: ${normalizedSessionId}`,
      '🔒 自动清理不会删除该 OpenCode 会话。',
    ];
    if (migrated) {
      replyLines.push('🔁 该会话原绑定的旧群已自动解绑。');
    }

    await feishuClient.reply(messageId, replyLines.join('\n'));
  }

  private async handleListSessions(chatId: string, messageId: string): Promise<void> {
    let sessions: Awaited<ReturnType<typeof opencodeClient.listSessions>> = [];
    let opencodeUnavailable = false;
    try {
      sessions = await opencodeClient.listSessions();
    } catch (error) {
      opencodeUnavailable = true;
      console.warn('[Command] 拉取 OpenCode 会话失败，回退到本地映射列表:', error);
    }

    const sortedSessions = [...sessions].sort((left, right) => {
      const rightTime = right.time?.updated ?? right.time?.created ?? 0;
      const leftTime = left.time?.updated ?? left.time?.created ?? 0;
      return rightTime - leftTime;
    });

    const localBindings = new Map<string, { chatIds: string[]; title?: string }>();
    for (const boundChatId of chatSessionStore.getAllChatIds()) {
      const binding = chatSessionStore.getSession(boundChatId);
      if (!binding?.sessionId) continue;

      const existing = localBindings.get(binding.sessionId);
      if (existing) {
        existing.chatIds.push(boundChatId);
        if (!existing.title && binding.title) {
          existing.title = binding.title;
        }
        continue;
      }

      localBindings.set(binding.sessionId, {
        chatIds: [boundChatId],
        title: binding.title,
      });
    }

    const tableHeader = 'SessionID | OpenCode侧会话名称 | 绑定群明细 | 当前会话状态';
    const rows: string[] = [];
    for (const session of sortedSessions) {
      const bindingInfo = localBindings.get(session.id);
      const title = session.title && session.title.trim().length > 0 ? session.title.trim() : '未命名会话';
      const chatDetail = bindingInfo ? bindingInfo.chatIds.join(', ') : '无';
      const status = bindingInfo ? 'OpenCode可用/已绑定' : 'OpenCode可用/未绑定';
      rows.push(`${session.id} | ${title} | ${chatDetail} | ${status}`);
      localBindings.delete(session.id);
    }

    for (const [sessionId, bindingInfo] of localBindings.entries()) {
      const localTitle = bindingInfo.title && bindingInfo.title.trim().length > 0
        ? bindingInfo.title.trim()
        : '本地绑定记录';
      rows.push(`${sessionId} | ${localTitle} | ${bindingInfo.chatIds.join(', ')} | 仅本地映射(可能已失活)`);
    }

    if (rows.length === 0) {
      const emptyMessage = opencodeUnavailable
        ? 'OpenCode 暂不可达，且当前无本地会话映射记录'
        : '当前无可用会话记录';
      await feishuClient.reply(messageId, emptyMessage);
      return;
    }

    const rowChunks: string[] = [];
    let currentRows = '';
    for (const row of rows) {
      if ((tableHeader.length + currentRows.length + row.length + 2) > 3000 && currentRows.length > 0) {
        rowChunks.push(currentRows.trimEnd());
        currentRows = '';
      }
      currentRows += `${row}\n`;
    }
    if (currentRows.trim().length > 0) {
      rowChunks.push(currentRows.trimEnd());
    }

    const chunks = rowChunks.map(chunk => `${tableHeader}\n${chunk}`);

    if (chunks.length === 0) {
      await feishuClient.reply(messageId, `${tableHeader}\n（无数据）`);
      return;
    }

    const totalCount = rows.length;
    const header = opencodeUnavailable
      ? `📚 会话列表（总计 ${totalCount}，OpenCode 暂不可达，仅展示本地映射）`
      : `📚 会话列表（总计 ${totalCount}）`;

    await feishuClient.reply(
      messageId,
      `${header}\n${chunks[0]}`
    );

    for (let index = 1; index < chunks.length; index++) {
      await feishuClient.sendText(chatId, `📚 会话列表（续 ${index + 1}/${chunks.length}）\n${chunks[index]}`);
    }
  }

  private async handleModel(
    chatId: string,
    messageId: string,
    userId: string,
    chatType: 'p2p' | 'group',
    modelName?: string
  ): Promise<void> {
    try {
      // 0. 确保会话存在
      let session = chatSessionStore.getSession(chatId);
      if (!session) {
         // 自动创建会话
         const title = `群聊会话-${chatId.slice(-4)}`;
          const newSession = await opencodeClient.createSession(title);
          if (newSession) {
              chatSessionStore.setSession(chatId, newSession.id, userId, title, { chatType });
              session = chatSessionStore.getSession(chatId);
          } else {
             await feishuClient.reply(messageId, '❌ 无法创建会话以保存配置');
             return;
         }
      }

      // 1. 如果没有提供模型名称，显示当前状态
      if (!modelName) {
        const envDefaultModel = modelConfig.defaultProvider && modelConfig.defaultModel
          ? `${modelConfig.defaultProvider}:${modelConfig.defaultModel}`
          : undefined;
        const currentModel = session?.preferredModel || envDefaultModel || '跟随 OpenCode 默认模型';
        await feishuClient.reply(messageId, `当前模型: ${currentModel}`);
        return;
      }

      const providersResult = await opencodeClient.getProviders();
      const providers = Array.isArray(providersResult.providers) ? providersResult.providers : [];
      const normalizedModelName = modelName.trim();
      const normalizedModelNameLower = normalizedModelName.toLowerCase();

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
          const isMatched = candidateValues.some(item => item.toLowerCase() === normalizedModelNameLower);
          if (!isMatched) {
            continue;
          }

          matchedModel = candidate;
          break;
        }

        if (matchedModel) {
          break;
        }
      }

      if (matchedModel) {
        // 3. 更新配置
        const newValue = `${matchedModel.providerId}:${matchedModel.modelId}`;
        chatSessionStore.updateConfig(chatId, { preferredModel: newValue });

        const lines = [`✅ 已切换模型: ${newValue}`];
        const reconciled = await this.reconcilePreferredEffort(chatId);
        if (reconciled.clearedEffort) {
          lines.push(
            `⚠️ 当前模型不支持强度 ${reconciled.clearedEffort}，已回退为默认（可选: ${this.formatEffortList(reconciled.support.supportedEfforts)}）`
          );
        }

        await feishuClient.reply(messageId, lines.join('\n'));
      } else {
        // 即使没找到匹配的，如果格式正确也允许强制设置（针对自定义或未列出的模型）
        if (normalizedModelName.includes(':') || normalizedModelName.includes('/')) {
             const separator = normalizedModelName.includes(':') ? ':' : '/';
             const [provider, model] = normalizedModelName.split(separator);
             const newValue = `${provider}:${model}`;
             chatSessionStore.updateConfig(chatId, { preferredModel: newValue });

             const currentEffort = chatSessionStore.getSession(chatId)?.preferredEffort;
             const warning = currentEffort
               ? '\n⚠️ 当前模型不在列表中，无法校验已设置强度是否兼容。'
               : '';
             await feishuClient.reply(messageId, `⚠️ 未在列表中找到该模型，但已强制设置为: ${newValue}${warning}`);
        } else {
             await feishuClient.reply(messageId, `❌ 未找到模型 "${normalizedModelName}"\n请使用 /panel 查看可用列表`);
        }
      }

    } catch (error) {
      await feishuClient.reply(messageId, `❌ 设置模型失败: ${error}`);
    }
  }

  private async handleEffort(
    chatId: string,
    messageId: string,
    userId: string,
    chatType: 'p2p' | 'group',
    command: ParsedCommand
  ): Promise<void> {
    try {
      // 0. 确保会话存在
      let session = chatSessionStore.getSession(chatId);
      if (!session) {
        const title = `群聊会话-${chatId.slice(-4)}`;
        const newSession = await opencodeClient.createSession(title);
        if (newSession) {
          chatSessionStore.setSession(chatId, newSession.id, userId, title, { chatType });
          session = chatSessionStore.getSession(chatId);
        } else {
          await feishuClient.reply(messageId, '❌ 无法创建会话以保存强度配置');
          return;
        }
      }

      const support = await this.getEffortSupportInfo(chatId);
      const currentEffort = session?.preferredEffort;
      const modelLabel = this.formatModelLabel(support.model);
      const supportText = this.formatEffortList(support.supportedEfforts);

      if (command.effortReset) {
        chatSessionStore.updateConfig(chatId, { preferredEffort: undefined });
        await feishuClient.reply(
          messageId,
          [
            currentEffort ? `✅ 已清除会话强度（原为: ${currentEffort}）` : '✅ 当前会话强度已是默认（自动）',
            `当前模型: ${modelLabel}`,
            `可选强度: ${supportText}`,
          ].join('\n')
        );
        return;
      }

      if (command.effortRaw && !command.effortLevel) {
        await feishuClient.reply(
          messageId,
          `❌ 不支持的强度: ${command.effortRaw}\n${EFFORT_USAGE_TEXT}\n可选强度: ${supportText}`
        );
        return;
      }

      if (!command.effortLevel) {
        await feishuClient.reply(
          messageId,
          [
            `当前强度: ${currentEffort || '默认（自动）'}`,
            `当前模型: ${modelLabel}`,
            `可选强度: ${supportText}`,
            '临时覆盖: 在消息开头使用 #low / #high / #max / #xhigh',
          ].join('\n')
        );
        return;
      }

      const requested = command.effortLevel;
      if (!support.modelMatched) {
        chatSessionStore.updateConfig(chatId, { preferredEffort: requested });
        await feishuClient.reply(
          messageId,
          `⚠️ 已设置会话强度: ${requested}\n当前模型: ${modelLabel}\n无法识别当前模型能力，暂无法校验兼容性。`
        );
        return;
      }

      if (!support.supportedEfforts.includes(requested)) {
        await feishuClient.reply(
          messageId,
          `❌ 当前模型不支持强度 ${requested}\n当前模型: ${modelLabel}\n可选强度: ${supportText}`
        );
        return;
      }

      chatSessionStore.updateConfig(chatId, { preferredEffort: requested });
      await feishuClient.reply(
        messageId,
        `✅ 已设置会话强度: ${requested}\n当前模型: ${modelLabel}`
      );
    } catch (error) {
      await feishuClient.reply(messageId, `❌ 设置强度失败: ${error}`);
    }
  }

  private getVisibleAgents(agents: OpencodeAgentInfo[]): OpencodeAgentInfo[] {
    return agents.filter(agent => agent.hidden !== true && !INTERNAL_HIDDEN_AGENT_NAMES.has(agent.name));
  }

  private getAgentModePrefix(agent: OpencodeAgentInfo): string {
    return agent.mode === 'subagent' ? '（子）' : '（主）';
  }

  private getBuiltinAgentTranslation(agent: OpencodeAgentInfo): string | undefined {
    const normalizedName = normalizeAgentText(agent.name);
    const normalizedDescription = normalizeAgentText(typeof agent.description === 'string' ? agent.description : '');

    for (const rule of BUILTIN_AGENT_TRANSLATION_RULES) {
      const byName = rule.names.includes(normalizedName);
      const byDescription = normalizedDescription.length > 0
        && normalizedDescription.startsWith(rule.descriptionStartsWith);
      if (byName || byDescription) {
        return rule.translated;
      }
    }

    return undefined;
  }

  private getAgentDisplayName(agent: OpencodeAgentInfo): string {
    const translatedBuiltinName = this.getBuiltinAgentTranslation(agent);
    if (translatedBuiltinName) {
      return translatedBuiltinName;
    }

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

    const byDisplayName = agents.find(agent => this.getAgentDisplayName(agent).toLowerCase() === lowered);
    if (byDisplayName) return byDisplayName;

    return agents.find(agent => this.getAgentDisplayText(agent).toLowerCase() === lowered);
  }

  private getCurrentRoleDisplay(currentAgentName: string | undefined, agents: OpencodeAgentInfo[]): string {
    if (!currentAgentName) return '默认角色';
    const found = agents.find(agent => agent.name === currentAgentName);
    if (found) return this.getAgentDisplayText(found);
    return currentAgentName;
  }

  private getRuntimeDefaultAgentName(config: OpencodeRuntimeConfig): string | undefined {
    const record = config as Record<string, unknown>;
    const rawValue = record.default_agent ?? record.defaultAgent;
    if (typeof rawValue !== 'string') {
      return undefined;
    }

    const normalized = rawValue.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private findAgentByNameInsensitive(agents: OpencodeAgentInfo[], name: string): OpencodeAgentInfo | undefined {
    const target = name.trim().toLowerCase();
    if (!target) return undefined;
    return agents.find(agent => agent.name.toLowerCase() === target);
  }

  private shouldHideDefaultRoleOption(defaultAgentName: string | undefined, agents: OpencodeAgentInfo[]): boolean {
    const buildAgent = this.findAgentByNameInsensitive(agents, 'build');
    if (!buildAgent) {
      return false;
    }

    if (!defaultAgentName) {
      return true;
    }

    return defaultAgentName.trim().toLowerCase() === 'build';
  }

  private getDefaultRoleDisplay(defaultAgentName: string | undefined, agents: OpencodeAgentInfo[]): string {
    if (defaultAgentName) {
      const defaultAgent = this.findAgentByNameInsensitive(agents, defaultAgentName);
      if (defaultAgent) {
        return this.getAgentDisplayText(defaultAgent);
      }
      return defaultAgentName;
    }

    const buildAgent = this.findAgentByNameInsensitive(agents, 'build');
    if (buildAgent) {
      return this.getAgentDisplayText(buildAgent);
    }

    return '默认角色';
  }

  private getRoleAgentMap(config: OpencodeRuntimeConfig): Record<string, OpencodeAgentConfig> {
    if (!config.agent || typeof config.agent !== 'object') {
      return {};
    }
    return config.agent;
  }

  private async handleRoleCreate(
    chatId: string,
    messageId: string,
    userId: string,
    chatType: 'p2p' | 'group',
    roleSpec: string
  ): Promise<void> {
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
      chatSessionStore.setSession(chatId, newSession.id, userId, title, { chatType });
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

  private async handleAgent(
    chatId: string,
    messageId: string,
    userId: string,
    chatType: 'p2p' | 'group',
    agentName?: string
  ): Promise<void> {
    try {
      // 0. 确保会话存在
      let session = chatSessionStore.getSession(chatId);
      if (!session) {
        // 自动创建会话
        const title = `群聊会话-${chatId.slice(-4)}`;
        const newSession = await opencodeClient.createSession(title);
        if (newSession) {
          chatSessionStore.setSession(chatId, newSession.id, userId, title, { chatType });
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

  private async buildPanelCard(chatId: string, chatType: 'p2p' | 'group' = 'group'): Promise<object> {
    const session = chatSessionStore.getSession(chatId);
    const currentModel = session?.preferredModel || '默认';
    const currentEffort = session?.preferredEffort || '默认（自动）';

    // 获取列表供卡片使用
    const [{ providers }, allAgents, runtimeConfig] = await Promise.all([
      opencodeClient.getProviders(),
      opencodeClient.getAgents(),
      opencodeClient.getConfig(),
    ]);

    const visibleAgents = this.getVisibleAgents(allAgents);
    const defaultAgentName = this.getRuntimeDefaultAgentName(runtimeConfig);
    const hideDefaultRoleOption = this.shouldHideDefaultRoleOption(defaultAgentName, visibleAgents);
    const currentAgent = session?.preferredAgent
      ? this.getCurrentRoleDisplay(session.preferredAgent, visibleAgents)
      : this.getDefaultRoleDisplay(defaultAgentName, visibleAgents);

    const modelOptions: { label: string; value: string }[] = [];
    const modelOptionValues = new Set<string>();
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
          const value = `${providerId}:${modelId}`;
          if (!modelOptionValues.has(value)) {
            modelOptionValues.add(value);
            modelOptions.push({ label, value });
          }
        }
      }
    }

    const selectedModel = session?.preferredModel || '';
    let panelModelOptions = modelOptions.slice(0, PANEL_MODEL_OPTION_LIMIT);
    if (selectedModel.includes(':') && panelModelOptions.every(item => item.value !== selectedModel)) {
      const matched = modelOptions.find(item => item.value === selectedModel);
      if (matched) {
        if (panelModelOptions.length >= PANEL_MODEL_OPTION_LIMIT) {
          panelModelOptions = [...panelModelOptions.slice(0, PANEL_MODEL_OPTION_LIMIT - 1), matched];
        } else {
          panelModelOptions = [...panelModelOptions, matched];
        }
      }
    }

    const mappedAgentOptions = visibleAgents.map(agent => ({
      label: this.getAgentDisplayText(agent),
      value: agent.name,
    }));

    const agentOptions = hideDefaultRoleOption
      ? mappedAgentOptions
      : [{ label: '（主）默认角色', value: 'none' }, ...mappedAgentOptions];

    return buildControlCard({
      conversationKey: `chat:${chatId}`,
      chatId,
      chatType,
      currentModel,
      currentAgent,
      currentEffort,
      models: panelModelOptions,
      agents: agentOptions,
    });
  }

  public async pushPanelCard(chatId: string, chatType: 'p2p' | 'group' = 'group'): Promise<void> {
    const card = await this.buildPanelCard(chatId, chatType);
    await feishuClient.sendCard(chatId, card);
  }

  private async handlePanel(chatId: string, messageId: string, chatType: 'p2p' | 'group'): Promise<void> {
    const card = await this.buildPanelCard(chatId, chatType);
    if (messageId) {
      await feishuClient.replyCard(messageId, card);
      return;
    }

    await feishuClient.sendCard(chatId, card);
  }

  private async handlePassthroughCommand(
    chatId: string,
    messageId: string,
    commandName: string,
    commandArgs: string,
    commandPrefix: '/' | '!' = '/'
  ): Promise<void> {
    const sessionId = chatSessionStore.getSessionId(chatId);
    if (!sessionId) {
      await feishuClient.reply(messageId, '❌ 当前没有活跃的会话，请先发送消息建立会话');
      return;
    }

    const shownCommand = commandPrefix === '!' ? `!${commandArgs}` : `/${commandName} ${commandArgs}`.trim();
    console.log(`[Command] 透传命令到 OpenCode: ${shownCommand}`);

    try {
      if (commandPrefix === '!') {
        const shellCommand = commandArgs.trim();
        if (!shellCommand) {
          await feishuClient.reply(messageId, '❌ 用法: !<shell命令>，例如 !ls');
          return;
        }

        const shellAgent = await this.resolveShellAgent(chatId);
        const result = await opencodeClient.sendShellCommand(sessionId, shellCommand, shellAgent);
        const output = this.formatOutput(result.parts);
        if (output !== '(无输出)') {
          await feishuClient.reply(messageId, output);
          return;
        }

        await feishuClient.reply(messageId, `✅ Shell 命令执行完成: !${shellCommand}`);
        return;
      }

      // 使用专门的 sendCommand 方法
      const result = await opencodeClient.sendCommand(sessionId, commandName, commandArgs);

      // 处理返回结果
      if (result && result.parts) {
        const output = this.formatOutput(result.parts);
        await feishuClient.reply(messageId, output);
      } else {
        await feishuClient.reply(messageId, `✅ 命令执行完成: ${shownCommand}`);
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
        const text = p.text.trim();
        if (text) {
          output.push(text);
        }
        continue;
      }

      if (p.type !== 'tool') {
        continue;
      }

      const state = p.state;
      if (!state || typeof state !== 'object') {
        continue;
      }

      const toolState = state as Record<string, unknown>;
      if (typeof toolState.output === 'string' && toolState.output.trim()) {
        output.push(toolState.output.trim());
        continue;
      }

      const metadata = toolState.metadata;
      if (metadata && typeof metadata === 'object') {
        const metadataRecord = metadata as Record<string, unknown>;
        if (typeof metadataRecord.output === 'string' && metadataRecord.output.trim()) {
          output.push(metadataRecord.output.trim());
          continue;
        }
      }

      if (typeof toolState.error === 'string' && toolState.error.trim()) {
        output.push(`工具执行失败: ${toolState.error.trim()}`);
      }
    }

    const merged = output.join('\n\n').trim();
    if (!merged) {
      return '(无输出)';
    }

    const maxLength = 3500;
    if (merged.length <= maxLength) {
      return merged;
    }

    return `${merged.slice(0, maxLength)}\n\n...（输出过长，已截断）`;
  }

  private async handleClearFreeSession(chatId: string, messageId: string): Promise<void> {
    await feishuClient.reply(messageId, '🧹 正在扫描并清理无效群聊...');
    const stats = await lifecycleHandler.runCleanupScan();

    await feishuClient.reply(
      messageId,
      `✅ 清理完成\n- 扫描群聊: ${stats.scannedChats} 个\n- 解散群聊: ${stats.disbandedChats} 个\n- 清理会话: ${stats.deletedSessions} 个\n- 跳过删除(受保护): ${stats.skippedProtectedSessions} 个\n- 移除孤儿映射: ${stats.removedOrphanMappings} 个`
    );
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
