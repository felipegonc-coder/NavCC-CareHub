import { combine, isCivilDate, isCivilDateTime } from '@carehub/team-time';
import type { CivilDateTime } from '@carehub/team-time';
import { dateOf } from './civil';
import { checkRule } from './rule';
import { RepeatError } from './types';
import type { ByDay, Civil, Frequency, RepeatRule, UnsupportedRule } from './types';

export type ParseOptions = {
  /**
   * Turns a UTC UNTIL, given as '2026-12-01T06:59:59Z', into a civil date-time in the event's
   * time zone. Needed only when a rule has one.
   */
  fromUtc?: (instant: string) => CivilDateTime;
};

export type SerializeOptions = {
  /** All-day events write UNTIL as a date. */
  allDay: boolean;
  /**
   * Turns a civil date-time in the event's time zone into a UTC instant such as
   * '2026-12-01T06:59:00Z'. Needed for UNTIL on timed events: iCalendar and Google want UTC there.
   */
  toUtc?: (civil: CivilDateTime) => string;
};

const FREQUENCIES: Readonly<Record<string, Frequency>> = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
};
const UNTIL = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/;
const DAY = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/;
const UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]00:?00)$/;

export const isUnsupported = (rule: RepeatRule | UnsupportedRule): rule is UnsupportedRule =>
  'unsupported' in rule && rule.unsupported === true;

const whole = (text: string) => (/^[+-]?\d{1,9}$/.test(text) ? Number(text) : Number.NaN);

function parseDay(text: string): ByDay | null {
  const match = DAY.exec(text);
  if (!match) return null;
  const [, nth, day] = match;
  return nth === undefined
    ? { day: day as ByDay['day'] }
    : { day: day as ByDay['day'], nth: whole(nth) };
}

function parseUntil(text: string, options: ParseOptions): Civil | null {
  const match = UNTIL.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, utc] = match;
  const date = `${year}-${month}-${day}`;
  if (hour === undefined) return isCivilDate(date) ? date : null;
  const civil = `${date}T${hour}:${minute}`;
  if (!isCivilDateTime(civil) || Number(second) > 59) return null;
  if (utc !== 'Z') return civil;
  if (!options.fromUtc) {
    throw new RepeatError('needs-converter', 'Pass fromUtc to read a rule with a UTC UNTIL.');
  }
  const local = options.fromUtc(`${civil}:${second}Z`);
  return isCivilDateTime(local) ? local : null;
}

/**
 * Reads an iCalendar or Google RRULE ('RRULE:FREQ=WEEKLY;BYDAY=MO,WE', with or without the
 * prefix). Anything outside the supported subset, or invalid, comes back as `{ unsupported, raw }`.
 */
export function parseRRule(text: string, options: ParseOptions = {}): RepeatRule | UnsupportedRule {
  const unsupported: UnsupportedRule = { unsupported: true, raw: text };
  const body = text
    .trim()
    .replace(/^RRULE:/i, '')
    .toUpperCase();
  if (body === '' || /\s/.test(body)) return unsupported;
  const rule: Record<string, unknown> = { interval: 1 };
  const seen = new Set<string>();
  for (const part of body.split(';')) {
    if (part === '') continue;
    const [name = '', value = '', ...rest] = part.split('=');
    if (rest.length > 0 || value === '' || seen.has(name)) return unsupported;
    seen.add(name);
    const list = value.split(',');
    if (name === 'FREQ') rule.freq = FREQUENCIES[value];
    else if (name === 'INTERVAL') rule.interval = whole(value);
    else if (name === 'COUNT') rule.count = whole(value);
    else if (name === 'UNTIL') rule.until = parseUntil(value, options);
    else if (name === 'BYDAY') rule.byDay = list.map(parseDay);
    else if (name === 'BYMONTHDAY') rule.byMonthDay = list.map(whole);
    else if (name === 'BYMONTH') rule.byMonth = list.map(whole);
    else if (name === 'WKST') rule.weekStart = value;
    else return unsupported;
  }
  return checkRule(rule).length === 0 ? (rule as RepeatRule) : unsupported;
}

function untilText(until: Civil, options: SerializeOptions): string {
  if (options.allDay) return dateOf(until).replaceAll('-', '');
  if (!options.toUtc) {
    throw new RepeatError('needs-converter', 'Pass toUtc to write UNTIL for a timed event.');
  }
  const local = isCivilDate(until) ? combine(until, '23:59') : until;
  const match = UTC.exec(options.toUtc(local));
  if (!match) throw new RepeatError('invalid-input', 'toUtc must return a UTC ISO 8601 time.');
  const [, year, month, day, hour, minute] = match;
  // The whole minute counts, so the last occurrence is kept.
  return `${year}${month}${day}T${hour}${minute}59Z`;
}

/**
 * Writes a rule as 'RRULE:…' for iCalendar and Google. An unsupported rule is passed through
 * unchanged.
 */
export function serializeRRule(
  rule: RepeatRule | UnsupportedRule,
  options: SerializeOptions,
): string {
  if (isUnsupported(rule)) return rule.raw;
  const problems = checkRule(rule);
  if (problems.length > 0) throw new RepeatError('invalid-input', problems.join(' '));
  const parts = [`FREQ=${rule.freq.toUpperCase()}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== undefined) parts.push(`UNTIL=${untilText(rule.until, options)}`);
  if (rule.byMonth) parts.push(`BYMONTH=${rule.byMonth.join(',')}`);
  if (rule.byMonthDay) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
  if (rule.byDay) parts.push(`BYDAY=${rule.byDay.map((d) => `${d.nth ?? ''}${d.day}`).join(',')}`);
  if (rule.weekStart) parts.push(`WKST=${rule.weekStart}`);
  return `RRULE:${parts.join(';')}`;
}
