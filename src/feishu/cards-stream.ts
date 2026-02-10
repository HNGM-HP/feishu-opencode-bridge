import { type PermissionCardData } from './cards.js';

export * from './cards.js';

export interface StreamCardData {
  thinking: string;
  showThinking?: boolean; // Controls visibility of thinking process
  text: string;
  chatId?: string;
  messageId?: string;
  tools: Array<{
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    output?: string;
  }>;
  status: 'processing' | 'completed' | 'failed';
}

export function buildStreamCard(data: StreamCardData): object {
  const elements: object[] = [];

  // 1. 思考过程 (Collapsible UI)
  if (data.thinking) {
    const isExpanded = data.showThinking === true;
    
    // Header line with toggle button
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `🤔 **思考过程** (${data.thinking.length} chars)`,
      },
      extra: {
        tag: 'button',
        text: {
          tag: 'plain_text',
          content: isExpanded ? '收起' : '展开',
        },
        type: 'default',
        value: {
          action: 'toggle_thinking',
          toggleMode: isExpanded ? 'collapse' : 'expand',
          nextShowThinking: !isExpanded,
          ...(data.chatId ? { chatId: data.chatId } : {}),
          ...(data.messageId ? { messageId: data.messageId } : {}),
        }
      }
    });

    // Content (only if expanded)
    if (isExpanded) {
      elements.push({
        tag: 'div',
        text: {
            tag: 'lark_md',
            content: data.thinking
        }
      });
      // Add a separator
      elements.push({ tag: 'hr' });
    } else {
        // Optional: Show a preview if collapsed?
        // For now, just hide it as requested ("Thinking..." by default)
    }
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
