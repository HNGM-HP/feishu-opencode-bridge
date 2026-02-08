// 权限确认卡片模板
export interface PermissionCardData {
  tool: string;
  description: string;
  risk?: string;
  sessionId: string;
  permissionId: string;
}

export function buildPermissionCard(data: PermissionCardData): object {
  const riskColor = data.risk === 'high' ? 'red' : data.risk === 'medium' ? 'orange' : 'green';
  const riskText = data.risk === 'high' ? '⚠️ 高风险' : data.risk === 'medium' ? '⚡ 中等风险' : '✅ 低风险';

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: '🔐 权限确认请求',
      },
      template: 'blue',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**工具名称**: ${data.tool}`,
        },
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**操作描述**: ${data.description}`,
        },
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**风险等级**: <font color="${riskColor}">${riskText}</font>`,
        },
      },
      {
        tag: 'hr',
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: '✅ 允许',
            },
            type: 'primary',
            value: {
              action: 'permission_allow',
              sessionId: data.sessionId,
              permissionId: data.permissionId,
              remember: false,
            },
          },
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: '❌ 拒绝',
            },
            type: 'danger',
            value: {
              action: 'permission_deny',
              sessionId: data.sessionId,
              permissionId: data.permissionId,
            },
          },
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: '📝 始终允许此工具',
            },
            type: 'default',
            value: {
              action: 'permission_allow',
              sessionId: data.sessionId,
              permissionId: data.permissionId,
              remember: true,
            },
          },
        ],
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: '也可以直接回复 y 或 n 来确认',
          },
        ],
      },
    ],
  };
}

// 执行状态卡片
export interface StatusCardData {
  status: 'running' | 'completed' | 'failed' | 'aborted';
  sessionId: string;
  currentTool?: string;
  progress?: string;
  output?: string;
}

export function buildStatusCard(data: StatusCardData): object {
  const statusMap = {
    running: { text: '⏳ 执行中', color: 'blue' },
    completed: { text: '✅ 已完成', color: 'green' },
    failed: { text: '❌ 执行失败', color: 'red' },
    aborted: { text: '⏹️ 已中断', color: 'orange' },
  };

  const status = statusMap[data.status];

  const elements: object[] = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**状态**: <font color="${status.color}">${status.text}</font>`,
      },
    },
  ];

  if (data.currentTool) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**当前工具**: ${data.currentTool}`,
      },
    });
  }

  if (data.progress) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**进度**: ${data.progress}`,
      },
    });
  }

  if (data.output) {
    elements.push({
      tag: 'hr',
    });
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: data.output.slice(0, 2000), // 飞书卡片内容限制
      },
    });
  }

  // 运行中时显示中断按钮
  if (data.status === 'running') {
    elements.push({
      tag: 'hr',
    });
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: {
            tag: 'plain_text',
            content: '⏹️ 中断执行',
          },
          type: 'danger',
          value: {
            action: 'abort',
            sessionId: data.sessionId,
          },
        },
      ],
    });
  }

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: '🤖 OpenCode 执行状态',
      },
      template: status.color,
    },
    elements,
  };
}

// 控制面板卡片
export interface ControlCardData {
  conversationKey: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  currentModel?: string;
  currentAgent?: string;
  models: Array<{ label: string; value: string }>;
  agents: Array<{ label: string; value: string }>;
}

export function buildControlCard(data: ControlCardData): object {
  const modelOptions = data.models.map(item => ({
    text: { tag: 'plain_text', content: item.label },
    value: item.value,
  }));

  const agentOptions = data.agents.map(item => ({
    text: { tag: 'plain_text', content: item.label },
    value: item.value,
  }));

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: '🎛️ 会话控制面板',
      },
      template: 'blue',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**当前模型**: ${data.currentModel || '跟随默认'}\n**当前Agent**: ${data.currentAgent || '默认'}`,
        },
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '⏹️ 停止' },
            type: 'danger',
            value: { action: 'abort', conversationKey: data.conversationKey, chatId: data.chatId, chatType: data.chatType },
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '↩️ 撤回' },
            type: 'default',
            value: { action: 'undo', conversationKey: data.conversationKey, chatId: data.chatId, chatType: data.chatType },
          },
        ],
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'select_static',
            placeholder: { tag: 'plain_text', content: '切换模型' },
            value: { action: 'model_select', conversationKey: data.conversationKey, chatId: data.chatId, chatType: data.chatType },
            options: modelOptions,
          },
        ],
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'select_static',
            placeholder: { tag: 'plain_text', content: '切换Agent' },
            value: { action: 'agent_select', conversationKey: data.conversationKey, chatId: data.chatId, chatType: data.chatType },
            options: agentOptions,
          },
        ],
      },
    ],
  };
}

// AI 提问卡片 (question 工具)
export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionInfo {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface QuestionCardData {
  requestId: string;
  sessionId: string;
  questions: QuestionInfo[];
  conversationKey: string;
  chatId: string;
  draftAnswers?: string[][];
  draftCustomAnswers?: string[];
  pendingCustomQuestionIndex?: number;
  currentQuestionIndex?: number;
  optionPageIndexes?: number[];
}

export const QUESTION_OPTION_PAGE_SIZE = 15;
const QUESTION_DESCRIPTION_MAX_LENGTH = 120;
const QUESTION_DESCRIPTION_LINE_LENGTH = 40;

function wrapText(text: string, lineLength: number): string {
  if (text.length <= lineLength) return text;
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += lineLength) {
    parts.push(text.slice(i, i + lineLength));
  }
  return parts.join('\n    ');
}

function formatOptionDescription(description: string): string {
  const trimmed = description.trim().slice(0, QUESTION_DESCRIPTION_MAX_LENGTH);
  return wrapText(trimmed, QUESTION_DESCRIPTION_LINE_LENGTH);
}

// 文字选择方案：只读卡片 + 跳过按钮
export function buildQuestionCardV2(data: QuestionCardData): object {
  const elements: object[] = [];
  const totalQuestions = data.questions.length;
  const safeIndex = totalQuestions > 0
    ? Math.min(Math.max(data.currentQuestionIndex ?? 0, 0), totalQuestions - 1)
    : 0;
  const question = data.questions[safeIndex];

  const titleLines = [`**问题 ${safeIndex + 1}/${totalQuestions}**`];
  if (question.header) titleLines.push(question.header);
  if (question.question) titleLines.push(question.question);

  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: titleLines.join('\n'),
    },
  });

  if (question.options.length > 0) {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const descriptionLines = question.options.map((opt, optIndex) => {
      const number = optIndex + 1;
      const letter = optIndex < letters.length ? letters[optIndex] : '';
      const prefix = letter ? `${letter}(${number}).` : `${number}.`;
      const desc = opt.description ? formatOptionDescription(opt.description) : '';
      return `${prefix} **${opt.label}**${desc ? `: ${desc}` : ''}`;
    }).join('\n');
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: descriptionLines,
      },
    });
  }

  const hint = question.multiple
    ? '多选请用逗号或空格分隔（如 A,C 或 1 3），或直接回复自定义内容'
    : '回复 A 或 1，或直接回复自定义内容';
  elements.push({
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content: hint,
      },
    ],
  });

  elements.push({
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content: '可直接回复自定义内容（不匹配选项将按自定义处理）',
      },
    ],
  });

  elements.push({
    tag: 'action',
    actions: [
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '跳过' },
        type: 'default',
        value: {
          action: 'question_skip',
          requestId: data.requestId,
          conversationKey: data.conversationKey,
          questionIndex: safeIndex,
        },
      },
    ],
  });

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: '🤔 AI 需要你的输入',
      },
      template: 'orange',
    },
    elements,
  };
}

// 已回答的问题卡片（更新后的状态）
export function buildQuestionAnsweredCard(answers: string[][]): object {
  // 格式化答案展示
  const answerTexts = answers.map((ans, i) => {
    const answerStr = ans.length > 0 ? ans.join(', ') : '(未回答)';
    return answers.length > 1 ? `**问题 ${i + 1}**: ${answerStr}` : `**你的回答**: ${answerStr}`;
  });

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: '✅ 已回答',
      },
      template: 'green',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: answerTexts.join('\n'),
        },
      },
    ],
  };
}

// 兼容旧的单字符串调用
export function buildQuestionAnsweredCardSimple(answer: string): object {
  return buildQuestionAnsweredCard([[answer]]);
}

// 欢迎卡片（引导创建群聊）
export function buildWelcomeCard(userName: string): object {
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: '👋 欢迎使用 OpenCode',
      },
      template: 'blue',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `你好 **${userName}**，我是你的 AI 助手。\n\n为了更好地管理上下文，请点击下方按钮创建一个专属的会话群。`,
        },
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: '➕ 创建新会话',
            },
            type: 'primary',
            value: {
              action: 'create_chat',
            },
          },
        ],
      },
    ],
  };
}

