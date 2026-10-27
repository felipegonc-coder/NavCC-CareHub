import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VERIFY_PERIOD,
  VERIFY_PERIODS,
  expired,
  expiresAt,
  isAllowedUntil,
  newVerification,
  readVerification,
  shouldExpire,
  untilFor,
  verificationState,
  verifyLabel,
} from './verification';

const RILEY = '6f1c2b9e-4d3a-4e5f-9a8b-1c2d3e4f5a6b';

describe('verify periods', () => {
  it('labels the menu, with 90 days as the default', () => {
    expect(VERIFY_PERIODS.map(verifyLabel)).toEqual([
      'Verify for 1 week',
      'Verify for 30 days',
      'Verify for 90 days',
      'Verify for 6 months',
      'Verify for 1 year',
      'Verify with no end date',
    ]);
    expect(DEFAULT_VERIFY_PERIOD).toBe('90d');
  });

  it('works out the until date from today', () => {
    expect(untilFor('1w', '2026-10-27')).toBe('2026-11-03');
    expect(untilFor('30d', '2026-10-27')).toBe('2026-11-26');
    expect(untilFor('90d', '2026-10-27')).toBe('2027-01-25');
    expect(untilFor('6m', '2026-10-27')).toBe('2027-04-27');
    expect(untilFor('1y', '2026-10-27')).toBe('2027-10-27');
    expect(untilFor('none', '2026-10-27')).toBeNull();
  });

  it('allows until dates after today and within ten years', () => {
    expect(isAllowedUntil('2026-10-28', '2026-10-27')).toBe(true);
    expect(isAllowedUntil('2026-10-27', '2026-10-27')).toBe(false);
    expect(isAllowedUntil('2036-10-27', '2026-10-27')).toBe(true);
    expect(isAllowedUntil('2036-10-28', '2026-10-27')).toBe(false);
  });
});

describe('stored verification', () => {
  const verified = newVerification(RILEY, new Date('2026-10-27T16:00:00Z'), '2027-01-25');

  it('reads what it writes and treats anything else as Not verified', () => {
    expect(readVerification(JSON.parse(JSON.stringify(verified)))).toEqual(verified);
    expect(verificationState(readVerification(verified))).toBe('verified');
    expect(readVerification(null)).toBeNull();
    expect(readVerification({ state: 'verified', verifiedBy: RILEY })).toBeNull();
    expect(readVerification({ ...verified, until: 'soon' })).toBeNull();
    expect(readVerification({ ...verified, state: 'expired', until: null })).toBeNull();
    expect(verificationState(null)).toBe('none');
  });

  it('expires at 9:00 AM on the until date in the owner’s time zone', () => {
    const value = newVerification(RILEY, new Date('2026-07-03T16:00:00Z'), '2026-10-01');
    expect(expiresAt(value, 'America/Denver')?.toISOString()).toBe('2026-10-01T15:00:00.000Z');
    expect(shouldExpire(value, 'America/Denver', new Date('2026-10-01T14:59:59Z'))).toBe(false);
    expect(shouldExpire(value, 'America/Denver', new Date('2026-10-01T15:00:00Z'))).toBe(true);
    expect(shouldExpire(value, 'Europe/London', new Date('2026-10-01T08:00:00Z'))).toBe(true);
    expect(shouldExpire(expired(value), 'America/Denver', new Date('2026-10-02T00:00:00Z'))).toBe(
      false,
    );
    expect(expired(value).state).toBe('expired');
  });

  it('never expires with no end date', () => {
    const forever = newVerification(RILEY, new Date('2026-10-27T16:00:00Z'), null);
    expect(expiresAt(forever, 'America/Denver')).toBeNull();
    expect(shouldExpire(forever, 'America/Denver', new Date('2099-01-01T00:00:00Z'))).toBe(false);
    expect(shouldExpire(null, 'America/Denver', new Date())).toBe(false);
  });
});
