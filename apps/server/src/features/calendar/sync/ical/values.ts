// iCalendar value types (RFC 5545 section 3.3) and the civil date arithmetic they need.
// Wall-clock values are kept as "civil" milliseconds: the wall time read as if it were UTC.

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

export interface Civil {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** Civil milliseconds for a wall-clock time (works for every year, unlike `Date.UTC`). */
export function civilToMs({ year, month, day, hour, minute }: Civil): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, 0, 0);
  return date.getTime();
}

export function msToCivil(ms: number): Civil {
  const date = new Date(ms);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

export function daysInMonth(year: number, month: number): number {
  return msToCivil(civilToMs({ year, month: month + 1, day: 0, hour: 0, minute: 0 })).day;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(year: number, month: number, day: number): number {
  return new Date(civilToMs({ year, month, day, hour: 0, minute: 0 })).getUTCDay();
}

/** 'YYYY-MM-DD' */
export function formatDate(c: Civil): string {
  return `${pad(c.year, 4)}-${pad(c.month)}-${pad(c.day)}`;
}

/** 'YYYY-MM-DDTHH:mm' */
export function formatDateTime(c: Civil): string {
  return `${formatDate(c)}T${pad(c.hour)}:${pad(c.minute)}`;
}

/** ISO instant with zero seconds, as `toISOString()` writes it. */
export function formatInstant(ms: number): string {
  return new Date(Math.floor(ms / MINUTE_MS) * MINUTE_MS).toISOString();
}

/** Reads 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' (the wall-clock strings used across Care Hub). */
export function parseCivil(text: string): Civil | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(text);
  if (!m) return undefined;
  return validCivil(+m[1]!, +m[2]!, +m[3]!, Number(m[4] ?? 0), Number(m[5] ?? 0));
}

function validCivil(year: number, month: number, day: number, hour: number, minute: number) {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  if (hour > 23 || minute > 59) return undefined;
  return { year, month, day, hour, minute };
}

export interface IcalDateTime {
  civil: Civil;
  seconds: number; // kept apart: event times drop them, LAST-MODIFIED keeps them
  dateOnly: boolean;
  utc: boolean;
}

/**
 * Reads a DATE ('20261027') or DATE-TIME ('20261027T100000', with 'Z' for UTC) value.
 * Seconds are dropped. Lenient: seconds may be missing, and 24:00 means the next midnight.
 */
export function parseIcalDateTime(value: string): IcalDateTime | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(value.trim());
  if (!m) return undefined;
  const [year, month, day] = [+m[1]!, +m[2]!, +m[3]!];
  if (m[4] === undefined) {
    const civil = validCivil(year, month, day, 0, 0);
    return civil && { civil, seconds: 0, dateOnly: true, utc: false };
  }
  const [minute, seconds] = [+m[5]!, Number(m[6] ?? 0)];
  const midnight = +m[4] === 24 && minute === 0 && seconds === 0; // 24:00 is the next 00:00
  const hour = midnight ? 0 : +m[4];
  const shift = midnight ? DAY_MS : 0;
  const civil = validCivil(year, month, day, hour, minute);
  if (!civil || seconds > 60) return undefined;
  const utc = m[7] !== undefined;
  return {
    civil: msToCivil(civilToMs(civil) + shift),
    seconds,
    dateOnly: false,
    utc,
  };
}

/** 'YYYYMMDD' */
export function formatIcalDate(c: Civil): string {
  return `${pad(c.year, 4)}${pad(c.month)}${pad(c.day)}`;
}

/** 'YYYYMMDDTHHMMSS', seconds always 00 unless given. */
export function formatIcalDateTime(c: Civil, seconds = 0): string {
  return `${formatIcalDate(c)}T${pad(c.hour)}${pad(c.minute)}${pad(seconds)}`;
}

/** A UTC instant in iCalendar form: '20261027T160000Z'. */
export function formatIcalUtc(ms: number, keepSeconds = false): string {
  const seconds = keepSeconds ? new Date(ms).getUTCSeconds() : 0;
  return `${formatIcalDateTime(msToCivil(ms), seconds)}Z`;
}

export interface Duration {
  sign: 1 | -1;
  days: number; // nominal: weeks and days
  seconds: number; // exact: hours, minutes and seconds
}

/** Reads a DURATION value such as 'PT1H30M', 'P1D' or '-P2W' (RFC 5545 3.3.6). */
export function parseDuration(value: string): Duration | undefined {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(
    value.trim(),
  );
  if (!m || /T$/i.test(value.trim()) || !/\d/.test(value)) return undefined;
  const n = (i: number) => Number(m[i] ?? 0);
  return {
    sign: m[1] === '-' ? -1 : 1,
    days: n(2) * 7 + n(3),
    seconds: n(4) * 3600 + n(5) * 60 + n(6),
  };
}

/** Reads a UTC offset such as '-0700' or '+053000' into minutes (east is positive). */
export function parseUtcOffset(value: string): number | undefined {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(value.trim());
  if (!m || +m[3]! > 59) return undefined;
  const minutes = +m[2]! * 60 + +m[3]! + Math.round(Number(m[4] ?? 0) / 60);
  return m[1] === '-' ? -minutes : minutes;
}

export function formatUtcOffset(minutes: number): string {
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}
