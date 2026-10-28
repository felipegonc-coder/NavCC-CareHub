// The Verification property: who verified a page, when, and until when. A page with no value is
// Not verified. This file is the only place that reads or writes the stored value.
import { z } from 'zod';
import { KB_NOTICE_TIME } from './constants';
import { addDays, addMonths, daysBetween, isCivilDate, zonedInstant, type CivilDate } from './time';

export const VERIFY_PERIODS = ['1w', '30d', '90d', '6m', '1y', 'none'] as const;
export type VerifyPeriod = (typeof VERIFY_PERIODS)[number];
export const DEFAULT_VERIFY_PERIOD: VerifyPeriod = '90d';

const PERIOD_WORDS: Readonly<Record<VerifyPeriod, string>> = {
  '1w': '1 week',
  '30d': '30 days',
  '90d': '90 days',
  '6m': '6 months',
  '1y': '1 year',
  none: 'no end date',
};

/** The verify menu's items, also used by the review bar for the default period. */
export function verifyLabel(period: VerifyPeriod): string {
  return period === 'none' ? 'Verify with no end date' : `Verify for ${PERIOD_WORDS[period]}`;
}

export const VERIFY_UNTIL_LABEL = 'Verify until a date…';
export const REMOVE_VERIFICATION_LABEL = 'Remove verification';
/** The furthest "until a date" can be. */
export const MAX_VERIFY_MONTHS = 120;

/** The until date for a period that starts today; null means no end date. */
export function untilFor(period: VerifyPeriod, today: CivilDate): CivilDate | null {
  switch (period) {
    case '1w':
      return addDays(today, 7);
    case '30d':
      return addDays(today, 30);
    case '90d':
      return addDays(today, 90);
    case '6m':
      return addMonths(today, 6);
    case '1y':
      return addMonths(today, 12);
    case 'none':
      return null;
  }
}

/**
 * "Until a date" must be after today and within ten years. `pastDates` (the server's test hook,
 * only with CAREHUB_TEST_HOOKS=1) also allows today and earlier days, so a test can make a page
 * expire without waiting.
 */
export function isAllowedUntil(
  until: CivilDate,
  today: CivilDate,
  { pastDates = false }: { pastDates?: boolean } = {},
): boolean {
  return (
    (pastDates || daysBetween(today, until) >= 1) && until <= addMonths(today, MAX_VERIFY_MONTHS)
  );
}

export const civilDateSchema = z
  .string()
  .refine(isCivilDate, { error: 'Use a date like 2026-10-27.' });

export const verificationSchema = z
  .object({
    state: z.enum(['verified', 'expired']),
    verifiedBy: z.string().min(1),
    verifiedAt: z.iso.datetime({ offset: true }),
    until: civilDateSchema.nullable(),
  })
  .refine((value) => value.state === 'verified' || value.until !== null);

export type Verification = z.infer<typeof verificationSchema>;
export type VerificationState = Verification['state'] | 'none';

/** Reads a stored value; anything unreadable counts as Not verified. */
export function readVerification(raw: unknown): Verification | null {
  const parsed = verificationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function verificationState(value: Verification | null): VerificationState {
  return value?.state ?? 'none';
}

export function newVerification(by: string, at: Date, until: CivilDate | null): Verification {
  return { state: 'verified', verifiedBy: by, verifiedAt: at.toISOString(), until };
}

/** When a verified page turns Expired: 9:00 AM on the until date in the owner's time zone. */
export function expiresAt(value: Verification, timeZone: string): Date | null {
  return value.until === null ? null : zonedInstant(value.until, KB_NOTICE_TIME, timeZone);
}

export function shouldExpire(value: Verification | null, timeZone: string, now: Date): boolean {
  if (value?.state !== 'verified') return false;
  const at = expiresAt(value, timeZone);
  return at !== null && now.getTime() >= at.getTime();
}

export function expired(value: Verification): Verification {
  return { ...value, state: 'expired' };
}
