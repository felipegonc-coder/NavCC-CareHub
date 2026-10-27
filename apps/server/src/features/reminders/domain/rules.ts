// Reminder rules: what the routes accept, limits, due times and the list (Home and reminders).
import { addMinutes, combine, toInstant } from '@carehub/team-time';
import { z } from 'zod';
import type { EventStart, Reminder, ReminderView } from '../types';

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
const DAY_MS = 86_400_000;
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

const targetSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('page'), pageId: z.guid() }),
  eventTargetSchema,
]);
const at = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const note = z
  .string()
  .trim()
  .max(REMINDER_LIMITS.note, `Notes can be up to ${REMINDER_LIMITS.note} characters.`);
export const ONE_KIND = 'Page reminders take a time (at); event reminders take minutesBefore.';

/** POST /api/reminders: a page at a time (`at`), or an event `minutesBefore` its start. */
export const createReminderSchema = z
  .strictObject({
    target: targetSchema,
    at: at.optional(),
    minutesBefore: minutesBeforeSchema.optional(),
    note: note.optional(),
  })
  .refine(
    ({ target, at, minutesBefore }) =>
      target.type === 'page'
        ? at !== undefined && minutesBefore === undefined
        : minutesBefore !== undefined && at === undefined,
    ONE_KIND,
  );

/** PATCH /api/reminders/:id: a new time (`at` or `minutesBefore`), a new note, or both. */
export const updateReminderSchema = z
  .strictObject({
    at: at.optional(),
    minutesBefore: minutesBeforeSchema.optional(),
    note: note.optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    'Change the time or the note.',
  )
  .refine((input) => input.at === undefined || input.minutesBefore === undefined, ONE_KIND);

export type CreateReminderInput = z.output<typeof createReminderSchema>;
export type UpdateReminderInput = z.output<typeof updateReminderSchema>;

/** When a reminder `minutesBefore` an event is due. All-day events go by the wall clock. */
export function dueBefore(start: EventStart, minutesBefore: number, timeZone: string): Date {
  if ('start' in start) return new Date(start.start.getTime() - minutesBefore * MINUTE_MS);
  return toInstant(addMinutes(combine(start.allDay, '00:00'), -minutesBefore), timeZone);
}

/** Snoozed reminders are pending too: they arrive again at the snooze time. */
export function isPending(reminder: Pick<Reminder, 'status'>): boolean {
  return reminder.status === 'pending' || reminder.status === 'snoozed';
}

/** The list shows reminders sent since this time: the last 30 days. */
export function sentSince(now: Date): Date {
  return new Date(now.getTime() - REMINDER_LIMITS.sentDays * DAY_MS);
}

/** The Reminders list: pending soonest first, then sent in the last 30 days, newest first. */
export function reminderList(reminders: readonly Reminder[], now: Date) {
  const since = sentSince(now).getTime();
  const sentAt = (reminder: Reminder) => reminder.sentAt?.getTime() ?? 0;
  const isSent = (reminder: Reminder) =>
    (reminder.status === 'sent' || reminder.status === 'done') && sentAt(reminder) >= since;
  return {
    pending: reminders.filter(isPending).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime()),
    sent: reminders.filter(isSent).sort((a, b) => sentAt(b) - sentAt(a)),
  };
}

export function toReminderView(reminder: Reminder): ReminderView {
  const { id, target, minutesBefore, dueAt, note, status, sentAt, createdAt } = reminder;
  return {
    id,
    target,
    minutesBefore,
    dueAt: dueAt.toISOString(),
    note,
    status,
    sentAt: sentAt?.toISOString() ?? null,
    createdAt: createdAt.toISOString(),
  };
}
