import { describe, expect, it } from 'vitest';
import { parseEventSeq, resolveReplaySince } from '../web/src/composables/chat-stream-utils.ts';

describe('chat stream reconnect helpers', () => {
  it('应从 Last-Event-ID 中提取合法事件序号', () => {
    expect(parseEventSeq('5')).toBe(5);
    expect(parseEventSeq('0')).toBeNull();
    expect(parseEventSeq('not-a-number')).toBeNull();
    expect(parseEventSeq(undefined)).toBeNull();
  });

  it('仅在同一会话重连时才应携带 since 序号', () => {
    expect(resolveReplaySince('session-1', 'session-1', 5)).toBe(5);
    expect(resolveReplaySince('session-1', 'session-2', 5)).toBeNull();
    expect(resolveReplaySince('session-1', 'session-1', null)).toBeNull();
  });
});
