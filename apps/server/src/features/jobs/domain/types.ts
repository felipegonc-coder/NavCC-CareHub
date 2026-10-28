export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type FinishedStatus = Extract<JobStatus, 'succeeded' | 'failed' | 'cancelled'>;
export const FINISHED_STATUSES: readonly FinishedStatus[] = ['succeeded', 'failed', 'cancelled'];

export interface JobProgress {
  done: number;
  total?: number;
  label?: string;
}

export interface Job {
  id: string;
  kind: string;
  /** Dedupes among unfinished jobs of the same kind. */
  key: string | null;
  payload: JsonValue;
  status: JobStatus;
  workspaceId: string | null;
  ownerUserId: string | null;
  /** When the job was meant to run; `lateByMs` is measured from here. */
  dueAt: Date;
  /** When it may run next: later than `dueAt` while it waits for a retry. */
  runAt: Date;
  /** Attempts started so far, counting the current one. */
  attempts: number;
  lockedBy: string | null;
  lockedUntil: Date | null;
  cancelRequested: boolean;
  progress: JobProgress | null;
  result: JsonValue | null;
  /** The user-facing reason of the last failure. */
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface NewJob {
  id: string;
  kind: string;
  key: string | null;
  payload: JsonValue;
  workspaceId: string | null;
  ownerUserId: string | null;
  runAt: Date;
  now: Date;
}

/** Which claim of a job a write belongs to; writes from a lost claim are refused. */
export interface Fence {
  workerId: string;
  attempt: number;
}

export interface ClaimInput {
  kind: string;
  limit: number;
  workerId: string;
  now: Date;
  lockedUntil: Date;
  /** Only this job, and only while it's queued, even before its run time (the test hook). */
  id?: string;
}

export interface RequeueInput {
  runAt: Date;
  error: string | null;
  now: Date;
  /** False when the attempt didn't really run (a shutdown): it's given back. */
  countAttempt: boolean;
}

export interface FinishInput {
  status: FinishedStatus;
  result: JsonValue | null;
  error: string | null;
  progress: JobProgress | null;
  now: Date;
}

/** The one database call a SQL store needs. A node-postgres Pool or Client fits. */
export interface SqlRunner {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Where jobs live: Postgres in production, memory in development and tests. */
export interface JobStore {
  /** Adds a job, unless an unfinished one of the same kind has the same key. */
  insert(job: NewJob): Promise<{ job: Job; created: boolean }>;
  /**
   * Locks due queued jobs, and running ones whose lock ran out (a crashed worker), oldest first.
   * With `id`, only that job, if it's queued.
   */
  claim(input: ClaimInput): Promise<Job[]>;
  setProgress(id: string, fence: Fence, progress: JobProgress, now: Date): Promise<boolean>;
  finish(id: string, fence: Fence, input: FinishInput): Promise<Job | null>;
  /** Puts a running job back in the queue, or cancels it if a cancel was requested. */
  requeue(id: string, fence: Fence, input: RequeueInput): Promise<Job | null>;
  get(id: string): Promise<Job | null>;
  /** Cancels a queued job, or asks the worker to stop a running one. Null if unknown. */
  cancel(id: string, now: Date): Promise<Job | null>;
  /** Of these running jobs, the ones with a cancel request. */
  listCancelRequested(ids: readonly string[]): Promise<string[]>;
  /** Deletes up to `limit` jobs that finished before `cutoff`; returns how many. */
  deleteFinishedBefore(cutoff: Date, limit: number): Promise<number>;
  /**
   * The same store on a caller's connection or transaction: a job added through it exists only
   * once that transaction commits. SQL stores have it; the memory store doesn't.
   */
  within?(sql: SqlRunner): JobStore;
}
