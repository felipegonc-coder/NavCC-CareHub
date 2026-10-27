import type { IsoDate } from '../format/index';
import { addMonths, daysBetween } from '../util/index';

/** Where a certificate stands on a given day. */
export type CertificateStatus = 'valid' | 'expiring_soon' | 'expired';

/**
 * The day a certificate stops being valid: `issuedOn` plus `validForMonths` calendar months
 * (Jan 31 + 1 month = the last day of February). Null when the course sets no expiry.
 */
export function certificateExpiry(
  issuedOn: IsoDate,
  validForMonths?: number | null,
): IsoDate | null {
  if (validForMonths === undefined || validForMonths === null) return null;
  if (!Number.isInteger(validForMonths) || validForMonths < 1) {
    throw new RangeError('validForMonths must be a whole number of months, at least 1');
  }
  return addMonths(issuedOn, validForMonths);
}

/**
 * "expired" from the expiry day on, "expiring_soon" within `headsUpDays` days before it,
 * otherwise "valid". A certificate without an expiry is always valid.
 */
export function certificateStatus(
  cert: { readonly expiresOn?: IsoDate | null },
  today: IsoDate,
  headsUpDays = 30,
): CertificateStatus {
  if (cert.expiresOn === undefined || cert.expiresOn === null) return 'valid';
  const daysLeft = daysBetween(today, cert.expiresOn);
  if (daysLeft <= 0) return 'expired';
  return daysLeft <= headsUpDays ? 'expiring_soon' : 'valid';
}
