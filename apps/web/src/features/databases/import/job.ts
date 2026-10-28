/**
 * Following a server job (import or export) from a dialog, through the platform's useJob: it
 * refetches when the server nudges and polls every 5 seconds while the job is unfinished. The
 * dialog stops asking after a limit; the job itself keeps running.
 */
import { useEffect, useState } from 'react';
import { useJob, type JobView } from '../../jobs';

/** How long a dialog follows a job before it stops asking. */
export const FOLLOW_LIMIT_MS = 15 * 60_000;

const FINISHED: ReadonlySet<JobView['status']> = new Set(['succeeded', 'failed', 'cancelled']);

export interface FollowedJob {
  /** The job's latest state (absent until it loads, and once the dialog stopped asking). */
  job: JobView | undefined;
  /** Succeeded, failed or cancelled. */
  finished: boolean;
  /** Still unfinished after the limit, so the dialog stopped asking. */
  stopped: boolean;
  /** Why the job couldn't be loaded (safe to show), when there is no state to show. */
  error: string | null;
}

export function useFollowJob(jobId: string | null, limitMs: number = FOLLOW_LIMIT_MS): FollowedJob {
  const [stoppedFor, setStoppedFor] = useState<string | null>(null);
  const stopped = jobId !== null && stoppedFor === jobId;
  const query = useJob(stopped ? null : jobId);
  const job = stopped ? undefined : query.data;
  const finished = job !== undefined && FINISHED.has(job.status);

  useEffect(() => {
    if (jobId === null || finished || stopped) return;
    const timer = setTimeout(() => setStoppedFor(jobId), limitMs);
    return () => clearTimeout(timer);
  }, [jobId, finished, stopped, limitMs]);

  const error = !job && !stopped && query.error ? query.error.message : null;
  return { job, finished, stopped, error };
}
