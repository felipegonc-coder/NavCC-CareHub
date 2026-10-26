/**
 * Reading numbers and dates that people type or that come from CSV files.
 * Shared by cell editing (values.ts), CSV import (csv/) and forms. Accepts everything
 * formatDecimal and formatDateValue produce, so exports read back unchanged.
 */
import type { CalendarDate, DateValue, Instant, Viewer } from './types';
import { addDays, daysInMonth, todayIn, toCalendarDate, zonedToInstant } from './dates';
import { fitsNumberLimits, normalizeDecimal, shiftDecimal } from './decimal';

// ------------------------------------------------------------------ numbers

const CURRENCY_PREFIX = /^(?:[A-Z]{1,3}\$|R\$|CN¥|[$€£¥₹₩₽₺₪฿₫₱₴₦₡₲₵₸₭₮]|[A-Z]{3}\s?)/;
const CURRENCY_SUFFIX = /\s?(?:[A-Z]{3}|[$€£¥₹₩₽₺₪฿₫₱]|kr|zł|Kč|Ft|lei)$/;
const GROUPED = /^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;

/**
 * "1,234.50", "$12", "-12", "(12)", "($1,234.00)", "€1,234.50", "CHF 12.00", "45%" (→ 0.45), "1e3".
 * Returns the canonical decimal, or null if it isn't a number that fits the Number limits.
 * Commas are only thousands separators: "1,5" is not a number.
 */
export function parseNumberText(text: string): string | null {
  let s = text.trim();
  if (!s) return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  let percent = false;
  if (s.endsWith('%')) {
    percent = true;
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = !negative;
    s = s.slice(1).trim();
  }
  const bare = s.replace(CURRENCY_PREFIX, '').replace(CURRENCY_SUFFIX, '').trim();
  const hadCurrency = bare !== s;
  s = bare;
  if (hadCurrency && !negative && (s.startsWith('-') || s.startsWith('−'))) {
    negative = !negative;
    s = s.slice(1).trim();
  }
  if (s.startsWith('+')) s = s.slice(1);
  if (s.includes(',')) {
    if (!GROUPED.test(s)) return null;
    s = s.replace(/,/g, '');
  }
  if (!/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(s)) return null;
  let d = normalizeDecimal(negative ? `-${s}` : s);
  if (d === null) return null;
  if (percent) d = shiftDecimal(d, -2);
  return fitsNumberLimits(d) ? d : null;
}

// ------------------------------------------------------------------ dates

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export interface DateTextOptions {
  viewer: Pick<Viewer, 'timeZone' | 'now'>;
  /** Read "01/02/2026" as 1 February (the property's format is Day/Month/Year). Default: month first. */
  dayFirst?: boolean;
}

interface Time {
  h: number;
  m: number;
}
type Part = { day: CalendarDate; time: Time | null } | { instant: Instant };

const TIME_RE = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2})(?:\.\d+)?)?\s*(?:([ap])\.?\s?m\.?)?$/i;

/** "3:30 PM", "3 pm", "15:30", "15:30:00". A bare "15" is not a time. */
export function parseTimeText(text: string): Time | null {
  const r = TIME_RE.exec(text.trim());
  if (!r) return null;
  const ap = r[4]?.toLowerCase();
  if (!ap && r[2] === undefined) return null;
  let h = Number(r[1]);
  const m = r[2] === undefined ? 0 : Number(r[2]);
  if (m > 59 || (r[3] !== undefined && Number(r[3]) > 59)) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap === 'p' ? 12 : 0);
  } else if (h > 23) return null;
  return { h, m };
}

function ymd(y: number, m: number, d: number): CalendarDate | null {
  if (
    !Number.isInteger(y) ||
    y < 1 ||
    y > 9999 ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > daysInMonth(y, m)
  )
    return null;
  return toCalendarDate({ y, m, d });
}

function withTime(day: CalendarDate | null, rest: string | undefined): Part | null {
  if (!day) return null;
  if (rest === undefined || rest.trim() === '') return { day, time: null };
  const time = parseTimeText(rest.replace(/^at\s+/i, ''));
  return time ? { day, time } : null;
}

function parsePart(text: string, opts: DateTextOptions): Part | null {
  const s = text.trim().replace(/\s+/g, ' ');
  let r: RegExpExecArray | null;
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : { instant: new Date(t).toISOString() };
  }
  if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](.+))?$/i.exec(s))) {
    return withTime(ymd(Number(r[1]), Number(r[2]), Number(r[3])), r[4]);
  }
  if ((r = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4}),?(?: (.+))?$/.exec(s))) {
    const a = Number(r[1]);
    const b = Number(r[2]);
    return withTime(opts.dayFirst ? ymd(Number(r[3]), b, a) : ymd(Number(r[3]), a, b), r[4]);
  }
  if ((r = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4}),?(?: (.+))?$/i.exec(s))) {
    const m = MONTHS[(r[1] ?? '').toLowerCase()];
    return m ? withTime(ymd(Number(r[3]), m, Number(r[2])), r[4]) : null;
  }
  if ((r = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?,? (\d{4}),?(?: (.+))?$/i.exec(s))) {
    const m = MONTHS[(r[2] ?? '').toLowerCase()];
    return m ? withTime(ymd(Number(r[3]), m, Number(r[1])), r[4]) : null;
  }
  if ((r = /^(today|tomorrow|yesterday)(?: (.+))?$/i.exec(s))) {
    const word = (r[1] ?? '').toLowerCase();
    const today = todayIn(opts.viewer);
    return withTime(addDays(today, word === 'today' ? 0 : word === 'tomorrow' ? 1 : -1), r[2]);
  }
  return null;
}

function toInstant(p: Part, timeZone: string): Instant {
  if ('instant' in p) return p.instant;
  return zonedToInstant(p.day, p.time?.h ?? 0, p.time?.m ?? 0, timeZone);
}

/**
 * Oct 26, 2026 · October 26 2026 · 26 Oct 2026 · 10/26/2026 (26/10/2026 with dayFirst) · 2026-10-26 ·
 * today / tomorrow / yesterday, each with an optional time (3:30 PM, 15:30), an ISO instant, or a range
 * "start → end" (also "->"; the end may be just a time on the start's day). Times are read in the
 * viewer's time zone. Returns null if it can't be read or the end is before the start.
 */
export function parseDateText(text: string, opts: DateTextOptions): DateValue | null {
  const pieces = text.split(/\s*(?:→|->)\s*/);
  if (pieces.length > 2) return null;
  const start = parsePart(pieces[0] ?? '', opts);
  if (!start) return null;
  let end: Part | null = null;
  if (pieces.length === 2) {
    const endText = pieces[1] ?? '';
    const timeOnly = parseTimeText(endText);
    if (timeOnly && 'day' in start) end = { day: start.day, time: timeOnly };
    else end = parsePart(endText, opts);
    if (!end) return null;
  }
  const hasTime =
    'instant' in start ||
    start.time !== null ||
    (end !== null && ('instant' in end || end.time !== null));
  const tz = opts.viewer.timeZone;
  if (hasTime) {
    const a = toInstant(start, tz);
    const b = end ? toInstant(end, tz) : null;
    if (b !== null && b < a) return null;
    return { start: a, end: b === a ? null : b, hasTime: true };
  }
  const a = (start as { day: CalendarDate }).day;
  const b = end ? (end as { day: CalendarDate }).day : null;
  if (b !== null && b < a) return null;
  return { start: a, end: b === a ? null : b, hasTime: false };
}
