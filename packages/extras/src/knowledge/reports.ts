// Report a problem: reasons, statuses and the request bodies the server checks.
import { z } from 'zod';
import { KB_LIMITS } from './constants';
import { daysBetween, todayIn } from './time';

export const REPORT_REASONS = [
  'out_of_date',
  'wrong_or_unclear',
  'broken_link',
  'missing',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Readonly<Record<ReportReason, string>> = {
  out_of_date: 'Out of date',
  wrong_or_unclear: 'Wrong or unclear',
  broken_link: 'Broken link or file',
  missing: "Something's missing",
  other: 'Other',
};

export const REPORT_STATUSES = ['new', 'in_progress', 'fixed', 'wont_fix'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABELS: Readonly<Record<ReportStatus, string>> = {
  new: 'New',
  in_progress: 'In progress',
  fixed: 'Fixed',
  wont_fix: "Won't fix",
};

/** New and In progress reports are open; they count on the strip and in the health line. */
export function isOpenReport(status: ReportStatus): boolean {
  return status === 'new' || status === 'in_progress';
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Keep it under ${max.toLocaleString('en-US')} characters.` })
    .optional();

export const reportInputSchema = z
  .strictObject({
    reason: z.enum(REPORT_REASONS, { error: "Pick what's wrong." }),
    text: optionalText(KB_LIMITS.reportText),
    quote: optionalText(KB_LIMITS.reportQuote),
    blockId: z.string().min(1).max(64).optional(),
  })
  .refine((input) => input.reason !== 'other' || Boolean(input.text), {
    error: "Say what's wrong.",
    path: ['text'],
  });
export type ReportInput = z.infer<typeof reportInputSchema>;

export const replyInputSchema = z.strictObject({
  text: z
    .string()
    .trim()
    .min(1, { error: 'Write a reply first.' })
    .max(KB_LIMITS.replyText, { error: 'Keep it under 2,000 characters.' }),
});

export const reportStatusInputSchema = z.strictObject({ status: z.enum(REPORT_STATUSES) });

/** The person's latest report on this page from the last 7 days, if any. */
export function recentReport<R extends { createdAt: string }>(
  mine: readonly R[],
  now: Date,
): R | null {
  const since = now.getTime() - KB_LIMITS.repeatReportDays * 86_400_000;
  let latest: R | null = null;
  for (const report of mine) {
    const at = Date.parse(report.createdAt);
    if (at >= since && at <= now.getTime() && (!latest || at > Date.parse(latest.createdAt))) {
      latest = report;
    }
  }
  return latest;
}

/** "today", "yesterday" or "3 days ago", in the person's time zone. */
export function reportedWhen(createdAt: string, now: Date, timeZone: string): string {
  const days = daysBetween(todayIn(timeZone, new Date(createdAt)), todayIn(timeZone, now));
  if (days <= 0) return 'today';
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
