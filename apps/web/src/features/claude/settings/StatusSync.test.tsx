import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

function renderSync() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
