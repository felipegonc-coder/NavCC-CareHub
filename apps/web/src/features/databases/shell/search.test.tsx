import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSearch } from './search';
import { SEARCH_DELAY_MS } from './tools';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useSearch', () => {
  it('searches for the trimmed text once typing stops', () => {
    const { result } = renderHook(() => useSearch('view-a'));
    expect(result.current).toMatchObject({ open: false, text: '', query: '' });

    act(() => result.current.show());
    expect(result.current.open).toBe(true);
    act(() => result.current.type(' si'));
    wait(SEARCH_DELAY_MS - 1);
    act(() => result.current.type(' sink '));
    wait(SEARCH_DELAY_MS - 1);
    expect(result.current).toMatchObject({ text: ' sink ', query: '' });
    wait(1);
    expect(result.current).toMatchObject({ open: true, text: ' sink ', query: 'sink' });
  });

  it('shows every row at once when the box is emptied, and Clear search closes it', () => {
    const { result } = renderHook(() => useSearch('view-a'));
    act(() => result.current.type('sink'));
    wait(SEARCH_DELAY_MS);
    expect(result.current.query).toBe('sink');

    act(() => result.current.type(''));
    expect(result.current).toMatchObject({ open: true, text: '', query: '' });

    act(() => result.current.type('pump'));
    wait(SEARCH_DELAY_MS);
    act(() => result.current.clear());
    expect(result.current).toMatchObject({ open: false, text: '', query: '' });
  });

  it('belongs to the view showing: another view starts without it', () => {
    const { result, rerender } = renderHook(({ viewId }) => useSearch(viewId), {
      initialProps: { viewId: 'view-a' },
    });
    act(() => result.current.type('sink'));
    wait(SEARCH_DELAY_MS);
    rerender({ viewId: 'view-b' });
    expect(result.current).toMatchObject({ open: false, text: '', query: '' });
  });
});
