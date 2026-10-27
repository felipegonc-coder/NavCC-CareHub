// Words and numbers on the Status page.
import type { DayUptime, Viewer } from './api';

const dayName = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});
const dayPercent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** A day's bar, as shown on hover and focus and read by screen readers: "October 12: 99.2%". */
export function dayLabel(day: DayUptime): string {
  const name = dayName.format(new Date(`${day.date}T12:00:00Z`));
  return `${name}: ${day.percent === null ? 'no data' : `${dayPercent.format(day.percent)}%`}`;
}

export type DayTone = 'good' | 'fair' | 'poor' | 'none';

/** Green at 99.9% or more, amber at 99% or more, otherwise red; days before installation are grey. */
export function dayTone(percent: number | null): DayTone {
  if (percent === null) return 'none';
  if (percent >= 99.9) return 'good';
  return percent >= 99 ? 'fair' : 'poor';
}

/** The 30-day uptime, to two decimal places: "99.90%". */
export function uptimeText(percent: number): string {
  return `${percent.toFixed(2)}%`;
}

/** "Oct 26, 2:00 AM", in the viewer's time zone and clock. */
export function timeText(iso: string, viewer: Pick<Viewer, 'timeZone' | 'use24h'>): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: viewer.use24h ? 'h23' : 'h12',
    timeZone: viewer.timeZone,
  }).format(new Date(iso));
}

const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'];

/** "1.2 GB" */
export function sizeText(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: unit === 0 ? 0 : 1 });
  return `${number.format(value)} ${UNITS[unit]}`;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "5 minutes", "1 hour 20 minutes" */
export function minutesText(minutes: number): string {
  if (minutes < 60) return count(minutes, 'minute', 'minutes');
  const hours = count(Math.floor(minutes / 60), 'hour', 'hours');
  return minutes % 60 === 0 ? hours : `${hours} ${count(minutes % 60, 'minute', 'minutes')}`;
}
