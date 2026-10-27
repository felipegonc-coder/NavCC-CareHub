// The words the knowledge base shows and sends, so the web app, the server's notices and the tests
// agree on them.
import { REPORT_REASON_LABELS, REPORT_STATUS_LABELS, type ReportReason } from './reports';
import { verifiedPercent, type HealthCounts } from './review';
import { formatDay, formatDayLong, type CivilDate } from './time';
import type { Verification } from './verification';

export const KB_WORDS = {
  draft: 'Draft',
  published: 'Published',
  draftBanner: 'Draft. Only editors can see this page.',
  publish: 'Publish',
  backToDraft: 'Back to draft',
  backToDraftConfirm: "Readers won't see this page anymore.",
  reviewNow: 'Review now',
  stillCorrect: 'Still correct?',
  needsChanges: 'Needs changes',
  archive: 'Archive',
  notVerified: 'Not verified',
  noOwner: 'No owner',
  pickOwner: 'Pick an owner',
  reportProblem: 'Report a problem',
  whatsWrong: "What's wrong?",
  yourReports: 'Your reports',
  noOpenReports: 'No open reports.',
  noPages: 'No pages yet.',
  turnInto: 'Turn into knowledge base',
  turnBack: 'Turn back into a page',
} as const;

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

/** "Riley Chen", "Riley Chen and Sam Ortiz", "Riley Chen and 2 others". */
export function namesText(names: readonly string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names[0]} and ${names.length - 1} others`;
}

/** The badge's words: "✓ Verified by Riley Chen until Jan 20, 2027". */
export function badgeText(value: Verification | null, verifier: string, today: CivilDate) {
  if (!value) return KB_WORDS.notVerified;
  if (value.state === 'expired' && value.until) {
    return `Verification expired ${formatDay(value.until, today)}`;
  }
  const until = value.until ? ` until ${formatDay(value.until, today)}` : '';
  return `✓ Verified by ${verifier}${until}`;
}

/** What screen readers hear: "Verified by Riley Chen until January 20, 2027". */
export function badgeLabel(value: Verification | null, verifier: string): string {
  if (!value) return KB_WORDS.notVerified;
  if (value.state === 'expired' && value.until) {
    return `Verification expired ${formatDayLong(value.until)}`;
  }
  const until = value.until ? ` until ${formatDayLong(value.until)}` : ' with no end date';
  return `Verified by ${verifier}${until}`;
}

export function expiredBannerText(until: CivilDate, today: CivilDate): string {
  return `Verification expired on ${formatDay(until, today)}. This page may be out of date.`;
}

export function dueBannerText(until: CivilDate, today: CivilDate): string {
  return `Due for review since ${formatDay(until, today)}`;
}

export const openReportsText = (count: number) => plural(count, 'open report', 'open reports');

export function ownerLostAccessText(name: string): string {
  return `${name} can't open this page anymore.`;
}

/** "86% verified · 4 expired · 2 open reports", or null for an empty knowledge base. */
export function healthText(counts: HealthCounts): string | null {
  const percent = verifiedPercent(counts);
  if (percent === null) return null;
  return `${percent}% verified · ${counts.expired.toLocaleString('en-US')} expired · ${openReportsText(counts.openReports)}`;
}

export function turnIntoText(title: string, subPages: number): string {
  const pages =
    subPages === 0
      ? 'Pages you add to it get'
      : `Its ${plural(subPages, 'sub-page becomes a knowledge base page', 'sub-pages become knowledge base pages')} with`;
  return `Turn ${title} into a knowledge base? ${pages} an owner, status and verification. You can turn it back later.`;
}

export function turnBackText(openReports: number): string {
  if (openReports === 0) return 'Owner, status, verification and tags will be removed.';
  return `Owner, status, verification, tags and ${openReportsText(openReports)} will be removed.`;
}

export function reportThanksText(owners: readonly string[]): string {
  return owners.length === 0
    ? 'Thanks. An editor will take a look.'
    : `Thanks. ${namesText(owners)} will take a look.`;
}

/** `when` comes from `reportedWhen`: "today", "yesterday" or "3 days ago". */
export function repeatReportText(when: string): string {
  return `You reported this page ${when}. Add to that report?`;
}

/** The 🔔 notices. Titles are only sent to people who can open the page. */
export const KB_NOTICES = {
  summary: (pages: number, base: string) =>
    `${plural(pages, 'page', 'pages')} in ${base} ${pages === 1 ? 'needs' : 'need'} review`,
  expiredToday: (page: string) => `${page} needs review: its verification expired today.`,
  ownerRemoved: (name: string, pages: number, base: string) =>
    `${name} no longer owns ${plural(pages, 'page', 'pages')} in ${base}. Pick new owners.`,
  reported: (reporter: string, page: string, reason: ReportReason) =>
    `${reporter} reported a problem with ${page}: ${REPORT_REASON_LABELS[reason]}.`,
  replied: (author: string, page: string) => `${author} replied to your report on ${page}.`,
  added: (reporter: string, page: string) => `${reporter} added to their report on ${page}.`,
  closed: (page: string, status: 'fixed' | 'wont_fix') =>
    `Your report on ${page} was marked ${REPORT_STATUS_LABELS[status]}.`,
  editRemovedVerification: (page: string) => `${page} is no longer verified because it was edited.`,
} as const;
