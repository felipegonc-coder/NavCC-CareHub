import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLiveClientForTest } from '../../live/client';
import { createFakeLive } from '../../live/testSource';
import { useCalendarItems, useCalendarLayers, useCalendarLive, useUpcoming } from './queries';
import { TEST_ZONE, testEvent, testLayer } from './testItems';

/** Every request the hooks sent, as path and query. */
let requests: string[] = [];
let client: QueryClient;

const upcoming = {
  id: 'ev-1',
  title: 'QA calibration',
  allDay: false,
  start: '2026-10-27T16:00:00.000Z',
  end: '2026-10-27T17:00:00.000Z',
  videoLink: { url: 'https://meet.example.test/qa-calibration', provider: 'google-meet' },
  href: '/calendar?event=ev-1',
};

function answer(path: string): unknown {
  const url = new URL(path, 'http://localhost');
  if (url.pathname === '/api/calendar/layers') return { layers: [testLayer('meetings')] };
  if (url.pathname === '/api/calendar/upcoming') return { items: [upcoming] };
  return {
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    timeZone: TEST_ZONE,
    items: [testEvent()],
    truncated: false,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  requests = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      requests.push(path);
      return new Response(JSON.stringify(answer(path)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
  setLiveClientForTest(null);
});

describe('calendar queries', () => {
  it('asks for the days shown, with the day after the last one as the exclusive end', async () => {
    const { result } = renderHook(() => useCalendarItems('2026-10-25', '2026-10-31'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requests).toEqual(['/api/calendar/items?from=2026-10-25&to=2026-11-01']);
    expect(result.current.data).toMatchObject({ timeZone: TEST_ZONE, items: [{ id: 'ev-1' }] });
  });

  it('loads the items and layers again when the calendar changes elsewhere', async () => {
    const live = createFakeLive();
    setLiveClientForTest(live.client);
    renderHook(
      () => {
        useCalendarItems('2026-10-25', '2026-10-31');
        useCalendarLayers();
        useCalendarLive();
      },
      { wrapper },
    );
    await waitFor(() => expect(requests).toHaveLength(2));

    act(() => live.send({ type: 'calendar.changed', data: { eventId: 'ev-1' } }));
    await waitFor(() => expect(requests).toHaveLength(4));
    expect(requests.filter((path) => path === '/api/calendar/layers')).toHaveLength(2);
  });
});

describe('useUpcoming', () => {
  it('asks for what is next, up to the limit', async () => {
    const { result } = renderHook(() => useUpcoming(3), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requests).toEqual(['/api/calendar/upcoming?limit=3']);
    expect(result.current.data?.items).toEqual([upcoming]);
  });

  it('loads again when the calendar changes elsewhere', async () => {
    const live = createFakeLive();
    setLiveClientForTest(live.client);
    renderHook(() => useUpcoming(3), { wrapper });
    await waitFor(() => expect(requests).toHaveLength(1));

    act(() => live.send({ type: 'calendar.changed', data: { eventId: 'ev-1' } }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toBe('/api/calendar/upcoming?limit=3');
  });
});
