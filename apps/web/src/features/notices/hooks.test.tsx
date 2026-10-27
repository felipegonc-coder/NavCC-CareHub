import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLiveClientForTest } from '../live/client';
import { createFakeLive } from '../live/testSource';
import { useNoticesPreview, useNoticesUnread } from './hooks';
import { createNoticesServer, notice } from './testServer';

const realFetch = globalThis.fetch;
let api: ReturnType<typeof createNoticesServer>;
let live: ReturnType<typeof createFakeLive>;

function renderHooks() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => ({ unread: useNoticesUnread(), preview: useNoticesPreview() }), {
    wrapper,
  });
}

const summaryCalls = () => api.server.calls.filter((c) => c.url === '/api/notices/summary');

beforeEach(() => {
  api = createNoticesServer([
    notice({ id: 'n1', position: 1, read: true }),
    notice({
      id: 'n2',
      position: 2,
      kind: 'mention',
      sender: 'Sam Ortiz',
      title: 'Mentioned you in a comment',
      latestAt: '2026-10-27T16:00:00.000Z',
    }),
  ]);
  globalThis.fetch = api.fetchStub;
  live = createFakeLive();
  setLiveClientForTest(live.client);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setLiveClientForTest(null);
});

describe('useNoticesUnread and useNoticesPreview', () => {
  it('give 0 and undefined until loaded, then the count and newest notice, from one request', async () => {
    const { result } = renderHooks();
    expect(result.current).toEqual({ unread: 0, preview: undefined });
    await waitFor(() => expect(result.current.unread).toBe(1));
    expect(result.current.preview).toEqual({
      title: 'Mentioned you in a comment',
      sender: 'Sam Ortiz',
      latestAt: '2026-10-27T16:00:00.000Z',
    });
    expect(summaryCalls()).toHaveLength(1);
  });

  it('give null when the chat is empty', async () => {
    api.server.notices = [];
    const { result } = renderHooks();
    await waitFor(() => expect(result.current.preview).toBeNull());
    expect(result.current.unread).toBe(0);
  });

  it('refetch once when the server says the chat changed', async () => {
    const { result } = renderHooks();
    await waitFor(() => expect(result.current.unread).toBe(1));
    await act(() => live.open());

    api.server.add(
      notice({ id: 'n3', position: 3, title: 'Your export is ready', kind: 'export' }),
    );
    await act(async () => {
      live.send({ type: 'notices-changed' });
    });
    await waitFor(() => expect(result.current.unread).toBe(2));
    expect(result.current.preview?.title).toBe('Your export is ready');
    // Both hooks heard the nudge; the summary was fetched again only once.
    expect(summaryCalls()).toHaveLength(2);
  });

  it('refetch after a live reconnect, when nudges may have been missed', async () => {
    const { result } = renderHooks();
    await waitFor(() => expect(result.current.unread).toBe(1));
    await act(() => live.open());
    await act(async () => {
      live.last().emit('error');
    });
    await act(async () => {
      live.wake();
      await live.open();
    });
    await waitFor(() => expect(summaryCalls()).toHaveLength(2));
  });

  it('ignore other live events', async () => {
    const { result } = renderHooks();
    await waitFor(() => expect(result.current.unread).toBe(1));
    await act(() => live.open());
    await act(async () => {
      live.send({ type: 'job-updated', data: { jobId: 'job-1' } });
    });
    expect(summaryCalls()).toHaveLength(1);
  });
});
