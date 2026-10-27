/** Pure helpers behind the cells, kept apart from the components so they're easy to test. */
import {
  decimalToNumber,
  newId,
  plainText,
  shiftDecimal,
  textIncludes,
  toCalendarDate,
  zonedParts,
  zonedToInstant,
  type DateReminder,
  type DateValue,
  type EvalContext,
  type FileRef,
  type NumberDisplay,
  type Property,
  type RichText,
  type SelectOption,
  type Viewer,
} from '@carehub/databases';
import { VALUE_MESSAGES, validateValue } from '@carehub/databases/values';
import { CELL_TEXT, DAY_REMINDER_LABELS, TIME_REMINDER_LABELS } from './messages';
import type { CellContext, CellMove, CommitDetails } from './types';

/** The EvalContext the package's formatters take. */
export function evalContext(ctx: CellContext): EvalContext {
  return {
    properties: ctx.properties ?? [],
    viewer: ctx.viewer,
    userName: (id) => ctx.userName(id),
    rowTitle: (id) => ctx.rowTitle?.(id),
    isRemovedUser: (id) => ctx.isRemovedUser?.(id) === true,
  };
}

/** Same stored value (both empty counts as the same). */
export const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Search text matches when it's blank or found in any of the texts (ignoring case and accents). */
export function matchesQuery(query: string, ...texts: (string | undefined)[]): boolean {
  const q = query.trim();
  return !q || texts.some((t) => t !== undefined && textIncludes(t, q));
}

// ------------------------------------------------------------------ numbers

/** "Divide by" when the property has none. */
export const DEFAULT_DIVIDE_BY = 100;

/** How full a bar or ring is, 0 to 1. Percent compares what's shown: 45% of 100 is 0.45 full. */
export function numberFill(d: string, display: Pick<NumberDisplay, 'format' | 'divideBy'>): number {
  const value = decimalToNumber(d) * (display.format === 'percent' ? 100 : 1);
  const divideBy = display.divideBy ?? DEFAULT_DIVIDE_BY;
  if (!(divideBy > 0) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / divideBy));
}

/** What screen readers hear for a bar or ring: "7 of 10". */
export const numberLabel = (text: string, display: Pick<NumberDisplay, 'divideBy'>): string =>
  `${text} of ${display.divideBy ?? DEFAULT_DIVIDE_BY}`;

// ------------------------------------------------------------------ text editors

/** The text an editor starts with: Percent 0.45 is edited as 45. */
export function editText(prop: Property, value: unknown): string {
  const c = prop.config;
  if (c.type === 'text') return Array.isArray(value) ? plainText(value as RichText) : '';
  if (typeof value !== 'string') return '';
  return c.type === 'number' && c.format === 'percent' ? shiftDecimal(value, 2) : value;
}

/** Dials the number part of a phone value (an extension after "x" is left off). */
export function telHref(phone: string): string {
  const [number = ''] = phone.split(/x/i);
  return `tel:${number.replace(/[^\d+]/g, '')}`;
}

// ------------------------------------------------------------------ dates

/** What the date editor's fields hold. Dates are YYYY-MM-DD, times HH:MM. */
export interface DateDraft {
  start: string;
  startTime: string;
  /** null: no end date. */
  end: string | null;
  endTime: string;
  hasTime: boolean;
  /** "" shows the date in each viewer's own time zone. */
  timeZone: string;
  /** "" none, "m:5" minutes before, "d:1" days before. */
  reminder: string;
}

const DEFAULT_TIME = '09:00';
const pad = (n: number): string => String(n).padStart(2, '0');

function wallClock(instant: string, zone: string): [string, string] {
  const p = zonedParts(instant, zone);
  return [toCalendarDate(p), `${pad(p.hour)}:${pad(p.minute)}`];
}

export function dateDraft(v: DateValue | null, viewer: Viewer): DateDraft {
  const draft: DateDraft = {
    start: '',
    startTime: DEFAULT_TIME,
    end: null,
    endTime: DEFAULT_TIME,
    hasTime: false,
    timeZone: '',
    reminder: reminderKey(v?.reminder),
  };
  if (!v) return draft;
  if (!v.hasTime) return { ...draft, start: v.start, end: v.end };
  const zone = v.timeZone ?? viewer.timeZone;
  const [start, startTime] = wallClock(v.start, zone);
  let end: string | null = null;
  let endTime = startTime;
  if (v.end !== null) [end, endTime] = wallClock(v.end, zone);
  return { ...draft, hasTime: true, timeZone: v.timeZone ?? '', start, startTime, end, endTime };
}

const TIME = /^(\d{1,2}):(\d{2})/;
function readTime(t: string): [number, number] | null {
  const m = TIME.exec(t.trim());
  const h = Number(m?.[1]);
  const min = Number(m?.[2]);
  return m && h < 24 && min < 60 ? [h, min] : null;
}

/** The value to check with validateValue: null when cleared, undefined when it can't be read. */
export function draftValue(
  d: DateDraft,
  viewer: Viewer,
): Record<string, unknown> | null | undefined {
  if (!d.start) return null;
  const out: Record<string, unknown> = { start: d.start, end: d.end || null, hasTime: d.hasTime };
  const reminder = reminderFromKey(d.reminder, d.hasTime);
  if (reminder) out.reminder = reminder;
  if (!d.hasTime) return out;
  const zone = d.timeZone || viewer.timeZone;
  const a = readTime(d.startTime);
  const b = readTime(d.end ? d.endTime : d.startTime);
  if (!a || !b) return undefined;
  try {
    out.start = zonedToInstant(d.start, a[0], a[1], zone);
    out.end = d.end ? zonedToInstant(d.end, b[0], b[1], zone) : null;
  } catch {
    return undefined;
  }
  if (d.timeZone) out.timeZone = d.timeZone;
  return out;
}

const MINUTES = [0, 5, 10, 15, 30, 60, 120, 1440, 2880] as const;
const DAYS = [0, 1, 2, 7] as const;
/** The spec's choices; other stored ones show only on values that have them. */
const SHOWN_MINUTES: readonly number[] = [0, 5, 10, 60, 1440, 2880];

export function reminderKey(r: DateReminder | undefined): string {
  if (!r) return '';
  return 'minutesBefore' in r ? `m:${r.minutesBefore}` : `d:${r.daysBefore}`;
}

/** The reminder for a key, if it fits the date (minutes with a time, days without). */
export function reminderFromKey(key: string, hasTime: boolean): DateReminder | undefined {
  const n = Number(key.slice(2));
  if (hasTime && key.startsWith('m:')) {
    const m = MINUTES.find((x) => x === n);
    return m === undefined ? undefined : { minutesBefore: m };
  }
  if (!hasTime && key.startsWith('d:')) {
    const d = DAYS.find((x) => x === n);
    return d === undefined ? undefined : { daysBefore: d };
  }
  return undefined;
}

export function reminderChoices(
  hasTime: boolean,
  current: string,
): { key: string; label: string }[] {
  const prefix = hasTime ? 'm:' : 'd:';
  const labels = hasTime ? TIME_REMINDER_LABELS : DAY_REMINDER_LABELS;
  const shown: readonly number[] = hasTime ? SHOWN_MINUTES : DAYS;
  const extra = current.startsWith(prefix) ? Number(current.slice(2)) : NaN;
  const list =
    shown.includes(extra) || labels[extra] === undefined ? [...shown] : [...shown, extra];
  list.sort((a, b) => a - b);
  return [
    { key: '', label: CELL_TEXT.none },
    ...list.map((n) => ({ key: `${prefix}${n}`, label: labels[n] ?? '' })),
  ];
}

/** Every IANA time zone the browser knows, plus the one in use. */
export function timeZoneChoices(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    // Older engines: just UTC and the zone in use.
  }
  const all = new Set([...zones, 'UTC']);
  if (current) all.add(current);
  return [...all].sort();
}

// ------------------------------------------------------------------ files

const IMAGE_FILE = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;

/** Pictures show a thumbnail. */
export function isImageFile(f: FileRef): boolean {
  const path = (f.url ?? f.name).split(/[?#]/)[0] ?? '';
  return f.mime.startsWith('image/') || IMAGE_FILE.test(path);
}

const LINK_PROPERTY: Property = {
  id: 'web-link',
  name: 'Web link',
  description: '',
  config: { type: 'url' },
  rowPage: 'always',
};

/** The file name a web link shows: its last path part, or its host. */
function linkName(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).at(-1);
    return last ? decodeURIComponent(last) : u.hostname;
  } catch {
    return url;
  }
}

/** A web link added to a Files cell ("https://" is added when missing; http and https only). */
export function webLinkFile(
  text: string,
): { ok: true; file: FileRef } | { ok: false; error: string } {
  const res = validateValue(LINK_PROPERTY, text);
  if (!res.ok) return res;
  if (typeof res.value !== 'string') return { ok: false, error: VALUE_MESSAGES.url };
  const url = res.value;
  return { ok: true, file: { id: newId(), name: linkName(url), size: 0, mime: '', url } };
}

/** What onCommit says besides the value. */
export function commitDetails(
  before: unknown,
  after: unknown,
  move?: CellMove,
  newOptions?: SelectOption[],
): CommitDetails {
  const details: CommitDetails = { changed: !sameValue(before, after) || !!newOptions?.length };
  if (move) details.move = move;
  if (newOptions?.length) details.newOptions = newOptions;
  return details;
}
