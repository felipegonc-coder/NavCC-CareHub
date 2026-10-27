/**
 * Which view shows, and the viewer's own filter, sorts and grouping on top of it ("Changed for you
 * only · Reset"). Plain functions, so they're tested without React.
 */
import type { DatabaseMeta, Id, View, ViewOverride } from '@carehub/databases';
import { can } from '@carehub/databases/access';

/** The views listed as tabs, in order. A dashboard's tiles belong to their dashboard instead. */
export function tabViews(views: readonly View[]): View[] {
  return views.filter((view) => view.dashboardId === undefined);
}

/** Where this device remembers the view used last in a database. */
export function lastViewKey(databaseId: Id): string {
  return `carehub.databases.lastView.${databaseId}`;
}

export function readLastView(databaseId: Id): Id | null {
  try {
    return globalThis.localStorage.getItem(lastViewKey(databaseId));
  } catch {
    // Storage can be turned off (private windows): then the first tab opens.
    return null;
  }
}

export function rememberView(databaseId: Id, viewId: Id): void {
  try {
    globalThis.localStorage.setItem(lastViewKey(databaseId), viewId);
  } catch {
    // Storage can be turned off or full: the first tab opens next time.
  }
}

/** The view that opens: the one the link names, else the one used last, else the first tab. */
export function pickView(
  views: readonly View[],
  linked: Id | null | undefined,
  lastUsed: Id | null,
): View | null {
  const tabs = tabViews(views);
  return (
    tabs.find((v) => v.id === linked) ?? tabs.find((v) => v.id === lastUsed) ?? tabs[0] ?? null
  );
}

/** The saved view with the viewer's own filter, sorts and grouping on top. */
export function withOverride(view: View, override: ViewOverride | null): View {
  if (!override) return view;
  const next = { ...view };
  if (override.filter !== undefined) next.filter = override.filter;
  if (override.sorts !== undefined) next.sorts = override.sorts;
  if (override.grouping !== undefined) next.grouping = override.grouping;
  return next;
}

/**
 * A view change from someone who can't save views: the filter, sorts and grouping in it, added to
 * what they changed before. Everything else in the change is left out.
 */
export function mergeOverride(
  override: ViewOverride | null,
  change: Partial<View>,
): ViewOverride | null {
  const next: ViewOverride = { ...(override ?? {}) };
  if (change.filter !== undefined) next.filter = change.filter;
  if (change.sorts !== undefined) next.sorts = change.sorts;
  if (change.grouping !== undefined) next.grouping = change.grouping;
  return Object.keys(next).length > 0 ? next : null;
}

/** Whether the viewer saves view changes for everyone (otherwise they're theirs only). */
export function canEditViews(meta: Pick<DatabaseMeta, 'viewerAccess' | 'locked'>): boolean {
  return can('edit_views', meta.viewerAccess, { locked: meta.locked });
}
