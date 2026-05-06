import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearResourceListeners,
  emitResourceChange,
  onResourceChange,
} from '../../../src/services/resources/events.js';

describe('resources/events', () => {
  afterEach(() => clearResourceListeners());

  it('delivers events to subscribers', () => {
    const handler = vi.fn();
    const unsub = onResourceChange(handler);

    emitResourceChange('skill', 'add', { name: 'demo', scope: 'project' });

    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0];
    expect(ev.kind).toBe('skill');
    expect(ev.action).toBe('add');
    expect(ev.name).toBe('demo');
    expect(ev.scope).toBe('project');
    expect(typeof ev.at).toBe('number');

    unsub();
    emitResourceChange('skill', 'remove', { name: 'demo' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('defaults name to null when omitted', () => {
    const handler = vi.fn();
    onResourceChange(handler);
    emitResourceChange('mcp', 'reload');
    expect(handler.mock.calls[0][0].name).toBeNull();
  });

  it('clearResourceListeners removes all listeners', () => {
    const handler = vi.fn();
    onResourceChange(handler);
    clearResourceListeners();
    emitResourceChange('agent', 'add');
    expect(handler).not.toHaveBeenCalled();
  });
});
