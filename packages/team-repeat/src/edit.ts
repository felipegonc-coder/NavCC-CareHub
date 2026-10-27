import {
  addDays,
  combine,
  daysBetween,
  daysInMonth,
  isCivilDate,
  timePart,
} from '@carehub/team-time';
import type { CivilDate } from '@carehub/team-time';
import { addWeekdays, at, dateOf, isCivil, parts, sameKind, weekdayOf } from './civil';
import { countBefore, occurrenceAt, resolve, scheduled } from './expand';
import { checkRule } from './rule';
import {
  FIRST_DATE,
  LAST_DATE,
  compare,
  lengthOf,
  outOfRange,
  plus,
  tryAddDays,
  tryPlus,
} from './span';
import { RepeatError } from './types';
import type { Civil, Occurrence, OccurrenceKey, Override, RepeatRule, Series } from './types';

/** Changes to one occurrence ("This event"). */
export type OccurrenceChange<T extends object = Record<string, unknown>> = {
  /** Its new start. Without `end` it keeps its length. */
  start?: Civil;
  end?: Civil;
  /** Fields changed for this occurrence only. Set one to `undefined` to use the series value. */
  changes?: Partial<T>;
};

/** Changes to every occurrence ("All events"), or to this one and the ones after it. */
export type SeriesChange<T extends object = Record<string, unknown>> = {
  /**
   * The chosen occurrence's new start. Every occurrence moves by the same number of days and
   * takes this time of day (or becomes all-day).
   */
  start?: Civil;
  /** The chosen occurrence's new end. Every occurrence gets the same length. */
  end?: Civil;
  /** A new repeat rule. Left out, the rule stays (and follows occurrences that move days). */
  rule?: RepeatRule;
  /**
   * Event fields the caller changed for the whole series (title, location…). Occurrences' own
   * values for them are dropped, so the new value shows everywhere.
   */
  fields?: readonly (keyof T)[];
};

export type SeriesEdit<T extends object> = {
  series: Series<T>;
  /** Each old key's new key, or null if that occurrence is gone. Use it to move reminders. */
  mapKeys(keys: Iterable<OccurrenceKey>): Map<OccurrenceKey, OccurrenceKey | null>;
};

/** Where an occurrence went after "This and following". */
export type KeyMove = { series: 'before' | 'after'; key: OccurrenceKey };

export type FollowingEdit<T extends object> = {
  /** The old series, now ending before the chosen occurrence. Null if that was the first one. */
  before: Series<T> | null;
  /** A new series from the chosen occurrence on, with the change. */
  after: Series<T>;
  mapKeys(keys: Iterable<OccurrenceKey>): Map<OccurrenceKey, KeyMove | null>;
};

export type Split<T extends object> = { before: Series<T> | null; after: Series<T> };

type Schedule = Pick<Series<object>, 'start' | 'end' | 'rule'>;

/** The occurrence as it shows now. A key that's removed or not in the rule means a stale screen. */
function visible<T extends object>(series: Series<T>, key: OccurrenceKey): Occurrence<T> {
  const occurrence = occurrenceAt(series, key);
  if (!occurrence) {
    throw new RepeatError(
      'not-an-occurrence',
      'This occurrence is no longer in the series. Reload and try again.',
    );
  }
  return occurrence;
}

/** The new start and end. A new start without an end keeps the occurrence's length. */
function newSpan(shown: Occurrence<object>, change: { start?: Civil; end?: Civil }) {
  const start = change.start ?? shown.start;
  let end = change.end ?? shown.end;
  if (change.start !== undefined && change.end === undefined) {
    if (!isCivil(start) || !sameKind(start, shown.start)) {
      throw new RepeatError(
        'invalid-input',
        'Give an end when switching between all-day and timed.',
      );
    }
    end = plus(start, lengthOf(shown.start, shown.end));
  }
  if (!isCivil(start) || !isCivil(end) || !sameKind(start, end) || at(end) < at(start)) {
    throw new RepeatError(
      'invalid-input',
      'start and end must both be dates or both date-times, with end not before start.',
    );
  }
  return { start, end };
}

/** Canonical override: start and end both or neither, no unset fields. Null when nothing's left. */
function tidy<T extends object>(
  key: OccurrenceKey,
  override: Override<T>,
  length: number,
  drop: readonly PropertyKey[] = [],
): Override<T> | null {
  const out: Override<T> = {};
  if (override.start !== undefined || override.end !== undefined) {
    const shown = resolve(key, override, length) ?? outOfRange();
    if (shown.start !== key || shown.end !== tryPlus(key, length)) {
      out.start = shown.start;
      out.end = shown.end;
    }
  }
  const changes = Object.entries(override.changes ?? {}).filter(
    ([field, value]) => value !== undefined && !drop.includes(field),
  );
  if (changes.length > 0) out.changes = Object.fromEntries(changes) as Partial<T>;
  return out.start !== undefined || out.changes ? out : null;
}

/** A series with sorted exceptions and tidy overrides (an exception beats an override). */
function build<T extends object>(
  schedule: Schedule,
  exceptions: Iterable<OccurrenceKey>,
  overrides: Iterable<readonly [OccurrenceKey, Override<T>]>,
  drop: readonly PropertyKey[] = [],
): Series<T> {
  const removed = new Set(exceptions);
  const length = lengthOf(schedule.start, schedule.end);
  const kept: [OccurrenceKey, Override<T>][] = [];
  for (const [key, override] of overrides) {
    const clean = removed.has(key) ? null : tidy(key, override, length, drop);
    if (clean) kept.push([key, clean]);
  }
  kept.sort(([a], [b]) => compare(a, b));
  const { start, end, rule } = schedule;
  const sorted = [...removed].sort(compare);
  return { start, end, rule, exceptions: sorted, overrides: Object.fromEntries(kept) };
}

const entries = <T extends object>(series: Series<T>) =>
  Object.entries(series.overrides ?? {}) as [OccurrenceKey, Override<T>][];

/** "This event": moves or changes one occurrence. */
export function editOne<T extends object>(
  series: Series<T>,
  key: OccurrenceKey,
  change: OccurrenceChange<T>,
): Series<T> {
  const { start, end } = newSpan(visible(series, key), change);
  const old = series.overrides?.[key];
  const next: Override<T> = { start, end, changes: { ...old?.changes, ...change.changes } };
  const others = entries(series).filter(([k]) => k !== key);
  return build(series, series.exceptions ?? [], [...others, [key, next]]);
}

/** "This event" → Delete: removes one occurrence (and its changes). */
export function deleteOne<T extends object>(series: Series<T>, key: OccurrenceKey): Series<T> {
  visible(series, key);
  return build(series, [...(series.exceptions ?? []), key], entries(series));
}

/**
 * Splits a series before an occurrence: the old series ends the day before (or after fewer
 * occurrences, with a count) and a new one starts there with the same rule. Exceptions and
 * overrides go with their keys.
 */
export function splitSeries<T extends object>(series: Series<T>, key: OccurrenceKey): Split<T> {
  visible(series, key);
  const { rule } = series;
  const done = rule.count === undefined ? 0 : countBefore(series, key);
  const exceptions = series.exceptions ?? [];
  const overrides = entries(series);
  const after = build(
    {
      start: key,
      end: plus(key, lengthOf(series.start, series.end)),
      rule: rule.count === undefined ? rule : { ...rule, count: rule.count - done },
    },
    exceptions.filter((k) => k >= key),
    overrides.filter(([k]) => k >= key),
  );
  if (key === series.start) return { before: null, after };
  const ended: RepeatRule =
    rule.count === undefined
      ? { ...rule, until: addDays(dateOf(key), -1) }
      : { ...rule, count: done };
  const before = build(
    { ...series, rule: ended },
    exceptions.filter((k) => k < key),
    overrides.filter(([k]) => k < key),
  );
  return { before, after };
}

/**
 * `until` moved by `days`, as the last day an occurrence at `time` (null: all-day) can fall on.
 * It stays inside the range: no occurrence can fall outside it anyway.
 */
function movedUntil(until: Civil, time: string | null, days: number): CivilDate {
  const early = !isCivilDate(until) && time !== null && timePart(until) < time;
  const shift = days - (early ? 1 : 0);
  return tryAddDays(dateOf(until), shift) ?? (shift < 0 ? FIRST_DATE : LAST_DATE);
}

/**
 * The rule moved by `days` along with its occurrences, `key` being one of them. Null when that
 * takes new repeat days (several days of the month, or months that would change).
 */
function moveRule(rule: RepeatRule, key: OccurrenceKey, days: number, time: string | null) {
  const out: RepeatRule = { ...rule };
  if (rule.until !== undefined) out.until = movedUntil(rule.until, time, days);
  if (days === 0) return out;
  const { freq, byDay = [], byMonthDay = [], byMonth = [] } = rule;
  const date = addDays(dateOf(key), days);
  const [year, month, day] = parts(date);
  const length = daysInMonth(year, month);
  const yearlyOneMonth = freq === 'yearly' && byMonth.length === 1;
  if (byMonth.length > 0 && !yearlyOneMonth) return null;
  if (yearlyOneMonth) out.byMonth = [month];
  if (byMonthDay.length > 0 || byDay.some((d) => d.nth !== undefined)) {
    const oneDay = byMonthDay.length + byDay.length === 1;
    if (!oneDay || !(freq === 'monthly' || yearlyOneMonth)) return null;
    const [first] = byMonthDay;
    const nth = byDay[0]?.nth ?? 0;
    if (first !== undefined) out.byMonthDay = [first > 0 ? day : day - length - 1];
    else {
      const n = nth > 0 ? Math.ceil(day / 7) : -Math.ceil((length - day + 1) / 7);
      out.byDay = [{ day: weekdayOf(date), nth: n }];
    }
    return out;
  }
  if (byDay.length > 0) out.byDay = byDay.map((d) => ({ day: addWeekdays(d.day, days) }));
  return out;
}

/**
 * "All events": applies a change made through the chosen occurrence to every occurrence. With a
 * new start or end, every occurrence moves the same number of days from its original start and
 * takes the chosen occurrence's new time of day and length; moved occurrences go back in line.
 * Overrides keep their other changes, except the `fields` changed here.
 */
export function editAll<T extends object>(
  series: Series<T>,
  key: OccurrenceKey,
  change: SeriesChange<T>,
): SeriesEdit<T> {
  const shown = visible(series, key);
  const { start, end } = newSpan(shown, change);
  if (change.rule !== undefined) {
    const problems = checkRule(change.rule);
    if (problems.length > 0) throw new RepeatError('invalid-input', problems.join(' '));
  }
  const retimed = start !== shown.start || end !== shown.end;
  // A new start, or an occurrence of another kind than the series, moves every occurrence.
  const moved = retimed && (start !== shown.start || !sameKind(start, series.start));
  const oldLength = lengthOf(series.start, series.end);
  const length = retimed ? lengthOf(start, end) : oldLength;
  const days = moved ? daysBetween(dateOf(key), dateOf(start)) : 0;
  const time = isCivilDate(start) ? null : timePart(start);
  // Null when the key would leave the range, so no occurrence can be there.
  const shift = (k: OccurrenceKey): OccurrenceKey | null => {
    if (!moved) return k;
    const date = tryAddDays(dateOf(k), days);
    return date === null || time === null ? date : combine(date, time);
  };
  const oldTime = isCivilDate(series.start) ? null : timePart(series.start);
  const rule = change.rule ?? (moved ? moveRule(series.rule, key, days, oldTime) : series.rule);
  if (rule === null) {
    throw new RepeatError(
      'invalid-input',
      'Moving every occurrence by days needs new repeat days.',
    );
  }
  const newStart = shift(series.start) ?? outOfRange();
  const schedule: Schedule = { start: newStart, end: plus(newStart, length), rule };
  const resized = !moved && length !== oldLength;
  const overrides = entries(series).flatMap(([k, o]): [OccurrenceKey, Override<T>][] => {
    const next = shift(k);
    if (next === null) return [];
    if (moved) return [[next, { changes: o.changes }]];
    if (resized && (o.start === undefined || sameKind(o.start, k))) {
      return [[k, { start: o.start, changes: o.changes }]];
    }
    return [[k, o]];
  });
  const exceptions = (series.exceptions ?? []).flatMap((k) => shift(k) ?? []);
  // Drop exceptions and overrides for occurrences the new schedule doesn't make.
  const valid = scheduled(schedule, [...exceptions, ...overrides.map(([k]) => k)]);
  const result = build(
    schedule,
    exceptions.filter((k) => valid.has(k)),
    overrides.filter(([k]) => valid.has(k)),
    (change.fields ?? []) as readonly PropertyKey[],
  );
  return {
    series: result,
    mapKeys(list) {
      const next = new Map([...list].map((k) => [k, isCivil(k) ? shift(k) : null] as const));
      const found = scheduled(
        result,
        [...next.values()].flatMap((k) => k ?? []),
      );
      const removed = new Set(result.exceptions);
      return new Map(
        [...next].map(([k, n]) => [k, n !== null && found.has(n) && !removed.has(n) ? n : null]),
      );
    },
  };
}

/** "This and following": splits the series at the chosen occurrence and edits the new part. */
export function editFollowing<T extends object>(
  series: Series<T>,
  key: OccurrenceKey,
  change: SeriesChange<T>,
): FollowingEdit<T> {
  const { before, after } = splitSeries(series, key);
  const edited = editAll(after, key, change);
  return {
    before,
    after: edited.series,
    mapKeys(keys) {
      const list = [...keys];
      const later = edited.mapKeys(list.filter((k) => k >= key));
      return new Map(
        list.map((k): [OccurrenceKey, KeyMove | null] => {
          if (k < key) return [k, before ? { series: 'before', key: k } : null];
          const next = later.get(k);
          return [k, next ? { series: 'after', key: next } : null];
        }),
      );
    },
  };
}

/** "This and following" → Delete: what's left of the series, or null when nothing is. */
export function deleteFollowing<T extends object>(
  series: Series<T>,
  key: OccurrenceKey,
): Series<T> | null {
  return splitSeries(series, key).before;
}
