import { afterEach, describe, expect, it, vi } from 'vitest';

const envKeys = [
  'FEISHU_SHOW_THINKING_CHAIN',
  'FEISHU_SHOW_TOOL_CHAIN',
  'SHOW_THINKING_CHAIN',
  'SHOW_TOOL_CHAIN',
];

const backup = new Map<string, string | undefined>();

const restoreEnv = (): void => {
  for (const key of envKeys) {
    const value = backup.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const snapshotEnv = (): void => {
  for (const key of envKeys) {
    backup.set(key, process.env[key]);
  }
};

const loadCardsModule = async () => {
  vi.resetModules();
  return await import('../src/feishu/cards-stream.js');
};

describe('Feishu visibility gating', () => {
  afterEach(() => {
    restoreEnv();
    backup.clear();
  });

  it('默认情况下应显示思考链和工具链', async () => {
    snapshotEnv();
    delete process.env.FEISHU_SHOW_THINKING_CHAIN;
    delete process.env.FEISHU_SHOW_TOOL_CHAIN;

    const { buildStreamCard } = await loadCardsModule();
    const card = buildStreamCard({
      thinking: '这是思考过程',
      text: '这是最终答案',
      tools: [{ name: 'Read', status: 'completed', output: '文件内容' }],
      status: 'completed',
    }) as { body: { elements: unknown[] } };

    expect(card.body.elements).toBeDefined();
    const elements = card.body.elements as object[];
    expect(elements.length).toBeGreaterThan(0);
  });

  it('FEISHU_SHOW_THINKING_CHAIN=false 时应隐藏思考链', async () => {
    snapshotEnv();
    process.env.FEISHU_SHOW_THINKING_CHAIN = 'false';
    process.env.FEISHU_SHOW_TOOL_CHAIN = 'true';

    const { buildStreamCard } = await loadCardsModule();
    const card = buildStreamCard({
      thinking: '这是思考过程',
      text: '这是最终答案',
      tools: [],
      status: 'completed',
    }) as { body: { elements: unknown[] } };

    const elements = card.body.elements as object[];
    const hasThinkingPanel = elements.some((el: object) => {
      const record = el as Record<string, unknown>;
      return record.tag === 'collapsible_panel' && 
        JSON.stringify(record).includes('思考过程');
    });
    
    expect(hasThinkingPanel).toBe(false);
  });

  it('FEISHU_SHOW_TOOL_CHAIN=false 时应隐藏工具链', async () => {
    snapshotEnv();
    process.env.FEISHU_SHOW_THINKING_CHAIN = 'true';
    process.env.FEISHU_SHOW_TOOL_CHAIN = 'false';

    const { buildStreamCard } = await loadCardsModule();
    const card = buildStreamCard({
      thinking: '',
      text: '这是最终答案',
      tools: [{ name: 'Read', status: 'completed', output: '文件内容' }],
      status: 'completed',
    }) as { body: { elements: unknown[] } };

    const elements = card.body.elements as object[];
    const hasToolContent = elements.some((el: object) => {
      const record = el as Record<string, unknown>;
      const content = JSON.stringify(record);
      return content.includes('Read') || content.includes('工具');
    });
    
    expect(hasToolContent).toBe(false);
  });

  it('两个开关都为 false 时 final answer 仍然可见', async () => {
    snapshotEnv();
    process.env.FEISHU_SHOW_THINKING_CHAIN = 'false';
    process.env.FEISHU_SHOW_TOOL_CHAIN = 'false';

    const { buildStreamCard } = await loadCardsModule();
    const card = buildStreamCard({
      thinking: '这是思考过程',
      text: '这是最终答案',
      tools: [{ name: 'Read', status: 'completed', output: '文件内容' }],
      status: 'completed',
    }) as { body: { elements: unknown[] } };

    const elements = card.body.elements as object[];
    const hasFinalAnswer = elements.some((el: object) => {
      const record = el as Record<string, unknown>;
      const content = JSON.stringify(record);
      return content.includes('这是最终答案');
    });
    
    expect(hasFinalAnswer).toBe(true);
  });

  it('segments 模式下 FEISHU_SHOW_THINKING_CHAIN=false 应隐藏 reasoning segment', async () => {
    snapshotEnv();
    process.env.FEISHU_SHOW_THINKING_CHAIN = 'false';
    process.env.FEISHU_SHOW_TOOL_CHAIN = 'true';

    const { buildStreamCard } = await loadCardsModule();
    const card = buildStreamCard({
      thinking: '',
      text: '这是最终答案',
      segments: [
        { type: 'reasoning', text: '这是思考过程' },
        { type: 'text', text: '这是正文内容' },
      ],
      tools: [],
      status: 'completed',
    }) as { body: { elements: unknown[] } };

    const elements = card.body.elements as object[];
    const hasReasoningPanel = elements.some((el: object) => {
      const record = el as Record<string, unknown>;
      return record.tag === 'collapsible_panel' && 
        JSON.stringify(record).includes('思考过程');
    });
    
    expect(hasReasoningPanel).toBe(false);
  });

  it('segments 模式下 FEISHU_SHOW_TOOL_CHAIN=false 应隐藏 tool segment', async () => {
    snapshotEnv();
    process.env.FEISHU_SHOW_THINKING_CHAIN = 'true';
    process.env.FEISHU_SHOW_TOOL_CHAIN = 'false';

    const { buildStreamCard } = await loadCardsModule();
    const card = buildStreamCard({
      thinking: '',
      text: '这是最终答案',
      segments: [
        { type: 'tool', name: 'Read', status: 'completed', output: '文件内容' },
        { type: 'text', text: '这是正文内容' },
      ],
      tools: [],
      status: 'completed',
    }) as { body: { elements: unknown[] } };

    const elements = card.body.elements as object[];
    const hasToolPanel = elements.some((el: object) => {
      const record = el as Record<string, unknown>;
      return record.tag === 'collapsible_panel' && 
        JSON.stringify(record).includes('Read');
    });
    
    expect(hasToolPanel).toBe(false);
  });

  it('两个开关都为 false 时 segments 模式仍保留 text segment', async () => {
    snapshotEnv();
    process.env.FEISHU_SHOW_THINKING_CHAIN = 'false';
    process.env.FEISHU_SHOW_TOOL_CHAIN = 'false';

    const { buildStreamCard } = await loadCardsModule();
    const card = buildStreamCard({
      thinking: '',
      text: '',
      segments: [
        { type: 'reasoning', text: '这是思考过程' },
        { type: 'tool', name: 'Read', status: 'completed', output: '输出' },
        { type: 'text', text: '这是正文内容' },
      ],
      tools: [],
      status: 'completed',
    }) as { body: { elements: unknown[] } };

    const elements = card.body.elements as object[];
    const hasTextContent = elements.some((el: object) => {
      const record = el as Record<string, unknown>;
      const content = JSON.stringify(record);
      return content.includes('这是正文内容');
    });
    
    expect(hasTextContent).toBe(true);
  });
});
