// Reviews: which pages need one, when the Monday summary goes out, and the health line's numbers.
import { KB_LIMITS, KB_NOTICE_TIME } from './constants';
import { dayOfWeek, daysBetween, todayIn, zonedInstant, type CivilDate } from './time';
import type { Verification } from './verification';

/** Expired, or verified with an until date in the next 14 days (today included). */
export function isDueForReview(value: Verification | null, today: CivilDate): boolean {
  if (!value) return false;
  if (value.state === 'expired') return true;
  return value.until !== null && daysBetween(today, value.until) <= KB_LIMITS.reviewWindowDays;
}

/** The Needs review view: due for review, or without an owner. */
export function needsReview(value: Verification | null, ownerCount: number, today: CivilDate) {
  return ownerCount === 0 || isDueForReview(value, today);
}

/**
 * Whether an owner's weekly summary is due: it's Monday, 9:00 AM has passed in their time zone,
 * and this Monday's summary hasn't gone out yet. A missed Monday waits for the next one.
 */
export function isSummaryDue(now: Date, timeZone: string, lastSentAt: Date | null): boolean {
  const today = todayIn(timeZone, now);
  if (dayOfWeek(today) !== 1) return false;
  const at = zonedInstant(today, KB_NOTICE_TIME, timeZone).getTime();
  return now.getTime() >= at && (lastSentAt === null || lastSentAt.getTime() < at);
}

export interface HealthCounts {
  /** Every page in the knowledge base (the All pages view). */
  pages: number;
  verified: number;
  expired: number;
  openReports: number;
}

/** Whole percent, rounded down so 100% means every page. Null for an empty knowledge base. */
export function verifiedPercent(counts: HealthCounts): number | null {
  return counts.pages === 0 ? null : Math.floor((counts.verified / counts.pages) * 100);
}
