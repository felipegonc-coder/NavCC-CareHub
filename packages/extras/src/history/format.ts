// How versions read in Version history: "Today, 3:12 PM · Avery Lin, Sam Ortiz", grouped by day,
// and "Oct 20, 3:00 PM" in the restore question and note. Times are in `timeZone` (the browser's
// when left out).
import type { VersionSummary } from './api';
import type { VersionKind } from './kinds';

const LOCALE = 'en-US';

function dayKey(at: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((one) => one.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The calendar day before `YYYY-MM-DD`, whatever the clock changes. */
function dayBefore(day: string): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10);
}

const sameYear = (at: Date, now: Date, timeZone?: string) =>
  dayKey(at, timeZone).slice(0, 4) === dayKey(now, timeZone).slice(0, 4);

/** "Oct 20", or "Oct 20, 2025" in another year. */
function shortDate(at: Date, now: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    month: 'short',
    day: 'numeric',
    ...(sameYear(at, now, timeZone) ? {} : { year: 'numeric' }),
  }).format(at);
}

/** "3:12 PM" */
export function versionClock(at: string | Date, timeZone?: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, hour: 'numeric', minute: '2-digit' }).format(
    new Date(at),
  );
}

/** The day a version is listed under: "Today", "Yesterday" or "Oct 20". */
export function versionDay(at: string | Date, now = new Date(), timeZone?: string): string {
  const date = new Date(at);
  const day = dayKey(date, timeZone);
  const today = dayKey(now, timeZone);
  if (day === today) return 'Today';
  if (day === dayBefore(today)) return 'Yesterday';
  return shortDate(date, now, timeZone);
}

/** "Today, 3:12 PM" */
export function versionWhen(at: string | Date, now = new Date(), timeZone?: string): string {
  return `${versionDay(at, now, timeZone)}, ${versionClock(at, timeZone)}`;
}

/** "Oct 20, 3:00 PM": the version a restore question or note is about. */
export function versionDate(at: string | Date, now = new Date(), timeZone?: string): string {
  const date = new Date(at);
  return `${shortDate(date, now, timeZone)}, ${versionClock(date, timeZone)}`;
}

/** Who's behind a version: its editors, else whoever caused it. */
export function versionPeople(
  version: Pick<VersionSummary, 'editors' | 'createdBy' | 'kind'>,
): string {
  if (version.editors.length > 0) return version.editors.map((one) => one.name).join(', ');
  if (version.createdBy) return version.createdBy.name;
  return version.kind === 'before_automation' ? 'An automation' : 'Someone';
}

/** "Today, 3:12 PM · Avery Lin, Sam Ortiz" */
export function versionLine(version: VersionSummary, now = new Date(), timeZone?: string): string {
  return `${versionWhen(version.createdAt, now, timeZone)} · ${versionPeople(version)}`;
}

const KIND_LABELS: Record<VersionKind, string | null> = {
  automatic: null,
  before_restore: 'Before a restore',
  before_import: 'Before an import',
  before_template: 'Before a template',
  before_replace: 'Before Replace all',
  before_accept_all: 'Before Accept all',
  before_automation: 'Before an automation',
};

/** Why a version was saved, for the ones saved right before a change; null for automatic ones. */
export function versionKindLabel(kind: VersionKind): string | null {
  return KIND_LABELS[kind];
}

/** The restore question (section 3.2), with `from` from `versionDate`. */
export function restoreQuestion(from: string): string {
  return `Replace the current page with the version from ${from}? The current page is saved as a version first.`;
}
