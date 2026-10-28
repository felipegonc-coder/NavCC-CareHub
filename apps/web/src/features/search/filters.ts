import {
  SEARCH_TYPES,
  type SearchFilters,
  type SearchSort,
  type SearchType,
} from '@carehub/extras/search';
import { format, isSameYear } from 'date-fns';

// The filter chips and sort (spec 2): what each says, and the filters the search API gets.

export const SORT_LABELS: Record<SearchSort, string> = {
  best: 'Best match',
  edited_desc: 'Edited, newest first',
  edited_asc: 'Edited, oldest first',
  created_desc: 'Created, newest first',
  created_asc: 'Created, oldest first',
};

export const TYPE_LABELS: Record<SearchType, string> = {
  page: 'Pages',
  database: 'Databases',
  row: 'Rows',
  file: 'Files',
};

/** The names of the pages and people picked, by ID, for the chips to show. */
export type Names = Readonly<Record<string, string>>;

/** Leaves out what's off or empty, so the request only has the filters that are on. */
export function cleanFilters(filters: SearchFilters): SearchFilters {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === false || (Array.isArray(value) && value.length === 0))
      continue;
    clean[key] = value;
  }
  return clean as SearchFilters;
}

export const hasFilters = (filters: SearchFilters) => Object.keys(cleanFilters(filters)).length > 0;

/** Adds the ID, or takes it out if it's there. */
export const toggled = (ids: readonly string[] | undefined, id: string) =>
  ids?.includes(id) ? ids.filter((other) => other !== id) : [...(ids ?? []), id];

/** "In", "In: Support" or "In: 2 pages"; "Edited by: Sam Ortiz". */
export function pickLabel(
  chip: string,
  ids: readonly string[] | undefined,
  names: Names,
  [one, more]: readonly [string, string],
): string {
  if (!ids?.length) return chip;
  if (ids.length > 1) return `${chip}: ${ids.length} ${more}`;
  return `${chip}: ${names[ids[0]!] ?? `1 ${one}`}`;
}

/** "Type" or "Type: Pages, Rows". */
export function typeLabel(types: readonly SearchType[] | undefined): string {
  const on = SEARCH_TYPES.filter((type) => types?.includes(type));
  return on.length ? `Type: ${on.map((type) => TYPE_LABELS[type]).join(', ')}` : 'Type';
}

export const DATE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: 'Last 7 days', days: 6 },
  { label: 'Last 30 days', days: 29 },
] as const;

/** The start of the day `days` before `now`, in the person's time zone. */
export function dayStart(now: Date, days = 0): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days).toISOString();
}

/** "2026-10-20" from a date field, as the start of that day here; `next` for the day after. */
export function fieldDay(value: string, next = false): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  return new Date(year, month - 1, day + (next ? 1 : 0)).toISOString();
}

/** The other way: an ISO time as "2026-10-20" here, for a date field (`before` for `to`). */
export function dayField(iso: string | undefined, before = false): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (before) date.setDate(date.getDate() - 1);
  return format(date, 'yyyy-MM-dd');
}

/** "Date", "Date: Edited, last 7 days" or "Date: Created, Oct 1 – Oct 20". */
export function dateLabel(date: SearchFilters['date'], now = new Date()): string {
  if (!date || (!date.from && !date.to)) return 'Date';
  const field = date.field === 'created' ? 'Created' : 'Edited';
  const preset = DATE_PRESETS.find(({ days }) => !date.to && date.from === dayStart(now, days));
  if (preset) return `Date: ${field}, ${preset.label.toLowerCase()}`;
  const day = (at: Date) => format(at, isSameYear(at, now) ? 'MMM d' : 'MMM d, yyyy');
  const from = date.from && day(new Date(date.from));
  // `to` isn't included, so the last day is the one before it.
  const to = date.to && day(new Date(new Date(date.to).getTime() - 1));
  if (from && to) return `Date: ${field}, ${from} – ${to}`;
  return from ? `Date: ${field}, since ${from}` : `Date: ${field}, until ${to}`;
}
