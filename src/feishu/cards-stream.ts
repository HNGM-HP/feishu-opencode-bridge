import { outputConfig } from '../config.js';

export * from './cards.js';

export type StreamToolState = {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: string;
};

export type StreamCardSegment =
  | {
      type: 'reasoning';
      text: string;
    }
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'tool';
      name: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      output?: string;
      kind?: 'tool' | 'subtask';
    }
  | {
      type: 'note';
      text: string;
      variant?: 'retry' | 'compaction' | 'question' | 'error' | 'permission';
    };

export interface StreamCardPendingPermission {
  sessionId: string;
  permissionId: string;
  tool: string;
  description: string;
  risk?: string;
  pendingCount?: number;
}

export interface StreamCardQuestionOption {
  label: string;
  description?: string;
}

export interface StreamCardPendingQuestion {
  requestId: string;
  sessionId: string;
  chatId: string;
  questionIndex: number;
  totalQuestions: number;
  header: string;
  question: string;
  options: StreamCardQuestionOption[];
  multiple?: boolean;
}

export interface StreamCardData {
  thinking: string;
  showThinking?: boolean;
  text: string;
  chatId?: string;
  messageId?: string;
  thinkingMessageId?: string;
  tools: StreamToolState[];
  segments?: StreamCardSegment[];
  pendingPermission?: StreamCardPendingPermission;
  pendingQuestion?: StreamCardPendingQuestion;
  status: 'processing' | 'completed' | 'failed';
}

function escapeCodeBlockContent(text: string): string {
  return text.replace(/```/g, '` ` `');
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...`;
}

function truncateMiddleText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  const marker = `\n...（中间省略 ${text.length - limit} 字）...\n`;
  const available = Math.max(limit - marker.length, 200);
  const headLength = Math.max(Math.floor(available * 0.55), 120);
  const tailLength = Math.max(available - headLength, 80);
  return `${text.slice(0, headLength)}${marker}${text.slice(-tailLength)}`;
}

function getToolStatusLabel(status: StreamToolState['status']): { icon: string; text: string } {
  if (status === 'running') {
    return { icon: '⏳', text: '执行中' };
  }
  if (status === 'completed') {
    return { icon: '✅', text: '已完成' };
  }
  if (status === 'failed') {
    return { icon: '❌', text: '失败' };
  }
  return { icon: '⏸️', text: '等待中' };
}

function getRiskLabel(risk?: string): string {
  if (risk === 'high') return '⚠️ 高风险';
  if (risk === 'medium') return '⚡ 中风险';
  return '✅ 低风险';
}

export interface StreamCardBuildOptions {
  componentBudget?: number;
}

const DEFAULT_STREAM_CARD_COMPONENT_BUDGET = 180;
const MIN_STREAM_CARD_COMPONENT_BUDGET = 20;
const MAX_TIMELINE_SEGMENTS = 60;
const MAX_REASONING_SEGMENT_LENGTH = 2600;
const MAX_TOOL_OUTPUT_LENGTH = 4000;
const MAX_TEXT_SEGMENT_LENGTH = 5000;
const MAX_THINKING_PANEL_LENGTH = 2600;
const MAX_BODY_TEXT_LENGTH = 6000;

function isHrElement(element: object): boolean {
  const value = element as { tag?: unknown };
  return value.tag === 'hr';
}

function countComponentTags(node: unknown): number {
  if (Array.isArray(node)) {
    let total = 0;
    for (const item of node) {
      total += countComponentTags(item);
    }
    return total;
  }

  if (!node || typeof node !== 'object') {
    return 0;
  }

  const record = node as Record<string, unknown>;
  let total = typeof record.tag === 'string' ? 1 : 0;
  for (const value of Object.values(record)) {
    total += countComponentTags(value);
  }

  return total;
}

function normalizeElementPage(elements: object[]): object[] {
  const normalized: object[] = [];
  for (const element of elements) {
    if (isHrElement(element)) {
      if (normalized.length === 0) {
        continue;
      }
      const last = normalized[normalized.length - 1];
      if (isHrElement(last)) {
        continue;
      }
    }
    normalized.push(element);
  }

  while (normalized.length > 0 && isHrElement(normalized[normalized.length - 1])) {
    normalized.pop();
  }

  return normalized;
}

function paginateElementsByComponentBudget(elements: object[], componentBudget: number): object[][] {
  const safeBudget = Math.max(componentBudget, MIN_STREAM_CARD_COMPONENT_BUDGET);
  const budgetForBody = Math.max(1, safeBudget - 1);
  const pages: object[][] = [];
  let currentPage: object[] = [];
  let currentCount = 0;

  for (const element of elements) {
    const componentCount = Math.max(1, countComponentTags(element));

    if (currentPage.length > 0 && currentCount + componentCount > budgetForBody) {
      const normalized = normalizeElementPage(currentPage);
      if (normalized.length > 0) {
        pages.push(normalized);
      }
      currentPage = [];
      currentCount = 0;
    }

    currentPage.push(element);
    currentCount += componentCount;
  }

  const normalized = normalizeElementPage(currentPage);
  if (normalized.length > 0) {
    pages.push(normalized);
  }

  if (pages.length === 0) {
    pages.push([{ tag: 'markdown', content: '（无输出）' }]);
  }

  return pages;
}

function buildTimelineElements(
  segments: StreamCardSegment[],
  options?: { showThinking?: boolean; showTools?: boolean }
): object[] {
  const elements: object[] = [];
  const visibleSegments = segments.slice(-MAX_TIMELINE_SEGMENTS);

  for (const segment of visibleSegments) {
    let nextElement: object | null = null;

    if (segment.type === 'reasoning') {
      if (options?.showThinking === false) {
        continue;
      }
      const text = segment.text.trim();
      if (!text) {
        continue;
      }

      const rendered = truncateMiddleText(text, MAX_REASONING_SEGMENT_LENGTH);
      nextElement = {
        tag: 'collapsible_panel',
        expanded: false,
        header: {
          title: {
            tag: 'plain_text',
            content: `🤔 思考过程 (${rendered.length}字)`,
          },
        },
        elements: [
          {
            tag: 'markdown',
            content: `\`\`\`\n${escapeCodeBlockContent(rendered)}\n\`\`\``,
          },
        ],
      };
    } else if (segment.type === 'tool') {
      if (options?.showTools === false) {
        continue;
      }
      const statusInfo = getToolStatusLabel(segment.status);
      const toolKindLabel = segment.kind === 'subtask' ? '子任务' : '工具';
      const output = segment.output?.trim() ? truncateMiddleText(segment.output.trim(), MAX_TOOL_OUTPUT_LENGTH) : '';
      const panelElements: object[] = [
        {
          tag: 'markdown',
          content: `状态：**${statusInfo.text}**`,
        },
      ];

      if (output) {
        panelElements.push({
          tag: 'markdown',
          content: `\`\`\`\n${escapeCodeBlockContent(output)}\n\`\`\``,
        });
      } else if (segment.status === 'running' || segment.status === 'pending') {
        panelElements.push({
          tag: 'markdown',
          content: '等待工具输出...',
        });
      }

      nextElement = {
        tag: 'collapsible_panel',
        expanded: false,
        header: {
          title: {
            tag: 'plain_text',
            content: `${statusInfo.icon} ${toolKindLabel} · ${segment.name}`,
          },
        },
        elements: panelElements,
      };
    } else if (segment.type === 'text') {
      if (!segment.text.trim()) {
        continue;
      }
      const text = truncateMiddleText(segment.text, MAX_TEXT_SEGMENT_LENGTH);
      nextElement = {
        tag: 'markdown',
        content: text,
      };
    } else if (segment.type === 'note') {
      const text = segment.text.trim();
      if (!text) {
        continue;
      }
      nextElement = {
        tag: 'markdown',
        content: truncateText(text, 800),
      };
    }

    if (!nextElement) {
      continue;
    }

    if (elements.length > 0) {
      elements.push({ tag: 'hr' });
    }
    elements.push(nextElement);
  }

  return elements;
}

function buildPendingPermissionElements(permission: StreamCardPendingPermission): object[] {
  const blocks: object[] = [];
  const toolName = permission.tool.trim() || 'unknown';
  const description = truncateMiddleText(permission.description.trim() || '（无描述）', 1600);
  const pendingCountText = permission.pendingCount && permission.pendingCount > 1
    ? `\n> 当前待确认权限：${permission.pendingCount} 项（仅展示最早一项）`
    : '';

  blocks.push({ tag: 'hr' });
  blocks.push({
    tag: 'collapsible_panel',
    expanded: true,
    header: {
      title: {
        tag: 'plain_text',
        content: `🔐 权限确认 · ${toolName}`,
      },
    },
    elements: [
      {
        tag: 'markdown',
        content: `风险等级：**${getRiskLabel(permission.risk)}**${pendingCountText}`,
      },
      {
        tag: 'markdown',
        content: `\`\`\`\n${escapeCodeBlockContent(description)}\n\`\`\``,
      },
      {
        tag: 'markdown',
        content: '请在群里回复：`允许` / `拒绝` / `始终允许`（也支持 `y` / `n` / `always`）',
      },
    ],
  });

  return blocks;
}

function buildPendingQuestionElements(question: StreamCardPendingQuestion): object[] {
  const blocks: object[] = [];
  const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const options = question.options.slice(0, 20);
  const optionLines = options.map((item, index) => {
    const number = index + 1;
    const prefix = index < labels.length ? `${labels[index]}(${number}).` : `${number}.`;
    const description = item.description?.trim() ? `: ${truncateText(item.description.trim(), 100)}` : '';
    return `${prefix} **${item.label}**${description}`;
  });
  if (question.options.length > options.length) {
    optionLines.push(`... 其余 ${question.options.length - options.length} 个选项已省略显示`);
  }

  const title = `**问题 ${question.questionIndex + 1}/${question.totalQuestions}**`;
  const headerLine = question.header.trim();
  const questionLine = question.question.trim();
  const bodyLines = [title, headerLine, questionLine, optionLines.join('\n')].filter(line => line && line.trim()).join('\n\n');
  const hint = question.multiple
    ? '请直接回复：可多选（例如 A,C 或 1 3），不匹配选项会按自定义答案处理。'
    : '请直接回复：单选可用 A 或 1，不匹配选项会按自定义答案处理。';

  blocks.push({ tag: 'hr' });
  blocks.push({
    tag: 'collapsible_panel',
    expanded: true,
    header: {
      title: {
        tag: 'plain_text',
        content: '🤝 问答交互',
      },
    },
    elements: [
      {
        tag: 'markdown',
        content: truncateMiddleText(bodyLines, 2600),
      },
      {
        tag: 'markdown',
        content: hint,
      },
      {
        tag: 'markdown',
        content: '输入"跳过"可跳过本题。',
      },
    ],
  });

  return blocks;
}

function buildStreamCardElements(
  data: StreamCardData,
  options?: { showThinking?: boolean; showTools?: boolean }
): object[] {
  const elements: object[] = [];
  const thinkingText = data.thinking.trim();

  const timelineElements = Array.isArray(data.segments) && data.segments.length > 0
    ? buildTimelineElements(data.segments, { showThinking: options?.showThinking, showTools: options?.showTools })
    : [];

  if (timelineElements.length > 0) {
    elements.push(...timelineElements);
  }

  const showThinking = options?.showThinking ?? true;
  const showTools = options?.showTools ?? true;

  if (timelineElements.length === 0) {
    // 1. 思考过程（原生折叠面板）
    if (thinkingText && showThinking) {
      const renderedThinking = truncateMiddleText(thinkingText, MAX_THINKING_PANEL_LENGTH);
      elements.push({
        tag: 'collapsible_panel',
        expanded: false,
        header: {
          title: {
            tag: 'plain_text',
            content: `🤔 思考过程 (${renderedThinking.length}字)`,
          },
        },
        elements: [
          {
            tag: 'markdown',
            content: `\`\`\`\n${escapeCodeBlockContent(renderedThinking)}\n\`\`\``,
          },
        ],
      });
    }

    // 2. 工具调用列表
    if (data.tools.length > 0 && showTools) {
      if (elements.length > 0) {
        elements.push({ tag: 'hr' });
      }

      const toolLines = data.tools.map(tool => {
        const icon = tool.status === 'running' ? '⏳' : tool.status === 'completed' ? '✅' : tool.status === 'failed' ? '❌' : '⏸️';
        let line = `${icon} **${tool.name}**`;
        if (tool.output) {
          const output = tool.output.length > 200 ? tool.output.slice(0, 200) + '...' : tool.output;
          line += `\n> ${output.replace(/\n/g, '\n> ')}`;
        }
        return line;
      });

      elements.push({
        tag: 'markdown',
        content: toolLines.join('\n\n'),
      });
    }

    // 3. 正文
    if (data.text) {
      if (elements.length > 0) {
        elements.push({ tag: 'hr' });
      }
      elements.push({
        tag: 'markdown',
        content: truncateMiddleText(data.text, MAX_BODY_TEXT_LENGTH),
      });
    } else if (data.status === 'processing') {
      if (elements.length > 0) {
        elements.push({ tag: 'hr' });
      }
      elements.push({
        tag: 'markdown',
        content: '▋',
      });
    } else if (elements.length === 0) {
      elements.push({
        tag: 'markdown',
        content: '（无输出）',
      });
    }
  } else if (data.status === 'processing') {
    if (elements.length > 0) {
      elements.push({ tag: 'hr' });
    }
    elements.push({
      tag: 'markdown',
      content: '▋',
    });
  }

  if (elements.length === 0) {
    elements.push({
      tag: 'markdown',
      content: '（无输出）',
    });
  }

  if (data.pendingPermission) {
    elements.push(...buildPendingPermissionElements(data.pendingPermission));
  }

  if (data.pendingQuestion) {
    elements.push(...buildPendingQuestionElements(data.pendingQuestion));
  }

  return elements;
}

function buildStreamCardPayload(
  elements: object[],
  statusText: string,
  statusColor: 'blue' | 'green' | 'red'
): object {
  const normalizedElements = elements.length > 0
    ? elements
    : [{ tag: 'markdown', content: '（无输出）' }];

  return {
    schema: '2.0',
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: statusText,
      },
      template: statusColor,
    },
    body: {
      elements: normalizedElements,
    },
  };
}

function getFeishuVisibilityOptions(): { showThinking: boolean; showTools: boolean } {
  return {
    showThinking: outputConfig.feishu.showThinkingChain,
    showTools: outputConfig.feishu.showToolChain,
  };
}

export function buildStreamCards(data: StreamCardData, options?: StreamCardBuildOptions): object[] {
  const visibilityOptions = getFeishuVisibilityOptions();
  const allElements = buildStreamCardElements(data, visibilityOptions);
  const statusColor: 'blue' | 'green' | 'red' = data.status === 'processing'
    ? 'blue'
    : data.status === 'completed'
      ? 'green'
      : 'red';
  const baseStatusText = data.status === 'processing' ? '处理中...' : data.status === 'completed' ? '已完成' : '失败';

  const componentBudget = typeof options?.componentBudget === 'number' && Number.isFinite(options.componentBudget)
    ? Math.floor(options.componentBudget)
    : DEFAULT_STREAM_CARD_COMPONENT_BUDGET;
  const pages = paginateElementsByComponentBudget(allElements, componentBudget);

  if (pages.length <= 1) {
    return [buildStreamCardPayload(pages[0], baseStatusText, statusColor)];
  }

  return pages.map((pageElements, index) => {
    const statusText = `${baseStatusText}（${index + 1}/${pages.length}）`;
    return buildStreamCardPayload(pageElements, statusText, statusColor);
  });
}

export function buildStreamCard(data: StreamCardData): object {
  return buildStreamCards(data)[0];
}
