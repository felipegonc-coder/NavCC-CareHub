// What the page screen works out from page data: the breadcrumbs, "Edited 2m ago", the browser
// tab's title, the "start with" choices and edits to cached page data (Pages and blocks, 2 and 3.1).
import type { Stamp } from './api';
import type { PageIcon } from './types';

/** A title is plain text on one line, up to 2,000 characters (section 3.1). */
export const TITLE_MAX = 2000;

export const cleanTitle = (text: string): string =>
  text.replace(/[\r\n]+/g, ' ').slice(0, TITLE_MAX);

/** "Care Hub · 🚀 Refund steps": the browser tab shows the page's icon and title. */
export function tabTitle(page: { title: string; icon: PageIcon | null }): string {
  const icon = page.icon?.type === 'emoji' ? `${page.icon.emoji} ` : '';
  return `Care Hub · ${icon}${page.title.trim() || 'Untitled'}`;
}

/**
 * Breadcrumbs past `max` levels keep the first and the last two, and fold the middle into "…"
 * (section 2): `first`, then "…" for `folded` when there are any, then `last`.
 */
export function foldCrumbs<T>(crumbs: readonly T[], max = 4) {
  if (crumbs.length <= max) return { first: [...crumbs], folded: [] as T[], last: [] as T[] };
  const kept = max - 2;
  return {
    first: crumbs.slice(0, 1),
    folded: crumbs.slice(1, crumbs.length - kept),
    last: crumbs.slice(-kept),
  };
}

const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dayAndTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "Edited just now", "Edited 2m ago", "Edited 3h ago", "Edited 4d ago", then "Edited Oct 20, 2026". */
export function editedLabel(at: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(at)) / 60_000);
  if (minutes < 1) return 'Edited just now';
  if (minutes < 60) return `Edited ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Edited ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `Edited ${days}d ago` : `Edited ${day.format(new Date(at))}`;
}

/** "Created by Sam Ortiz, Oct 26, 2026, 3:30 PM", for Page info and hovering "Edited 2m ago". */
export const madeWhen = (what: 'Created' | 'Edited', stamp: Stamp): string =>
  `${what}${stamp.by?.name ? ` by ${stamp.by.name}` : ''}, ${dayAndTime.format(new Date(stamp.at))}`;

export const editedWhen = (stamp: Stamp): string => madeWhen('Edited', stamp);

const count = new Intl.NumberFormat('en-US');
const letters = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** Page info's "4 words · 23 characters"; an emoji counts as one character, line breaks as none. */
export function textCounts(text: string): string {
  const words = text.split(/\s+/).filter(Boolean).length;
  const characters = [...letters.segment(text.replace(/[\r\n]/g, ''))].length;
  const plural = (n: number, one: string) => `${count.format(n)} ${one}${n === 1 ? '' : 's'}`;
  return `${plural(words, 'word')} · ${plural(characters, 'character')}`;
}

/** "Locked by Avery Lin" (section 2, States). */
export const lockedLabel = (stamp: Stamp): string =>
  stamp.by?.name ? `Locked by ${stamp.by.name}` : 'Locked';

/** The "start with" choices of a new empty page that the editor's "/" menu has, in this order. */
export const START_WITH = ['Table', 'Board', 'List', 'Calendar', 'Gallery', 'Timeline', 'Chart'];

/** The database views and Form among "/" items ("Table view", "Form"), in the spec's order. */
export function startItems<T extends { title: string }>(items: readonly T[]) {
  const byTitle = new Map(items.map((item) => [item.title.trim().toLowerCase(), item]));
  const names = [...START_WITH.map((name) => [name, `${name} view`]), ['Form', 'Form']];
  return names.flatMap(([label = '', title = '']) => {
    const item = byTitle.get(title.toLowerCase());
    return item ? [{ label, item }] : [];
  });
}

/** A page's own fields that show wherever it's listed. */
export type ShownFields = Partial<{ title: string; icon: PageIcon | null }>;

function patchOne(item: unknown, id: string, fields: ShownFields): unknown {
  if (typeof item !== 'object' || item === null) return item;
  const record = item as Record<string, unknown>;
  let next = record;
  if (record.id === id) {
    const own = Object.entries(fields).filter(([key]) => key in record);
    if (own.length > 0) next = { ...record, ...Object.fromEntries(own) };
  }
  const path = record.path;
  if (Array.isArray(path) && path.some((step) => (step as { id?: unknown } | null)?.id === id)) {
    next = { ...next, path: path.map((step) => patchOne(step, id, fields)) };
  }
  return next;
}

/**
 * Cached data from any page query with page `id` changed: in lists, in the page's own data, and
 * in the breadcrumbs of the pages under it. Data without that page comes back as it was.
 */
export function patchCached(data: unknown, id: string, fields: ShownFields): unknown {
  return Array.isArray(data)
    ? data.map((item) => patchOne(item, id, fields))
    : patchOne(data, id, fields);
}
