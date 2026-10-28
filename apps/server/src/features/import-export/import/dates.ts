import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  parseCalendarDate,
  zonedToInstant,
} from '@carehub/databases';
import type { PlanDates } from '@carehub/extras/import-export/import/index';

// The dates a source gives for its items (PlanDates), as Updates keeps them (spec 3.1).

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/;
const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i;

/** The person's time zone when Intl knows it, otherwise Care Hub's default. */
export const usableTimeZone = (timeZone: string) =>
  isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;

/**
 * A date stays a date (2021-03-03); a date and time becomes a moment in UTC, read in `timeZone`
 * when it has no zone. Null when it isn't one.
 */
export function importedWhen(value: string, timeZone: string): string | null {
  if (DATE.test(value)) return parseCalendarDate(value) ? value : null;
  const local = LOCAL.exec(value);
  if (local) {
    const [, date = '', hour = '', minute = '', second = '0', fraction = '0'] = local;
    const [h, m, s] = [Number(hour), Number(minute), Number(second)];
    if (!parseCalendarDate(date) || h > 23 || m > 59 || s > 59) return null;
    const start = Date.parse(zonedToInstant(date, h, m, timeZone));
    return new Date(start + Math.floor((s + Number(fraction)) * 1000)).toISOString();
  }
  if (!ZONED.test(value) || !parseCalendarDate(value.slice(0, 10))) return null;
  const moment = Date.parse(value);
  return Number.isNaN(moment) ? null : new Date(moment).toISOString();
}

/** An item's dates as Updates keeps them; null when it has none worth keeping. */
export function importedDates(
  item: PlanDates,
  timeZone: string,
): { created?: string; updated?: string } | null {
  const created = item.created === undefined ? null : importedWhen(item.created, timeZone);
  const updated = item.updated === undefined ? null : importedWhen(item.updated, timeZone);
  if (created === null && updated === null) return null;
  return { ...(created === null ? {} : { created }), ...(updated === null ? {} : { updated }) };
}
