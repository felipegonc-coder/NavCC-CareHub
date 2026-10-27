// Reminders: where they're kept, the job that sends them, and Calendar's event reminders.
import type { Db, Tx } from '../../db';
import type { SendNotice } from '../notices';
import { reminderNotice } from './domain/notice';
import {
  dueBefore,
  eventTargetSchema,
  isPending,
  minutesBeforeSchema,
  REMINDER_LIMITS,
} from './domain/rules';
import type { EventStart, Reminder, ReminderStatus, ReminderTarget } from './types';

export type NewReminder = Omit<Reminder, 'id' | 'status' | 'sentAt' | 'createdAt'>;
export type ReminderChanges = Partial<Omit<Reminder, 'id' | 'workspaceId' | 'userId' | 'target'>>;

/** Where reminders are kept: Postgres in the app, memory in unit tests (testing.ts). */
export interface ReminderStore {
  /** Adds a pending reminder, or returns null when its owner already has `limit` pending. */
  insert(db: Db | Tx, reminder: NewReminder, limit: number, now: Date): Promise<Reminder | null>;
  get(db: Db | Tx, id: string): Promise<Reminder | null>;
  /** Every reminder on an event that isn't deleted: all occurrences and owners. */
  listForEvent(db: Db | Tx, eventId: string): Promise<Reminder[]>;
  /**
   * Applies `changes` only while the status is one of `when.status` (and the due time is still
   * `when.dueAt`, when given). Returns the changed reminder, or null when nothing matched.
   */
  update(
    db: Db | Tx,
    id: string,
    changes: ReminderChanges,
    when: { status: readonly ReminderStatus[]; dueAt?: Date },
  ): Promise<Reminder | null>;
}

/** The job that sends a reminder at its time. A job for an old due time finds nothing to do. */
export const FIRE_JOB = 'reminders.fire';
export interface FirePayload {
  reminderId: string;
  /** ISO instant: the due time this job is for. */
  dueAt: string;
}
/** `scheduleJob` from features/jobs (when it lands), in the caller's transaction. */
export type ScheduleJob = (
  input: {
    kind: string;
    payload: FirePayload;
    key: string;
    runAt: Date;
    workspaceId: string;
    ownerUserId: string;
  },
  options: { db: Db | Tx },
) => Promise<unknown>;

/** The live event published to a person whenever their reminders change. */
export const REMINDERS_CHANGED = 'reminders-changed';

export interface RemindersRuntime {
  store: ReminderStore;
  scheduleJob: ScheduleJob;
  sendNotice: SendNotice;
  /** `publishToUsers` from features/live. */
  publish: (userIds: readonly string[], event: { type: string }) => void;
  now?: () => Date;
}

let bound: RemindersRuntime | null = null;

/** The routes bind the app's runtime at start-up; the returned function unbinds it. */
export function bindReminders(runtime: RemindersRuntime): () => void {
  bound = runtime;
  return () => {
    if (bound === runtime) bound = null;
  };
}

function runtime(): RemindersRuntime {
  if (bound) return bound;
  throw new Error('Reminders are not running: register their routes, or bindMemoryReminders().');
}

const nowOf = (rt: RemindersRuntime) => rt.now?.() ?? new Date();

function nudge(rt: RemindersRuntime, userId: string): void {
  try {
    rt.publish([userId], { type: REMINDERS_CHANGED });
  } catch {
    // Live updates are best effort: the list loads fresh anyway.
  }
}

async function schedule(rt: RemindersRuntime, db: Db | Tx, reminder: Reminder): Promise<void> {
  const { id, dueAt, workspaceId, userId } = reminder;
  await rt.scheduleJob(
    {
      kind: FIRE_JOB,
      payload: { reminderId: id, dueAt: dueAt.toISOString() },
      key: `${FIRE_JOB}:${id}:${dueAt.getTime()}`,
      runAt: dueAt,
      workspaceId,
      ownerUserId: userId,
    },
    { db },
  );
}

/** Saves a new reminder and its job together; null when the owner is at the limit. */
function insert(rt: RemindersRuntime, db: Db | Tx, reminder: NewReminder) {
  return (db as Db).transaction(async (tx) => {
    const limit = REMINDER_LIMITS.pendingPerPerson;
    const created = await rt.store.insert(tx, reminder, limit, nowOf(rt));
    if (created) await schedule(rt, tx, created);
    return created;
  });
}

/**
 * The `reminders.fire` job. Sends the notice while the reminder is still due at this time, then
 * marks it sent. However late it runs, it still sends, saying when it was due (HR-11).
 */
export async function fireReminder(db: Db | Tx, payload: FirePayload): Promise<{ sent: boolean }> {
  const rt = runtime();
  const reminder = await rt.store.get(db, payload.reminderId);
  const due = Date.parse(payload.dueAt);
  if (!reminder || !isPending(reminder) || reminder.dueAt.getTime() !== due) return { sent: false };
  const now = nowOf(rt);
  await rt.sendNotice(reminderNotice(reminder, now));
  const when = { status: ['pending', 'snoozed'] as const, dueAt: reminder.dueAt };
  await rt.store.update(db, reminder.id, { status: 'sent', sentAt: now }, when);
  nudge(rt, reminder.userId);
  return { sent: true };
}

// For Calendar, inside its own transaction (exported from index.ts).

export interface EventReminderInput {
  workspaceId: string;
  userId: string;
  eventId: string;
  occurrenceStart?: string;
  start: EventStart;
  minutesBefore: number;
  /** The person's settings: all-day events and the notice's times go by them. */
  timeZone: string;
  use24h: boolean;
}

/** Adds this person's reminder to an event. Null when that time has passed or they're at 500. */
export async function createEventReminder(
  db: Db | Tx,
  input: EventReminderInput,
): Promise<{ reminderId: string } | null> {
  const rt = runtime();
  const { workspaceId, userId, eventId, occurrenceStart, timeZone, use24h } = input;
  const target = eventTargetSchema.parse(
    occurrenceStart === undefined
      ? { type: 'event', eventId }
      : { type: 'event', eventId, occurrenceStart },
  );
  const minutesBefore = minutesBeforeSchema.parse(input.minutesBefore);
  const dueAt = dueBefore(input.start, minutesBefore, timeZone);
  if (dueAt <= nowOf(rt)) return null;
  const reminder = await insert(rt, db, {
    workspaceId,
    userId,
    target,
    minutesBefore,
    dueAt,
    note: '',
    timeZone,
    use24h,
  });
  return reminder ? { reminderId: reminder.id } : null;
}

const sameOccurrence = (target: ReminderTarget, occurrenceStart: string | undefined) =>
  target.type === 'event' && target.occurrenceStart === occurrenceStart;

/**
 * The event, or the occurrence with this `occurrenceStart`, now starts at `start`: its pending
 * reminders move with it. One that's now in the past is sent within a minute, marked Late.
 * Returns how many moved.
 */
export async function syncEventReminders(
  db: Db | Tx,
  input: { eventId: string; occurrenceStart?: string; start: EventStart },
): Promise<number> {
  const rt = runtime();
  let moved = 0;
  for (const reminder of await rt.store.listForEvent(db, input.eventId)) {
    const { status, minutesBefore, target } = reminder;
    if (status !== 'pending' || minutesBefore === null) continue;
    if (!sameOccurrence(target, input.occurrenceStart)) continue;
    const dueAt = dueBefore(input.start, minutesBefore, reminder.timeZone);
    if (dueAt.getTime() === reminder.dueAt.getTime()) continue;
    const when = { status: ['pending'] as const, dueAt: reminder.dueAt };
    const updated = await rt.store.update(db, reminder.id, { dueAt }, when);
    if (!updated) continue;
    await schedule(rt, db, updated);
    moved += 1;
  }
  return moved;
}

/** The event (without `occurrenceStart`: every occurrence) was deleted, and so are its reminders. */
export async function deleteEventReminders(
  db: Db | Tx,
  input: { eventId: string; occurrenceStart?: string },
): Promise<number> {
  const rt = runtime();
  const live = ['pending', 'snoozed', 'sent', 'done'] as const;
  let deleted = 0;
  for (const { id, target } of await rt.store.listForEvent(db, input.eventId)) {
    if (input.occurrenceStart !== undefined && !sameOccurrence(target, input.occurrenceStart)) {
      continue;
    }
    if (await rt.store.update(db, id, { status: 'deleted' }, { status: live })) deleted += 1;
  }
  return deleted;
}
