import { describe, expect, it } from 'vitest';
import { isDueForReview, isSummaryDue, needsReview, verifiedPercent } from './review';
import { expired, newVerification } from './verification';

const RILEY = '6f1c2b9e-4d3a-4e5f-9a8b-1c2d3e4f5a6b';
const at = new Date('2026-07-01T16:00:00Z');

describe('needs review', () => {
  const today = '2026-10-27';

  it('includes expired pages and pages expiring within 14 days', () => {
    expect(isDueForReview(newVerification(RILEY, at, '2026-11-10'), today)).toBe(true);
    expect(isDueForReview(newVerification(RILEY, at, '2026-11-11'), today)).toBe(false);
    expect(isDueForReview(newVerification(RILEY, at, '2026-10-27'), today)).toBe(true);
    expect(isDueForReview(expired(newVerification(RILEY, at, '2026-10-01')), today)).toBe(true);
    expect(isDueForReview(newVerification(RILEY, at, null), today)).toBe(false);
    expect(isDueForReview(null, today)).toBe(false);
  });

  it('includes pages without an owner', () => {
    expect(needsReview(null, 0, today)).toBe(true);
    expect(needsReview(null, 1, today)).toBe(false);
    expect(needsReview(newVerification(RILEY, at, '2026-11-01'), 2, today)).toBe(true);
  });
});

describe('the Monday summary (KB-06)', () => {
  // Monday, October 26, 2026: 9:00 AM in Denver is 15:00 UTC.
  const before = new Date('2026-10-26T14:59:00Z');
  const after = new Date('2026-10-26T15:00:00Z');

  it('goes out once, after 9:00 AM on Monday in the owner’s time zone', () => {
    expect(isSummaryDue(before, 'America/Denver', null)).toBe(false);
    expect(isSummaryDue(after, 'America/Denver', null)).toBe(true);
    expect(isSummaryDue(after, 'America/Denver', new Date('2026-10-19T15:05:00Z'))).toBe(true);
    expect(isSummaryDue(after, 'America/Denver', new Date('2026-10-26T15:00:00Z'))).toBe(false);
  });

  it('skips other days and other time zones’ Mondays', () => {
    expect(isSummaryDue(new Date('2026-10-27T15:00:00Z'), 'America/Denver', null)).toBe(false);
    // 15:00 UTC Monday is already Tuesday 0:00 in Tokyo.
    expect(isSummaryDue(new Date('2026-10-26T15:00:00Z'), 'Asia/Tokyo', null)).toBe(false);
    expect(isSummaryDue(new Date('2026-10-26T00:00:00Z'), 'Asia/Tokyo', null)).toBe(true);
  });
});

describe('the health line numbers', () => {
  it('rounds down, so 100% means every page', () => {
    expect(verifiedPercent({ pages: 50, verified: 43, expired: 4, openReports: 2 })).toBe(86);
    expect(verifiedPercent({ pages: 200, verified: 199, expired: 0, openReports: 0 })).toBe(99);
    expect(verifiedPercent({ pages: 3, verified: 3, expired: 0, openReports: 0 })).toBe(100);
    expect(verifiedPercent({ pages: 0, verified: 0, expired: 0, openReports: 0 })).toBeNull();
  });
});
