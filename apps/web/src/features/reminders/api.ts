import { DEFAULT_TIME_PREFS, isValidTimeZone } from '@carehub/team-time';
import { z } from 'zod';
import { api } from '../../lib/api';
import type { TimeSettings } from './format';

const targetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page'), pageId: z.string() }),
  z.object({
    type: z.literal('event'),
    eventId: z.string(),
    occurrenceStart: z.string().optional(),
  }),
]);

/** A reminder as GET /api/reminders sends it (apps/server/src/features/reminders). */
export const reminderSchema = z.object({
  id: z.string(),
  target: targetSchema,
  /** The page or event title; null when the person can't open it any more. */
  title: z.string().nullable(),
  /** Where the title links to: the page, or the event in Calendar. */
  href: z.string(),
  /** Event reminders: minutes before the start; negative is a time on the day (all-day events). */
  minutesBefore: z.number().nullable(),
  dueAt: z.string(),
  /** '' when there's none. */
  note: z.string(),
  status: z.enum(['pending', 'snoozed', 'sent', 'done', 'deleted']),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Reminder = z.infer<typeof reminderSchema>;

/** Pending (and snoozed) soonest first; sent in the last 30 days, newest first. */
const listSchema = z.object({ pending: z.array(reminderSchema), sent: z.array(reminderSchema) });
export type ReminderList = z.infer<typeof listSchema>;

const oneSchema = z.object({ reminder: reminderSchema });

/** A new time (`at` for a page, `minutesBefore` for an event), a new note, or both. */
export type ReminderChange = { at?: string; minutesBefore?: number; note?: string };

/** A pending reminder, for Home's Reminders section. */
export interface PendingReminder {
  id: string;
  type: 'page' | 'event';
  /** Null when the person can't open the page or event any more. */
  title: string | null;
  /** ISO instant. */
  dueAt: string;
  note: string;
  /** The page, or the event in Calendar. */
  href: string;
}

/** The first `limit` pending reminders, soonest first as the server sends them, for Home. */
export function pendingForHome(list: ReminderList, limit: number): PendingReminder[] {
  return list.pending.slice(0, limit).map(({ id, target, title, dueAt, note, href }) => ({
    id,
    type: target.type,
    title,
    dueAt,
    note,
    href,
  }));
}

/** The list without reminder `id`, shown at once after it's deleted. */
export function withoutReminder(list: ReminderList, id: string): ReminderList {
  return {
    pending: list.pending.filter((reminder) => reminder.id !== id),
    sent: list.sent.filter((reminder) => reminder.id !== id),
  };
}

/** For someone who hasn't changed them: America/Denver, 12-hour times. */
export const DEFAULT_TIME_SETTINGS: TimeSettings = {
  timeZone: DEFAULT_TIME_PREFS.timeZone,
  use24h: DEFAULT_TIME_PREFS.use24h,
};

const meSchema = z.object({ user: z.object({ timeZone: z.string(), use24h: z.boolean() }) });

/** The time settings in a GET /api/auth/me reply; the defaults when it has no usable ones. */
export function timeSettingsFrom(reply: unknown): TimeSettings {
  const me = meSchema.safeParse(reply);
  if (!me.success || !isValidTimeZone(me.data.user.timeZone)) return DEFAULT_TIME_SETTINGS;
  return { timeZone: me.data.user.timeZone, use24h: me.data.user.use24h };
}

export const remindersKeys = {
  all: ['reminders'] as const,
  list: ['reminders', 'list'] as const,
};

export const remindersApi = {
  list: (signal?: AbortSignal) => api.get('/api/reminders', { schema: listSchema, signal }),
  update: async (id: string, change: ReminderChange) =>
    (await api.patch(`/api/reminders/${encodeURIComponent(id)}`, change, { schema: oneSchema }))
      .reminder,
  remove: async (id: string): Promise<void> => {
    await api.delete(`/api/reminders/${encodeURIComponent(id)}`);
  },
  timeSettings: async (signal?: AbortSignal) =>
    timeSettingsFrom(await api.get('/api/auth/me', { signal })),
};
