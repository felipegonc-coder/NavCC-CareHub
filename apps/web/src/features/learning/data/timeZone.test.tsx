import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEARNING_DAY_ZONE,
  isTimeZone,
  meQueryKey,
  profileTimeZone,
  useProfileTimeZone,
} from './timeZone';

// Fictional data only.
const me = (user: Record<string, unknown>) => ({
  user: { id: 'user-robin', name: 'Robin Example', ...user },
  member: null,
  workspace: null,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderZone(client = freshClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useProfileTimeZone(), { wrapper });
}

afterEach(() => vi.restoreAllMocks());

describe('useProfileTimeZone', () => {
  it('is undefined while the profile loads, then the profile zone', async () => {
    let answer: (response: Response) => void = () => undefined;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const { result } = renderZone();
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(String(fetch.mock.calls[0]?.[0])).toBe('/api/auth/me');
    answer(json(200, me({ timeZone: 'Pacific/Honolulu' })));
    await waitFor(() => expect(result.current).toBe('Pacific/Honolulu'));
  });

  it('gives America/Denver when the profile has no zone, or one the browser does not know', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(200, me({})))
      .mockResolvedValueOnce(json(200, me({ timeZone: 'Mars/Olympus_Mons' })));
    const none = renderZone();
    await waitFor(() => expect(none.result.current).toBe('America/Denver'));
    const unknown = renderZone();
    await waitFor(() => expect(unknown.result.current).toBe('America/Denver'));
  });

  it('gives America/Denver when the profile cannot be loaded', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json(500, { error: { code: 'server_error', message: 'Something went wrong.' } }),
    );
    const { result } = renderZone();
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe('America/Denver'));
  });

  it('reads the profile another screen already loaded, without asking again', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const client = freshClient();
    client.setQueryData(meQueryKey, me({ timeZone: 'Europe/Lisbon' }));
    const { result } = renderZone(client);
    expect(result.current).toBe('Europe/Lisbon');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('profileTimeZone', () => {
  it('reads user.timeZone, or gives America/Denver', () => {
    expect(profileTimeZone(me({ timeZone: 'Asia/Tokyo' }))).toBe('Asia/Tokyo');
    expect(profileTimeZone(me({ timeZone: 42 }))).toBe('America/Denver');
    expect(profileTimeZone({ user: null })).toBe('America/Denver');
    expect(profileTimeZone(undefined)).toBe('America/Denver');
  });

  it('keeps "today" in America/Denver', () => {
    expect(LEARNING_DAY_ZONE).toBe('America/Denver');
  });
});

describe('isTimeZone', () => {
  it('knows IANA zone names', () => {
    for (const zone of [
      'America/Denver',
      'Pacific/Honolulu',
      'America/Argentina/Buenos_Aires',
      'Etc/GMT+7',
      'UTC',
    ]) {
      expect(isTimeZone(zone)).toBe(true);
    }
  });

  it('turns down anything else, offsets included', () => {
    for (const zone of ['', 'Denver', 'Mars/Olympus_Mons', '+05:00', ' UTC', 'UTC; Europe/Paris']) {
      expect(isTimeZone(zone)).toBe(false);
    }
    // A second look gives the same answer.
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isTimeZone('UTC')).toBe(true);
  });
});
