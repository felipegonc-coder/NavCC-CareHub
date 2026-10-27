// Uptime from heartbeats (Status page spec, section 3). The server records one heartbeat a minute;
// a missing minute counts as down. Heartbeats arrive here as runs of consecutive minutes.
import { DAY_MINUTES, MINUTE_MS, addDays, civilDate, epochMinute, startOfDay } from './time';

/**
 * A run of whole minutes, [start, end), as minute numbers counted from the Unix epoch (what
 * `floor(extract(epoch from minute) / 60)` gives in SQL), such as the minutes with a heartbeat.
 */
export interface MinuteSpan {
  start: number;
  end: number;
}

/** Uptime covers the last 30 days, or the time since installation if that's shorter. */
export const UPTIME_DAYS = 30;

export interface UptimeWindow {
  /** Where the window starts: 30 days ago or installation, whichever is later. */
  from: Date;
  /**
   * Where the window ends, exclusive: the current minute, whose heartbeat may still be coming. In
   * the first minute after installation, the end of that minute once its heartbeat is in.
   */
  to: Date;
  upMinutes: number;
  totalMinutes: number;
  /** Null until the first heartbeat is in. */
  percent: number | null;
}

export interface DayUptime {
  /** Civil date in the viewer's time zone. */
  date: string;
  upMinutes: number;
  /** Minutes of the day that are measured: none before installation, and today only up to now. */
  totalMinutes: number;
  percent: number | null;
}

export interface UptimeOptions {
  now: Date;
  /** When the server first ran (its first heartbeat), or null if it never has. */
  installedAt: Date | null;
}

/** The current minute and the first measured minute, as minute numbers. */
function bounds(options: UptimeOptions): { first: number; to: number } {
  const to = epochMinute(options.now.getTime());
  const first = options.installedAt ? epochMinute(options.installedAt.getTime()) : to;
  return { first, to };
}

/** Sorted, with empty runs dropped and overlapping or touching runs merged. */
export function normalizeSpans(spans: readonly MinuteSpan[]): MinuteSpan[] {
  const sorted = spans
    .filter((span) => span.end > span.start)
    .toSorted((a, b) => a.start - b.start);
  const merged: MinuteSpan[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ start: span.start, end: span.end });
  }
  return merged;
}

/** Minutes in [from, to) with a heartbeat. `spans` must be normalized. */
function minutesUp(spans: readonly MinuteSpan[], from: number, to: number): number {
  let total = 0;
  for (const span of spans) {
    total += Math.max(0, Math.min(span.end, to) - Math.max(span.start, from));
  }
  return total;
}

/**
 * Minutes up ÷ minutes measured, in percent with two decimals, rounded half up. Rounding never
 * reaches 100 while a minute is missing: 1 missed minute in 30 days is 99.99, not 100.00.
 */
export function uptimePercent(up: number, total: number): number | null {
  if (total <= 0) return null;
  if (up >= total) return 100;
  // Integer arithmetic, so 43 missed minutes in 30 days is exactly 99.90.
  const hundredths = Math.floor((Math.max(0, up) * 20_000 + total) / (2 * total));
  return Math.min(hundredths, 9_999) / 100;
}

/**
 * Uptime over the last 30 days, or since installation, up to the start of the current minute.
 * Until a whole minute has passed since installation, the current minute counts once its
 * heartbeat is in, so a new server shows 100% from its first heartbeat.
 */
export function uptimeOverWindow(
  spans: readonly MinuteSpan[],
  options: UptimeOptions,
): UptimeWindow {
  const merged = normalizeSpans(spans);
  const { first, to } = bounds(options);
  const end = to === first && minutesUp(merged, to, to + 1) > 0 ? to + 1 : to;
  const from = Math.min(end, Math.max(end - UPTIME_DAYS * DAY_MINUTES, first));
  const up = minutesUp(merged, from, end);
  return {
    from: new Date(from * MINUTE_MS),
    to: new Date(end * MINUTE_MS),
    upMinutes: up,
    totalMinutes: end - from,
    percent: uptimePercent(up, end - from),
  };
}

/**
 * Uptime for each of the last `days` civil days in `timeZone` (30 by default), oldest first and
 * ending today. Days follow the zone's own lengths (23 or 25 hours when the clocks change), the day
 * of installation counts from installation, and today counts up to the current minute.
 */
export function uptimeByDay(
  spans: readonly MinuteSpan[],
  options: UptimeOptions & { timeZone: string; days?: number },
): DayUptime[] {
  const merged = normalizeSpans(spans);
  const { first, to } = bounds(options);
  const days = options.days ?? UPTIME_DAYS;
  let date = addDays(civilDate(options.now.getTime(), options.timeZone), 1 - days);
  let dayStart = epochMinute(startOfDay(date, options.timeZone));
  const result: DayUptime[] = [];
  for (let i = 0; i < days; i += 1) {
    const next = addDays(date, 1);
    const nextStart = epochMinute(startOfDay(next, options.timeZone));
    const from = Math.max(dayStart, first);
    const total = Math.max(0, Math.min(nextStart, to) - from);
    const up = total > 0 ? minutesUp(merged, from, from + total) : 0;
    result.push({ date, upMinutes: up, totalMinutes: total, percent: uptimePercent(up, total) });
    date = next;
    dayStart = nextStart;
  }
  return result;
}
