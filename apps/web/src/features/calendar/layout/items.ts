import { addDays, datePart } from '@carehub/team-time';
import type { CivilDate, CivilDateTime } from '@carehub/team-time';
import { minuteOfDay } from './civil';
import type { CalendarItem } from './types';

/** The items to lay out: with Hide declined events on, the ones the viewer declined are left out. */
export function visibleItems<T extends CalendarItem>(
  items: readonly T[],
  options: { hideDeclined?: boolean },
): T[] {
  return items.filter((item) => !(options.hideDeclined === true && item.declined === true));
}

/** A timed item's start and end; a missing or backwards end makes it a point in time. */
export function timedBounds(item: CalendarItem): { start: CivilDateTime; end: CivilDateTime } {
  const start = item.start as CivilDateTime;
  const end = item.end != null && item.end > start ? (item.end as CivilDateTime) : start;
  return { start, end };
}

/** The first and last date an item covers. A timed item ending at midnight stops the day before. */
export function dateSpan(item: CalendarItem): { first: CivilDate; last: CivilDate } {
  if (item.allDay) {
    const first = item.start as CivilDate;
    return { first, last: item.end != null && item.end > first ? (item.end as CivilDate) : first };
  }
  const { start, end } = timedBounds(item);
  const first = datePart(start);
  if (end === start) return { first, last: first };
  return { first, last: minuteOfDay(end) === 0 ? addDays(datePart(end), -1) : datePart(end) };
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Agenda order: all-day items first, then by start, longer first, then by id. */
export function compareItems(a: CalendarItem, b: CalendarItem): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (a.allDay) {
    const [x, y] = [dateSpan(a), dateSpan(b)];
    return byText(x.first, y.first) || byText(y.last, x.last) || byText(a.id, b.id);
  }
  const [x, y] = [timedBounds(a), timedBounds(b)];
  return byText(x.start, y.start) || byText(y.end, x.end) || byText(a.id, b.id);
}
