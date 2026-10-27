import { dateOf, isCivil, parts, weekdayIndex } from './civil';
import { isRepeatRule, normalizeRule } from './rule';
import type { ByDay, Civil, RepeatRule, UnsupportedRule, WeekdayCode } from './types';

const DAY_NAMES: Readonly<Record<WeekdayCode, string>> = {
  SU: 'Sunday',
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
};
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const UNITS = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' } as const;

const monthName = (month: number) => MONTHS[month - 1] ?? '';
const short = (name: string) => name.slice(0, 3);
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** "Mon", "Mon and Wed", "Mon, Wed and Fri". */
function list(items: readonly string[], word = 'and'): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${word} ${items.at(-1)}`;
}

/** One name in full, several short: "Tuesday", "Mon and Wed". */
const names = (all: readonly string[], word = 'and') =>
  list(all.length === 1 ? all : all.map(short), word);

/** "the 2nd", "the last", "the 2nd-to-last". */
const position = (n: number) =>
  n > 0 ? `the ${ordinal(n)}` : n === -1 ? 'the last' : `the ${ordinal(-n)}-to-last`;

/** Days in a month or year: "day 26", "days 1 and 15", "the last day", "the 2nd Monday". */
function monthDays(rule: RepeatRule): string {
  const byMonthDay = rule.byMonthDay ?? [];
  const byDay = rule.byDay ?? [];
  const positive = byMonthDay.filter((n) => n > 0).map(String);
  const numbered = [
    ...(positive.length > 0 ? [`${positive.length > 1 ? 'days' : 'day'} ${list(positive)}`] : []),
    ...byMonthDay.filter((n) => n < 0).map((n) => `${position(n)} day`),
  ];
  const weekdays = byDay.map((d) =>
    d.nth === undefined ? `every ${DAY_NAMES[d.day]}` : `${position(d.nth)} ${DAY_NAMES[d.day]}`,
  );
  if (numbered.length > 0 && byDay.length > 0) {
    return `${list(numbered)} if it's a ${names(
      byDay.map((d) => DAY_NAMES[d.day]),
      'or',
    )}`;
  }
  return list(numbered.length > 0 ? numbered : weekdays);
}

function sortDays(byDay: readonly ByDay[], weekStart: WeekdayCode): string[] {
  const offset = (day: WeekdayCode) => (weekdayIndex(day) - weekdayIndex(weekStart) + 7) % 7;
  return [...new Set(byDay.map((d) => d.day))]
    .sort((a, b) => offset(a) - offset(b))
    .map((day) => DAY_NAMES[day]);
}

function schedule(rule: RepeatRule): string {
  const { freq, interval, byDay = [], byMonthDay = [], byMonth = [] } = rule;
  const every = interval === 1 ? `Every ${UNITS[freq]}` : `Every ${interval} ${UNITS[freq]}s`;
  const months = byMonth.map(monthName);
  const inMonths = months.length > 0 ? ` in ${names(months)}` : '';
  const days = sortDays(byDay, rule.weekStart ?? 'SU');
  const plain = byDay.every((d) => d.nth === undefined);
  const weekly = freq === 'weekly' || (freq === 'daily' && interval === 1);
  if (weekly && plain && byMonthDay.length === 0 && interval === 1) {
    if (days.length === 7) return `Every day${inMonths}`;
    if (days.length === 5 && !days.includes('Saturday') && !days.includes('Sunday')) {
      return `Every weekday${inMonths}`;
    }
  }
  if (freq === 'weekly' || (weekly && byDay.length > 0 && byMonthDay.length === 0)) {
    const base = freq === 'daily' ? 'Every week' : every;
    return `${base}${days.length > 0 ? ` on ${names(days)}` : ''}${inMonths}`;
  }
  if (freq === 'daily') {
    const when = [
      ...(days.length > 0 ? [`a ${names(days, 'or')}`] : []),
      ...(byMonthDay.length > 0 ? [`day ${list(byMonthDay.map(String), 'or')} of the month`] : []),
    ];
    return `${every}${when.length > 0 ? ` when it's ${when.join(' and ')}` : ''}${inMonths}`;
  }
  const on = monthDays(rule);
  if (freq === 'monthly') return `${every}${on ? ` on ${on}` : ''}${inMonths}`;
  const [month] = byMonth;
  const [day] = byMonthDay;
  if (byMonth.length === 1 && byMonthDay.length === 1 && byDay.length === 0 && day && day > 0) {
    return `${every} on ${short(monthName(month ?? 1))} ${day}`;
  }
  if (!on) return `${every}${inMonths}`;
  if (months.length === 0) {
    const of = byMonthDay.length > 0 ? ' of every month' : plain ? '' : ' of the year';
    return `${every} on ${on}${of}`;
  }
  return `${every} on ${on}${months.length === 1 ? ` of ${months[0]}` : inMonths}`;
}

function ending(rule: RepeatRule): string {
  if (rule.count !== undefined)
    return rule.count === 1 ? ', once' : `, ${thousands(rule.count)} times`;
  if (rule.until === undefined) return '';
  const [year, month, day] = parts(dateOf(rule.until));
  return `, until ${short(monthName(month))} ${day}, ${year}`;
}

/**
 * The rule in plain words: "Every 2 weeks on Mon and Wed", "Every month on the last Friday, 10
 * times". Pass the series start to name the days a rule leaves to it. Any rule it can't read
 * (unsupported or invalid) is "Custom repeat"; a start that isn't a date or date-time is ignored.
 */
export function describeRepeat(rule: RepeatRule | UnsupportedRule, start?: Civil): string {
  if (!isRepeatRule(rule)) return 'Custom repeat';
  const full = isCivil(start) ? normalizeRule(rule, start) : rule;
  return `${schedule(full)}${ending(full)}`;
}
