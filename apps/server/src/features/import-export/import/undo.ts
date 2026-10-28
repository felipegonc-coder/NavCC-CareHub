import type { UndoPreview } from '@carehub/extras/import-export/import/index';
import type { ImportItem } from './store';

// Undo import (Import and export spec, section 3.1): what the import made goes to Trash as one
// entry. Pages changed since are listed first and stay, unless "Remove them too" is ticked.

/** Each part of the preview lists at most this many pages. */
export const PREVIEW_MAX = 1_000;

/**
 * What stays: the changed pages and databases (a changed row is a change to its database), every
 * page above them, so they keep their place, and the rows of a database that stays.
 */
export function keptItems(items: readonly ImportItem[], changed: ReadonlySet<string>): Set<string> {
  const byId = new Map(items.map((item) => [item.pageId, item]));
  const kept = new Set<string>();
  const keepWithParents = (pageId: string | null) => {
    let item = pageId === null ? undefined : byId.get(pageId);
    while (item && !kept.has(item.pageId)) {
      kept.add(item.pageId);
      item = item.parentId === null ? undefined : byId.get(item.parentId);
    }
  };
  for (const item of items) {
    if (changed.has(item.pageId))
      keepWithParents(item.kind === 'row' ? item.parentId : item.pageId);
  }
  // Items come parents first, so each row sees whether its database stays.
  for (const item of items) {
    if (item.kind === 'row' && item.parentId !== null && kept.has(item.parentId)) {
      kept.add(item.pageId);
    }
  }
  return kept;
}

/**
 * The pages to move to Trash: the top-most ones that don't stay. What's under them goes with them,
 * so rows go with their database.
 */
export function undoTrash(
  items: readonly ImportItem[],
  changed: ReadonlySet<string>,
  removeChanged: boolean,
): string[] {
  const made = new Set(items.map((item) => item.pageId));
  const kept = removeChanged ? new Set<string>() : keptItems(items, changed);
  return items
    .filter(
      (item) =>
        !kept.has(item.pageId) &&
        (item.parentId === null || !made.has(item.parentId) || kept.has(item.parentId)),
    )
    .map((item) => item.pageId);
}

/** What Undo import will do, pages and databases only: what stays unless ticked, then the rest. */
export function undoPreview(
  items: readonly ImportItem[],
  changed: ReadonlySet<string>,
): UndoPreview {
  const kept = keptItems(items, changed);
  const listed = items.filter((item) => item.kind !== 'row');
  const entries = (part: ImportItem[]) =>
    part.slice(0, PREVIEW_MAX).map(({ pageId, title }) => ({ pageId, title }));
  return {
    changed: entries(listed.filter((item) => kept.has(item.pageId))),
    unchanged: entries(listed.filter((item) => !kept.has(item.pageId))),
  };
}
