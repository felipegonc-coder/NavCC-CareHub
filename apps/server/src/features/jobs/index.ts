import { publishToUsers } from '../live';
import { createMemoryJobStore } from './domain/memoryStore';
import {
  createJobRunner,
  type JobHandler,
  type JobHandlerOptions,
  type PeriodicTask,
  type ScheduleJobInput,
} from './domain/runner';
import type { Job } from './domain/types';

export { JobError } from './domain/runner';
export type {
  JobContext,
  JobFailure,
  JobHandler,
  JobHandlerOptions,
  PeriodicTask,
  ScheduleJobInput,
} from './domain/runner';
export type { Job, JobProgress, JobStatus, JsonValue } from './domain/types';

/** The app-wide runner. Jobs live in memory until routes.ts is given the database. */
export const jobRunner = createJobRunner({
  store: createMemoryJobStore(),
  onJobUpdated: (job) => {
    if (job.ownerUserId) {
      publishToUsers([job.ownerUserId], { type: 'job-updated', data: { jobId: job.id } });
    }
  },
});

/**
 * Handles jobs of `kind` (such as `reminders.fire`). At least once: make the handler idempotent.
 * `options.onFailed(payload, { jobId, attempts, error })` runs once when a job fails for good.
 */
export function registerJobHandler<P>(
  kind: string,
  handler: JobHandler<P>,
  options?: JobHandlerOptions<P>,
): void {
  jobRunner.registerHandler(kind, handler, options);
}

/** Queues a job. With a `key`, an unfinished job of the same kind and key is reused. */
export function scheduleJob<P>(
  input: ScheduleJobInput<P>,
): Promise<{ jobId: string; created: boolean }> {
  return jobRunner.schedule(input);
}

export function getJob(jobId: string): Promise<Job | null> {
  return jobRunner.get(jobId);
}

/** Cancels a queued job or stops a running one. Null when there's no such job. */
export function cancelJob(jobId: string): Promise<Job | null> {
  return jobRunner.cancel(jobId);
}

/** Runs `run` every `everyMs`, one run at a time across all processes. */
export function registerPeriodicTask(name: string, everyMs: number, run: PeriodicTask): void {
  jobRunner.registerPeriodicTask(name, everyMs, run);
}
