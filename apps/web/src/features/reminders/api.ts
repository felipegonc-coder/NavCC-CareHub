import { z } from 'zod';
import { api } from '../../lib/api';

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
};
