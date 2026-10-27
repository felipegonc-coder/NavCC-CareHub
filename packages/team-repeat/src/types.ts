import type { CivilDate, CivilDateTime } from '@carehub/team-time';

/** A civil date ('YYYY-MM-DD') for all-day events, or a civil date-time ('YYYY-MM-DDTHH:mm'). */
export type Civil = CivilDate | CivilDateTime;

/** Weekdays as iCalendar writes them. */
export type WeekdayCode = 'SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA';

/**
 * A weekday. With `nth`, only the nth one of the month: 1 to 5, or -1 for the last (-2 for the
 * one before it). In a yearly rule without `byMonth`, the nth one of the year (up to ±53).
 */
export type ByDay = { day: WeekdayCode; nth?: number };

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * A repeat rule: the iCalendar RRULE subset Care Hub supports, on civil values. Parts left out
 * follow the series start, as in iCalendar (a weekly rule without `byDay` repeats on the start's
 * weekday; a monthly rule without days repeats on the start's day of the month).
 */
export type RepeatRule = {
  freq: Frequency;
  /** Every `interval` days, weeks, months or years (1 to 1,000). */
  interval: number;
  /** Weekly: the chosen days. Monthly or yearly: weekdays such as the 2nd Tuesday. */
  byDay?: readonly ByDay[];
  /** Days of the month, 1 to 31, or -1 for the last day. Months without that day are skipped. */
  byMonthDay?: readonly number[];
  /** Months, 1 to 12. */
  byMonth?: readonly number[];
  /** First day of the week for weekly rules with an interval (iCalendar WKST, default Monday). */
  weekStart?: WeekdayCode;
  /** Ends after this many occurrences; the first one counts. */
  count?: number;
  /** Ends on this date, or at this date-time (both inclusive). Never together with `count`. */
  until?: Civil;
};

/** A rule outside the subset: show the event read-only and pass `raw` through unchanged. */
export type UnsupportedRule = { unsupported: true; raw: string };

/** An occurrence's original civil start. It identifies the occurrence even after it moves. */
export type OccurrenceKey = Civil;

/** Changes to one occurrence of a series. */
export type Override<T extends object = Record<string, unknown>> = {
  /** Where the occurrence moved to (same kinds as each other; may differ from the series). */
  start?: Civil;
  end?: Civil;
  /** Event fields changed for this occurrence only (title, location…), in the caller's shape. */
  changes?: Partial<T>;
};

/** A repeating event's schedule. */
export type Series<T extends object = Record<string, unknown>> = {
  /** Start of the first occurrence. The start always counts as an occurrence, as in iCalendar. */
  start: Civil;
  /**
   * End of the first occurrence, the same kind as `start` and exclusive: an all-day event on
   * Nov 5 ends on '…-11-06'. Every occurrence has the same length unless it's overridden.
   */
  end: Civil;
  rule: RepeatRule;
  /** Removed occurrences. */
  exceptions?: readonly OccurrenceKey[];
  /** Moved or changed occurrences. */
  overrides?: Readonly<Record<OccurrenceKey, Override<T>>>;
};

/** One occurrence as it should show, after exceptions and overrides. */
export type Occurrence<T extends object = Record<string, unknown>> = {
  key: OccurrenceKey;
  start: Civil;
  end: Civil;
  /** This occurrence's own changes, if it has any. */
  changes?: Partial<T>;
};

export type RepeatErrorCode = 'invalid-input' | 'not-an-occurrence' | 'needs-converter';

/** Thrown for bad input (map it to HTTP 400) or a stale occurrence key (409). */
export class RepeatError extends Error {
  readonly code: RepeatErrorCode;

  constructor(code: RepeatErrorCode, message: string) {
    super(message);
    this.name = 'RepeatError';
    this.code = code;
  }
}
