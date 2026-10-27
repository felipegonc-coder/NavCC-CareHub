import type { CivilDate, CivilDateTime, WeekStart } from '@carehub/team-time';

/**
 * Anything the grid places: an event, a database row's date or a Learning due date.
 * Times are civil values in the viewer's time zone; convert instants before calling.
 */
export interface CalendarItem {
  /** Unique within one call. */
  id: string;
  allDay: boolean;
  /** Timed: 'YYYY-MM-DDTHH:mm'. All-day: 'YYYY-MM-DD'. */
  start: CivilDateTime | CivilDate;
  /**
   * Timed: the exclusive end; missing (or not after start) is a point in time.
   * All-day: the inclusive last date; missing is a single day.
   */
  end?: CivilDateTime | CivilDate | null;
  /** The viewer answered Not going: drawn faded and struck through, or left out (visibleItems). */
  declined?: boolean;
}

/** New times from a drag, resize or keyboard step, in the same conventions as CalendarItem. */
export type ItemTimes =
  | { allDay: false; start: CivilDateTime; end: CivilDateTime | null }
  | { allDay: true; start: CivilDate; end: CivilDate | null };

/** The person's settings that change the grid. */
export interface GridOptions {
  weekStart: WeekStart;
  hideWeekends: boolean;
  /** Phone layout: Week shows 3 days at a time. */
  phone?: boolean;
  /** Settings: hide declined events (see visibleItems). */
  hideDeclined?: boolean;
}

export const MINUTES_PER_DAY = 1440;
/** Drag, resize and keyboard steps. */
export const STEP_MINUTES = 15;
/** Shortest event a resize makes. */
export const MIN_DURATION_MINUTES = 15;
/** Default length of a new event (Settings: 30 or 60). */
export const DEFAULT_EVENT_MINUTES = 60;
/** Items drawn per day before "+N more" (Month, and the all-day row). */
export const VISIBLE_ITEMS = 3;
/** Day and Week open scrolled to 7:00 AM, or to the current time if later. */
export const OPEN_AT_MINUTES = 7 * 60;
/** When Day and Week open at the current time, how much shows above the now line. */
export const NOW_LEAD_MINUTES = 60;
/** Phone Week shows 3 days at a time. */
export const PHONE_WEEK_DAYS = 3;
