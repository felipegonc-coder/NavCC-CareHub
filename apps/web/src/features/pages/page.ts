// What the page screen works out from page data: the browser tab's title, the "start with"
// choices and edits to cached page data (Pages and blocks, sections 2 and 3.1).
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
