import { type PermissionCardData } from './cards.js';

export * from './cards.js';

export interface StreamCardData {
  thinking: string;
  text: string;
  tools: Array<{
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    output?: string;
  }>;
  status: 'processing' | 'completed' | 'failed';
}

export function buildStreamCard(data: StreamCardData): object {
  const elements: object[] = [];

  // 1. 思考过程 (Collapsible Panel)
  if (data.thinking) {
    const thinkingPreview = data.thinking.slice(0, 50).replace(/\n/g, ' ') + (data.thinking.length > 50 ? '...' : '');
    elements.push({
      tag: 'collapsible_panel',
      expanded: false,
      header: {
        title: {
          tag: 'plain_text',
          content: `🤔 思考过程 (${data.thinking.length} chars)`,
        },
      },
      elements: [
        {
          tag: 'markdown',
          content: data.thinking, // 飞书会自动处理 Markdown 引用块
        },
      ],
    });
  }

  // 2. 工具调用列表
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

  // 3. 最终文本回复
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

  // 4. 状态栏
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
