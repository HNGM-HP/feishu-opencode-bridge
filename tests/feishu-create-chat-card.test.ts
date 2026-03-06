import { describe, expect, it } from 'vitest';
import {
  buildCreateChatCard,
  CREATE_CHAT_NEW_SESSION_VALUE,
  type CreateChatCardData,
} from '../src/feishu/cards.js';

type CardFormElement = {
  tag?: unknown;
  name?: unknown;
  options?: Array<{ value?: string }>;
};

function getFormElements(card: object): CardFormElement[] {
  const cardRecord = card as { elements?: Array<{ tag?: string; elements?: CardFormElement[] }> };
  const elements = Array.isArray(cardRecord.elements) ? cardRecord.elements : [];
  const form = elements.find(item => item && item.tag === 'form');
  return Array.isArray(form?.elements) ? form.elements : [];
}

function createBaseData(): CreateChatCardData {
  return {
    selectedSessionId: CREATE_CHAT_NEW_SESSION_VALUE,
    sessionOptions: [
      { label: '新建 OpenCode 会话（默认）', value: CREATE_CHAT_NEW_SESSION_VALUE },
    ],
    totalSessionCount: 0,
    manualBindEnabled: false,
  };
}

describe('Feishu create_chat card project selector', () => {
  it('无项目列表时也应展示工作项目下拉（含默认项）', () => {
    const card = buildCreateChatCard(createBaseData());
    const formElements = getFormElements(card);
    const projectSelect = formElements.find(item => item.name === 'project_source');

    expect(projectSelect).toBeDefined();
    expect(projectSelect?.tag).toBe('select_static');
    expect(Array.isArray(projectSelect?.options)).toBe(true);
    expect(projectSelect?.options?.[0]?.value).toBe('__default__');
  });

  it('有项目列表时应附加项目选项', () => {
    const data: CreateChatCardData = {
      ...createBaseData(),
      projectOptions: [
        {
          name: 'frontend',
          directory: '/workspace/frontend',
          source: 'alias',
        },
      ],
    };

    const card = buildCreateChatCard(data);
    const formElements = getFormElements(card);
    const projectSelect = formElements.find(item => item.name === 'project_source');

    expect(projectSelect).toBeDefined();
    expect(projectSelect?.options?.length).toBe(2);
    expect(projectSelect?.options?.[1]?.value).toBe('/workspace/frontend');
  });
});
