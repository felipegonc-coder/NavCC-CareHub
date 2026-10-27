// How Analytics writes numbers, days and page names (en-US, like the rest of Care Hub).
import type { TopPage } from './api';

const numberFormat = new Intl.NumberFormat('en-US');
// Days are calendar days already in the viewer's time zone, so they're formatted as UTC noon.
const shortDay = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const longDay = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const noon = (day: string) => new Date(`${day}T12:00:00Z`);

/** 1234 → "1,234". */
export const countText = (count: number): string => numberFormat.format(count);

/** "2 views", "1 view". */
export const countOf = (count: number, one: string, many: string): string =>
  `${countText(count)} ${count === 1 ? one : many}`;

/** "2026-10-21" → "Oct 21", for chart axes. */
export const shortDayText = (day: string): string => shortDay.format(noon(day));

/** "2026-10-21" → "October 21, 2026". */
export const dayText = (day: string): string => longDay.format(noon(day));

/** A page's name as Analytics lists it: deleted pages keep their numbers, marked as such. */
export function pageName(page: Pick<TopPage, 'title' | 'state'>): string {
  const title = page.title.trim() || 'Untitled';
  if (page.state === 'trash') return `${title} (in Trash)`;
  if (page.state === 'deleted') return `${title} (deleted)`;
  return title;
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  // en-CA writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
