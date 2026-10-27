import type { Db, Tx } from '../../../db';
import {
  createEventReminder,
  deleteEventReminders,
  remapEventReminders,
  type EventRemap,
  type EventStart,
} from '../../reminders';
import { firstKey, type EditPlan } from './edit';
import { shownTitle, type StoredPerson } from './items';
import { seriesOf, type Schedule } from './model';
import { startOf } from './starts';
import { eventsById, findEvent } from './store';

/** Whose reminder: the person, with the time settings their reminders use. */
export type ReminderOwner = { id: string; workspaceId: string; timeZone: string; use24h: boolean };

let logReminderError: (error: unknown) => void = () => undefined;

/** Where a reminder change that failed is logged; the routes pass the app's log. */
export function onReminderError(log: (error: unknown) => void): void {
  logReminderError = log;
}

/**
 * Reminders are their own feature: each change runs in a savepoint of Calendar's transaction, and
 * one that fails (for example while reminders aren't running) is logged and never fails the edit.
 */
async function guarded(tx: Tx, change: (savepoint: Tx) => Promise<unknown>): Promise<void> {
  try {
    await tx.transaction(change);
  } catch (error) {
    logReminderError(error);
  }
}

/** The organizer and the people invited see an event; no one else does. */
const sees = (event: { organizerId: string; people: StoredPerson[] }, userId: string) =>
  event.organizerId === userId || event.people.some((person) => person.userId === userId);

/** Remind me in the event panel: when it starts, for the organizer and the people invited. */
export async function lookupStart(
  db: Db | Tx,
  userId: string,
  target: { eventId: string; occurrenceStart?: string },
): Promise<EventStart | null> {
  const event = await findEvent(db, target.eventId);
  return event && sees(event, userId) ? startOf(event, target.occurrenceStart) : null;
}

/** The Reminders list: titles of the events this person sees, and not of cancelled ones. */
export async function lookupTitles(
  db: Db | Tx,
  userId: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const events = await eventsById(db, ids);
  const open = events.filter((event) => !event.cancelledAt && sees(event, userId));
  return new Map(open.map((event) => [event.id, shownTitle(event.title)]));
}

/**
 * CA-21: the maker's default reminder on a new timed event. Repeating events get theirs once
 * reminders can follow every occurrence.
 */
export async function addDefaultReminder(
  tx: Tx,
  owner: ReminderOwner,
  eventId: string,
  schedule: Schedule,
  minutesBefore: number | null,
): Promise<void> {
  const start = schedule.allDay ? null : startOf(schedule);
  if (minutesBefore === null || !start) return;
  const { id: userId, workspaceId, timeZone, use24h } = owner;
  await guarded(tx, (savepoint) =>
    createEventReminder(savepoint, {
      workspaceId,
      userId,
      eventId,
      start,
      minutesBefore,
      timeZone,
      use24h,
    }),
  );
}

/** Where reminders on `key` (null: the whole event) go in `schedule`, or null when it's gone. */
function placeIn(eventId: string, schedule: Schedule, key: string | null): EventRemap | null {
  const start = startOf(schedule, key ?? undefined);
  if (!start) return null;
  return key === null ? { eventId, start } : { eventId, occurrenceStart: key, start };
}

/** People taken off a meeting lose their reminders on it. */
async function dropPeople(tx: Tx, eventId: string, was: StoredPerson[], now: StoredPerson[]) {
  const stay = new Set(now.map((person) => person.userId));
  const userIds = was.map((person) => person.userId).filter((id) => !stay.has(id));
  if (userIds.length === 0) return;
  await guarded(tx, (savepoint) => deleteEventReminders(savepoint, { eventId, userIds }));
}

/**
 * After an edit, pending reminders follow their occurrence: to its new start and key, or to the
 * new series after This and following (`splitId`). They go when it's gone.
 */
export async function remindersAfterEdit(
  tx: Tx,
  people: StoredPerson[],
  plan: EditPlan,
  ids: { eventId: string; splitId: string | null },
): Promise<void> {
  const map = (key: string | null) => {
    const place = plan.placeOf(key);
    if (!place) return null;
    const [state, eventId] =
      place.in === 'split' ? [plan.split, ids.splitId] : [plan.event, ids.eventId];
    return state && eventId ? placeIn(eventId, state, place.key) : null;
  };
  await guarded(tx, (savepoint) => remapEventReminders(savepoint, { eventId: ids.eventId, map }));
  await dropPeople(tx, ids.eventId, people, plan.event.people);
  if (plan.split && ids.splitId) await dropPeople(tx, ids.splitId, people, plan.split.people);
}

/** After a delete, reminders go with the event or the occurrences deleted; the others stay. */
export async function remindersAfterDelete(
  tx: Tx,
  eventId: string,
  left: Schedule | null,
): Promise<void> {
  if (!left) {
    await guarded(tx, (savepoint) => deleteEventReminders(savepoint, { eventId }));
    return;
  }
  const series = seriesOf(left);
  const first = series ? firstKey(series) : null;
  const map = (key: string | null) => placeIn(eventId, left, key ?? first);
  await guarded(tx, (savepoint) => remapEventReminders(savepoint, { eventId, map }));
}
