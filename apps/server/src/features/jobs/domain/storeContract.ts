// Test helper: the behaviour every JobStore must have. Used by the memory and Postgres store tests.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Fence, JobStore, NewJob } from './types';

const t0 = new Date('2026-10-27T09:00:00.000Z');
const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
const later = at(3600);

function newJob(overrides: Partial<NewJob> = {}): NewJob {
  return {
    id: randomUUID(),
    kind: 'reminders.fire',
    key: null,
    payload: { reminderId: 'rem-1' },
    workspaceId: 'ws-1',
    ownerUserId: 'user-avery',
    runAt: t0,
    now: t0,
    ...overrides,
  };
}

export function describeJobStoreContract(name: string, createStore: () => Promise<JobStore>): void {
  describe(`${name}: JobStore contract`, () => {
    const claimOne = async (store: JobStore, now = t0, workerId = 'w-1') => {
      const [job] = await store.claim({
        kind: 'reminders.fire',
        limit: 1,
        workerId,
        now,
        lockedUntil: at(60),
      });
      if (!job) throw new Error('nothing claimed');
      return { job, fence: { workerId, attempt: job.attempts } satisfies Fence };
    };

    it('adds queued jobs and reads them back', async () => {
      const store = await createStore();
      const input = newJob({ key: 'rem-1@2026-10-27T09:00', runAt: at(30) });
      const { job, created } = await store.insert(input);
      expect(created).toBe(true);
      expect(job).toMatchObject({
        id: input.id,
        kind: 'reminders.fire',
        key: 'rem-1@2026-10-27T09:00',
        payload: { reminderId: 'rem-1' },
        status: 'queued',
        workspaceId: 'ws-1',
        ownerUserId: 'user-avery',
        attempts: 0,
        cancelRequested: false,
        progress: null,
        result: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      });
      expect(job.runAt.toISOString()).toBe(at(30).toISOString());
      expect(job.dueAt.toISOString()).toBe(at(30).toISOString());
      expect((await store.get(input.id))?.payload).toEqual({ reminderId: 'rem-1' });
      expect(await store.get(randomUUID())).toBeNull();
      expect(await store.get('not-a-job-id')).toBeNull();
    });

    it('dedupes by kind and key among unfinished jobs only', async () => {
      const store = await createStore();
      const first = await store.insert(newJob({ key: 'k-1', runAt: at(-1) }));
      const again = await store.insert(newJob({ key: 'k-1' }));
      expect(again).toMatchObject({ created: false, job: { id: first.job.id } });
      expect((await store.insert(newJob({ key: 'k-1', kind: 'calendar.sync' }))).created).toBe(
        true,
      );
      expect((await store.insert(newJob())).created).toBe(true);
      expect((await store.insert(newJob())).created).toBe(true);

      const { job, fence } = await claimOne(store);
      expect(job.id).toBe(first.job.id);
      expect((await store.insert(newJob({ key: 'k-1' }))).created).toBe(false);
      await store.finish(job.id, fence, {
        status: 'succeeded',
        result: null,
        error: null,
        progress: null,
        now: t0,
      });
      expect((await store.insert(newJob({ key: 'k-1' }))).created).toBe(true);
    });

    it('claims due jobs of one kind, oldest first, up to the limit', async () => {
      const store = await createStore();
      const late = await store.insert(newJob({ runAt: at(-10) }));
      const early = await store.insert(newJob({ runAt: at(-20) }));
      await store.insert(newJob({ runAt: at(10) }));
      await store.insert(newJob({ kind: 'calendar.sync', runAt: at(-30) }));
      const input = { kind: 'reminders.fire', workerId: 'w-1', now: t0, lockedUntil: at(60) };

      const claimed = await store.claim({ ...input, limit: 1 });
      expect(claimed.map((job) => job.id)).toEqual([early.job.id]);
      expect(claimed[0]).toMatchObject({ status: 'running', attempts: 1, lockedBy: 'w-1' });
      expect(claimed[0]?.lockedUntil?.toISOString()).toBe(at(60).toISOString());
      expect(claimed[0]?.startedAt?.toISOString()).toBe(t0.toISOString());

      const rest = await store.claim({ ...input, limit: 10 });
      expect(rest.map((job) => job.id)).toEqual([late.job.id]);
      expect(await store.claim({ ...input, limit: 10 })).toEqual([]);
    });

    it('takes over running jobs whose lock ran out', async () => {
      const store = await createStore();
      const { job } = await store.insert(newJob());
      await claimOne(store, t0, 'w-crashed');
      expect(
        await store.claim({
          kind: 'reminders.fire',
          limit: 1,
          workerId: 'w-2',
          now: at(59),
          lockedUntil: at(120),
        }),
      ).toEqual([]);
      const { job: retaken, fence } = await claimOne(store, at(61), 'w-2');
      expect(retaken).toMatchObject({
        id: job.id,
        attempts: 2,
        lockedBy: 'w-2',
        status: 'running',
      });
      expect(retaken.startedAt?.toISOString()).toBe(t0.toISOString());

      // The first worker's writes are refused now.
      const stale = { workerId: 'w-crashed', attempt: 1 };
      expect(await store.setProgress(job.id, stale, { done: 1 }, at(62))).toBe(false);
      const done = {
        status: 'succeeded' as const,
        result: null,
        error: null,
        progress: null,
        now: at(62),
      };
      expect(await store.finish(job.id, stale, done)).toBeNull();
      expect(
        await store.requeue(job.id, stale, {
          runAt: at(62),
          error: null,
          now: at(62),
          countAttempt: true,
        }),
      ).toBeNull();
      expect(
        await store.setProgress(job.id, fence, { done: 1, total: 2, label: 'Sending' }, at(62)),
      ).toBe(true);
      expect((await store.get(job.id))?.progress).toEqual({ done: 1, total: 2, label: 'Sending' });
    });

    it('finishes jobs with a result or an error', async () => {
      const store = await createStore();
      await store.insert(newJob());
      const { job, fence } = await claimOne(store);
      const finished = await store.finish(job.id, fence, {
        status: 'succeeded',
        result: { sent: 3, to: ['user-sam'] },
        error: null,
        progress: { done: 3, total: 3 },
        now: at(5),
      });
      expect(finished).toMatchObject({
        status: 'succeeded',
        result: { sent: 3, to: ['user-sam'] },
        progress: { done: 3, total: 3 },
        lockedBy: null,
        lockedUntil: null,
      });
      expect(finished?.finishedAt?.toISOString()).toBe(at(5).toISOString());
      expect(
        await store.finish(job.id, fence, {
          status: 'failed',
          result: null,
          error: 'x',
          progress: null,
          now: at(6),
        }),
      ).toBeNull();

      await store.insert(newJob());
      const second = await claimOne(store);
      await store.setProgress(second.job.id, second.fence, { done: 1 }, at(1));
      const failed = await store.finish(second.job.id, second.fence, {
        status: 'failed',
        result: null,
        error: 'Something went wrong.',
        progress: null,
        now: at(6),
      });
      expect(failed).toMatchObject({
        status: 'failed',
        error: 'Something went wrong.',
        progress: { done: 1 },
      });
    });

    it('requeues for a retry, and gives the attempt back after a shutdown', async () => {
      const store = await createStore();
      const { job: original } = await store.insert(newJob({ runAt: at(-5) }));
      let { fence } = await claimOne(store);
      const retry = await store.requeue(original.id, fence, {
        runAt: at(60),
        error: 'Busy.',
        now: t0,
        countAttempt: true,
      });
      expect(retry).toMatchObject({
        status: 'queued',
        attempts: 1,
        error: 'Busy.',
        lockedBy: null,
        finishedAt: null,
      });
      expect(retry?.runAt.toISOString()).toBe(at(60).toISOString());
      expect(retry?.dueAt.toISOString()).toBe(at(-5).toISOString());

      ({ fence } = await claimOne(store, at(61)));
      const undone = await store.requeue(original.id, fence, {
        runAt: at(61),
        error: 'Busy.',
        now: at(61),
        countAttempt: false,
      });
      expect(undone).toMatchObject({ status: 'queued', attempts: 1 });
    });

    it('cancels queued jobs at once and asks running ones to stop', async () => {
      const store = await createStore();
      const queued = await store.insert(newJob({ runAt: later }));
      const cancelled = await store.cancel(queued.job.id, at(1));
      expect(cancelled).toMatchObject({ status: 'cancelled', cancelRequested: false });
      expect(cancelled?.finishedAt?.toISOString()).toBe(at(1).toISOString());
      expect(await store.cancel(randomUUID(), at(1))).toBeNull();
      expect(await store.cancel('not-a-job-id', at(1))).toBeNull();

      const other = await store.insert(newJob());
      const { job, fence } = await claimOne(store);
      expect(job.id).toBe(other.job.id);
      expect(await store.listCancelRequested([job.id])).toEqual([]);
      expect(await store.cancel(job.id, at(2))).toMatchObject({
        status: 'running',
        cancelRequested: true,
      });
      expect(await store.listCancelRequested([job.id, queued.job.id, randomUUID()])).toEqual([
        job.id,
      ]);
      const stopped = await store.requeue(job.id, fence, {
        runAt: at(3),
        error: null,
        now: at(3),
        countAttempt: false,
      });
      expect(stopped).toMatchObject({ status: 'cancelled' });
      expect(stopped?.finishedAt?.toISOString()).toBe(at(3).toISOString());
      expect(await store.cancel(job.id, at(4))).toMatchObject({ status: 'cancelled' });
    });

    it('deletes finished jobs older than the cutoff, in batches', async () => {
      const store = await createStore();
      const finishAt = async (seconds: number) => {
        await store.insert(newJob());
        const { job, fence } = await claimOne(store);
        await store.finish(job.id, fence, {
          status: 'succeeded',
          result: null,
          error: null,
          progress: null,
          now: at(seconds),
        });
        return job.id;
      };
      const oldest = await finishAt(1);
      const old = await finishAt(2);
      const recent = await finishAt(100);
      const waiting = await store.insert(newJob({ runAt: later }));

      expect(await store.deleteFinishedBefore(at(50), 1)).toBe(1);
      expect(await store.get(oldest)).toBeNull();
      expect(await store.get(old)).not.toBeNull();
      expect(await store.deleteFinishedBefore(at(50), 10)).toBe(1);
      expect(await store.deleteFinishedBefore(at(50), 10)).toBe(0);
      expect(await store.get(recent)).not.toBeNull();
      expect(await store.get(waiting.job.id)).not.toBeNull();
    });
  });
}
