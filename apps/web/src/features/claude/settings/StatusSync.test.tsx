import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_OFF, isClaudeOn, setClaudeStatus } from './status';
import { STATUS_KEY, StatusSync } from './StatusSync';

const realFetch = globalThis.fetch;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const failure = () =>
  json(500, { error: { code: 'unexpected', message: 'Something went wrong. Try again.' } });

function renderSync(defaults: { refetchOnWindowFocus?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, ...defaults } } });
  const view = render(
    <QueryClientProvider client={client}>
      <StatusSync />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  setClaudeStatus(ALL_OFF);
  focusManager.setFocused(undefined);
});

describe('StatusSync', () => {
  it('asks the server and turns on only what it says', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json(200, { on: { ...ALL_OFF.on, writing_help: true } }),
    );
    globalThis.fetch = fetchMock;
    renderSync();
    await waitFor(() => expect(isClaudeOn('writing_help')).toBe(true));
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/claude/status');
    expect(isClaudeOn('assistant')).toBe(false);
  });

  it('turns everything off when asking fails', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(200, { on: { ...ALL_OFF.on, assistant: true } }))
      .mockImplementation(async () => failure());
    const { client } = renderSync();
    await waitFor(() => expect(isClaudeOn('assistant')).toBe(true));
    await act(() => client.refetchQueries({ queryKey: STATUS_KEY }));
    await waitFor(() => expect(isClaudeOn('assistant')).toBe(false));
  });

  it('asks again when someone comes back to the tab, so a feature switched off goes away', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(200, { on: { ...ALL_OFF.on, assistant: true } }))
      .mockImplementation(async () => json(200, ALL_OFF));
    globalThis.fetch = fetchMock;
    // Even when the app's query defaults don't ask again on focus.
    renderSync({ refetchOnWindowFocus: false });
    await waitFor(() => expect(isClaudeOn('assistant')).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
    await waitFor(() => expect(isClaudeOn('assistant')).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores an answer of the wrong shape', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(200, { on: { writing_help: 'yes' } }));
    globalThis.fetch = fetchMock;
    const { client } = renderSync();
    await waitFor(() => expect(client.getQueryState(STATUS_KEY)?.status).toBe('error'));
    expect(isClaudeOn('writing_help')).toBe(false);
  });

  it('turns everything off when it goes away, for example on signing out', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () =>
      json(200, { on: { ...ALL_OFF.on, fields: true } }),
    );
    const { unmount } = renderSync();
    await waitFor(() => expect(isClaudeOn('fields')).toBe(true));
    unmount();
    expect(isClaudeOn('fields')).toBe(false);
  });
});
