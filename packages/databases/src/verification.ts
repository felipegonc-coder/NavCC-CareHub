/**
 * The Verification property (Databases spec 3.4; Knowledge base spec 3.3). Wiki databases only.
 *
 * The knowledge base writes the value (@carehub/extras/knowledge, verificationSchema) through the
 * rows API: Verify stores who, when and until when; Remove verification clears it, and so does an
 * edit when "Editing removes verification" is on. Nothing is saved when it expires: a value reads
 * as Expired from 9:00 AM on its until date, in the viewer's time zone, worked out as it's read.
 * This file reads values for cells, exports, filters, sorts, totals and formulas. Nobody types a
 * verification into a cell: nothing turns into this type (convert.ts), templates, buttons and
 * imports leave it alone, and it's always added as a new property.
 *
 * Like an unticked checkbox, Not verified is a state, not an empty cell: it shows and exports as
 * "Not verified", sorts as the last state (first when descending), counts in totals, and formulas
 * read it as that text.
 */
import {
  DEFAULT_TIME_ZONE,
  formatCalendarDate,
  isCalendarDate,
  isValidTimeZone,
  zonedToInstant,
} from './dates';
import type {
  DatabaseMeta,
  PropertyType,
  VerificationState,
  VerificationValue,
  Viewer,
} from './types';

/** The viewer's moment and time zone, which decide whether a verification has expired. */
export type VerificationClock = Pick<Viewer, 'now' | 'timeZone'>;

/** A verification turns Expired at this hour (9:00 AM) on its until date. */
export const EXPIRY_HOUR = 9;

/** The words for each state, as filters, formulas and totals say them. */
export const VERIFICATION_LABELS: Record<VerificationState, string> = {
  verified: 'Verified',
  expired: 'Expired',
  none: 'Not verified',
};

/** A date and time with Z or an offset, the way the knowledge base writes `verifiedAt`. */
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * True for a value the knowledge base wrote (its verificationSchema): Verified or Expired, who
 * verified it and when, and the until date or null for no end date. Expired always has a date.
 */
export function isVerificationValue(v: unknown): v is VerificationValue {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (o.state !== 'verified' && o.state !== 'expired') return false;
  if (typeof o.verifiedBy !== 'string' || o.verifiedBy === '') return false;
  if (typeof o.verifiedAt !== 'string' || !DATE_TIME_RE.test(o.verifiedAt)) return false;
  if (Number.isNaN(Date.parse(o.verifiedAt))) return false;
  return o.until === null ? o.state === 'verified' : isCalendarDate(o.until);
}

/**
 * The moment a verification turns Expired: 9:00 AM on its until date in `timeZone` (an invalid
 * one means America/Denver). null with no end date: it never expires.
 */
export function verificationExpiresAt(value: VerificationValue, timeZone: string): Date | null {
  if (value.until === null) return null;
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  return new Date(zonedToInstant(value.until, EXPIRY_HOUR, 0, zone));
}

/**
 * Verified, Expired or Not verified ('none') at the viewer's moment: Expired from 9:00 AM on the
 * until date in the viewer's time zone, or when the value is already marked Expired. Anything but
 * a verification is Not verified.
 */
export function verificationState(value: unknown, clock: VerificationClock): VerificationState {
  if (!isVerificationValue(value)) return 'none';
  if (value.state === 'expired') return 'expired';
  const at = verificationExpiresAt(value, clock.timeZone);
  return at !== null && clock.now.getTime() >= at.getTime() ? 'expired' : 'verified';
}

/**
 * The badge as text, for cells, exports and Text conversions: "Verified by Riley Chen until Jan 20,
 * 2027", "Verified by Riley Chen" with no end date, "Verification expired Oct 1, 2026", or "Not
 * verified". Dates keep their year, so an export reads the same in any year. `verifierName` is how
 * the verifier's name shows (undefined when unknown: "Verified until Jan 20, 2027").
 */
export function verificationText(
  value: unknown,
  clock: VerificationClock,
  verifierName: string | undefined,
): string {
  if (!isVerificationValue(value)) return VERIFICATION_LABELS.none;
  const until = value.until === null ? null : formatCalendarDate(value.until, 'full');
  if (until !== null && verificationState(value, clock) === 'expired') {
    return `Verification expired ${until}`;
  }
  const by = verifierName ? ` by ${verifierName}` : '';
  return until === null ? `Verified${by}` : `Verified${by} until ${until}`;
}

/** Only a wiki database (a knowledge base) can have a Verification property. */
export const NOT_WIKI_MESSAGE = 'Only knowledge bases can have a Verification property.';

/**
 * Why a property of this type can't be added to the database, or null when it can: Verification
 * needs a wiki database. Every other type is fine here.
 */
export function wikiOnlyProblem(type: PropertyType, db: Pick<DatabaseMeta, 'wiki'>): string | null {
  return type === 'verification' && db.wiki !== true ? NOT_WIKI_MESSAGE : null;
}
