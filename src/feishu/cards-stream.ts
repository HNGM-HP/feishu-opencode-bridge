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

  // 1. 工具调用列表
  if (data.tools && data.tools.length > 0) {
    const toolLines = data.tools.map(tool => {
      const icon = tool.status === 'running' ? '⏳' : tool.status === 'completed' ? '✅' : tool.status === 'failed' ? '❌' : '⏸️';
      let line = `${icon} **${tool.name}**`;
      if (tool.output) {
        // 截断输出以防卡片过大
        const output = tool.output.length > 200 ? tool.output.slice(0, 200) + '...' : tool.output;
        line += `\n> ${output.replace(/\n/g, '\n> ')}`;
      }
      return line;
    });
    
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: toolLines.join('\n\n'),
      },
    });
    
    elements.push({ tag: 'hr' });
  }

  // 2. 最终文本回复
  if (data.text) {
    elements.push({
      tag: 'markdown',
      content: data.text,
    });
  } else if (data.status === 'processing') {
    elements.push({
      tag: 'div',
      text: {
        tag: 'plain_text',
        content: '▋', // 光标闪烁效果
      },
    });
  }

  // 3. 状态栏
  const statusColor = data.status === 'processing' ? 'blue' : data.status === 'completed' ? 'green' : 'red';
  const statusText = data.status === 'processing' ? '处理中...' : data.status === 'completed' ? '已完成' : '失败';

  return {
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
    elements,
  };
}

export function buildThinkingCard(data: StreamCardData): object {
  const thinkingText = data.thinking || '（无思考过程）';
  const panelTitle = `🤔 思考过程 (${thinkingText.length}字)`;

  const statusColor = data.status === 'processing' ? 'blue' : data.status === 'completed' ? 'green' : 'red';
  const statusText = data.status === 'processing' ? '思考中...' : data.status === 'completed' ? '思考完成' : '思考失败';

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
      elements: [
        {
          tag: 'collapsible_panel',
          expanded: false,
          header: {
            title: {
              tag: 'plain_text',
              content: panelTitle,
            },
          },
          elements: [
            {
              tag: 'markdown',
              content: `\`\`\`\n${escapeCodeBlockContent(thinkingText)}\n\`\`\``,
            },
          ],
        },
      ],
    },
  };
}
