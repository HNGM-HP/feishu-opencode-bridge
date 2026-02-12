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
      variant?: 'retry' | 'compaction' | 'question' | 'error';
    };

export interface StreamCardData {
  thinking: string;
  showThinking?: boolean;
  text: string;
  chatId?: string;
  messageId?: string;
  thinkingMessageId?: string;
  tools: StreamToolState[];
  segments?: StreamCardSegment[];
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
      const output = segment.output?.trim() ? truncateText(segment.output.trim(), 4000) : '';
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
        content: truncateText(text, 500),
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
