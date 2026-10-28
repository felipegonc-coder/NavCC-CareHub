import { CLAUDE_FEATURES, type ClaudeFeature } from '@carehub/extras/claude';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_OFF,
  claudeStatus,
  isClaudeOn,
  onClaudeStatusChange,
  setClaudeStatus,
  useClaudeOn,
} from './status';

const on = (features: Partial<Record<ClaudeFeature, boolean>>) => ({
  on: { ...ALL_OFF.on, ...features },
});

afterEach(() => {
  setClaudeStatus(ALL_OFF);
});

describe('Claude status', () => {
  it('starts all off, so nothing shows before the server answers (CL-01)', () => {
    expect(claudeStatus()).toEqual(ALL_OFF);
    for (const feature of CLAUDE_FEATURES) expect(isClaudeOn(feature)).toBe(false);
  });

  it('tells listeners once per change, with the new status', () => {
    const listener = vi.fn();
    const stop = onClaudeStatusChange(listener);
    setClaudeStatus(on({ writing_help: true }));
    setClaudeStatus(on({ writing_help: true }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(on({ writing_help: true }));
    expect(isClaudeOn('writing_help')).toBe(true);
    expect(isClaudeOn('assistant')).toBe(false);
    stop();
    setClaudeStatus(ALL_OFF);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps its own copy of what it was given', () => {
    const next = on({ assistant: true });
    setClaudeStatus(next);
    next.on.assistant = false;
    expect(isClaudeOn('assistant')).toBe(true);
  });

  it('draws components again when a feature turns on or off (CL-05)', () => {
    const { result } = renderHook(() => useClaudeOn('fields'));
    expect(result.current).toBe(false);
    act(() => setClaudeStatus(on({ fields: true })));
    expect(result.current).toBe(true);
    act(() => setClaudeStatus(ALL_OFF));
    expect(result.current).toBe(false);
  });
});
