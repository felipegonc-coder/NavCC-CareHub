import type { Fence, Job, JobStore } from './types';

const ms = (date: Date) => date.getTime();
const set = (job: Job, patch: Partial<Job>) => Object.assign(job, patch);

/** A JobStore in memory, for development and tests. Same rules as the Postgres store. */
export function createMemoryJobStore(): JobStore {
  const jobs = new Map<string, Job>();
  const unfinished = (job: Job) => job.status === 'queued' || job.status === 'running';
  const held = (id: string, fence: Fence): Job | null => {
    const job = jobs.get(id);
    const ok = job?.status === 'running' && job.lockedBy === fence.workerId;
    return ok && job.attempts === fence.attempt ? job : null;
  };

  return {
    async insert(input) {
      for (const job of jobs.values()) {
        if (
          input.key !== null &&
          job.key === input.key &&
          job.kind === input.kind &&
          unfinished(job)
        ) {
          return { job: structuredClone(job), created: false };
        }
      }
      const job: Job = {
        id: input.id,
        kind: input.kind,
        key: input.key,
        payload: structuredClone(input.payload),
        status: 'queued',
        workspaceId: input.workspaceId,
        ownerUserId: input.ownerUserId,
        dueAt: input.runAt,
        runAt: input.runAt,
        attempts: 0,
        lockedBy: null,
        lockedUntil: null,
        cancelRequested: false,
        progress: null,
        result: null,
        error: null,
        createdAt: input.now,
        updatedAt: input.now,
        startedAt: null,
        finishedAt: null,
      };
      jobs.set(job.id, job);
      return { job: structuredClone(job), created: true };
    },

    async claim({ kind, limit, workerId, now, lockedUntil }) {
      const due = [...jobs.values()]
        .filter(
          (job) =>
            job.kind === kind &&
            ((job.status === 'queued' && ms(job.runAt) <= ms(now)) ||
              (job.status === 'running' &&
                job.lockedUntil !== null &&
                ms(job.lockedUntil) < ms(now))),
        )
        .sort((a, b) => ms(a.runAt) - ms(b.runAt) || ms(a.createdAt) - ms(b.createdAt));
      return due.slice(0, limit).map((job) => {
        set(job, {
          status: 'running',
          attempts: job.attempts + 1,
          lockedBy: workerId,
          lockedUntil,
          startedAt: job.startedAt ?? now,
          updatedAt: now,
        });
        return structuredClone(job);
      });
    },

    async setProgress(id, fence, progress, now) {
      const job = held(id, fence);
      if (!job) return false;
      set(job, { progress: structuredClone(progress), updatedAt: now });
      return true;
    },

    async finish(id, fence, { status, result, error, progress, now }) {
      const job = held(id, fence);
      if (!job) return null;
      set(job, {
        status,
        result: structuredClone(result),
        error,
        progress: progress ? structuredClone(progress) : job.progress,
        lockedBy: null,
        lockedUntil: null,
        finishedAt: now,
        updatedAt: now,
      });
      return structuredClone(job);
    },

    async requeue(id, fence, { runAt, error, now, countAttempt }) {
      const job = held(id, fence);
      if (!job) return null;
      const cancelled = job.cancelRequested;
      set(job, {
        status: cancelled ? 'cancelled' : 'queued',
        runAt,
        attempts: countAttempt ? job.attempts : job.attempts - 1,
        error,
        lockedBy: null,
        lockedUntil: null,
        finishedAt: cancelled ? now : null,
        updatedAt: now,
      });
      return structuredClone(job);
    },

    async get(id) {
      const job = jobs.get(id);
      return job ? structuredClone(job) : null;
    },

    async cancel(id, now) {
      const job = jobs.get(id);
      if (!job) return null;
      if (job.status === 'queued') {
        set(job, { status: 'cancelled', finishedAt: now, updatedAt: now });
      } else if (job.status === 'running') {
        set(job, { cancelRequested: true, updatedAt: now });
      }
      return structuredClone(job);
    },

    async listCancelRequested(ids) {
      return ids.filter((id) => {
        const job = jobs.get(id);
        return job?.status === 'running' && job.cancelRequested;
      });
    },

    async deleteFinishedBefore(cutoff, limit) {
      const old = [...jobs.values()]
        .filter((job) => !unfinished(job) && job.finishedAt && ms(job.finishedAt) < ms(cutoff))
        .sort((a, b) => ms(a.finishedAt ?? cutoff) - ms(b.finishedAt ?? cutoff))
        .slice(0, limit);
      for (const job of old) jobs.delete(job.id);
      return old.length;
    },
  };
}
