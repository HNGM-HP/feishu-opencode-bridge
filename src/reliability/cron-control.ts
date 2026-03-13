import { reliabilityConfig } from '../config.js';
import { chatSessionStore } from '../store/chat-session.js';
import type {
  RuntimeCronJob,
  RuntimeCronManager,
  RuntimeCronPayload,
  RuntimeCronSchedule,
} from './runtime-cron.js';

export type CronIntentAction = 'list' | 'help' | 'add' | 'update' | 'remove' | 'pause' | 'resume';

export type CronIntentSource = 'slash' | 'natural';

export interface CronIntent {
  action: CronIntentAction;
  source: CronIntentSource;
  argsText: string;
  preset?: {
    id?: string;
    expr?: string;
    text?: string;
    name?: string;
  };
}

export interface ExecuteCronIntentOptions {
  manager: RuntimeCronManager | null;
  intent: CronIntent;
  currentSessionId?: string;
  currentDirectory?: string;
  currentConversationId?: string;
  creatorId?: string;
  platform: 'feishu' | 'discord';
}

export interface ResolveCronIntentForExecutionOptions {
  source: CronIntentSource;
  argsText: string;
  action?: CronIntentAction;
  semanticParser?: (argsText: string, source: CronIntentSource, actionHint?: CronIntentAction) => Promise<CronIntent | null>;
}

const WEEKDAY_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
};

export function parseCronSlashIntent(rawArgs: string): CronIntent {
  const trimmed = rawArgs.trim();
  if (!trimmed) {
    return {
      action: 'list',
      source: 'slash',
      argsText: '',
    };
  }

  const [first, ...rest] = trimmed.split(/\s+/);
  const action = normalizeAction(first);
  if (!action) {
    return {
      action: 'help',
      source: 'slash',
      argsText: trimmed,
    };
  }

  return {
    action,
    source: 'slash',
    argsText: rest.join(' '),
  };
}

export async function resolveCronIntentForExecution(
  options: ResolveCronIntentForExecutionOptions
): Promise<CronIntent> {
  const source = options.source;
  const argsText = options.argsText.trim();

  if (source === 'natural') {
    if (options.semanticParser) {
      const semantic = await options.semanticParser(argsText, source, options.action).catch(() => null);
      if (semantic) {
        return semantic;
      }
    }
    return parseCronBodyIntent(argsText, 'natural');
  }

  const shouldUseSemantic = shouldUseSemanticParserForSlash(options.action, argsText);
  if (shouldUseSemantic && options.semanticParser) {
    const semantic = await options.semanticParser(argsText, source, options.action).catch(() => null);
    if (semantic) {
      return semantic;
    }
  }

  if (shouldUseSemantic) {
    const fallbackText = buildFallbackBodyForLocalParser(options.action, argsText);
    const fallback = parseCronBodyIntent(fallbackText, 'slash');
    if (fallback.action !== 'help') {
      return fallback;
    }
  }

  if (options.action) {
    return {
      action: options.action,
      source,
      argsText,
    };
  }

  return parseCronSlashIntent(argsText);
}

export function buildCronHelpText(platform: 'feishu' | 'discord'): string {
  const slashPrefix = platform === 'discord' ? '///cron' : '/cron';
  const lines: string[] = [
    '🕒 Cron 调度命令（支持语义解析）',
    '',
    '【语义命令（推荐）】',
    `- \`${slashPrefix} 添加个定时任务，每天早上8点向我发送一份AI简报\``,
    `- \`${slashPrefix} 生产AI简报，工作日记得发我\``,
    `- \`${slashPrefix} 列出现在的定时任务\``,
    `- \`${slashPrefix} 暂停任务 <jobId>\``,
    `- \`${slashPrefix} 恢复任务 <jobId>\``,
    `- \`${slashPrefix} 删除任务 <jobId>\``,
    '',
    '【结构化命令（高级）】',
    `- \`${slashPrefix} list\``,
    `- \`${slashPrefix} add --name <名称> --expr "<cron表达式>" --text "<执行内容>" [--session current|<id>] [--chat current|<会话ID>] [--dir current|<路径>] [--agent <名称>]\``,
    `- \`${slashPrefix} update --id <jobId> [--name <名称>] [--expr "<cron表达式>"] [--text "<执行内容>"] [--chat current|<会话ID>] [--enabled true|false]\``,
    `- \`${slashPrefix} remove --id <jobId>\``,
    `- \`${slashPrefix} pause --id <jobId>\``,
    `- \`${slashPrefix} resume --id <jobId>\``,
    `- 持久化路径: \`${reliabilityConfig.cronJobsFile || '~/cron/jobs.json'}\``,
  ];

  return lines.join('\n');
}

export function executeCronIntent(options: ExecuteCronIntentOptions): string {
  const { manager, intent, currentSessionId, currentDirectory, currentConversationId, creatorId, platform } = options;

  if (!manager) {
    return [
      '❌ Runtime Cron 未启用。',
      '请检查配置：',
      '- RELIABILITY_CRON_ENABLED=true',
      '- RELIABILITY_CRON_API_ENABLED=true（可选，开启 HTTP 管理）',
    ].join('\n');
  }

  if (intent.action === 'help') {
    return buildCronHelpText(platform);
  }

  if (intent.action === 'list') {
    const jobs = manager.listJobs();
    if (jobs.length === 0) {
      return [
        '当前没有运行时 Cron 任务。',
        `使用 \`${platform === 'discord' ? '///cron' : '/cron'} add ...\` 创建任务。`,
      ].join('\n');
    }

    const lines = ['🕒 运行时 Cron 任务列表', '（状态基于本地绑定表；fallback 为候选目标）'];
    for (const job of jobs) {
      const status = job.enabled ? '启用' : '暂停';
      const briefText = brief(job.payload.text, 60);
      const displayStatus = buildRuntimeCronDisplayStatus(job);
      lines.push(`- [${status}] ${job.id} | ${job.name} | ${job.schedule.expr}`);
      lines.push(`  text: ${briefText}`);
      lines.push(`  target: ${displayStatus.targetWindow} | session: ${job.payload.sessionId || '未绑定'}`);
      lines.push(`  orphan: ${displayStatus.orphanStatus}`);
      lines.push(`  fallback: ${displayStatus.fallbackStatus}`);
    }
    return lines.join('\n');
  }

  const parsedArgs = parseOptionArgs(intent.argsText);

  if (intent.action === 'remove') {
    const id = resolveJobId(intent, parsedArgs);
    if (!id) {
      return '❌ 缺少任务 ID。用法：remove --id <jobId>';
    }
    const removed = manager.removeJob(id);
    if (!removed) {
      return `❌ 未找到任务: ${id}`;
    }
    return `✅ 已删除任务: ${id}`;
  }

  if (intent.action === 'pause' || intent.action === 'resume') {
    const id = resolveJobId(intent, parsedArgs);
    if (!id) {
      return '❌ 缺少任务 ID。用法：pause/resume --id <jobId>';
    }
    const enabled = intent.action === 'resume';
    try {
      manager.updateJob({
        id,
        enabled,
      });
      return `✅ 已${enabled ? '恢复' : '暂停'}任务: ${id}`;
    } catch (error) {
      return `❌ ${enabled ? '恢复' : '暂停'}任务失败: ${formatError(error)}`;
    }
  }

  if (intent.action === 'add') {
    const expr = resolveExpr(intent, parsedArgs);
    const text = resolveText(intent, parsedArgs);
    if (!expr || !text) {
      return '❌ 新增任务缺少参数：需要 expr 与 text。用法：add --name <名称> --expr "*/5 * * * * *" --text "执行内容"';
    }

    if (!currentSessionId && !parsedArgs.options.session) {
      return '❌ 当前聊天尚未绑定 OpenCode 会话；请先在当前窗口建立/绑定会话，或显式使用 --session <id>。';
    }

    if (!currentConversationId) {
      return '❌ 当前聊天上下文缺失，无法为 Cron 任务绑定回推窗口。';
    }

    const name = resolveName(intent, parsedArgs, text);
    const payload = buildPayload(intent, parsedArgs, text, {
      currentSessionId,
      currentDirectory,
      currentConversationId,
      creatorId,
      platform,
    });

    if (!payload.sessionId) {
      return '❌ 当前聊天尚未绑定 OpenCode 会话；请先在当前窗口建立/绑定会话，或显式使用 --session <id>。';
    }

    const enabled = resolveEnabled(parsedArgs, true);
    try {
      const created = manager.addJob({
        name,
        schedule: { kind: 'cron', expr },
        payload,
        enabled,
      });
      return [
        '✅ Cron 任务创建成功',
        `- id: ${created.id}`,
        `- name: ${created.name}`,
        `- expr: ${created.schedule.expr}`,
        `- enabled: ${created.enabled}`,
        `- store: ${reliabilityConfig.cronJobsFile || '~/cron/jobs.json'}`,
      ].join('\n');
    } catch (error) {
      return `❌ 创建任务失败: ${formatError(error)}`;
    }
  }

  if (intent.action === 'update') {
    const id = resolveJobId(intent, parsedArgs);
    if (!id) {
      return '❌ 更新任务缺少 ID。用法：update --id <jobId> [--expr ...] [--text ...] [--enabled true|false]';
    }

    const existing = manager.listJobs().find(item => item.id === id);
    if (!existing) {
      return `❌ 未找到任务: ${id}`;
    }

    const nextSchedule = resolveExpr(intent, parsedArgs);
    const nextText = resolveText(intent, parsedArgs);
    const nextName = resolveName(intent, parsedArgs, existing.payload.text, true);
    const nextEnabled = resolveEnabled(parsedArgs, existing.enabled);
    const hasPayloadChange = Boolean(
      nextText
      || parsedArgs.options.session
      || parsedArgs.options.dir
      || parsedArgs.options.agent
      || parsedArgs.options.chat
    );

    const nextConversationId = resolveOptionalValue(parsedArgs.options.chat, currentConversationId);
    const updatePayload: Partial<RuntimeCronPayload> = {
      ...(nextText ? { text: nextText } : {}),
      ...(resolveOptionalValue(parsedArgs.options.session, currentSessionId) !== undefined
        ? { sessionId: resolveOptionalValue(parsedArgs.options.session, currentSessionId) }
        : {}),
      ...(resolveOptionalValue(parsedArgs.options.dir, currentDirectory) !== undefined
        ? { directory: resolveOptionalValue(parsedArgs.options.dir, currentDirectory) }
        : {}),
      ...(resolveOptionalValue(parsedArgs.options.agent, undefined) !== undefined
        ? { agent: resolveOptionalValue(parsedArgs.options.agent, undefined) }
        : {}),
    };

    try {
      manager.updateJob({
        id,
        ...(nextName ? { name: nextName } : {}),
        ...(nextSchedule ? { schedule: { kind: 'cron', expr: nextSchedule } as RuntimeCronSchedule } : {}),
        ...(hasPayloadChange
          ? {
              payload: {
                kind: 'systemEvent',
                text: updatePayload.text || existing.payload.text,
                ...(updatePayload.sessionId !== undefined
                  ? (updatePayload.sessionId ? { sessionId: updatePayload.sessionId } : {})
                  : (existing.payload.sessionId ? { sessionId: existing.payload.sessionId } : {})),
                ...(updatePayload.directory !== undefined
                  ? (updatePayload.directory ? { directory: updatePayload.directory } : {})
                  : (existing.payload.directory ? { directory: existing.payload.directory } : {})),
                ...(updatePayload.agent !== undefined
                  ? (updatePayload.agent ? { agent: updatePayload.agent } : {})
                  : (existing.payload.agent ? { agent: existing.payload.agent } : {})),
                ...(nextConversationId !== undefined
                  ? {
                      delivery: {
                        platform,
                        conversationId: nextConversationId || currentConversationId || existing.payload.delivery?.conversationId || '',
                        ...(creatorId || existing.payload.delivery?.creatorId
                          ? { creatorId: creatorId || existing.payload.delivery?.creatorId }
                          : {}),
                        ...(existing.payload.delivery?.fallbackConversationId
                          ? { fallbackConversationId: existing.payload.delivery.fallbackConversationId }
                          : {}),
                      },
                    }
                  : (existing.payload.delivery ? { delivery: existing.payload.delivery } : {})),
              },
            }
          : {}),
        ...(nextEnabled !== existing.enabled ? { enabled: nextEnabled } : {}),
      });

      return `✅ 已更新任务: ${id}`;
    } catch (error) {
      return `❌ 更新任务失败: ${formatError(error)}`;
    }
  }

  return buildCronHelpText(platform);
}

function normalizeAction(rawAction: string): CronIntentAction | null {
  const normalized = rawAction.trim().toLowerCase();
  if (!normalized) {
    return 'list';
  }

  if (normalized === 'list' || normalized === 'ls' || normalized === '列表') {
    return 'list';
  }

  if (normalized === 'help' || normalized === 'h' || normalized === '帮助') {
    return 'help';
  }

  if (
    normalized === 'add'
    || normalized === 'create'
    || normalized === '新增'
    || normalized === '添加'
    || normalized === '添加任务'
    || normalized === '添加定时任务'
    || normalized === '创建定时任务'
  ) {
    return 'add';
  }

  if (
    normalized === 'update'
    || normalized === 'edit'
    || normalized === '修改'
    || normalized === '修改任务'
    || normalized === '更新'
    || normalized === '更新任务'
  ) {
    return 'update';
  }

  if (normalized === 'remove' || normalized === 'delete' || normalized === '删除' || normalized === '删除任务') {
    return 'remove';
  }

  if (normalized === 'pause' || normalized === 'disable' || normalized === '暂停' || normalized === '暂停任务') {
    return 'pause';
  }

  if (normalized === 'resume' || normalized === 'enable' || normalized === '恢复' || normalized === '恢复任务') {
    return 'resume';
  }

  return null;
}

function shouldUseSemanticParserForSlash(action: CronIntentAction | undefined, argsText: string): boolean {
  const trimmed = argsText.trim();
  if (!trimmed) {
    return false;
  }

  if (action === 'list') {
    return false;
  }

  if (action === 'add' || action === 'update') {
    return !/^--/u.test(trimmed);
  }

  if (action === 'remove' || action === 'pause' || action === 'resume') {
    if (/^--id\b/iu.test(trimmed)) {
      return false;
    }
    return /\s/u.test(trimmed);
  }

  // 显式参数命令（低歧义）直接走本地解析
  if (/^add\s+--/i.test(trimmed) || /^update\s+--/i.test(trimmed)) {
    return false;
  }

  // list/help/remove/pause/resume 显式子命令优先本地解析
  if (/^(?:list|ls|help|h|remove|delete|pause|resume|列表|查看|帮助|删除|删除任务|暂停|暂停任务|恢复|恢复任务)(?:\s|$)/iu.test(trimmed)) {
    return false;
  }

  // 其余 slash 文本（例如“添加个定时任务...”）走语义解析
  return true;
}

function buildFallbackBodyForLocalParser(action: CronIntentAction | undefined, argsText: string): string {
  const trimmed = argsText.trim();
  if (!trimmed) {
    if (action === 'list') {
      return 'list';
    }
    return '';
  }

  if (action === 'remove' || action === 'pause' || action === 'resume') {
    return `${action} ${trimmed}`;
  }

  return trimmed;
}

function parseCronBodyIntent(bodyText: string, source: CronIntentSource): CronIntent {
  const body = bodyText.trim();
  if (!body) {
    return {
      action: 'help',
      source,
      argsText: '',
    };
  }

  if (/^(help|帮助|说明)$/iu.test(body)) {
    return {
      action: 'help',
      source,
      argsText: '',
    };
  }

  if (/^(list|列表|查看)$/iu.test(body)) {
    return {
      action: 'list',
      source,
      argsText: '',
    };
  }

  const removeMatch = body.match(/^(?:删除任务|删除|移除|remove)\s+(.+)$/iu);
  if (removeMatch) {
    return {
      action: 'remove',
      source,
      argsText: '',
      preset: { id: removeMatch[1].trim() },
    };
  }

  const pauseMatch = body.match(/^(?:暂停任务|暂停|停用|pause)\s+(.+)$/iu);
  if (pauseMatch) {
    return {
      action: 'pause',
      source,
      argsText: '',
      preset: { id: pauseMatch[1].trim() },
    };
  }

  const resumeMatch = body.match(/^(?:恢复任务|恢复|启用|resume)\s+(.+)$/iu);
  if (resumeMatch) {
    return {
      action: 'resume',
      source,
      argsText: '',
      preset: { id: resumeMatch[1].trim() },
    };
  }

  const normalizedBody = stripCreateTaskPrefix(body);

  const everyMinutesMatch = normalizedBody.match(/^(?:每|每隔)\s*(\d{1,2})\s*分钟\s*(?:执行|做|处理)?\s*(.+)$/u);
  if (everyMinutesMatch) {
    const minutes = Number.parseInt(everyMinutesMatch[1], 10);
    if (minutes < 1 || minutes > 59) {
      return {
        action: 'help',
        source,
        argsText: '',
      };
    }
    const textValue = everyMinutesMatch[2].trim();
    if (!textValue) {
      return {
        action: 'help',
        source,
        argsText: body,
      };
    }
    return {
      action: 'add',
      source,
      argsText: '',
      preset: {
        expr: `0 */${minutes} * * * *`,
        text: textValue,
        name: buildNaturalJobName(textValue),
      },
    };
  }

  const everyHoursMatch = normalizedBody.match(/^(?:每|每隔)\s*(\d{1,2})\s*小时\s*(?:执行|做|处理)?\s*(.+)$/u);
  if (everyHoursMatch) {
    const hours = Number.parseInt(everyHoursMatch[1], 10);
    if (hours < 1 || hours > 23) {
      return {
        action: 'help',
        source,
        argsText: '',
      };
    }
    const textValue = everyHoursMatch[2].trim();
    if (!textValue) {
      return {
        action: 'help',
        source,
        argsText: body,
      };
    }
    return {
      action: 'add',
      source,
      argsText: '',
      preset: {
        expr: `0 0 */${hours} * * *`,
        text: textValue,
        name: buildNaturalJobName(textValue),
      },
    };
  }

  const dailyMatch = normalizedBody.match(/^每天\s*(\d{1,2})[:：](\d{2})\s*(?:执行|做|处理)?\s*(.+)$/u);
  if (dailyMatch) {
    const hour = Number.parseInt(dailyMatch[1], 10);
    const minute = Number.parseInt(dailyMatch[2], 10);
    if (!isValidHourMinute(hour, minute)) {
      return {
        action: 'help',
        source,
        argsText: '',
      };
    }
    const textValue = dailyMatch[3].trim();
    if (!textValue) {
      return {
        action: 'help',
        source,
        argsText: body,
      };
    }
    return {
      action: 'add',
      source,
      argsText: '',
      preset: {
        expr: `0 ${minute} ${hour} * * *`,
        text: textValue,
        name: buildNaturalJobName(textValue),
      },
    };
  }

  const dailyChineseMatch = normalizedBody.match(
    /^每天\s*(早上|上午|中午|下午|晚上)?\s*(\d{1,2})(?:[:：](\d{1,2})|点(?:(\d{1,2})分?)?)?\s*(?:执行|做|处理)?\s*(.+)$/u
  );
  if (dailyChineseMatch) {
    const period = dailyChineseMatch[1]?.trim();
    const baseHour = Number.parseInt(dailyChineseMatch[2], 10);
    const minuteRaw = dailyChineseMatch[3] ?? dailyChineseMatch[4] ?? '0';
    const minute = Number.parseInt(minuteRaw, 10);
    const hour = normalizeHourByPeriod(baseHour, period);
    if (!isValidHourMinute(hour, minute)) {
      return {
        action: 'help',
        source,
        argsText: '',
      };
    }

    const rawTextValue = dailyChineseMatch[5].trim();
    const textValue = stripActionPrefix(rawTextValue);
    if (!textValue) {
      return {
        action: 'help',
        source,
        argsText: body,
      };
    }
    return {
      action: 'add',
      source,
      argsText: '',
      preset: {
        expr: `0 ${minute} ${hour} * * *`,
        text: textValue,
        name: buildNaturalJobName(textValue),
      },
    };
  }

  const weeklyMatch = normalizedBody.match(/^每周([一二三四五六日天])\s*(\d{1,2})[:：](\d{2})\s*(?:执行|做|处理)?\s*(.+)$/u);
  if (weeklyMatch) {
    const weekday = WEEKDAY_MAP[weeklyMatch[1]];
    const hour = Number.parseInt(weeklyMatch[2], 10);
    const minute = Number.parseInt(weeklyMatch[3], 10);
    if (typeof weekday !== 'number' || !isValidHourMinute(hour, minute)) {
      return {
        action: 'help',
        source,
        argsText: '',
      };
    }
    const textValue = weeklyMatch[4].trim();
    if (!textValue) {
      return {
        action: 'help',
        source,
        argsText: body,
      };
    }
    return {
      action: 'add',
      source,
      argsText: '',
      preset: {
        expr: `0 ${minute} ${hour} * * ${weekday}`,
        text: textValue,
        name: buildNaturalJobName(textValue),
      },
    };
  }

  return {
    action: 'help',
    source,
    argsText: body,
  };
}

function buildNaturalJobName(text: string): string {
  const candidate = text.trim().slice(0, 24);
  return candidate || `cron-${Date.now()}`;
}

function stripCreateTaskPrefix(text: string): string {
  return text
    .replace(/^(?:请|请你|帮我)?\s*(?:添加|新增|创建)(?:一个|个)?\s*定时任务[，,:\s]*/u, '')
    .trim();
}

function stripActionPrefix(text: string): string {
  return text
    .replace(/^(?:执行|做|处理)\s*/u, '')
    .trim();
}

function normalizeHourByPeriod(hour: number, period?: string): number {
  if (!Number.isFinite(hour)) {
    return hour;
  }
  const normalizedPeriod = (period || '').trim();
  if (!normalizedPeriod) {
    return hour;
  }

  if (normalizedPeriod === '早上' || normalizedPeriod === '上午') {
    return hour === 12 ? 0 : hour;
  }
  if (normalizedPeriod === '中午') {
    if (hour >= 1 && hour <= 10) {
      return hour + 12;
    }
    return hour;
  }
  if (normalizedPeriod === '下午' || normalizedPeriod === '晚上') {
    if (hour >= 1 && hour <= 11) {
      return hour + 12;
    }
    return hour;
  }
  return hour;
}

function isValidHourMinute(hour: number, minute: number): boolean {
  return Number.isInteger(hour)
    && Number.isInteger(minute)
    && hour >= 0
    && hour <= 23
    && minute >= 0
    && minute <= 59;
}

interface ParsedOptionArgs {
  options: Record<string, string>;
  flags: Set<string>;
  positionals: string[];
}

function parseOptionArgs(input: string): ParsedOptionArgs {
  const tokens = tokenize(input);
  const options: Record<string, string> = {};
  const flags = new Set<string>();
  const positionals: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const item = token.slice(2);
    if (!item) {
      continue;
    }

    const equalIndex = item.indexOf('=');
    if (equalIndex >= 0) {
      const key = item.slice(0, equalIndex).trim().toLowerCase();
      const value = item.slice(equalIndex + 1).trim();
      if (key) {
        options[key] = value;
      }
      continue;
    }

    const key = item.trim().toLowerCase();
    const nextToken = tokens[index + 1];
    if (nextToken && !nextToken.startsWith('--')) {
      options[key] = nextToken;
      index += 1;
      continue;
    }
    flags.add(key);
  }

  return {
    options,
    flags,
    positionals,
  };
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`|(\S+)/g;
  let matched: RegExpExecArray | null = regex.exec(input);
  while (matched !== null) {
    const value = matched[1] ?? matched[2] ?? matched[3] ?? matched[4] ?? '';
    if (value) {
      tokens.push(unescapeToken(value));
    }
    matched = regex.exec(input);
  }
  return tokens;
}

function unescapeToken(value: string): string {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\`/g, '`')
    .replace(/\\\\/g, '\\');
}

function resolveJobId(intent: CronIntent, args: ParsedOptionArgs): string {
  const fromPreset = intent.preset?.id?.trim();
  if (fromPreset) {
    return fromPreset;
  }
  const fromOption = args.options.id?.trim();
  if (fromOption) {
    return fromOption;
  }
  return args.positionals[0]?.trim() || '';
}

function resolveExpr(intent: CronIntent, args: ParsedOptionArgs): string {
  const fromPreset = intent.preset?.expr?.trim();
  if (fromPreset) {
    return fromPreset;
  }
  const fromOption = args.options.expr?.trim();
  if (fromOption) {
    return fromOption;
  }
  return '';
}

function resolveText(intent: CronIntent, args: ParsedOptionArgs): string {
  const fromPreset = intent.preset?.text?.trim();
  if (fromPreset) {
    return fromPreset;
  }
  const fromOption = args.options.text?.trim();
  if (fromOption) {
    return fromOption;
  }
  return '';
}

function resolveName(intent: CronIntent, args: ParsedOptionArgs, fallbackText: string, keepEmpty: boolean = false): string {
  const fromPreset = intent.preset?.name?.trim();
  if (fromPreset) {
    return fromPreset;
  }
  const fromOption = args.options.name?.trim();
  if (fromOption) {
    return fromOption;
  }
  if (keepEmpty) {
    return '';
  }
  return buildNaturalJobName(fallbackText);
}

function resolveEnabled(args: ParsedOptionArgs, fallback: boolean): boolean {
  if ('enabled' in args.options) {
    return parseBooleanLike(args.options.enabled, fallback);
  }
  if (args.flags.has('enabled')) {
    return true;
  }
  if (args.flags.has('disabled')) {
    return false;
  }
  return fallback;
}

function parseBooleanLike(value: string, fallback: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on', 'enable', 'enabled'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off', 'disable', 'disabled'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function resolveOptionalValue(raw: string | undefined, currentValue: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.toLowerCase() === 'current') {
    return currentValue || '';
  }
  return trimmed;
}

function buildPayload(
  intent: CronIntent,
  args: ParsedOptionArgs,
  text: string,
  context: {
    currentSessionId?: string;
    currentDirectory?: string;
    currentConversationId?: string;
    creatorId?: string;
    platform: 'feishu' | 'discord';
  }
): RuntimeCronPayload {
  const optionSession = resolveOptionalValue(args.options.session, context.currentSessionId);
  const optionDirectory = resolveOptionalValue(args.options.dir, context.currentDirectory);
  const optionAgent = resolveOptionalValue(args.options.agent, undefined);
  const optionConversationId = args.options.chat !== undefined
    ? resolveOptionalValue(args.options.chat, context.currentConversationId)
    : (context.currentConversationId || '');
  const presetSession = intent.preset?.id;

  const sessionId = optionSession !== undefined
    ? optionSession
    : (context.currentSessionId || presetSession || '');

  return {
    kind: 'systemEvent',
    text,
    ...(sessionId ? { sessionId } : {}),
    ...(optionDirectory ? { directory: optionDirectory } : {}),
    ...(optionAgent ? { agent: optionAgent } : {}),
    ...(optionConversationId
      ? {
          delivery: {
            platform: context.platform,
            conversationId: optionConversationId,
            ...(context.creatorId ? { creatorId: context.creatorId } : {}),
          },
        }
      : {}),
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function brief(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function buildRuntimeCronDisplayStatus(job: RuntimeCronJob): {
  targetWindow: string;
  orphanStatus: string;
  fallbackStatus: string;
} {
  const sessionId = job.payload.sessionId?.trim();
  const delivery = job.payload.delivery;

  if (!delivery) {
    return {
      targetWindow: '未绑定窗口',
      orphanStatus: '是（未绑定目标窗口）',
      fallbackStatus: resolveRuntimeCronFallbackStatus(job),
    };
  }

  const targetLabel = `${delivery.platform}:${delivery.conversationId}`;
  if (!sessionId) {
    return {
      targetWindow: `${targetLabel}（未绑定会话）`,
      orphanStatus: '是（未绑定 OpenCode 会话）',
      fallbackStatus: resolveRuntimeCronFallbackStatus(job),
    };
  }

  const currentBinding = chatSessionStore.getSessionByConversation(delivery.platform, delivery.conversationId);
  const boundConversation = chatSessionStore.getConversationBySessionId(sessionId);
  if (
    boundConversation
    && (boundConversation.platform !== delivery.platform || boundConversation.conversationId !== delivery.conversationId)
  ) {
    return {
      targetWindow: `${targetLabel}（原会话已迁移到 ${boundConversation.platform}:${boundConversation.conversationId}）`,
      orphanStatus: '是（原会话已迁移到其他窗口）',
      fallbackStatus: `${resolveRuntimeCronFallbackStatus(job)}；原会话已迁移，运行时不会直接回退`,
    };
  }

  if (!currentBinding) {
    return {
      targetWindow: `${targetLabel}（本地未绑定/已失联）`,
      orphanStatus: '是（目标窗口未绑定或已失联）',
      fallbackStatus: resolveRuntimeCronFallbackStatus(job),
    };
  }

  if (currentBinding.sessionId !== sessionId) {
    return {
      targetWindow: `${targetLabel}（已改绑到 ${currentBinding.sessionId}）`,
      orphanStatus: '是（目标窗口已改绑到其他会话）',
      fallbackStatus: resolveRuntimeCronFallbackStatus(job),
    };
  }

  return {
    targetWindow: `${targetLabel}（本地绑定有效）`,
    orphanStatus: '否',
    fallbackStatus: resolveRuntimeCronFallbackStatus(job),
  };
}

function resolveRuntimeCronFallbackStatus(job: RuntimeCronJob): string {
  if (!reliabilityConfig.cronForwardToPrivateChat) {
    return '关闭';
  }

  const delivery = job.payload.delivery;
  if (!delivery) {
    return '已启用，但任务未绑定目标窗口';
  }

  if (delivery.fallbackConversationId) {
    return `候选 ${delivery.platform}:${delivery.fallbackConversationId}（任务显式）`;
  }

  if (delivery.platform === 'feishu' && reliabilityConfig.cronFallbackFeishuChatId) {
    return `候选 feishu:${reliabilityConfig.cronFallbackFeishuChatId}（env）`;
  }

  if (delivery.platform === 'discord' && reliabilityConfig.cronFallbackDiscordConversationId) {
    return `候选 discord:${reliabilityConfig.cronFallbackDiscordConversationId}（env）`;
  }

  if (!delivery.creatorId) {
    return '已启用，但未找到可用回退目标';
  }

  const privateBinding = chatSessionStore.findPrivateConversationByCreator(delivery.creatorId, delivery.platform);
  if (!privateBinding) {
    return '已启用，但未找到创建者私聊';
  }

  return `候选 ${privateBinding.platform}:${privateBinding.conversationId}（创建者私聊）`;
}
