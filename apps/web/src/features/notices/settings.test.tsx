import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLiveClientForTest } from '../live/client';
import { createFakeLive } from '../live/testSource';
import {
  NOTICE_SETTING_KEYS,
  NOTICE_SETTINGS,
  useChangeNoticeSettings,
  useNoticeSettings,
  type NoticeSettings,
} from './settings';

const realFetch = globalThis.fetch;
let live: ReturnType<typeof createFakeLive>;

/** Answers /api/notices/settings like the server, for Avery in Care Team Demo. */
function createSettingsServer() {
  const server = {
    settings: { comments: true, edits: true, formResponses: true, automations: true },
    /** The next PATCH fails with this status. */
    refuseNext: 0,
    /** PATCHes wait until this is resolved. */
    hold: null as Promise<void> | null,
    gets: 0,
    patches: [] as unknown[],
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url !== '/api/notices/settings') return json(404, {});
    if ((init?.method ?? 'GET') === 'GET') {
      server.gets += 1;
      return json(200, { settings: server.settings });
    }
    const change = JSON.parse(String(init?.body)) as Partial<NoticeSettings>;
    server.patches.push(change);
    await server.hold;
    if (server.refuseNext > 0) {
      const status = server.refuseNext;
      server.refuseNext = 0;
      return json(status, { error: { code: 'unexpected', message: 'The server broke.' } });
    }
    server.settings = { ...server.settings, ...change };
    return json(200, { settings: server.settings });
  };
  return server;
}

let server: ReturnType<typeof createSettingsServer>;

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => {
      const settings = useNoticeSettings();
      // `data` is read while rendering, as the Settings screen does, so a refetch renders again.
      return { settings, data: settings.data, change: useChangeNoticeSettings() };
    },
    { wrapper },
  );
}

beforeEach(() => {
  server = createSettingsServer();
  live = createFakeLive();
  setLiveClientForTest(live.client);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setLiveClientForTest(null);
});

describe('NOTICE_SETTINGS', () => {
  it('lists each kind once, in Settings order', () => {
    expect(NOTICE_SETTINGS.map((setting) => setting.key)).toEqual([...NOTICE_SETTING_KEYS]);
    expect(NOTICE_SETTINGS.find((setting) => setting.key === 'edits')?.hint).toBe(
      'At most one summary per page per hour',
    );
  });
});

describe('useNoticeSettings and useChangeNoticeSettings', () => {
  it("load the person's settings", async () => {
    server.settings.automations = false;
    const { result } = renderSettings();
    await waitFor(() => expect(result.current.settings.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      comments: true,
      edits: true,
      formResponses: true,
      automations: false,
    });
  });

  it('show a change at once, send only what changed, then keep the saved settings', async () => {
    const { result } = renderSettings();
    await waitFor(() => expect(result.current.settings.isSuccess).toBe(true));
    let release!: () => void;
    server.hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    act(() => result.current.change.mutate({ comments: false }));
    await waitFor(() => expect(result.current.data?.comments).toBe(false));
    await waitFor(() => expect(server.patches).toEqual([{ comments: false }]));
    expect(result.current.change.isPending).toBe(true);

    await act(async () => release());
    await waitFor(() => expect(result.current.change.isSuccess).toBe(true));
    // Asked again once the change was saved.
    await waitFor(() => expect(server.gets).toBe(2));
    expect(result.current.data).toEqual({
      comments: false,
      edits: true,
      formResponses: true,
      automations: true,
    });
  });

  it('go back to how they were when the server refuses a change', async () => {
    server.refuseNext = 500;
    const { result } = renderSettings();
    await waitFor(() => expect(result.current.settings.isSuccess).toBe(true));

    act(() => result.current.change.mutate({ edits: false }));
    await waitFor(() => expect(result.current.change.isError).toBe(true));
    expect(result.current.change.error?.status).toBe(500);
    expect(result.current.data?.edits).toBe(true);
  });

  it('follow a change made in another tab', async () => {
    const { result } = renderSettings();
    await waitFor(() => expect(result.current.settings.isSuccess).toBe(true));
    await act(() => live.open());

    server.settings = { ...server.settings, formResponses: false };
    await act(async () => {
      live.send({ type: 'notice-settings-changed' });
    });
    await waitFor(() => expect(result.current.data?.formResponses).toBe(false));
  });
});
