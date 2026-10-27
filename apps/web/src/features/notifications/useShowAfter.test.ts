import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useShowAfter } from './useShowAfter';

afterEach(() => {
  vi.useRealTimers();
});

describe('useShowAfter', () => {
  it('turns true only after 300 ms, and false again when it stops', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ active }) => useShowAfter(active), {
      initialProps: { active: true },
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
    rerender({ active: false });
    expect(result.current).toBe(false);
  });
});
