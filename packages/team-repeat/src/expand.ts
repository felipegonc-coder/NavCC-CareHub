import {
  addDays,
  combine,
  datePart,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  isCivilDate,
  timePart,
} from '@carehub/team-time';
import type { CivilDate } from '@carehub/team-time';
import { at, dateOf, isCivil, parts, sameKind, weekdayIndex, ymd } from './civil';
import { checkSeries, normalizeRule } from './rule';
import { FIRST_DATE, compare, lengthOf, tryPlus } from './span';
import { RepeatError } from './types';
import type {
  ByDay,
  Civil,
  Occurrence,
  OccurrenceKey,
  Override,
  RepeatRule,
  Series,
} from './types';

/** Most occurrences one call returns. */
export const MAX_OCCURRENCES = 1000;
/** Most candidate days one call looks at, so a rule that rarely matches can't hang the server. */
export const MAX_STEPS = 50_000;

export type ExpandWindow = {
  /** Start of the window, inclusive. A date means its midnight. */
  from: Civil;
  /** End of the window, exclusive. */
  to: Civil;
  /** At most this many occurrences: 1 to 1,000 (the default). */
  limit?: number;
};

export type Expansion<T extends object> = {
  /** Occurrences overlapping the window, by start. */
  occurrences: Occurrence<T>[];
  /** True when a cap stopped the expansion, so there may be more. */
  truncated: boolean;
};

type Budget = { steps: number; exhausted: boolean };
const newBudget = (): Budget => ({ steps: 0, exhausted: false });
/** Periods stop a week before the last civil date, so date math never leaves year 9999. */
const LAST_DAY = ymd(9999, 12, 24);

/** Day numbers in a month or year of `length` days whose day 1 is weekday `first`. */
function weekdayNumbers(byDay: readonly ByDay[], length: number, first: number): number[] {
  const out: number[] = [];
  for (const { day, nth } of byDay) {
    const firstMatch = 1 + ((weekdayIndex(day) - first + 7) % 7);
    if (nth === undefined) {
      for (let n = firstMatch; n <= length; n += 7) out.push(n);
      continue;
    }
    const lastMatch = firstMatch + 7 * Math.floor((length - firstMatch) / 7);
    const n = nth > 0 ? firstMatch + 7 * (nth - 1) : lastMatch + 7 * (nth + 1);
    if (n >= 1 && n <= length) out.push(n);
  }
  return out;
}

const monthDayNumbers = (list: readonly number[], length: number) =>
  list.map((n) => (n > 0 ? n : length + 1 + n)).filter((n) => n >= 1 && n <= length);
const sortedUnique = (list: number[]) => [...new Set(list)].sort((a, b) => a - b);

/** Days of one month for a monthly rule, or a yearly rule with months. */
function monthDays(rule: RepeatRule, year: number, month: number, anchor: number): number[] {
  const length = daysInMonth(year, month);
  const first = dayOfWeek(ymd(year, month, 1));
  const { byDay, byMonthDay } = rule;
  if (byMonthDay?.length) {
    const days = monthDayNumbers(byMonthDay, length);
    if (!byDay?.length) return sortedUnique(days);
    const allowed = new Set(weekdayNumbers(byDay, length, first));
    return sortedUnique(days.filter((n) => allowed.has(n)));
  }
  if (byDay?.length) return sortedUnique(weekdayNumbers(byDay, length, first));
  return anchor <= length ? [anchor] : [];
}

/** Dates of one year for a yearly rule. Without months, days count through the whole year. */
function yearDays(rule: RepeatRule, year: number, anchor: number): CivilDate[] {
  const { byDay, byMonth, byMonthDay } = rule;
  if (byMonth?.length) {
    return sortedUnique([...byMonth]).flatMap((month) =>
      monthDays(rule, year, month, anchor).map((day) => ymd(year, month, day)),
    );
  }
  const jan1 = ymd(year, 1, 1);
  const length = daysInMonth(year, 2) === 29 ? 366 : 365;
  let numbers: number[] = [];
  if (byMonthDay?.length) {
    let offset = 0;
    for (let month = 1; month <= 12; month += 1) {
      const days = daysInMonth(year, month);
      for (const day of monthDayNumbers(byMonthDay, days)) numbers.push(offset + day);
      offset += days;
    }
    if (byDay?.length) {
      const allowed = new Set(weekdayNumbers(byDay, length, dayOfWeek(jan1)));
      numbers = numbers.filter((n) => allowed.has(n));
    }
  } else if (byDay?.length) {
    numbers = weekdayNumbers(byDay, length, dayOfWeek(jan1));
  }
  return sortedUnique(numbers).map((n) => addDays(jan1, n - 1));
}

/** Daily and weekly rules use byMonth, byMonthDay and byDay as filters. */
function passes(rule: RepeatRule, date: CivilDate): boolean {
  const [year, month, day] = parts(date);
  if (rule.byMonth?.length && !rule.byMonth.includes(month)) return false;
  if (
    rule.byMonthDay?.length &&
    !monthDayNumbers(rule.byMonthDay, daysInMonth(year, month)).includes(day)
  ) {
    return false;
  }
  return !rule.byDay?.length || rule.byDay.some((d) => weekdayIndex(d.day) === dayOfWeek(date));
}

/**
 * Period k of a rule (k × interval days, weeks, months or years on): its first day and candidate
 * days. Weeks begin `back` days before the start's weekday, but the start's own week counts from
 * the start: earlier days don't matter, and they may fall before year 1.
 */
function period(
  rule: RepeatRule,
  start: CivilDate,
  back: number,
  k: number,
): { first: CivilDate; days: CivilDate[] } {
  const [year, month, day] = parts(start);
  const n = k * rule.interval;
  switch (rule.freq) {
    case 'daily': {
      const date = addDays(start, n);
      return { first: date, days: passes(rule, date) ? [date] : [] };
    }
    case 'weekly': {
      const offset = 7 * n - back;
      const days: CivilDate[] = [];
      for (let i = Math.max(0, -offset); i < 7; i += 1) {
        const date = addDays(start, offset + i);
        if (passes(rule, date)) days.push(date);
      }
      return { first: addDays(start, Math.max(0, offset)), days };
    }
    case 'monthly': {
      const total = year * 12 + month - 1 + n;
      const [y, m] = [Math.floor(total / 12), (total % 12) + 1];
      const skip = rule.byMonth?.length && !rule.byMonth.includes(m);
      return {
        first: ymd(y, m, 1),
        days: skip ? [] : monthDays(rule, y, m, day).map((d) => ymd(y, m, d)),
      };
    }
    case 'yearly':
      return { first: ymd(year + n, 1, 1), days: yearDays(rule, year + n, day) };
  }
}

/** The period holding `date`, so expansion can jump straight to a window. */
function periodIndex(rule: RepeatRule, start: CivilDate, back: number, date: CivilDate): number {
  const [y1, m1] = parts(start);
  const [y2, m2] = parts(date);
  const span =
    rule.freq === 'daily'
      ? daysBetween(start, date)
      : rule.freq === 'weekly'
        ? Math.floor((daysBetween(start, date) + back) / 7)
        : rule.freq === 'monthly'
          ? (y2 - y1) * 12 + m2 - m1
          : y2 - y1;
  return Math.max(0, Math.floor(span / rule.interval));
}

/**
 * Original starts of a series' occurrences in order, before exceptions and overrides. The start
 * always comes first. Without a count, it jumps to the period holding `from`. It stops before a
 * period that begins after `to`, at the rule's end, or when the budget runs out.
 */
function* keys(
  start: Civil,
  rule: RepeatRule,
  from: CivilDate,
  to: CivilDate,
  budget: Budget,
): Generator<OccurrenceKey> {
  yield start;
  const r = normalizeRule(rule, start);
  const total = r.count ?? Number.POSITIVE_INFINITY;
  const startDate = dateOf(start);
  const time = isCivilDate(start) ? null : timePart(start);
  const until =
    r.until === undefined ? null : isCivilDate(r.until) ? combine(r.until, '23:59') : r.until;
  const back = (dayOfWeek(startDate) - weekdayIndex(r.weekStart ?? 'MO') + 7) % 7;
  const last = periodIndex(r, startDate, back, LAST_DAY);
  let count = 1;
  let k = r.count === undefined && from > startDate ? periodIndex(r, startDate, back, from) : 0;
  while (count < total && k <= last) {
    const { first, days } = period(r, startDate, back, k);
    if (first > to) return;
    budget.steps += 1 + days.length;
    if (budget.steps > MAX_STEPS) {
      budget.exhausted = true;
      return;
    }
    for (const day of days) {
      if (day <= startDate) continue;
      const key = time === null ? day : combine(day, time);
      if (until !== null && at(key) > until) return;
      yield key;
      count += 1;
      if (count >= total) return;
    }
    k += 1;
  }
}

/** Which of these keys the rule makes (ignoring exceptions). */
export function scheduled(
  series: Series<object>,
  candidates: Iterable<OccurrenceKey>,
  budget: Budget = newBudget(),
): Set<OccurrenceKey> {
  const wanted = new Set(
    [...candidates].filter((key) => isCivil(key) && sameKind(key, series.start)),
  );
  const sorted = [...wanted].sort(compare);
  const found = new Set<OccurrenceKey>();
  const low = sorted[0];
  const high = sorted.at(-1);
  if (low === undefined || high === undefined) return found;
  // Without a count each key is a jump to its own period; with one, a single pass from the start.
  const runs =
    series.rule.count === undefined
      ? sorted.map((key) => [key, key] as const)
      : [[low, high] as const];
  for (const [first, last] of runs) {
    for (const key of keys(series.start, series.rule, dateOf(first), dateOf(last), budget)) {
      if (key > last) break;
      if (wanted.has(key)) found.add(key);
    }
  }
  return found;
}

/** How many occurrences (removed ones included) come before `key`. */
export function countBefore(series: Series<object>, key: OccurrenceKey): number {
  const budget = newBudget();
  let count = 0;
  for (const k of keys(series.start, series.rule, dateOf(series.start), dateOf(key), budget)) {
    if (k >= key) break;
    count += 1;
  }
  if (budget.exhausted) {
    throw new RepeatError('invalid-input', 'This series is too long to split there.');
  }
  return count;
}

export function assertSeries(series: Series<object>): void {
  const problems = checkSeries(series);
  if (problems.length > 0) throw new RepeatError('invalid-input', problems.join(' '));
}

/** An overridden occurrence where it shows now; null when it would end after 9999-12-31. */
export function resolve<T extends object>(
  key: OccurrenceKey,
  override: Override<T>,
  length: number,
): Occurrence<T> | null {
  const start = override.start ?? key;
  const end = override.end ?? (sameKind(start, key) ? tryPlus(start, length) : start);
  if (end === null) return null;
  const occurrence: Occurrence<T> = { key, start, end };
  if (override.changes && Object.keys(override.changes).length > 0) {
    occurrence.changes = override.changes;
  }
  return occurrence;
}

/** Whether [start, end) overlaps [from, to). A zero-length occurrence counts at its start. */
function overlaps(start: Civil, end: Civil, from: string, to: string): boolean {
  const [s, e] = [at(start), at(end)];
  return s < to && (e > from || (s === e && s >= from));
}

/**
 * Occurrences overlapping a civil window, after exceptions (removed) and overrides (moved or
 * changed; a moved one shows where it moved to). Capped at 1,000 per call.
 */
export function expand<T extends object>(series: Series<T>, window: ExpandWindow): Expansion<T> {
  assertSeries(series);
  const limit = Math.min(window.limit ?? MAX_OCCURRENCES, MAX_OCCURRENCES);
  if (!isCivil(window.from) || !isCivil(window.to) || !Number.isInteger(limit) || limit < 1) {
    throw new RepeatError(
      'invalid-input',
      'The window needs a civil from and to, and a limit of 1 or more.',
    );
  }
  const [from, to] = [at(window.from), at(window.to)];
  const found: Occurrence<T>[] = [];
  if (from >= to) return { occurrences: found, truncated: false };
  const length = lengthOf(series.start, series.end);
  const removed = new Set(series.exceptions);
  const overrides = series.overrides ?? {};
  const budget = newBudget();
  // Look back far enough to catch occurrences that start before the window and run into it.
  const lookback = tryPlus(isCivilDate(series.start) ? datePart(from) : from, -length);
  const scanFrom = lookback === null ? FIRST_DATE : dateOf(lookback);
  const seen = new Set<OccurrenceKey>();
  let more = false;
  for (const key of keys(series.start, series.rule, scanFrom, datePart(to), budget)) {
    if (at(key) >= to) break;
    if (Object.hasOwn(overrides, key)) {
      seen.add(key);
      continue;
    }
    // One that would end after 9999-12-31 is left out, and so is every later one.
    const end = tryPlus(key, length);
    if (end === null) break;
    if (removed.has(key) || !overlaps(key, end, from, to)) continue;
    if (found.length === limit) {
      more = true;
      break;
    }
    found.push({ key, start: key, end });
  }
  const moved = Object.entries(overrides)
    .filter(([key]) => !removed.has(key))
    .map(([key, override]) => resolve(key, override, length))
    .filter((o): o is Occurrence<T> => o !== null && overlaps(o.start, o.end, from, to));
  const unseen = moved.map((occurrence) => occurrence.key).filter((key) => !seen.has(key));
  const valid = scheduled(series, unseen, budget);
  for (const occurrence of moved) {
    if (seen.has(occurrence.key) || valid.has(occurrence.key)) found.push(occurrence);
  }
  found.sort((a, b) => compare(at(a.start), at(b.start)) || compare(a.key, b.key));
  return {
    occurrences: found.slice(0, limit),
    truncated: more || found.length > limit || budget.exhausted,
  };
}

/**
 * The occurrence with this key as it shows now; null if it's removed, not in the rule, or would
 * end after 9999-12-31.
 */
export function occurrenceAt<T extends object>(
  series: Series<T>,
  key: OccurrenceKey,
): Occurrence<T> | null {
  assertSeries(series);
  if (series.exceptions?.includes(key)) return null;
  const budget = newBudget();
  const made = scheduled(series, [key], budget).has(key);
  if (budget.exhausted) {
    throw new RepeatError('invalid-input', 'This series is too long to look that far ahead.');
  }
  if (!made) return null;
  const length = lengthOf(series.start, series.end);
  const override =
    series.overrides && Object.hasOwn(series.overrides, key) ? series.overrides[key] : undefined;
  if (override) return resolve(key, override, length);
  const end = tryPlus(key, length);
  return end === null ? null : { key, start: key, end };
}
