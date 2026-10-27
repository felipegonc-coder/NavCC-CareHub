/**
 * Date functions. A date without a time starts at the viewer's midnight; parts such as hour() and
 * day() are read in the date's own time zone if it has one, else the viewer's.
 */
import {
  addDays,
  addMonths,
  dayOfWeek,
  epochDays,
  fromEpochDays,
  isCalendarDate,
  isValidDateValue,
  parseCalendarDate,
  startOfDayInstant,
  toCalendarDate,
  todayIn,
  zonedParts,
  zonedToInstant,
} from '../../dates';
import type { ComputedValue, DateValue } from '../../types';
import {
  EMPTY,
  dateMillis,
  defineFunction,
  fail,
  num,
  spendText,
  txt,
  type Call,
  type FunctionDef,
  type Param,
} from '../registry';

const p = (name: string, type: Param['type']): Param => ({ name, type });
const DATE_IN = p('date', 'date');
const define = (def: Omit<FunctionDef, 'kind'>) => defineFunction({ kind: 'dates', ...def });
const zoneOf = (c: Call) => c.ctx.viewer.timeZone;

/** A date result; one that can't be stored (out of range) is empty. */
const dateResult = (v: DateValue): ComputedValue =>
  isValidDateValue(v) ? { kind: 'date', value: v } : EMPTY;

const iso = (ms: number): string =>
  Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : '';

/** Calendar parts of a date's start (or end) on the wall clock. */
interface Wall {
  y: number;
  m: number;
  d: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
  weekday: number;
}

function wall(v: DateValue, timeZone: string, which: 'start' | 'end' = 'start'): Wall {
  const s = which === 'end' ? (v.end ?? v.start) : v.start;
  if (!v.hasTime) {
    const c = parseCalendarDate(s) ?? { y: 1970, m: 1, d: 1 };
    return { ...c, hour: 0, minute: 0, second: 0, ms: 0, weekday: dayOfWeek(toCalendarDate(c)) };
  }
  const t = Date.parse(s);
  return { ...zonedParts(t, v.timeZone ?? timeZone), ms: ((t % 1000) + 1000) % 1000 };
}

const wallMs = (w: Wall) => Date.UTC(w.y, w.m - 1, w.d, w.hour, w.minute, w.second, w.ms);

define({
  name: 'now',
  signatures: [{ params: [], result: 'date' }],
  description: 'The current date and time.',
  example: 'dateBetween(prop("Due"), now(), "days")',
  evaluate: (c) => dateResult({ start: c.ctx.viewer.now.toISOString(), end: null, hasTime: true }),
});

define({
  name: 'today',
  signatures: [{ params: [], result: 'date' }],
  description: "Today's date, without a time.",
  example: 'prop("Due") < today()',
  evaluate: (c) => dateResult({ start: todayIn(c.ctx.viewer), end: null, hasTime: false }),
});

/** ISO week number: weeks start on Monday and week 1 has the year's first Thursday. */
function isoWeek(date: string): number {
  const thursday = epochDays(date) - ((dayOfWeek(date) + 6) % 7) + 3;
  const year = fromEpochDays(thursday).slice(0, 4);
  return Math.floor((thursday - epochDays(`${year}-01-01`)) / 7) + 1;
}

const PARTS: [string, string, (w: Wall) => number][] = [
  ['minute', 'The minute (0–59).', (w) => w.minute],
  ['hour', 'The hour (0–23).', (w) => w.hour],
  [
    'day',
    'The day of the week: 1 is Monday, 7 is Sunday.',
    (w) => (w.weekday === 0 ? 7 : w.weekday),
  ],
  ['date', 'The day of the month (1–31).', (w) => w.d],
  ['week', 'The ISO week of the year (1–53).', (w) => isoWeek(toCalendarDate(w))],
  ['month', 'The month (1–12).', (w) => w.m],
  ['year', 'The year.', (w) => w.y],
];

for (const [name, description, read] of PARTS) {
  define({
    name,
    signatures: [{ params: [DATE_IN], result: 'number' }],
    description,
    example: `${name}(prop("Due"))`,
    evaluate: (c) => {
      const d = c.date(0);
      return d ? num(read(wall(d, zoneOf(c)))) : EMPTY;
    },
  });
}

type Unit =
  | 'years'
  | 'quarters'
  | 'months'
  | 'weeks'
  | 'days'
  | 'hours'
  | 'minutes'
  | 'seconds'
  | 'milliseconds';
const UNIT_NAMES: Unit[] = [
  'years',
  'quarters',
  'months',
  'weeks',
  'days',
  'hours',
  'minutes',
  'seconds',
  'milliseconds',
];
const UNITS = new Map<string, Unit>(
  UNIT_NAMES.flatMap(
    (u) =>
      [
        [u, u],
        [u.slice(0, -1), u],
      ] as [string, Unit][],
  ),
);
const UNIT_MS: Partial<Record<Unit, number>> = {
  weeks: 604_800_000,
  days: 86_400_000,
  hours: 3_600_000,
  minutes: 60_000,
  seconds: 1_000,
  milliseconds: 1,
};
const MONTHS_PER: Partial<Record<Unit, number>> = { years: 12, quarters: 3, months: 1 };

function unitOf(c: Call, i: number): Unit {
  const s = c.text(i) ?? '';
  return (
    UNITS.get(s.trim().toLowerCase()) ??
    fail(
      `"${s}" isn't a date unit. Use years, quarters, months, weeks, days, hours, minutes or seconds.`,
    )
  );
}

const clockUnit = (u: Unit) =>
  u === 'hours' || u === 'minutes' || u === 'seconds' || u === 'milliseconds';

function moveCalendar(date: string, n: number, unit: Unit): string {
  if (unit === 'days' || unit === 'weeks') return addDays(date, unit === 'weeks' ? 7 * n : n);
  return addMonths(date, n * (MONTHS_PER[unit] ?? 1));
}

/** dateAdd: calendar units move the wall-clock date (keeping the time); clock units add exact time. */
export function shiftDate(v: DateValue, amount: number, unit: Unit, timeZone: string): DateValue {
  if (!v.hasTime && !clockUnit(unit)) {
    const move = (s: string) => moveCalendar(s, Math.trunc(amount), unit);
    return { start: move(v.start), end: v.end === null ? null : move(v.end), hasTime: false };
  }
  const zone = v.timeZone ?? timeZone;
  const move = (s: string): string => {
    const t = Date.parse(v.hasTime ? s : startOfDayInstant(s, zone));
    if (clockUnit(unit)) return iso(t + amount * (UNIT_MS[unit] ?? 0));
    const z = zonedParts(t, zone);
    const moved = moveCalendar(toCalendarDate(z), Math.trunc(amount), unit);
    const base = Date.parse(zonedToInstant(moved, z.hour, z.minute, zone));
    return iso(base + z.second * 1000 + (((t % 1000) + 1000) % 1000));
  };
  const out: DateValue = {
    start: move(v.start),
    end: v.end === null ? null : move(v.end),
    hasTime: true,
  };
  if (v.timeZone) out.timeZone = v.timeZone;
  return out;
}

for (const [name, sign] of [
  ['dateAdd', 1],
  ['dateSubtract', -1],
] as const) {
  define({
    name,
    signatures: [{ params: [DATE_IN, p('amount', 'number'), p('unit', 'text')], result: 'date' }],
    description: `${sign > 0 ? 'Adds' : 'Subtracts'} an amount of years, quarters, months, weeks, days, hours, minutes or seconds.`,
    example: `${name}(prop("Due"), 3, "days")`,
    evaluate: (c) => {
      const d = c.date(0);
      const amount = c.number(1);
      const unit = unitOf(c, 2);
      if (!d || amount === null) return EMPTY;
      try {
        return dateResult(shiftDate(d, sign * amount, unit, zoneOf(c)));
      } catch (e) {
        if (e instanceof RangeError) return EMPTY;
        throw e;
      }
    },
  });
}

/** a minus b in whole units, rounded toward zero. Days and longer count on the wall clock. */
export function dateDifference(a: DateValue, b: DateValue, unit: Unit, timeZone: string): number {
  const ms = UNIT_MS[unit];
  if (clockUnit(unit) && ms)
    return Math.trunc((dateMillis(a, timeZone) - dateMillis(b, timeZone)) / ms);
  const wa = wall(a, timeZone);
  const wb = wall(b, timeZone);
  if (ms) return Math.trunc((wallMs(wa) - wallMs(wb)) / ms);
  let months = (wa.y - wb.y) * 12 + (wa.m - wb.m);
  const rest = (w: Wall) => wallMs({ ...w, y: 2000, m: 1 });
  if (months > 0 && rest(wa) < rest(wb)) months--;
  if (months < 0 && rest(wa) > rest(wb)) months++;
  return Math.trunc(months / (MONTHS_PER[unit] ?? 1));
}

define({
  name: 'dateBetween',
  signatures: [{ params: [p('a', 'date'), p('b', 'date'), p('unit', 'text')], result: 'number' }],
  description:
    'How many whole units from the second date to the first (negative when the first is earlier).',
  example: 'dateBetween(prop("Due"), today(), "days")',
  evaluate: (c) => {
    const a = c.date(0);
    const b = c.date(1);
    const unit = unitOf(c, 2);
    return a && b ? num(dateDifference(a, b, unit, zoneOf(c))) : EMPTY;
  },
});

define({
  name: 'dateRange',
  signatures: [{ params: [p('start', 'date'), p('end', 'date')], result: 'date' }],
  description: 'A date range from the start of one date to the start of another.',
  example: 'dateRange(prop("Start"), prop("Due"))',
  evaluate: (c) => {
    const a = c.date(0);
    const b = c.date(1);
    if (!a || !b) return EMPTY;
    const hasTime = a.hasTime || b.hasTime;
    const tz = zoneOf(c);
    const at = (v: DateValue) => (hasTime && !v.hasTime ? startOfDayInstant(v.start, tz) : v.start);
    const [start, end] = dateMillis(a, tz) <= dateMillis(b, tz) ? [at(a), at(b)] : [at(b), at(a)];
    return dateResult({ start, end, hasTime });
  },
});

for (const [name, which] of [
  ['dateStart', 'start'],
  ['dateEnd', 'end'],
] as const) {
  define({
    name,
    signatures: [{ params: [DATE_IN], result: 'date' }],
    description: `The ${which} of a date range (the date itself when it has no end).`,
    example: `${name}(prop("Dates"))`,
    evaluate: (c) => {
      const d = c.date(0);
      if (!d) return EMPTY;
      const out: DateValue = {
        start: which === 'end' ? (d.end ?? d.start) : d.start,
        end: null,
        hasTime: d.hasTime,
      };
      if (d.timeZone) out.timeZone = d.timeZone;
      return dateResult(out);
    },
  });
}

define({
  name: 'timestamp',
  signatures: [{ params: [DATE_IN], result: 'number' }],
  description: 'Milliseconds since Jan 1, 1970 (UTC).',
  example: 'timestamp(now())',
  evaluate: (c) => {
    const d = c.date(0);
    return d ? num(dateMillis(d, zoneOf(c))) : EMPTY;
  },
});

define({
  name: 'fromTimestamp',
  signatures: [{ params: [p('milliseconds', 'number')], result: 'date' }],
  description: 'The date and time a number of milliseconds after Jan 1, 1970 (UTC).',
  example: 'fromTimestamp(1793037600000)',
  evaluate: (c) => {
    const ms = c.number(0);
    return ms === null
      ? EMPTY
      : dateResult({ start: iso(Math.trunc(ms)), end: null, hasTime: true });
  },
});

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
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TOKENS = /\[([^\]]*)]|YYYY|YY|Q|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|A|a/g;
const two = (n: number) => String(n).padStart(2, '0');

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** formatDate tokens: YYYY YY Q MMMM MMM MM M Do DD D dddd ddd HH H hh h mm m ss A a; [text] stays as is. */
export function formatWall(w: Wall, format: string): string {
  const h12 = w.hour % 12 || 12;
  const month = MONTHS[w.m - 1] ?? '';
  const weekday = WEEKDAYS[w.weekday] ?? '';
  const values: Record<string, string> = {
    YYYY: String(w.y).padStart(4, '0'),
    YY: two(w.y % 100),
    Q: String(Math.ceil(w.m / 3)),
    MMMM: month,
    MMM: month.slice(0, 3),
    MM: two(w.m),
    M: String(w.m),
    Do: ordinal(w.d),
    DD: two(w.d),
    D: String(w.d),
    dddd: weekday,
    ddd: weekday.slice(0, 3),
    HH: two(w.hour),
    H: String(w.hour),
    hh: two(h12),
    h: String(h12),
    mm: two(w.minute),
    m: String(w.minute),
    ss: two(w.second),
    A: w.hour < 12 ? 'AM' : 'PM',
    a: w.hour < 12 ? 'am' : 'pm',
  };
  return format.replace(
    TOKENS,
    (token: string, literal: string | undefined) => literal ?? values[token] ?? token,
  );
}

define({
  name: 'formatDate',
  signatures: [{ params: [DATE_IN, p('format', 'text')], result: 'text' }],
  description: 'A date as text in a format such as "MMMM D, YYYY" or "YYYY-MM-DD h:mm A".',
  example: 'formatDate(prop("Due"), "MMM D")',
  evaluate: (c) => {
    const d = c.date(0);
    if (!d) return EMPTY;
    // At most a few characters per format character, so it's counted once it's made.
    const s = formatWall(wall(d, zoneOf(c)), c.text(1) ?? '');
    spendText(s.length);
    return txt(s);
  },
});

const DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** "2026-10-26", "2026-10-26T14:30" (the viewer's time zone), or with Z or an offset; else empty. */
export function parseDateText(text: string, timeZone: string): DateValue | null {
  const s = text.trim();
  if (isCalendarDate(s)) return { start: s, end: null, hasTime: false };
  const m = DATE_TIME.exec(s);
  if (!m || !isCalendarDate(m[1])) return null;
  const [, date = '', hh = '0', mm = '0', ss = '0', frac = '0', zone] = m;
  const extra = Number(ss) * 1000 + Number(frac.padEnd(3, '0'));
  if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) return null;
  let t: number;
  if (zone) {
    const offset = zone === 'Z' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
    t = Date.parse(`${date}T${hh}:${mm}:00${offset}`) + extra;
  } else {
    t = Date.parse(zonedToInstant(date, Number(hh), Number(mm), timeZone)) + extra;
  }
  const start = iso(t);
  return start ? { start, end: null, hasTime: true } : null;
}

define({
  name: 'parseDate',
  signatures: [{ params: [p('text', 'text')], result: 'date' }],
  description: 'A date from text like "2026-10-26" or "2026-10-26T14:30"; other text gives empty.',
  example: 'parseDate("2026-10-26")',
  evaluate: (c) => {
    const d = parseDateText(c.text(0) ?? '', zoneOf(c));
    return d ? dateResult(d) : EMPTY;
  },
});
