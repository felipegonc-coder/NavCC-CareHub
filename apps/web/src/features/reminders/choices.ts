// What Remind me offers (Home and reminders spec, section 2): preset times for a page or an event,
// and the custom times people type, checked before anything is sent.
import {
  addMinutes,
  ALL_DAY_REMINDER_PRESETS,
  allDayMinutesBefore,
  combine,
  EVENT_REMINDER_PRESETS,
  formatTime,
  isCivilTime,
  pageReminderTimes,
  toCivil,
  toInstant,
  type PageReminderPreset,
} from '@carehub/team-time';
import type { NewReminder, ReminderTime } from './api';
import {
  allDayLabel,
  beforeLabel,
  fromInputs,
  minutesOf,
  type BeforeUnit,
  type TimeSettings,
} from './format';

/** What Remind me is for: a page or row, or an event (one occurrence, when it repeats). */
export type RemindMeTarget =
  | {
      type: 'page';
      pageId: string;
      /** Left out when Ctrl+K opens it for the page that's open. */
      title?: string;
    }
  | {
      type: 'event';
      eventId: string;
      /** A repeating event's occurrence, by the key Calendar gives it. */
      occurrenceStart?: string;
      title: string;
      allDay: boolean;
      /** A timed event's start (an ISO instant), or an all-day event's day (YYYY-MM-DD). */
      start: string;
    };

type EventTarget = Extract<RemindMeTarget, { type: 'event' }>;

/** One of the picker's preset choices. */
export interface RemindMeChoice {
  id: string;
  label: string;
  time: ReminderTime;
  dueAt: Date;
}

/** A custom time that can be set, or what's wrong with it. */
export type CheckedTime = { time: ReminderTime; dueAt: Date } | { problem: string };

/** Event reminders go up to 28 days before (the server's limit too). */
const MAX_DAYS_BEFORE = 28;
const PASSED = 'That time has already passed.';
const WHOLE = /^\d+$/;

function pageLabel(preset: PageReminderPreset, at: Date, prefs: TimeSettings): string {
  if (preset === 'in-1-hour') return 'In 1 hour';
  const day = { 'later-today': 'Later today', tomorrow: 'Tomorrow', 'next-monday': 'Next Monday' };
  return `${day[preset]} at ${formatTime(toCivil(at, prefs.timeZone), prefs)}`;
}

/** When a reminder `minutesBefore` an event is due. All-day events go by the wall clock. */
export function eventDueAt(
  event: Pick<EventTarget, 'allDay' | 'start'>,
  minutesBefore: number,
  timeZone: string,
): Date {
  if (!event.allDay) return new Date(Date.parse(event.start) - minutesBefore * 60_000);
  return toInstant(addMinutes(combine(event.start, '00:00'), -minutesBefore), timeZone);
}

/** The preset choices for `target`, leaving out any whose time has already passed. */
export function remindMeChoices(
  target: RemindMeTarget,
  prefs: TimeSettings,
  now: Date,
): RemindMeChoice[] {
  if (target.type === 'page') {
    return pageReminderTimes(now, prefs.timeZone).map(({ preset, at }) => ({
      id: preset,
      label: pageLabel(preset, at, prefs),
      time: { at: at.toISOString() },
      dueAt: at,
    }));
  }
  const presets = target.allDay ? ALL_DAY_REMINDER_PRESETS : EVENT_REMINDER_PRESETS;
  return presets.flatMap((minutesBefore) => {
    const dueAt = eventDueAt(target, minutesBefore, prefs.timeZone);
    if (dueAt <= now) return [];
    const label = (target.allDay ? allDayLabel : beforeLabel)(minutesBefore, prefs);
    return [{ id: `before-${minutesBefore}`, label, time: { minutesBefore }, dueAt }];
  });
}

const checked = (time: ReminderTime, dueAt: Date, now: Date): CheckedTime =>
  dueAt > now ? { time, dueAt } : { problem: PASSED };

/** A page reminder at the date and time typed, on the person's clock. */
export function customAt(date: string, time: string, prefs: TimeSettings, now: Date): CheckedTime {
  const at = fromInputs(date, time, prefs.timeZone);
  if (!at) return { problem: 'Enter a date and a time.' };
  return checked({ at }, new Date(at), now);
}

/** A timed event's reminder `amount` minutes, hours or days before it starts. */
export function customBefore(
  event: EventTarget,
  amount: string,
  unit: BeforeUnit,
  prefs: TimeSettings,
  now: Date,
): CheckedTime {
  if (!WHOLE.test(amount)) return { problem: 'Enter a whole number.' };
  const minutesBefore = minutesOf(Number(amount), unit);
  if (minutesBefore > minutesOf(MAX_DAYS_BEFORE, 'days')) {
    return { problem: 'Pick a time up to 28 days before.' };
  }
  return checked({ minutesBefore }, eventDueAt(event, minutesBefore, prefs.timeZone), now);
}

/** An all-day event's reminder `days` before the day (0 is the day itself) at `time`. */
export function customAllDay(
  event: EventTarget,
  days: string,
  time: string,
  prefs: TimeSettings,
  now: Date,
): CheckedTime {
  if (!WHOLE.test(days) || Number(days) > MAX_DAYS_BEFORE) {
    return { problem: 'Pick 0 to 28 days before.' };
  }
  if (!isCivilTime(time)) return { problem: 'Enter a time.' };
  const minutesBefore = allDayMinutesBefore(Number(days), time);
  return checked({ minutesBefore }, eventDueAt(event, minutesBefore, prefs.timeZone), now);
}

/** The POST /api/reminders body: `target` at `time`, with the note when there is one. */
export function newReminder(target: RemindMeTarget, time: ReminderTime, note: string): NewReminder {
  const text = note.trim();
  const extra = text ? { note: text } : {};
  if (target.type === 'page') {
    return { target: { type: 'page', pageId: target.pageId }, ...time, ...extra };
  }
  const { eventId, occurrenceStart } = target;
  const occurrence = occurrenceStart ? { occurrenceStart } : {};
  return { target: { type: 'event', eventId, ...occurrence }, ...time, ...extra };
}
