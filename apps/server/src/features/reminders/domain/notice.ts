// What a due reminder looks like in the 🔔 Care Hub chat (Home and reminders spec, section 3).
import { datePart, formatDate, formatTime, toCivil } from '@carehub/team-time';
import type { NoticeButton, SendNoticeInput } from '../../notices';
import type { Reminder, ReminderTarget } from '../types';

/** Sent more than a minute after its time, a reminder says when it was due. */
export const LATE_AFTER_MS = 60_000;
export const SNOOZE_ACTION = 'reminders.snooze';
export const DONE_ACTION = 'reminders.done';
export const SNOOZES = ['15m', '1h', 'tomorrow'] as const;
export type Snooze = (typeof SNOOZES)[number];

type Prefs = Pick<Reminder, 'timeZone' | 'use24h'>;

export function snoozeLabel(snooze: Snooze, prefs: Prefs): string {
  if (snooze === 'tomorrow') return `Tomorrow at ${formatTime('09:00', prefs)}`;
  return snooze === '1h' ? '1 hour' : '15 minutes';
}

/** "Late: was due at 9:00 AM", or "Late: was due Oct 25 at 9:00 AM" on another day. */
export function lateNote(dueAt: Date, now: Date, prefs: Prefs): string {
  const due = toCivil(dueAt, prefs.timeZone);
  const today = datePart(toCivil(now, prefs.timeZone));
  const time = formatTime(due, prefs);
  if (datePart(due) === today) return `Late: was due at ${time}`;
  const date = formatDate(datePart(due), { year: due.slice(0, 4) !== today.slice(0, 4) });
  return `Late: was due ${date} at ${time}`;
}

/** Where Open goes: the page, or the event (and occurrence) in Calendar. */
export function reminderHref(target: ReminderTarget): string {
  if (target.type === 'page') return `/p/${target.pageId}`;
  const query = new URLSearchParams({ event: target.eventId });
  if (target.occurrenceStart) query.set('occurrence', target.occurrenceStart);
  return `/calendar?${query.toString()}`;
}

/** The notice for a due reminder: a generic title, the note, the card, Open, Snooze and Done. */
export function reminderNotice(reminder: Reminder, now: Date): SendNoticeInput {
  const late = now.getTime() - reminder.dueAt.getTime() > LATE_AFTER_MS;
  const lines = [late ? lateNote(reminder.dueAt, now, reminder) : '', reminder.note];
  const text = lines.filter((line) => line !== '').join('\n');
  const buttons: NoticeButton[] = [
    { label: 'Open', href: reminderHref(reminder.target) },
    {
      label: 'Snooze',
      action: SNOOZE_ACTION,
      choices: SNOOZES.map((snooze) => ({
        label: snoozeLabel(snooze, reminder),
        value: `${reminder.id}:${snooze}`,
      })),
    },
    { label: 'Done', action: DONE_ACTION, value: reminder.id },
  ];
  return {
    workspaceId: reminder.workspaceId,
    userId: reminder.userId,
    kind: 'reminder',
    sender: 'Reminders',
    icon: '⏰',
    title: 'Reminder',
    ...(text === '' ? {} : { text }),
    card: reminder.target,
    buttons,
    groupKey: `reminders:${reminder.id}`,
  };
}
