import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveEvent } from '../live';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** A job as its owner sees it (`GET /api/jobs/:jobId`). */
export interface JobView {
  jobId: string;
  kind: string;
  status: JobStatus;
  attempts: number;
  cancelRequested: boolean;
  progress: { done: number; total?: number; label?: string } | null;
  result: unknown;
  /** Safe to show. */
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Shaped like the web `ApiError` (`{ status, code, message }`) until that client lands. */
export class JobRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'JobRequestError';
    this.status = status;
    this.code = code;
  }
}

export const jobQueryKey = (jobId: string) => ['jobs', jobId] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function fetchJob(jobId: string, signal: AbortSignal): Promise<JobView> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    signal,
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  const body: unknown = await response.json().catch(() => null);
  if (response.ok && isRecord(body) && isRecord(body.job)) return body.job as unknown as JobView;
  // Errors are `{ error: { code, message } }`.
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  const code = typeof error.code === 'string' ? error.code : 'unknown';
  const message = typeof error.message === 'string' ? error.message : 'Something went wrong.';
  throw new JobRequestError(response.status, code, message);
}

/** The fallback poll: every 5 s while the job is queued or running. */
export function jobRefetchInterval(job: JobView | undefined): number | false {
  return job?.status === 'queued' || job?.status === 'running' ? 5_000 : false;
}

/**
 * A job's latest state. Refetches when the server nudges (`job-updated`) and after a live
 * reconnect, and polls while the job is unfinished in case a nudge doesn't arrive.
 */
export function useJob(jobId: string | null | undefined) {
  const queryClient = useQueryClient();
  useLiveEvent('job-updated', (event) => {
    if (jobId && (event.type === 'live-reconnected' || event.data?.jobId === jobId)) {
      void queryClient.invalidateQueries({ queryKey: jobQueryKey(jobId) });
    }
  });
  return useQuery({
    queryKey: jobQueryKey(jobId ?? ''),
    queryFn: jobId ? ({ signal }) => fetchJob(jobId, signal) : skipToken,
    refetchInterval: (query) => jobRefetchInterval(query.state.data),
    // A missing or someone else's job won't appear by asking again.
    retry: (failures, error) =>
      failures < 1 && !(error instanceof JobRequestError && error.status < 500),
  });
}
