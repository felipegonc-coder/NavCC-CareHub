/**
 * View tabs (spec section 3.2): new views' names, which tabs fit beside "More", the order after a
 * tab moves, and the tab that shows when one is deleted. Plain functions, tested without React.
 */
import type { Id, View, ViewLayout } from '@carehub/databases';
import { LAYOUT_LABELS, uniqueViewName } from '@carehub/databases/schema';
import { tabViews } from './view-state';

export const TAB_TEXT = {
  views: 'Views',
  more: 'More',
  addView: 'Add view',
  rename: 'Rename',
  viewName: 'View name',
  duplicate: 'Duplicate',
  moveLeft: 'Move left',
  moveRight: 'Move right',
  delete: 'Delete',
  deleted: 'View deleted.',
} as const;

/** The "…" next to the tabs, for the view showing. */
export function viewMenuLabel(view: View): string {
  return `More actions for ${view.name || 'Untitled'}`;
}

/** Names of views: 1 to 100 characters (REQUEST_LIMITS.name in @carehub/databases/schemas). */
export const VIEW_NAME_MAX = 100;

/** A new view is named after its layout: "Board", then "Board 2". */
export function newViewName(layout: ViewLayout, views: readonly View[]): string {
  return uniqueViewName(
    LAYOUT_LABELS[layout],
    views.map((v) => v.name),
  );
}

export interface TabSizes {
  /** Each tab's width, in order. */
  widths: readonly number[];
  /** The space between two tabs. */
  gap: number;
  /** Room for the tabs, and for More when they don't all fit. */
  room: number;
  /** More's width, with the space before it. */
  more: number;
  /** The tab showing, which stays in sight (-1: none). */
  active: number;
}

/**
 * The tabs in sight, in order: all of them when they fit, else as many as fit beside More. When
 * the tab showing would be in More, it takes the last place that fits.
 */
export function fitTabs({ widths, gap, room, more, active }: TabSizes): number[] {
  const span = (tabs: readonly number[]) =>
    tabs.reduce((sum, i) => sum + (widths[i] ?? 0), 0) + gap * Math.max(tabs.length - 1, 0);
  const all = widths.map((_, i) => i);
  if (span(all) <= room) return all;
  const shown: number[] = [];
  for (const i of all) {
    if (span([...shown, i]) + more > room) break;
    shown.push(i);
  }
  if (active < 0 || active >= widths.length || shown.includes(active)) return shown;
  while (shown.length > 0 && span([...shown, active]) + more > room) shown.pop();
  return [...shown, active];
}

/**
 * Every view's id in order after one tab moves before or after another, for PUT /views/order.
 * A dashboard's tiles keep their places. Null when nothing would move.
 */
export function placeTab(
  views: readonly View[],
  viewId: Id,
  targetId: Id,
  after: boolean,
): Id[] | null {
  const tabs = tabViews(views).map((v) => v.id);
  if (viewId === targetId || !tabs.includes(viewId)) return null;
  const order = tabs.filter((id) => id !== viewId);
  const at = order.indexOf(targetId);
  if (at < 0) return null;
  order.splice(after ? at + 1 : at, 0, viewId);
  if (order.every((id, i) => id === tabs[i])) return null;
  let next = 0;
  return views.map((v) => (v.dashboardId === undefined ? (order[next++] ?? v.id) : v.id));
}

/** The tab that shows when this one is deleted: the next one, else the one before. */
export function tabAfterDelete(tabs: readonly View[], viewId: Id): Id | null {
  const at = tabs.findIndex((v) => v.id === viewId);
  if (at < 0) return null;
  return (tabs[at + 1] ?? tabs[at - 1])?.id ?? null;
}
