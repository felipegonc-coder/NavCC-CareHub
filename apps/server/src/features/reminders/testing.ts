// Test helpers: reminders in memory, for this feature's unit tests and Calendar's.
import { randomUUID } from 'node:crypto';
import type { Db } from '../../db';
import type { SendNoticeInput } from '../notices';
import { isPending } from './domain/rules';
import {
  bindReminders,
  fireReminder,
  type FirePayload,
  type ReminderStore,
  type RemindersRuntime,
} from './service';
import type { Reminder } from './types';

/** A stand-in `db` for the memory store: transactions just run. */
export const memoryDb = {
  transaction: (run: (tx: unknown) => unknown) => run(memoryDb),
} as unknown as Db;

export type MemoryReminderStore = ReminderStore & { readonly reminders: Reminder[] };

export function createMemoryReminderStore(): MemoryReminderStore {
  const reminders: Reminder[] = [];
  const copy = (reminder: Reminder): Reminder => ({ ...reminder, target: { ...reminder.target } });
  const find = (id: string) => reminders.find((reminder) => reminder.id === id);
  return {
    reminders,
    async insert(_db, reminder, limit, now) {
      const mine = reminders.filter((r) => r.userId === reminder.userId && isPending(r));
      if (mine.filter((r) => r.workspaceId === reminder.workspaceId).length >= limit) return null;
      const id = randomUUID();
      reminders.push({ ...reminder, id, status: 'pending', sentAt: null, createdAt: now });
      return copy(find(id)!);
    },
    async get(_db, id) {
      const reminder = find(id);
      return reminder ? copy(reminder) : null;
    },
    async listForOwner(_db, { userId, workspaceId }, sentSince) {
      const sent = (r: Reminder) => (r.sentAt ?? sentSince) >= sentSince;
      return reminders
        .filter((r) => r.userId === userId && r.workspaceId === workspaceId)
        .filter((r) => isPending(r) || ((r.status === 'sent' || r.status === 'done') && sent(r)))
        .map(copy);
    },
    async listForEvent(_db, eventId) {
      return reminders
        .filter((r) => r.status !== 'deleted')
        .filter((r) => r.target.type === 'event' && r.target.eventId === eventId)
        .map(copy);
    },
    async update(_db, id, changes, when) {
      const reminder = find(id);
      if (!reminder || !when.status.includes(reminder.status)) return null;
      if (when.dueAt && when.dueAt.getTime() !== reminder.dueAt.getTime()) return null;
      Object.assign(reminder, changes);
      return copy(reminder);
    },
  };
}

/**
 * Binds reminders to memory. `jobs` holds the `reminders.fire` jobs not run yet (one per key, as
 * features/jobs dedupes them) and `runDueJobs()` runs the ones due by `now`. Notices go to
 * `notices` unless `sendNotice` is given (for example the real one, with `bindMemoryNotices()`).
 */
export function bindMemoryReminders(overrides: Partial<RemindersRuntime> = {}) {
  const store = createMemoryReminderStore();
  const jobs: { key: string; runAt: Date; payload: FirePayload; ownerUserId: string }[] = [];
  const notices: SendNoticeInput[] = [];
  const runtime: RemindersRuntime = {
    store,
    async scheduleJob(input) {
      const created = !jobs.some((job) => job.key === input.key);
      if (created) jobs.push(input);
      return { jobId: randomUUID(), created };
    },
    async sendNotice(input) {
      notices.push(input);
      return { noticeId: randomUUID(), grouped: false };
    },
    publish: () => undefined,
    canOpenPage: async () => true,
    ...overrides,
  };
  const unbind = bindReminders(runtime);
  /** Runs the jobs due by `now` and returns how many reminders they sent. */
  async function runDueJobs(now = runtime.now?.() ?? new Date()): Promise<number> {
    const due = jobs.filter((job) => job.runAt <= now);
    jobs.splice(0, jobs.length, ...jobs.filter((job) => !due.includes(job)));
    let sent = 0;
    for (const job of due) if ((await fireReminder(memoryDb, job.payload)).sent) sent += 1;
    return sent;
  }
  return { store, jobs, notices, runtime, runDueJobs, unbind };
}
