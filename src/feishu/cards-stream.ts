export * from './cards.js';

export type StreamToolState = {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: string;
};

export interface StreamCardData {
  thinking: string;
  showThinking?: boolean;
  text: string;
  chatId?: string;
  messageId?: string;
  thinkingMessageId?: string;
  tools: StreamToolState[];
  status: 'processing' | 'completed' | 'failed';
}

function escapeCodeBlockContent(text: string): string {
  return text.replace(/```/g, '` ` `');
}

export function buildStreamCard(data: StreamCardData): object {
  const elements: object[] = [];
  const thinkingText = data.thinking.trim();

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
