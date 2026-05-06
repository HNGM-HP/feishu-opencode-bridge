import { describe, expect, it } from 'vitest';
import { formatVariantLabel, resolveSupportedVariant } from '../web/src/composables/chat-model.ts';

describe('chat model variant helpers', () => {
  it('应把供应商原始 variant 名称映射成统一显示档位', () => {
    expect(formatVariantLabel('reasoning_high')).toBe('high');
    expect(formatVariantLabel('thinking_medium')).toBe('medium');
    expect(formatVariantLabel('deep')).toBe('xhigh');
  });

  it('应把已选档位映射到当前模型真正支持的原始 variant 值', () => {
    expect(resolveSupportedVariant('low', ['reasoning_low', 'reasoning_high'])).toBe('reasoning_low');
    expect(resolveSupportedVariant('thinking_high', ['high', 'max'])).toBe('high');
    expect(resolveSupportedVariant('medium', ['reasoning_low', 'reasoning_high'])).toBeUndefined();
  });
});
