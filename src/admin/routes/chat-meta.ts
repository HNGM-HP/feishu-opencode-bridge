import path from 'node:path';
import fs from 'node:fs/promises';
import express, { type Application, type Request, type Response } from 'express';
import { opencodeClient } from '../../opencode/client.js';
import { configStore } from '../../store/config-store.js';
import { chatAuthMiddleware } from './chat-auth.js';
import { KNOWN_EFFORT_LEVELS, normalizeEffortLevel } from '../../commands/effort.js';
import { skillRegistry } from '../../services/resources/skills/registry.js';
import { getMCPRegistry } from '../../services/resources/mcp/manager.js';
import { listSlashCommands as listMCPSlashCommands, toCommandItems as toMCPCommandItems } from '../../services/resources/mcp/slash.js';
import { listSlashCommands as listAgentSlashCommands, toCommandItems as toAgentCommandItems } from '../../services/resources/agents/slash.js';
import { modelConfig } from '../../config.js';

function errorMsg(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function splitDirectories(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) {
    return [];
  }

  return raw
    .split(/[\r\n,;]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function buildWorkspaceLabel(directory: string, preferredLabel?: string): string {
  const trimmedLabel = typeof preferredLabel === 'string' ? preferredLabel.trim() : '';
  if (trimmedLabel) {
    return `${trimmedLabel} · ${directory}`;
  }

  const baseName = path.basename(directory) || directory;
  return `${baseName} · ${directory}`;
}

function extractProviderId(provider: unknown): string | undefined {
  if (!provider || typeof provider !== 'object') {
    return undefined;
  }

  const record = provider as Record<string, unknown>;
  const rawId = typeof record.id === 'string' ? record.id.trim() : '';
  return rawId || undefined;
}

function extractEffortVariants(modelRecord: Record<string, unknown>): string[] {
  const rawVariants = modelRecord.variants;
  if (!rawVariants) {
    return [];
  }

  const values = Array.isArray(rawVariants)
    ? rawVariants
    : Object.keys(rawVariants as Record<string, unknown>);

  const variants: string[] = [];
  const dedupe = new Set<string>();
  for (const rawValue of values) {
    if (typeof rawValue !== 'string') {
      continue;
    }

    const value = rawValue.trim();
    if (!value) {
      continue;
    }

    const key = value.toLowerCase();
    if (dedupe.has(key)) {
      continue;
    }

    dedupe.add(key);
    variants.push(value);
  }

  const order = new Map<string, number>();
  KNOWN_EFFORT_LEVELS.forEach((value, index) => {
    order.set(value, index);
  });

  return variants.sort((left, right) => {
    const leftNormalized = normalizeEffortLevel(left);
    const rightNormalized = normalizeEffortLevel(right);
    const leftOrder = leftNormalized ? (order.get(leftNormalized) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    const rightOrder = rightNormalized ? (order.get(rightNormalized) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.localeCompare(right);
  });
}

function extractProviderModels(provider: unknown): Array<{
  id: string;
  name: string;
  variants: string[];
}> {
  if (!provider || typeof provider !== 'object') {
    return [];
  }

  const providerId = extractProviderId(provider);
  if (!providerId) {
    return [];
  }

  const record = provider as Record<string, unknown>;
  const rawModels = record.models;
  const models: Array<{ id: string; name: string; variants: string[] }> = [];
  const dedupe = new Set<string>();

  const pushModel = (rawModel: unknown, fallbackId?: string): void => {
    const fallbackNormalized = typeof fallbackId === 'string' ? fallbackId.trim() : '';
    if (!rawModel || typeof rawModel !== 'object') {
      if (!fallbackNormalized) {
        return;
      }

      const dedupeKey = `${providerId.toLowerCase()}:${fallbackNormalized.toLowerCase()}`;
      if (dedupe.has(dedupeKey)) {
        return;
      }

      dedupe.add(dedupeKey);
      models.push({
        id: fallbackNormalized,
        name: fallbackNormalized,
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
      : modelId;
    const dedupeKey = `${providerId.toLowerCase()}:${modelId.toLowerCase()}`;
    if (dedupe.has(dedupeKey)) {
      return;
    }

    dedupe.add(dedupeKey);
    models.push({
      id: modelId,
      name: modelName,
      variants: extractEffortVariants(modelRecord),
    });
  };

  if (Array.isArray(rawModels)) {
    for (const rawModel of rawModels) {
      pushModel(rawModel);
    }
  } else if (rawModels && typeof rawModels === 'object') {
    for (const [modelKey, rawModel] of Object.entries(rawModels as Record<string, unknown>)) {
      pushModel(rawModel, modelKey);
    }
  }

  return models.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
}

type CommandItem = {
  name: string;
  description?: string;
  source?: 'command' | 'mcp' | 'skill' | 'agent' | 'bridge-doc';
  template: string;
  hints: string[];
  group?: 'command' | 'mcp' | 'skill' | 'agent' | 'other';
};

function toTemplate(commandCell: string): string {
  const first = commandCell
    .split(/<br>|\/|、|，|\s+/)
    .map(item => item.trim())
    .find(item => item.startsWith('/'));

  return first || commandCell.trim();
}

async function readBridgeCommandFallback(): Promise<CommandItem[]> {
  const commandDocPath = path.resolve('assets', 'docs', 'commands.md');
  const content = await fs.readFile(commandDocPath, 'utf8');
  const commands = new Map<string, CommandItem>();

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    if (line.includes('| 命令 |') || line.includes('|------|')) continue;

    const cells = line
      .split('|')
      .slice(1, -1)
      .map(item => item.trim());

    if (cells.length < 2) continue;

    const commandCell = cells[0];
    const description = cells[1] || undefined;
    const matches = commandCell.match(/\/{1,2}[A-Za-z0-9:_-]+/g) || [];
    for (const match of matches) {
      const normalized = match.replace(/^\/+/, '');
      if (!normalized || commands.has(normalized)) {
        continue;
      }

      commands.set(normalized, {
        name: normalized,
        description,
        source: 'bridge-doc',
        template: toTemplate(match),
        hints: [],
      });
    }
  }

  return Array.from(commands.values()).sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
}

function mergeCommands(primary: CommandItem[], fallback: CommandItem[]): CommandItem[] {
  const merged = new Map<string, CommandItem>();

  const upsert = (item: CommandItem): void => {
    const key = item.name.trim().toLowerCase();
    if (!key) return;

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, item);
      return;
    }

    merged.set(key, {
      ...existing,
      ...item,
      description: existing.description || item.description,
      template: existing.template || item.template,
      hints: existing.hints.length > 0 ? existing.hints : item.hints,
      source: existing.source || item.source,
    });
  };

  for (const item of primary) upsert(item);
  for (const item of fallback) upsert(item);

  return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
}

/**
 * 根据source确定命令分组
 */
function getCommandGroup(source?: string): 'command' | 'mcp' | 'skill' | 'agent' | 'other' {
  switch (source) {
    case 'command':
    case 'bridge-doc':
      return 'command';
    case 'mcp':
      return 'mcp';
    case 'skill':
      return 'skill';
    case 'agent':
      return 'agent';
    default:
      return 'other';
  }
}

/**
 * 将命令按分组分类
 */
function groupCommands(commands: CommandItem[]): Map<string, CommandItem[]> {
  const groups = new Map<string, CommandItem[]>();
  const groupOrder: Record<string, number> = {
    command: 1,
    mcp: 2,
    skill: 3,
    agent: 4,
    other: 5,
  };

  for (const cmd of commands) {
    const group = getCommandGroup(cmd.source);
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group)!.push({ ...cmd, group });
  }

  // 按分组顺序排序
  const sortedGroups = new Map<string, CommandItem[]>();
  const sortedKeys = Array.from(groups.keys()).sort(
    (a, b) => (groupOrder[a] || 99) - (groupOrder[b] || 99)
  );

  for (const key of sortedKeys) {
    const items = groups.get(key)!;
    // 每组内按名称排序
    sortedGroups.set(key, items.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')));
  }

  return sortedGroups;
}

export function registerChatMetaRoutes(app: Application): void {
  const router = express.Router();
  router.use(chatAuthMiddleware);

  router.get('/workspaces', async (_req: Request, res: Response) => {
    try {
      const settings = configStore.get();
      const seenDirectories = new Set<string>();
      const workspaces: Array<{
        id: string;
        label: string;
        directory: string;
        source: 'project' | 'default' | 'allowlist';
      }> = [];

      const pushWorkspace = (
        directory: string | undefined,
        source: 'project' | 'default' | 'allowlist',
        preferredLabel?: string
      ): void => {
        const normalized = typeof directory === 'string' ? directory.trim() : '';
        if (!normalized || seenDirectories.has(normalized)) {
          return;
        }

        seenDirectories.add(normalized);
        workspaces.push({
          id: normalized,
          label: buildWorkspaceLabel(normalized, preferredLabel),
          directory: normalized,
          source,
        });
      };

      const projects = await opencodeClient.listProjects().catch(() => []);
      for (const project of projects) {
        if (!project || typeof project !== 'object') continue;
        const record = project as Record<string, unknown>;
        const worktree = typeof record.worktree === 'string' ? record.worktree.trim() : '';
        const name = typeof record.name === 'string' ? record.name.trim() : '';
        pushWorkspace(worktree, 'project', name);
      }

      pushWorkspace(settings.DEFAULT_WORK_DIRECTORY, 'default', '默认工作区');

      for (const directory of splitDirectories(settings.ALLOWED_DIRECTORIES)) {
        pushWorkspace(directory, 'allowlist');
      }

      workspaces.sort((left, right) => left.directory.localeCompare(right.directory, 'zh-Hans-CN'));
      res.json({ workspaces });
    } catch (error) {
      console.error('[Chat API] 获取工作区列表失败:', error);
      res.status(502).json({ error: errorMsg(error) });
    }
  });

  router.get('/agents', async (_req: Request, res: Response) => {
    try {
      const agents = (await opencodeClient.getAgents())
        .filter(agent => agent.hidden !== true)
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));

      res.json({ agents });
    } catch (error) {
      console.error('[Chat API] 获取 Agent 列表失败:', error);
      res.status(502).json({ error: errorMsg(error) });
    }
  });

  router.get('/models', async (_req: Request, res: Response) => {
    try {
      const providersResult = await opencodeClient.getProviders();
      const providers = Array.isArray(providersResult.providers) ? providersResult.providers : [];
      const whitelist = new Set(modelConfig.chatModelWhitelist.map(item => item.toLowerCase()));
      const useWhitelist = whitelist.size > 0;

      const items = providers
        .map(provider => {
          const record = provider as Record<string, unknown>;
          const id = extractProviderId(provider);
          if (!id) {
            return null;
          }

          const name = typeof record.name === 'string' && record.name.trim()
            ? record.name.trim()
            : id;

          return {
            id,
            name,
            models: extractProviderModels(provider).filter(model => {
              if (!useWhitelist) {
                return true;
              }
              return whitelist.has(`${id}/${model.id}`.toLowerCase());
            }),
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item && item.models.length > 0))
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));

      res.json({ providers: items });
    } catch (error) {
      console.error('[Chat API] 获取模型列表失败:', error);
      res.status(502).json({ error: errorMsg(error) });
    }
  });

  // 列出所有支持 image 输入的 model（供 VISION_OCR_MODEL 下拉选择器使用）
  router.get('/vision-models', async (_req: Request, res: Response) => {
    try {
      const models = await opencodeClient.listVisionModels();
      res.json({ models });
    } catch (error) {
      console.error('[Chat API] 获取多模态模型列表失败:', error);
      res.status(502).json({ error: errorMsg(error) });
    }
  });

  router.get('/commands', async (_req: Request, res: Response) => {
    try {
      const commands = (await opencodeClient.getCommands())
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
      const fallbackCommands = await readBridgeCommandFallback().catch(() => []);

      // 1. 获取技能命令
      const skillCommands = skillRegistry.listSlashCommands();
      const skillCommandItems: CommandItem[] = skillCommands.map(skill => ({
        name: skill.command,
        description: skill.description,
        source: 'skill' as const,
        template: skill.command,
        hints: [],
      }));

      // 2. 获取 MCP 命令（从 slash.ts 获取）
      const mcpSlashCommands = await listMCPSlashCommands();
      const mcpCommandItems: CommandItem[] = toMCPCommandItems(mcpSlashCommands);

      // 3. 获取 Agent 命令（从 slash.ts 获取）
      const agentSlashCommands = listAgentSlashCommands();
      const agentCommandItems: CommandItem[] = toAgentCommandItems(agentSlashCommands);

      // 4. 合并所有命令
      const allCommands = mergeCommands(
        commands,
        [...fallbackCommands, ...skillCommandItems, ...mcpCommandItems, ...agentCommandItems]
      );

      // 5. 按组返回（添加group字段）
      const groupedCommands = allCommands.map(cmd => ({
        ...cmd,
        group: getCommandGroup(cmd.source),
      }));

      res.json({ commands: groupedCommands });
    } catch (error) {
      console.error('[Chat API] 获取命令列表失败:', error);
      try {
        const fallbackCommands = await readBridgeCommandFallback();
        const groupedFallback = fallbackCommands.map(cmd => ({
          ...cmd,
          group: getCommandGroup(cmd.source),
        }));
        res.json({ commands: groupedFallback, fallback: true, error: errorMsg(error) });
      } catch (fallbackError) {
        res.status(502).json({ error: errorMsg(fallbackError) });
      }
    }
  });

  app.use('/api/chat', router);
}
