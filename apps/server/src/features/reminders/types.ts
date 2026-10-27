// Reminder shapes shared by the service, the routes and Calendar (through index.ts).
import type { CivilDate } from '@carehub/team-time';

/** What a reminder is for. Only IDs: the notice card looks the title up for the reader. */
export type ReminderTarget =
  | { type: 'page'; pageId: string }
  | {
      type: 'event';
      eventId: string;
      /** One occurrence of a repeating event, as Calendar names it (as on notice cards). */
      occurrenceStart?: string;
    };

export const REMINDER_STATUSES = ['pending', 'snoozed', 'sent', 'done', 'deleted'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

/** When an event or one occurrence starts: an instant, or the day of an all-day event. */
export type EventStart = { start: Date } | { allDay: CivilDate };

export interface Reminder {
  id: string;
  workspaceId: string;
  /** The owner: the only person who sees, changes or gets it. */
  userId: string;
  target: ReminderTarget;
  /**
   * Event reminders: minutes before the start. All-day events count from 00:00 on the day on
   * the wall clock, so -540 is 9:00 AM on the day and 900 is 9:00 AM the day before. Null for a
   * page reminder, which is at a fixed time.
   */
  minutesBefore: number | null;
  dueAt: Date;
  /** '' when there's none. */
  note: string;
  status: ReminderStatus;
  /** The owner's time settings when they last set it, for "Late: was due at…" and Snooze. */
  timeZone: string;
  use24h: boolean;
  sentAt: Date | null;
  createdAt: Date;
}

/** A reminder as the routes send it (GET /api/reminders lists them). */
export interface ReminderView {
  id: string;
  target: ReminderTarget;
  /** The page or event title, or null when the person can't open it. */
  title: string | null;
  /** Where Open goes: `/p/<pageId>`, or the event (occurrence) in Calendar. */
  href: string;
  minutesBefore: number | null;
  dueAt: string;
  note: string;
  status: ReminderStatus;
  sentAt: string | null;
  createdAt: string;
}

/** The signed-in person a request is for, with their time settings now. */
export interface Viewer {
  userId: string;
  workspaceId: string;
  timeZone: string;
  use24h: boolean;
}
