import { at, dateOf, isCivil, parts, sameKind, weekdayOf, WEEKDAYS } from './civil';
import { RepeatError } from './types';
import type { Civil, RepeatRule, WeekdayCode } from './types';

/** The largest interval a rule may have ("every 1,000 days"). */
export const MAX_INTERVAL = 1000;

const FREQUENCIES: readonly string[] = ['daily', 'weekly', 'monthly', 'yearly'];
const RULE_FIELDS = new Set([
  'freq',
  'interval',
  'byDay',
  'byMonthDay',
  'byMonth',
  'weekStart',
  'count',
  'until',
]);
const OVERRIDE_FIELDS = new Set(['start', 'end', 'changes']);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isWhole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const isWeekday = (value: unknown): value is WeekdayCode => WEEKDAYS.includes(value as WeekdayCode);
/** Absent, or a non-empty array whose items all pass. */
const listOf = (value: unknown, ok: (item: unknown) => boolean) =>
  value === undefined || (Array.isArray(value) && value.length > 0 && value.every(ok));
const unknownFields = (value: Record<string, unknown>, allowed: Set<string>) =>
  Object.keys(value).filter((key) => !allowed.has(key));

/** What's wrong with a repeat rule, in plain words; empty when it's valid. Takes untrusted JSON. */
export function checkRule(value: unknown): string[] {
  if (!isObject(value)) return ['The repeat rule must be an object.'];
  const problems = unknownFields(value, RULE_FIELDS).map((key) => `Unknown repeat field "${key}".`);
  const { freq, interval, byDay, byMonthDay, byMonth, weekStart, count, until } = value;
  if (typeof freq !== 'string' || !FREQUENCIES.includes(freq)) {
    problems.push('freq must be daily, weekly, monthly or yearly.');
  }
  if (!isWhole(interval, 1, MAX_INTERVAL)) {
    problems.push(`interval must be a whole number from 1 to ${MAX_INTERVAL}.`);
  }
  if (count !== undefined && !isWhole(count, 1, Number.MAX_SAFE_INTEGER)) {
    problems.push('count must be a whole number of at least 1.');
  }
  if (until !== undefined && !isCivil(until)) problems.push('until must be a date or a date-time.');
  if (count !== undefined && until !== undefined) problems.push('Use count or until, not both.');
  if (weekStart !== undefined && !isWeekday(weekStart)) {
    problems.push('weekStart must be a weekday code such as "MO".');
  }
  if (!listOf(byMonth, (n) => isWhole(n, 1, 12)))
    problems.push('byMonth must list months from 1 to 12.');
  if (!listOf(byMonthDay, (n) => isWhole(n, -31, 31) && n !== 0)) {
    problems.push('byMonthDay must list days from 1 to 31, or -31 to -1 counted from the end.');
  } else if (byMonthDay !== undefined && freq === 'weekly') {
    problems.push("A weekly rule can't use byMonthDay.");
  }
  // iCalendar allows "2nd Tuesday" only in monthly and yearly rules; in a yearly rule without
  // months the number counts weeks of the year.
  const maxNth = freq === 'monthly' ? 5 : freq === 'yearly' ? (byMonth === undefined ? 53 : 5) : 0;
  const dayOk = (item: unknown) =>
    isObject(item) &&
    isWeekday(item.day) &&
    unknownFields(item, new Set(['day', 'nth'])).length === 0 &&
    (item.nth === undefined || (isWhole(item.nth, -maxNth, maxNth) && item.nth !== 0));
  if (!listOf(byDay, dayOk)) {
    problems.push(
      maxNth === 0
        ? 'byDay must list weekdays, without numbers in daily and weekly rules.'
        : `byDay must list weekdays, each with an optional number up to ±${maxNth} (not 0).`,
    );
  }
  return problems;
}

export const isRepeatRule = (value: unknown): value is RepeatRule => checkRule(value).length === 0;

/** What's wrong with a series (start, end, rule, exceptions, overrides). Empty when it's valid. */
export function checkSeries(value: unknown): string[] {
  if (!isObject(value)) return ['The series must be an object.'];
  const { start, end, rule, exceptions, overrides } = value;
  const problems = checkRule(rule);
  if (!isCivil(start) || !isCivil(end) || !sameKind(start, end) || at(end) < at(start)) {
    problems.push(
      'start and end must both be dates or both date-times, with end not before start.',
    );
    return problems;
  }
  const isKey = (key: unknown) => isCivil(key) && sameKind(key, start);
  if (exceptions !== undefined && !(Array.isArray(exceptions) && exceptions.every(isKey))) {
    problems.push(`exceptions must list occurrence starts of the same kind as start.`);
  }
  const overrideOk = ([key, item]: [string, unknown]) =>
    isKey(key) &&
    isObject(item) &&
    unknownFields(item, OVERRIDE_FIELDS).length === 0 &&
    (item.start === undefined || isCivil(item.start)) &&
    (item.end === undefined || isCivil(item.end)) &&
    (!isCivil(item.start) ||
      !isCivil(item.end) ||
      (sameKind(item.start, item.end) && at(item.end) >= at(item.start))) &&
    (item.changes === undefined || isObject(item.changes));
  if (
    overrides !== undefined &&
    !(isObject(overrides) && Object.entries(overrides).every(overrideOk))
  ) {
    problems.push('overrides must map occurrence starts to { start?, end?, changes? }.');
  }
  return problems;
}

/**
 * Spells out the parts a rule leaves to its start: the weekday of a weekly rule, the day of a
 * monthly rule, the month and day of a yearly rule. Occurrences don't change.
 */
export function normalizeRule(rule: RepeatRule, start: Civil): RepeatRule {
  const problems = isCivil(start) ? checkRule(rule) : ['start must be a date or a date-time.'];
  if (problems.length > 0) throw new RepeatError('invalid-input', problems.join(' '));
  const date = dateOf(start);
  const [, month, day] = parts(date);
  const hasDays = (rule.byDay?.length ?? 0) > 0 || (rule.byMonthDay?.length ?? 0) > 0;
  const out: RepeatRule = { ...rule };
  if (rule.freq === 'weekly' && !rule.byDay?.length) out.byDay = [{ day: weekdayOf(date) }];
  if (rule.freq === 'monthly' && !hasDays) out.byMonthDay = [day];
  if (rule.freq === 'yearly' && !hasDays) {
    out.byMonthDay = [day];
    if (!rule.byMonth?.length) out.byMonth = [month];
  }
  return out;
}
