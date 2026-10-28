import { afterEach, describe, expect, it, vi } from 'vitest';
import { isWritingHelpOn, onWritingHelpChange, setWritingHelpOn } from './status';

afterEach(() => {
  setWritingHelpOn(false);
});

describe('writing help status', () => {
  it('starts off, so no Claude entry point shows before the status is known', () => {
    expect(isWritingHelpOn()).toBe(false);
  });

  it('tells listeners when it changes, once per change', () => {
    const listener = vi.fn();
    const stop = onWritingHelpChange(listener);
    setWritingHelpOn(true);
    setWritingHelpOn(true);
    expect(isWritingHelpOn()).toBe(true);
    setWritingHelpOn(false);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    setWritingHelpOn(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
