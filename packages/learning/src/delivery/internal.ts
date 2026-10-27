import type { CourseStatus, IsoDate, IsoDateTime } from '../format/index';
import { compareDays, isIsoDate, isoDateInTimeZone } from '../util/index';

// Helpers shared by delivery/ and reports/. Not exported from the package.

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Finished = completed or passed. A failed course is not finished. */
export function isFinished(status: CourseStatus): boolean {
  return status === 'completed' || status === 'passed';
}

/** Milliseconds since 1970. Throws a RangeError for a value that isn't a date or date-time. */
export function instant(at: IsoDateTime | IsoDate): number {
  const time = Date.parse(at);
  if (Number.isNaN(time)) throw new RangeError(`Not a date or date-time: ${JSON.stringify(at)}`);
  return time;
}

/**
 * The calendar day of `at` in `timeZone` (an IANA name). A plain "YYYY-MM-DD" is returned
 * unchanged.
 */
export function dayOf(at: IsoDateTime | IsoDate, timeZone = 'UTC'): IsoDate {
  return isIsoDate(at) ? at : isoDateInTimeZone(at, timeZone);
}

/** Sort order for optional date-times: newest first, missing last. */
export function newestFirst(a: IsoDateTime | undefined, b: IsoDateTime | undefined): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  return instant(b) - instant(a);
}

/** Sort order for optional calendar days: earliest first, missing last. */
export function earliestFirst(a: IsoDate | undefined, b: IsoDate | undefined): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  return compareDays(a, b);
}

/**
 * Sort order for names and titles: case- and accent-insensitive, numbers in numeric order, then
 * exact.
 */
export function byText(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}
