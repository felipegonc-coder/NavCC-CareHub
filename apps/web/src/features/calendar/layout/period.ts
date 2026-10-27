import { addDays, startOfWeek } from '@carehub/team-time';
import type { CalendarView, CivilDate } from '@carehub/team-time';
import { isWeekend, monthStart, stepDays } from './civil';
import { PHONE_WEEK_DAYS } from './types';
import type { GridOptions } from './types';

export interface MonthCell {
  date: CivilDate;
  /** False for the leading and trailing days of the next and previous months. */
  inMonth: boolean;
}

export interface MonthMatrix {
  /** 'YYYY-MM' of the month shown. */
  month: string;
  /** One row per week, from the person's week start; weekends left out when hidden. */
  weeks: MonthCell[][];
}

export interface PeriodRange {
  view: CalendarView;
  anchor: CivilDate;
  /** First and last date shown: what to load, and the period in the top bar. */
  start: CivilDate;
  end: CivilDate;
  /** The day columns in order (Day 1, Week 7 or 5, phone Week 3); Month: every date in the grid. */
  days: CivilDate[];
  /** Month view only. */
  month: MonthMatrix | null;
}

export type PeriodStep = 'previous' | 'next' | 'today';

/**
 * The weeks of the anchor's month. Rows that would only show other months' days (possible with
 * hidden weekends) are left out. sixWeeks always gives 6 rows, for a fixed-height month picker.
 */
export function monthMatrix(
  anchor: CivilDate,
  options: GridOptions & { sixWeeks?: boolean },
): MonthMatrix {
  const first = monthStart(anchor);
  const next = monthStart(anchor, 1);
  const weeks: MonthCell[][] = [];
  let week = startOfWeek(first, options.weekStart);
  while (options.sixWeeks ? weeks.length < 6 : week < next) {
    const cells = weekDates(week, options.hideWeekends).map((date) => ({
      date,
      inMonth: date >= first && date < next,
    }));
    if (options.sixWeeks || cells.some((cell) => cell.inMonth)) weeks.push(cells);
    week = addDays(week, 7);
  }
  return { month: first.slice(0, 7), weeks };
}

/**
 * What a view shows for an anchor date. Day always shows its date (hide weekends applies to Week
 * and Month); the phone Week shows 3 days from the anchor, skipping hidden weekends.
 */
export function viewRange(
  view: CalendarView,
  anchor: CivilDate,
  options: GridOptions,
): PeriodRange {
  const month = view === 'month' ? monthMatrix(anchor, options) : null;
  const days = month
    ? month.weeks.flat().map((cell) => cell.date)
    : view === 'day'
      ? [anchor]
      : options.phone
        ? phoneWeek(anchor, options.hideWeekends)
        : weekDates(startOfWeek(anchor, options.weekStart), options.hideWeekends);
  return { view, anchor, start: days[0] ?? anchor, end: days.at(-1) ?? anchor, days, month };
}

/** The anchor after Today, ‹ or ›: a day, a week, 3 shown days (phone Week) or a month. */
export function navigate(
  view: CalendarView,
  anchor: CivilDate,
  step: PeriodStep,
  options: GridOptions & { today: CivilDate },
): CivilDate {
  if (step === 'today') return options.today;
  const direction = step === 'next' ? 1 : -1;
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'month') return monthStart(anchor, direction);
  if (!options.phone) return addDays(anchor, 7 * direction);
  const { start } = viewRange(view, anchor, options);
  return stepDays(start, direction * PHONE_WEEK_DAYS, options.hideWeekends);
}

function weekDates(weekStart: CivilDate, hideWeekends: boolean): CivilDate[] {
  const dates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  return hideWeekends ? dates.filter((date) => !isWeekend(date)) : dates;
}

function phoneWeek(anchor: CivilDate, hideWeekends: boolean): CivilDate[] {
  const first = hideWeekends && isWeekend(anchor) ? stepDays(anchor, 1, true) : anchor;
  return Array.from({ length: PHONE_WEEK_DAYS }, (_, index) =>
    stepDays(first, index, hideWeekends),
  );
}
