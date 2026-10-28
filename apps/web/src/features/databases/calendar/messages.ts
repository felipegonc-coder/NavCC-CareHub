/** Every text the calendar shows (word for word from the Databases spec where it gives one). */
import {
  dayOfWeek,
  formatCalendarDate,
  MONTH_SHORT,
  type CalendarDate,
  type WeekDay,
} from '@carehub/databases';

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
const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const parts = (date: CalendarDate) => ({
  y: Number(date.slice(0, 4)),
  m: Number(date.slice(5, 7)),
  d: Number(date.slice(8, 10)),
});

export const CALENDAR_TEXT = {
  month: 'Month',
  week: 'Week',
  /** The Month and Week buttons. */
  view: 'Month or week',
  today: 'Today',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  previousWeek: 'Previous week',
  nextWeek: 'Next week',
  /** Rows without a date (spec 3.3). */
  noDate: 'No date',
  noDateEmpty: 'Every row has a date.',
  noDateHint: 'Drag a row onto a day to give it that date.',
  more: (count: number) => `+${count} more`,
  untitled: 'Untitled',
  open: 'Open',
  moveToDate: 'Move to date',
  delete: 'Delete',
  cardMenu: (title: string) => `Card menu for ${title}`,
  changeEnd: (title: string) => `Change the end of ${title}`,
  date: 'Date',
  move: 'Move',
  cancel: 'Cancel',
  moveDescription: (title: string) => `Pick the day "${title}" goes to.`,
  loadMore: 'Load more',
  /** There's no date property to show rows by. */
  noShowBy: 'Pick a date property to show rows by.',
  chooseShowBy: 'Show by',
  /** What screen readers hear after a move. */
  moved: (title: string, date: CalendarDate) => `Moved '${title}' to ${dayName(date)}`,
  newOnDay: (date: CalendarDate) => `New row on ${dayName(date)}`,
} as const;

/** "October 2026". */
export function monthTitle(date: CalendarDate): string {
  const { y, m } = parts(date);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "Oct 25 – 31, 2026", "Oct 25 – Nov 7, 2026" or "Dec 27, 2026 – Jan 2, 2027". */
export function weekTitle(first: CalendarDate, last: CalendarDate): string {
  const a = parts(first);
  const b = parts(last);
  const startMonth = MONTH_SHORT[a.m - 1];
  const endMonth = MONTH_SHORT[b.m - 1];
  if (a.y !== b.y) return `${startMonth} ${a.d}, ${a.y} – ${endMonth} ${b.d}, ${b.y}`;
  if (a.m !== b.m) return `${startMonth} ${a.d} – ${endMonth} ${b.d}, ${b.y}`;
  return `${startMonth} ${a.d} – ${b.d}, ${b.y}`;
}

/** "Sun" … "Sat". */
export const weekdayShort = (day: WeekDay): string => WEEKDAYS[day];

/** "Wednesday, Oct 28, 2026", how a day is named for screen readers. */
export function dayName(date: CalendarDate): string {
  return `${WEEKDAYS_LONG[dayOfWeek(date)]}, ${formatCalendarDate(date, 'full')}`;
}

/** The day's number in its cell, with the month on the 1st ("Nov 1"). */
export function dayNumber(date: CalendarDate): string {
  const { m, d } = parts(date);
  return d === 1 ? `${MONTH_SHORT[m - 1]} 1` : String(d);
}
