import type { Db, Tx } from '../../../db';
import {
  createEventReminder,
  deleteEventReminders,
  syncEventReminders,
  type EventStart,
} from '../../reminders';
import type { Schedule } from './model';
import { sameStart, startOf } from './starts';
import { findEvent } from './store';

/** Whose reminder: the person, with the time settings their reminders use. */
export type ReminderOwner = { id: string; workspaceId: string; timeZone: string; use24h: boolean };

/** Remind me in the event panel: when it starts, for the organizer and the people invited. */
export async function lookupStart(
  db: Db | Tx,
  userId: string,
  target: { eventId: string; occurrenceStart?: string },
): Promise<EventStart | null> {
  const event = await findEvent(db, target.eventId);
  if (!event) return null;
  const sees = event.organizerId === userId || event.people.some((p) => p.userId === userId);
  return sees ? startOf(event, target.occurrenceStart) : null;
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
  await createEventReminder(tx, {
    workspaceId,
    userId,
    eventId,
    start,
    minutesBefore,
    timeZone,
    use24h,
  });
}

/**
 * After an edit: pending reminders move with an event that doesn't repeat, or with the one
 * occurrence changed (`key`). Series-wide changes keep theirs until reminders can be remapped.
 */
export async function moveReminders(
  tx: Tx,
  eventId: string,
  before: Schedule,
  after: Schedule,
  key?: string,
): Promise<void> {
  const start = startOf(after, key);
  if (!start || sameStart(startOf(before, key), start)) return;
  await syncEventReminders(
    tx,
    key === undefined ? { eventId, start } : { eventId, start, occurrenceStart: key },
  );
}

/** Reminders go with the deleted event, or with the one occurrence deleted. */
export async function dropReminders(tx: Tx, eventId: string, key?: string): Promise<void> {
  await deleteEventReminders(
    tx,
    key === undefined ? { eventId } : { eventId, occurrenceStart: key },
  );
}
