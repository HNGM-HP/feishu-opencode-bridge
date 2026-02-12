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

function buildTimelineElements(segments: StreamCardSegment[]): object[] {
  const elements: object[] = [];
  const visibleSegments = segments.slice(-80);

  for (const segment of visibleSegments) {
    let nextElement: object | null = null;

    if (segment.type === 'reasoning') {
      const text = segment.text.trim();
      if (!text) {
        continue;
      }

      const rendered = truncateText(text, 6000);
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
      const statusInfo = getToolStatusLabel(segment.status);
      const toolKindLabel = segment.kind === 'subtask' ? '子任务' : '工具';
      const output = segment.output?.trim() ? truncateMiddleText(segment.output.trim(), 12000) : '';
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
      nextElement = {
        tag: 'markdown',
        content: segment.text,
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
        content: '输入“跳过”可跳过本题。',
      },
    ],
  });

  return blocks;
}

export function buildStreamCard(data: StreamCardData): object {
  const elements: object[] = [];
  const thinkingText = data.thinking.trim();

  const timelineElements = Array.isArray(data.segments) && data.segments.length > 0
    ? buildTimelineElements(data.segments)
    : [];

  if (timelineElements.length > 0) {
    elements.push(...timelineElements);
  }

  if (timelineElements.length === 0) {
    // 1. 思考过程（原生折叠面板）
    if (thinkingText) {
      elements.push({
        tag: 'collapsible_panel',
        expanded: false,
        header: {
          title: {
            tag: 'plain_text',
            content: `🤔 思考过程 (${thinkingText.length}字)`,
          },
        },
        elements: [
          {
            tag: 'markdown',
            content: `\`\`\`\n${escapeCodeBlockContent(thinkingText)}\n\`\`\``,
          },
        ],
      });
    }

    // 2. 工具调用列表
    if (data.tools.length > 0) {
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
        content: data.text,
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

  // 4. 状态栏
  const statusColor = data.status === 'processing' ? 'blue' : data.status === 'completed' ? 'green' : 'red';
  const statusText = data.status === 'processing' ? '处理中...' : data.status === 'completed' ? '已完成' : '失败';

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
      elements,
    },
  };
}
