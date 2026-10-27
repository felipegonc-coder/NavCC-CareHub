// Reminder rules: limits, event targets and due times (Home and reminders spec).
import { addMinutes, combine, toInstant } from '@carehub/team-time';
import { z } from 'zod';
import type { EventStart, Reminder } from '../types';

export const REMINDER_LIMITS = {
  note: 280,
  pendingPerPerson: 500,
  /** Event reminders: from 23:59 on an all-day event's day (-1439) to 28 days before. */
  minutesBeforeMin: -1439,
  minutesBeforeMax: 40_320,
  /** The list shows reminders sent in the last 30 days. */
  sentDays: 30,
} as const;

const MINUTE_MS = 60_000;
// The same shapes notice cards accept.
const EVENT_ID = /^[\w.:@-]+$/;
const OCCURRENCE_START =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

export const eventTargetSchema = z.strictObject({
  type: z.literal('event'),
  eventId: z.string().min(1).max(200).regex(EVENT_ID),
  occurrenceStart: z.string().regex(OCCURRENCE_START).optional(),
});

export const minutesBeforeSchema = z
  .int()
  .min(REMINDER_LIMITS.minutesBeforeMin)
  .max(REMINDER_LIMITS.minutesBeforeMax);

/** When a reminder `minutesBefore` an event is due. All-day events go by the wall clock. */
export function dueBefore(start: EventStart, minutesBefore: number, timeZone: string): Date {
  if ('start' in start) return new Date(start.start.getTime() - minutesBefore * MINUTE_MS);
  return toInstant(addMinutes(combine(start.allDay, '00:00'), -minutesBefore), timeZone);
}

/** Snoozed reminders are pending too: they arrive again at the snooze time. */
export function isPending(reminder: Pick<Reminder, 'status'>): boolean {
  return reminder.status === 'pending' || reminder.status === 'snoozed';
}
