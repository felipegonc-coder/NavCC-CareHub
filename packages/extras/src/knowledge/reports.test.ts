import { describe, expect, it } from 'vitest';
import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  REPORT_STATUSES,
  REPORT_STATUS_LABELS,
  isOpenReport,
  recentReport,
  replyInputSchema,
  reportInputSchema,
  reportStatusInputSchema,
  reportedWhen,
} from './reports';

describe('report reasons and statuses', () => {
  it('uses the spec’s words', () => {
    expect(REPORT_REASONS.map((reason) => REPORT_REASON_LABELS[reason])).toEqual([
      'Out of date',
      'Wrong or unclear',
      'Broken link or file',
      "Something's missing",
      'Other',
    ]);
    expect(REPORT_STATUSES.map((status) => REPORT_STATUS_LABELS[status])).toEqual([
      'New',
      'In progress',
      'Fixed',
      "Won't fix",
    ]);
    expect(REPORT_STATUSES.filter(isOpenReport)).toEqual(['new', 'in_progress']);
  });
});

describe('report input', () => {
  it('needs text for Other and caps it at 2,000 characters', () => {
    expect(reportInputSchema.safeParse({ reason: 'out_of_date' }).success).toBe(true);
    expect(reportInputSchema.safeParse({ reason: 'other' }).success).toBe(false);
    expect(reportInputSchema.safeParse({ reason: 'other', text: '   ' }).success).toBe(false);
    expect(
      reportInputSchema.safeParse({ reason: 'other', text: 'The phone number is wrong' }).success,
    ).toBe(true);
    expect(reportInputSchema.safeParse({ reason: 'missing', text: 'x'.repeat(2000) }).success).toBe(
      true,
    );
    expect(reportInputSchema.safeParse({ reason: 'missing', text: 'x'.repeat(2001) }).success).toBe(
      false,
    );
  });

  it('keeps a quote and its block, and refuses anything else', () => {
    const parsed = reportInputSchema.parse({
      reason: 'wrong_or_unclear',
      text: ' The phone number is wrong ',
      quote: 'within 3 days',
      blockId: 'blk_1',
    });
    expect(parsed).toEqual({
      reason: 'wrong_or_unclear',
      text: 'The phone number is wrong',
      quote: 'within 3 days',
      blockId: 'blk_1',
    });
    expect(reportInputSchema.safeParse({ reason: 'gossip' }).success).toBe(false);
    expect(
      reportInputSchema.safeParse({ reason: 'other', text: 'x', status: 'fixed' }).success,
    ).toBe(false);
  });

  it('checks replies and statuses', () => {
    expect(replyInputSchema.safeParse({ text: 'Fixed the number, thanks.' }).success).toBe(true);
    expect(replyInputSchema.safeParse({ text: ' ' }).success).toBe(false);
    expect(reportStatusInputSchema.safeParse({ status: 'wont_fix' }).success).toBe(true);
    expect(reportStatusInputSchema.safeParse({ status: 'closed' }).success).toBe(false);
  });
});

describe('reporting again within 7 days', () => {
  const now = new Date('2026-10-27T18:00:00Z');

  it('finds the latest report from the last 7 days', () => {
    const mine = [
      { id: 'old', createdAt: '2026-10-19T18:00:00Z' },
      { id: 'tuesday', createdAt: '2026-10-21T18:00:00Z' },
      { id: 'yesterday', createdAt: '2026-10-26T20:00:00Z' },
    ];
    expect(recentReport(mine, now)?.id).toBe('yesterday');
    expect(recentReport(mine.slice(0, 1), now)).toBeNull();
    expect(recentReport([], now)).toBeNull();
  });

  it('says when, in the person’s time zone', () => {
    expect(reportedWhen('2026-10-27T15:00:00Z', now, 'America/Denver')).toBe('today');
    expect(reportedWhen('2026-10-26T20:00:00Z', now, 'America/Denver')).toBe('yesterday');
    expect(reportedWhen('2026-10-24T20:00:00Z', now, 'America/Denver')).toBe('3 days ago');
    expect(reportedWhen('2026-10-27T05:00:00Z', now, 'America/Denver')).toBe('yesterday');
  });
});
