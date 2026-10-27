import { describe, expect, it } from 'vitest';
import {
  KB_NOTICES,
  KB_WORDS,
  badgeLabel,
  badgeText,
  dueBannerText,
  expiredBannerText,
  healthText,
  namesText,
  openReportsText,
  ownerLostAccessText,
  repeatReportText,
  reportThanksText,
  turnBackText,
  turnIntoText,
} from './texts';
import { expired, newVerification } from './verification';

const RILEY = '6f1c2b9e-4d3a-4e5f-9a8b-1c2d3e4f5a6b';
const today = '2026-10-27';

describe('badges and banners', () => {
  const verified = newVerification(RILEY, new Date('2026-10-22T16:00:00Z'), '2027-01-20');
  const lapsed = expired(newVerification(RILEY, new Date('2026-07-03T16:00:00Z'), '2026-10-01'));

  it('shows the spec’s badges, with words for screen readers', () => {
    expect(badgeText(verified, 'Riley Chen', today)).toBe(
      '✓ Verified by Riley Chen until Jan 20, 2027',
    );
    expect(badgeLabel(verified, 'Riley Chen')).toBe(
      'Verified by Riley Chen until January 20, 2027',
    );
    expect(badgeText(lapsed, 'Riley Chen', today)).toBe('Verification expired Oct 1');
    expect(badgeLabel(lapsed, 'Riley Chen')).toBe('Verification expired October 1, 2026');
    expect(badgeText(null, 'Riley Chen', today)).toBe('Not verified');
    const forever = newVerification(RILEY, new Date('2026-10-22T16:00:00Z'), null);
    expect(badgeText(forever, 'Riley Chen', today)).toBe('✓ Verified by Riley Chen');
    expect(badgeLabel(forever, 'Riley Chen')).toBe('Verified by Riley Chen with no end date');
  });

  it('words the banners', () => {
    expect(KB_WORDS.draftBanner).toBe('Draft. Only editors can see this page.');
    expect(expiredBannerText('2026-10-01', today)).toBe(
      'Verification expired on Oct 1. This page may be out of date.',
    );
    expect(dueBannerText('2026-10-01', today)).toBe('Due for review since Oct 1');
    expect(ownerLostAccessText('Riley Chen')).toBe("Riley Chen can't open this page anymore.");
  });
});

describe('counts in words', () => {
  it('matches the spec’s examples', () => {
    expect(healthText({ pages: 50, verified: 43, expired: 4, openReports: 2 })).toBe(
      '86% verified · 4 expired · 2 open reports',
    );
    expect(healthText({ pages: 0, verified: 0, expired: 0, openReports: 0 })).toBeNull();
    expect(openReportsText(1)).toBe('1 open report');
    expect(turnIntoText('Support handbook', 24)).toBe(
      'Turn Support handbook into a knowledge base? Its 24 sub-pages become knowledge base pages with an owner, status and verification. You can turn it back later.',
    );
    expect(turnIntoText('Support handbook', 1)).toContain(
      'Its 1 sub-page becomes a knowledge base page with an owner',
    );
    expect(turnIntoText('Notes', 0)).toContain('Pages you add to it get an owner');
    expect(turnBackText(3)).toBe(
      'Owner, status, verification, tags and 3 open reports will be removed.',
    );
    expect(turnBackText(0)).toBe('Owner, status, verification and tags will be removed.');
  });

  it('names who will take a look', () => {
    expect(namesText(['Riley Chen'])).toBe('Riley Chen');
    expect(namesText(['Riley Chen', 'Sam Ortiz'])).toBe('Riley Chen and Sam Ortiz');
    expect(namesText(['Riley Chen', 'Sam Ortiz', 'Ana Lima'])).toBe('Riley Chen and 2 others');
    expect(reportThanksText(['Riley Chen'])).toBe('Thanks. Riley Chen will take a look.');
    expect(reportThanksText([])).toBe('Thanks. An editor will take a look.');
    expect(repeatReportText('yesterday')).toBe(
      'You reported this page yesterday. Add to that report?',
    );
  });
});

describe('notices', () => {
  it('uses the spec’s words', () => {
    expect(KB_NOTICES.summary(3, 'Support handbook')).toBe(
      '3 pages in Support handbook need review',
    );
    expect(KB_NOTICES.summary(1, 'Support handbook')).toBe(
      '1 page in Support handbook needs review',
    );
    expect(KB_NOTICES.ownerRemoved('Riley Chen', 12, 'Support handbook')).toBe(
      'Riley Chen no longer owns 12 pages in Support handbook. Pick new owners.',
    );
    expect(KB_NOTICES.reported('Riley Chen', 'Refund policy', 'out_of_date')).toBe(
      'Riley Chen reported a problem with Refund policy: Out of date.',
    );
    expect(KB_NOTICES.closed('Refund policy', 'wont_fix')).toBe(
      "Your report on Refund policy was marked Won't fix.",
    );
  });
});
