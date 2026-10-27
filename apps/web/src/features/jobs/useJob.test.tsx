import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLiveClientForTest } from '../live/client';
import { createFakeLive } from '../live/testSource';
import { JobRequestError, jobRefetchInterval, useJob, type JobView } from './useJob';

const job = (overrides: Partial<JobView> = {}): JobView => ({
  jobId: 'job-1',
  kind: 'automations.run',
  status: 'running',
  attempts: 1,
  cancelRequested: false,
  progress: { done: 1, total: 4 },
  result: null,
  error: null,
  createdAt: '2026-10-27T09:00:00.000Z',
  startedAt: '2026-10-27T09:00:01.000Z',
  finishedAt: null,
  ...overrides,
});

const realFetch = globalThis.fetch;
let responses: { status: number; body: unknown }[];
let requests: string[];
let live: ReturnType<typeof createFakeLive>;

function render(jobId: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useJob(jobId), { wrapper });
}

beforeEach(() => {
  responses = [];
  requests = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input));
    const next = responses.shift() ?? { status: 200, body: { job: job() } };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  live = createFakeLive();
  setLiveClientForTest(live.client);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setLiveClientForTest(null);
});

describe('useJob', () => {
  it('loads the job and refetches when the server nudges about it', async () => {
    const { result } = render('job-1');
    await waitFor(() => expect(result.current.data?.status).toBe('running'));
    expect(requests).toEqual(['/api/jobs/job-1']);
    await act(() => live.open());

    responses.push({
      status: 200,
      body: { job: job({ status: 'succeeded', result: { rows: 4 } }) },
    });
    await act(async () => {
      live.send({ type: 'job-updated', data: { jobId: 'job-2' } });
      live.send({ type: 'job-updated', data: { jobId: 'job-1' } });
    });
    await waitFor(() => expect(result.current.data?.status).toBe('succeeded'));
    expect(requests).toHaveLength(2);
  });

  it('refetches after a live reconnect', async () => {
    const { result } = render('job-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(() => live.open());
    await act(async () => {
      live.last().emit('error');
    });
    await act(async () => {
      live.wake();
      await live.open();
    });
    await waitFor(() => expect(requests).toHaveLength(2));
  });

  it('waits while there is no job id', () => {
    const { result } = render(null);
    expect(result.current.isPending).toBe(true);
    expect(requests).toEqual([]);
  });

  it('reports the server’s message for a job it can’t show', async () => {
    responses.push({
      status: 403,
      body: { error: { code: 'forbidden', message: "You don't have access to this." } },
    });
    const { result } = render('job-9');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(JobRequestError);
    expect(result.current.error?.message).toBe("You don't have access to this.");
    expect(result.current.error).toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('polls every 5 s only while the job is unfinished', () => {
    expect(jobRefetchInterval(job({ status: 'queued' }))).toBe(5_000);
    expect(jobRefetchInterval(job({ status: 'running' }))).toBe(5_000);
    expect(jobRefetchInterval(job({ status: 'failed' }))).toBe(false);
    expect(jobRefetchInterval(undefined)).toBe(false);
  });
});
