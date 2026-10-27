import { isoDateInTimeZone } from '@carehub/learning';

/**
 * Learning's calendar day (decision 0317). Due dates, "overdue", "due soon" and "expiring soon" go
 * by today in this zone, the same day for everyone, never by a person's profile time zone.
 */
export const LEARNING_DAY_ZONE = 'America/Denver';

/** Today in LEARNING_DAY_ZONE, as `YYYY-MM-DD`. */
export function learningToday(now: Date = new Date()): string {
  return isoDateInTimeZone(now.toISOString(), LEARNING_DAY_ZONE);
}
