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
  const target = key === undefined ? { eventId, start } : { eventId, start, occurrenceStart: key };
  await guarded(tx, (savepoint) => syncEventReminders(savepoint, target));
}

/** Reminders go with the deleted event, or with the one occurrence deleted. */
export async function dropReminders(tx: Tx, eventId: string, key?: string): Promise<void> {
  const target = key === undefined ? { eventId } : { eventId, occurrenceStart: key };
  await guarded(tx, (savepoint) => deleteEventReminders(savepoint, target));
}
