/** Every text the timeline shows (word for word from the Databases spec where it gives one). */
import {
  dayOfWeek,
  formatCalendarDate,
  formatTime,
  MONTH_SHORT,
  toCalendarDate,
  zonedParts,
  type CalendarDate,
} from '@carehub/databases';
import type { Tick, TimelineScale } from './model';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** The zoom levels (spec 3.3: hours, day, week, two weeks, month, quarter, year). */
export const SCALE_LABELS: Readonly<Record<TimelineScale, string>> = {
  hours: 'Hours',
  day: 'Day',
  week: 'Week',
  bi_week: 'Bi-week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
};

export const TIMELINE_TEXT = {
  today: 'Today',
  earlier: 'Earlier',
  later: 'Later',
  zoom: 'Zoom',
  /** Rows without dates (spec 3.3). */
  noDate: 'No date',
  untitled: 'Untitled',
  name: 'Name',
  table: 'Rows',
  timeline: 'Timeline',
  loadMore: 'Load more',
  noShowBy: 'Pick a date property to show rows by.',
  chooseShowBy: 'Show by',
  /** Clicking the empty line of a row without dates. */
  place: (title: string) => `Place ${title} on the timeline`,
  moveStart: (title: string) => `Change the start of ${title}`,
  moveEnd: (title: string) => `Change the end of ${title}`,
  collapse: (label: string) => `Collapse ${label}`,
  expand: (label: string) => `Expand ${label}`,
  /** What screen readers hear. */
  moved: (title: string, when: string) => `Moved '${title}' to ${when}`,
  picked: (title: string) =>
    `Picked up '${title}'. Use the arrow keys to move it, Shift and the arrow keys to change its end, and Space to drop it.`,
  dropped: (title: string) => `Dropped '${title}'.`,
  ends: (title: string, when: string) => `'${title}' now ends ${when}`,
  cancelled: (title: string) => `'${title}' stays where it was.`,
  /** Read after a bar's name. */
  barHint: 'Enter opens it. Space picks it up to move with the arrow keys.',
} as const;

/** A header tick's label: "October 2026", "Q4 2026", "2026", "Wed, Oct 28", "Wed 28", "Oct 26", "Oct", "9 AM". */
export function tickLabel(
  tick: Tick,
  unit: 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year',
  scale: TimelineScale,
  hour12: boolean,
): string {
  const y = Number(tick.date.slice(0, 4));
  const m = Number(tick.date.slice(5, 7));
  const d = Number(tick.date.slice(8, 10));
  switch (unit) {
    case 'hour': {
      // "9 AM" or "09:00": an hour is narrow.
      const hour = tick.hour ?? 0;
      if (!hour12) return formatTime(hour, 0, false);
      return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
    }
    case 'day':
      if (scale === 'hours') return `${WEEKDAYS[dayOfWeek(tick.date)]}, ${MONTH_SHORT[m - 1]} ${d}`;
      return scale === 'day' ? `${WEEKDAYS[dayOfWeek(tick.date)]} ${d}` : String(d);
    case 'week':
      return `${MONTH_SHORT[m - 1]} ${d}`;
    case 'month':
      return scale === 'quarter' || scale === 'year'
        ? (MONTH_SHORT[m - 1] ?? '')
        : `${MONTHS[m - 1]} ${y}`;
    case 'quarter':
      return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
    case 'year':
      return String(y);
  }
}

/** How a moved point is read out: its day, and its time in its zone if it has one. */
export function pointLabel(
  point: string,
  hasTime: boolean,
  timeZone: string,
  hour12: boolean,
): string {
  if (!hasTime) return whenLabel(point, null, hour12);
  const parts = zonedParts(point, timeZone);
  return whenLabel(toCalendarDate(parts), { hour: parts.hour, minute: parts.minute }, hour12);
}

/** "Oct 27, 2026" or "Oct 27, 2026 3:30 PM", how a moved bar's new start is read out. */
export function whenLabel(
  date: CalendarDate,
  time: { hour: number; minute: number } | null,
  hour12: boolean,
): string {
  const day = formatCalendarDate(date, 'full');
  return time ? `${day} ${formatTime(time.hour, time.minute, hour12)}` : day;
}
