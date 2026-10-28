// Reminders: set, list, change, delete and send them (Home and reminders spec). See README.md.
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import type { NoticeActionContext, NoticeActionResult, SendNotice } from '../notices';
import { isSnooze, reminderNotice, snoozedMessage, snoozeUntil } from './domain/notice';
import {
  dueBefore,
  eventTargetSchema,
  isPending,
  minutesBeforeSchema,
  ONE_KIND,
  REMINDER_LIMITS,
  reminderList,
  sentSince,
  toReminderView,
  type CreateReminderInput,
  type UpdateReminderInput,
} from './domain/rules';
import type { EventStart, Reminder, ReminderStatus, ReminderTarget, Viewer } from './types';

export type NewReminder = Omit<Reminder, 'id' | 'status' | 'sentAt' | 'createdAt'>;
export type ReminderChanges = Partial<
  Omit<Reminder, 'id' | 'workspaceId' | 'userId' | 'createdAt'>
>;

/** Where reminders are kept: Postgres in the app (store.ts), memory in unit tests (testing.ts). */
export interface ReminderStore {
  /** Adds a pending reminder, or returns null when its owner already has `limit` pending. */
  insert(db: Db | Tx, reminder: NewReminder, limit: number, now: Date): Promise<Reminder | null>;
  get(db: Db | Tx, id: string): Promise<Reminder | null>;
  /** The owner's pending reminders and the ones sent (or done) since `sentSince`. */
  listForOwner(
    db: Db | Tx,
    owner: Pick<Viewer, 'userId' | 'workspaceId'>,
    sentSince: Date,
  ): Promise<Reminder[]>;
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
/** `scheduleJob` from features/jobs: the job is saved in the caller's transaction. */
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
  /** Stand-in for `getPageAccess(db, userId, pageId)` of at least 'view' until pages land. */
  canOpenPage: (db: Db | Tx, userId: string, pageId: string) => Promise<boolean>;
  now?: () => Date;
}

/**
 * When an event (or one occurrence) starts, or null when there's no such event or this person
 * can't open it. Calendar registers it at start-up, for Remind me in the event panel.
 */
export type EventLookup = (
  db: Db | Tx,
  userId: string,
  target: { eventId: string; occurrenceStart?: string },
) => Promise<EventStart | null>;

let bound: RemindersRuntime | null = null;
let eventLookup: EventLookup | null = null;

/** The routes bind the app's runtime at start-up; the returned function unbinds it. */
export function bindReminders(runtime: RemindersRuntime): () => void {
  bound = runtime;
  return () => {
    if (bound === runtime) bound = null;
  };
}

export function registerEventLookup(lookup: EventLookup | null): void {
  eventLookup = lookup;
}

/**
 * The titles of the pages (or events) with these IDs that this person can open. The rest are left
 * out and listed without a title. Pages and Calendar register one each at start-up.
 */
export type TitleLookup = (
  db: Db | Tx,
  userId: string,
  ids: readonly string[],
) => Promise<ReadonlyMap<string, string>>;

const titleLookups = new Map<ReminderTarget['type'], TitleLookup>();

export function registerTitleLookup(type: ReminderTarget['type'], lookup: TitleLookup | null) {
  if (lookup) titleLookups.set(type, lookup);
  else titleLookups.delete(type);
}

function runtime(): RemindersRuntime {
  if (bound) return bound;
  throw new Error('Reminders are not running: register their routes, or bindMemoryReminders().');
}

const nowOf = (rt: RemindersRuntime) => rt.now?.() ?? new Date();
const passed = () => httpError(400, 'invalid', 'That time has already passed.');
const GONE = 'This reminder was deleted.';

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

/** Changes a reminder while it's as it was, and schedules its job when the due time moved. */
async function change(rt: RemindersRuntime, db: Db | Tx, was: Reminder, changes: ReminderChanges) {
  return (db as Db).transaction(async (tx) => {
    const when = { status: [was.status], dueAt: was.dueAt };
    const updated = await rt.store.update(tx, was.id, changes, when);
    if (updated && updated.dueAt.getTime() !== was.dueAt.getTime()) await schedule(rt, tx, updated);
    return updated;
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

// The routes (routes.ts): the signed-in person's own reminders.

async function eventDue(db: Db | Tx, viewer: Viewer, target: ReminderTarget, minutes: number) {
  const start =
    target.type === 'event' && eventLookup ? await eventLookup(db, viewer.userId, target) : null;
  if (!start) throw httpError(403, 'forbidden');
  if ('start' in start && minutes < 0) {
    throw httpError(400, 'invalid', 'Pick a time before the event starts.');
  }
  return dueBefore(start, minutes, viewer.timeZone);
}

/** Remind me: on a page the person can open, at a time, or on an event, minutes before it. */
export async function createReminder(
  db: Db | Tx,
  viewer: Viewer,
  input: CreateReminderInput,
): Promise<Reminder> {
  const rt = runtime();
  const { target, minutesBefore = 0 } = input;
  if (target.type === 'page' && !(await rt.canOpenPage(db, viewer.userId, target.pageId))) {
    throw httpError(403, 'forbidden');
  }
  const dueAt =
    target.type === 'page' ? input.at : await eventDue(db, viewer, target, minutesBefore);
  if (!dueAt || dueAt <= nowOf(rt)) throw passed();
  const reminder = await insert(rt, db, {
    workspaceId: viewer.workspaceId,
    userId: viewer.userId,
    target,
    minutesBefore: target.type === 'page' ? null : minutesBefore,
    dueAt,
    note: input.note ?? '',
    timeZone: viewer.timeZone,
    use24h: viewer.use24h,
  });
  const limit = REMINDER_LIMITS.pendingPerPerson;
  if (!reminder) {
    throw httpError(
      413,
      'too_large',
      `You can have up to ${limit} pending reminders. Delete some first.`,
    );
  }
  nudge(rt, viewer.userId);
  return reminder;
}

/** The Reminders list: pending soonest first, and sent in the last 30 days. */
export async function listReminders(db: Db | Tx, viewer: Viewer) {
  const rt = runtime();
  const now = nowOf(rt);
  return reminderList(await rt.store.listForOwner(db, viewer, sentSince(now)), now);
}

const targetId = (target: ReminderTarget) =>
  target.type === 'page' ? target.pageId : target.eventId;

/** The reminders as the routes send them, with the titles this person may see. */
export async function viewsOf(db: Db | Tx, viewer: Viewer, reminders: readonly Reminder[]) {
  const titles = new Map<string, string>();
  for (const [type, lookup] of titleLookups) {
    const ofType = reminders.filter(({ target }) => target.type === type);
    const ids = [...new Set(ofType.map(({ target }) => targetId(target)))];
    if (ids.length === 0) continue;
    const found = await lookup(db, viewer.userId, ids);
    for (const id of ids) {
      const title = found.get(id);
      if (title !== undefined) titles.set(`${type}:${id}`, title);
    }
  }
  const titleOf = ({ target }: Reminder) =>
    titles.get(`${target.type}:${targetId(target)}`) ?? null;
  return reminders.map((reminder) => toReminderView(reminder, titleOf(reminder)));
}

/** Only the owner may see, change or delete a reminder (HR-12). */
export async function ownReminder(db: Db | Tx, viewer: Viewer, id: string): Promise<Reminder> {
  const reminder = await runtime().store.get(db, id);
  if (!reminder || reminder.status === 'deleted') throw httpError(404, 'not_found');
  const mine = reminder.userId === viewer.userId && reminder.workspaceId === viewer.workspaceId;
  if (!mine) throw httpError(403, 'forbidden');
  return reminder;
}

/** A new time or note for a pending reminder; it takes the person's time settings now. */
export async function updateReminder(
  db: Db | Tx,
  viewer: Viewer,
  id: string,
  input: UpdateReminderInput,
): Promise<Reminder> {
  const rt = runtime();
  const reminder = await ownReminder(db, viewer, id);
  if (!isPending(reminder)) {
    throw httpError(409, 'conflict', 'This reminder was already sent. Set a new one instead.');
  }
  const isPage = reminder.target.type === 'page';
  if (isPage ? input.minutesBefore !== undefined : input.at !== undefined) {
    throw httpError(400, 'invalid', ONE_KIND);
  }
  const minutesBefore = input.minutesBefore ?? reminder.minutesBefore;
  const dueAt =
    input.minutesBefore === undefined
      ? (input.at ?? reminder.dueAt)
      : await eventDue(db, viewer, reminder.target, input.minutesBefore);
  if (dueAt.getTime() !== reminder.dueAt.getTime() && dueAt <= nowOf(rt)) throw passed();
  const { timeZone, use24h } = viewer;
  const note = input.note ?? reminder.note;
  const updated = await change(rt, db, reminder, { dueAt, minutesBefore, note, timeZone, use24h });
  if (!updated) throw httpError(409, 'conflict');
  nudge(rt, viewer.userId);
  return updated;
}

export async function deleteReminder(db: Db | Tx, viewer: Viewer, id: string): Promise<void> {
  const rt = runtime();
  await ownReminder(db, viewer, id);
  const live = ['pending', 'snoozed', 'sent', 'done'] as const;
  await rt.store.update(db, id, { status: 'deleted' }, { status: live });
  nudge(rt, viewer.userId);
}

// The notice buttons (registered with registerNoticeAction in routes.ts).

/** The reminder behind a notice button, while it's there and the notice's owner has it. */
async function noticeReminder(db: Db | Tx, context: NoticeActionContext, id: string) {
  const reminder = await runtime().store.get(db, id);
  if (!reminder || reminder.status === 'deleted') return null;
  const mine = reminder.userId === context.userId && reminder.workspaceId === context.workspaceId;
  return mine ? reminder : null;
}

/** Snooze: it comes back in 15 minutes, 1 hour or tomorrow at 9:00 AM (HR-09). */
export async function snoozeFromNotice(
  db: Db | Tx,
  context: NoticeActionContext,
): Promise<NoticeActionResult> {
  const rt = runtime();
  const [id = '', snooze = ''] = (context.value ?? '').split(':');
  const reminder = await noticeReminder(db, context, id);
  if (!reminder || !isSnooze(snooze)) return { message: GONE };
  const dueAt = snoozeUntil(snooze, nowOf(rt), reminder.timeZone);
  if (!(await change(rt, db, reminder, { status: 'snoozed', dueAt }))) return { message: GONE };
  nudge(rt, reminder.userId);
  return { message: snoozedMessage(snooze, reminder) };
}

/** Done: the list shows it as done, and a snoozed one doesn't come back (HR-09). */
export async function doneFromNotice(
  db: Db | Tx,
  context: NoticeActionContext,
): Promise<NoticeActionResult> {
  const rt = runtime();
  const reminder = await noticeReminder(db, context, context.value ?? '');
  const when = { status: ['sent', 'snoozed', 'done'] as const };
  const done = reminder && (await rt.store.update(db, reminder.id, { status: 'done' }, when));
  if (!done) return { message: GONE };
  nudge(rt, done.userId);
  return { message: 'Marked as done.' };
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

const eventTarget = (eventId: string, occurrenceStart: string | undefined) =>
  eventTargetSchema.parse(
    occurrenceStart === undefined
      ? { type: 'event', eventId }
      : { type: 'event', eventId, occurrenceStart },
  );

/** Adds this person's reminder to an event. Null when that time has passed or they're at 500. */
export async function createEventReminder(
  db: Db | Tx,
  input: EventReminderInput,
): Promise<{ reminderId: string } | null> {
  const rt = runtime();
  const { workspaceId, userId, timeZone, use24h } = input;
  const target = eventTarget(input.eventId, input.occurrenceStart);
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
    if (await change(rt, db, reminder, { dueAt })) moved += 1;
  }
  return moved;
}

/** Where an occurrence went in a series edit: its event, occurrence and start now. */
export interface EventRemap {
  eventId: string;
  occurrenceStart?: string;
  start: EventStart;
}

/**
 * After a series edit. `map` is called once for each occurrence with pending reminders (null:
 * reminders on the whole event) and says where it went, or null when it's gone (its reminders
 * are deleted). Snoozed reminders keep their time. Returns how many reminders changed.
 */
export async function remapEventReminders(
  db: Db | Tx,
  input: { eventId: string; map: (occurrenceStart: string | null) => EventRemap | null },
): Promise<number> {
  const rt = runtime();
  const places = new Map<string | null, EventRemap | null>();
  let changed = 0;
  for (const reminder of await rt.store.listForEvent(db, input.eventId)) {
    if (!isPending(reminder) || reminder.target.type !== 'event') continue;
    const key = reminder.target.occurrenceStart ?? null;
    if (!places.has(key)) places.set(key, input.map(key));
    const place = places.get(key);
    const { minutesBefore, status } = reminder;
    const moves = place && status === 'pending' && minutesBefore !== null;
    const dueAt = moves ? dueBefore(place.start, minutesBefore, reminder.timeZone) : reminder.dueAt;
    const stays = place?.eventId === input.eventId && (place.occurrenceStart ?? null) === key;
    if (stays && dueAt.getTime() === reminder.dueAt.getTime()) continue;
    const changes: ReminderChanges = place
      ? { target: eventTarget(place.eventId, place.occurrenceStart), dueAt }
      : { status: 'deleted' };
    if (await change(rt, db, reminder, changes)) changed += 1;
  }
  return changed;
}

/**
 * The event (without `occurrenceStart`: every occurrence) was deleted, and so are its reminders;
 * with `userIds`, only those people's (removed from a meeting, for example). Returns how many.
 */
export async function deleteEventReminders(
  db: Db | Tx,
  input: { eventId: string; occurrenceStart?: string; userIds?: readonly string[] },
): Promise<number> {
  const rt = runtime();
  const live = ['pending', 'snoozed', 'sent', 'done'] as const;
  let deleted = 0;
  for (const { id, target, userId } of await rt.store.listForEvent(db, input.eventId)) {
    if (input.occurrenceStart !== undefined && !sameOccurrence(target, input.occurrenceStart)) {
      continue;
    }
    if (input.userIds && !input.userIds.includes(userId)) continue;
    if (await rt.store.update(db, id, { status: 'deleted' }, { status: live })) deleted += 1;
  }
  return deleted;
}
