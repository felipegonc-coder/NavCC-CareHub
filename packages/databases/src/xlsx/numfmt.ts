/**
 * Excel number formats that show dates and times, and Excel's day numbers ("serials") as the ISO
 * text CSV import reads: "2026-10-26", "2026-10-26 14:30", or "14:30" for a time of day. Other
 * numbers become plain decimals with Excel's 15 significant digits.
 */
import { fromEpochDays } from '../dates';
import { normalizeDecimal } from '../decimal';

/** How a format shows a number: a date, a date and time, a time of day, or elapsed time ([h]:mm). */
export type DateStyle = 'date' | 'datetime' | 'time' | 'duration';

/** Built-in format ids for dates and times (ECMA-376 part 1, 18.8.30), with the East Asian date ids. */
const BUILT_IN = new Map<number, DateStyle>([
  ...[14, 15, 16, 17, 27, 28, 29, 30, 31, 34, 35, 36].map((id) => [id, 'date'] as const),
  ...[50, 51, 52, 53, 54, 55, 56, 57, 58].map((id) => [id, 'date'] as const),
  ...[18, 19, 20, 21, 32, 33, 45, 47].map((id) => [id, 'time'] as const),
  [22, 'datetime'],
  [46, 'duration'],
]);

/** The date style of a built-in format id, or null for the number ones (0 General, 10 0.00%...). */
export function builtInDateStyle(id: number): DateStyle | null {
  return BUILT_IN.get(id) ?? null;
}

/**
 * The date style of a custom format code, read from its first section: d or y, or m not next to
 * h or s, is a date; h, s, or m after h or before s is a time; [h], [m] or [s] alone is elapsed
 * time. Quoted text, escaped characters, colors, locales, "General" and AM/PM don't count, so
 * "0.00", "#,##0 \"days\"" and "[Red]0%" are plain numbers.
 */
export function dateStyleOf(code: string): DateStyle | null {
  let s = '';
  let elapsed = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code.charAt(i);
    if (ch === ';') break;
    if (ch === '"') {
      const e = code.indexOf('"', i + 1);
      i = e < 0 ? code.length : e;
    } else if (ch === '\\' || ch === '_' || ch === '*') {
      i++;
    } else if (ch === '[') {
      const e = code.indexOf(']', i + 1);
      const inner = code.slice(i + 1, e < 0 ? code.length : e).toLowerCase();
      if (/^(?:h+|m+|s+)$/.test(inner)) {
        elapsed = true;
        s += ` ${inner.charAt(0)} `;
      }
      i = e < 0 ? code.length : e;
    } else {
      s += ch.toLowerCase();
    }
  }
  const tokens = s.replace(/general|am\/pm|a\/p/g, ' ').match(/[dmyhs]+/g) ?? [];
  let date = false;
  let time = false;
  for (let k = 0; k < tokens.length; k++) {
    const c = tokens[k]?.charAt(0);
    if (c === 'd' || c === 'y') date = true;
    else if (c === 'h' || c === 's') time = true;
    else if (tokens[k - 1]?.startsWith('h') || tokens[k + 1]?.startsWith('s')) time = true;
    else date = true;
  }
  if (date) return time ? 'datetime' : 'date';
  return elapsed ? 'duration' : time ? 'time' : null;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** "14:30", or "14:30:15" when there are seconds. */
function clock(seconds: number, hours = Math.floor(seconds / 3600)): string {
  const s = seconds % 60;
  return `${pad(hours)}:${pad(Math.floor(seconds / 60) % 60)}${s ? `:${pad(s)}` : ''}`;
}

/** Day 1 is 1900-01-01; day 60 is Excel's 1900-02-29, which never was (a Lotus 1-2-3 bug it kept). */
const LAST_DAY_1900 = 2_958_465; // 9999-12-31
/** In the 1904 system (older Mac workbooks), day 0 is 1904-01-01, 1,462 days after day 0 of 1900. */
const DAYS_1904 = 1_462;

/** The calendar date of a whole day number, or null outside 1900 (or 1904) to 9999. */
function serialDate(day: number, date1904: boolean): string | null {
  const d = date1904 ? day + DAYS_1904 : day;
  if (d < (date1904 ? DAYS_1904 : 1) || d > LAST_DAY_1900) return null;
  if (d === 60) return '1900-02-29';
  return fromEpochDays(d - (d < 60 ? 25_568 : 25_569));
}

/**
 * An Excel serial shown with a date style, rounded to the second: "2026-10-26" for dates,
 * "2026-10-26 14:30" for dates with times, "14:30" for times of day and "36:00" for elapsed time.
 * Null when it isn't a date Excel can show (negative, or past 9999), so it stays a number.
 * Day 60 of the 1900 system is written "1900-02-29", as Excel shows it.
 */
export function serialText(serial: number, style: DateStyle, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  const total = Math.round(serial * 86_400);
  if (style === 'duration') return clock(total);
  const seconds = total % 86_400;
  if (style === 'time') return clock(seconds);
  const day = serialDate(Math.floor(total / 86_400), date1904);
  if (style === 'date') return day;
  if (day === null) return total < 86_400 && !date1904 ? clock(seconds) : null;
  return `${day} ${clock(seconds)}`;
}

/**
 * A number as plain decimal text with up to 15 significant digits, as Excel shows it: a saved
 * 0.30000000000000004 reads "0.3" and 1.5E-3 reads "0.0015". Text that isn't a number is kept.
 */
export function numberText(value: string): string {
  const n = Number(value);
  if (!value.trim() || !Number.isFinite(n)) return value;
  return normalizeDecimal(n.toPrecision(15)) ?? value;
}
