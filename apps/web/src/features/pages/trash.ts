// What Trash lists and how each item reads (Page history and Trash, sections 2 and 6).
import type { TrashItem } from './api';

export interface TrashFilters {
  query: string;
  /** A person's ID; empty for anyone. */
  deletedBy: string;
  /** A space's name; empty for any. */
  space: string;
  /** Empty for every type. */
  kind: '' | 'page' | 'database' | 'row';
}

export const NO_FILTERS: TrashFilters = { query: '', deletedBy: '', space: '', kind: '' };

const DAY_MS = 86_400_000;
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export const named = (item: { title: string }) => item.title.trim() || 'Untitled';

/** The items the search and filters keep, newest first. */
export function filterTrash(items: readonly TrashItem[], filters: TrashFilters): TrashItem[] {
  const needle = filters.query.trim().toLowerCase();
  return items
    .filter(
      (item) =>
        (!needle || named(item).toLowerCase().includes(needle)) &&
        (!filters.deletedBy || item.deletedBy?.id === filters.deletedBy) &&
        (!filters.space || item.path[0] === filters.space) &&
        (!filters.kind || item.kind === filters.kind),
    )
    .sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
}

/** Who deleted things and the spaces they were in, for the filters. */
export function filterChoices(items: readonly TrashItem[]) {
  const people = new Map<string, string>();
  const spaces = new Set<string>();
  for (const item of items) {
    if (item.deletedBy) people.set(item.deletedBy.id, item.deletedBy.name);
    if (item.path[0]) spaces.add(item.path[0]);
  }
  return {
    people: [...people].sort((a, b) => a[1].localeCompare(b[1])),
    spaces: [...spaces].sort((a, b) => a.localeCompare(b)),
  };
}

/** "just now", "5 minutes ago", "yesterday", "12 days ago". */
export function ago(iso: string, now: number): string {
  const seconds = (Date.parse(iso) - now) / 1000;
  const units = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ] as const;
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** "Deletes in 12 days"; `soon` in the last 3 days. */
export function deletesIn(item: TrashItem, now: number): { label: string; soon: boolean } {
  const days = Math.max(0, Math.ceil((Date.parse(item.deletesAt) - now) / DAY_MS));
  const label = days === 0 ? 'Deletes today' : `Deletes in ${days} ${days === 1 ? 'day' : 'days'}`;
  return { label, soon: days <= 3 };
}

/** "and 12 sub-pages" */
export const insideLabel = (count: number) =>
  count > 0 ? `and ${count} ${count === 1 ? 'sub-page' : 'sub-pages'}` : '';

/** "Refund steps, in Support › Policies, deleted by Sam Ortiz yesterday, deletes in 29 days" */
export function describeItem(item: TrashItem, now: number): string {
  const parts = [named(item)];
  if (item.path.length > 0) parts.push(`in ${item.path.join(' › ')}`);
  const by = item.deletedBy ? ` by ${item.deletedBy.name}` : '';
  parts.push(`deleted${by} ${ago(item.deletedAt, now)}`);
  parts.push(deletesIn(item, now).label.toLowerCase());
  return parts.join(', ');
}
