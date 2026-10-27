/**
 * Paging (spec 3.2 "Load limit"; additions 11–12): each group shows the view's load limit, then
 * "Load more" continues it from a cursor. One answer holds at most LIMITS.queryPageRows rows.
 */
import { LIMITS, type Id, type View } from '../types';

const LOAD_LIMITS: readonly number[] = [10, 25, 50, 100, 200];
const DEFAULT_LOAD_LIMIT = 50;

/** Rows a page of one group (or of an ungrouped view) holds: the load limit, at most 100. */
export function pageSize(view: Pick<View, 'loadLimit'>): number {
  const limit = LOAD_LIMITS.includes(view.loadLimit) ? view.loadLimit : DEFAULT_LOAD_LIMIT;
  return Math.min(limit, LIMITS.queryPageRows, LIMITS.loadLimitMax);
}

/** Where "Load more" goes on: the group's keys (none for an ungrouped view) and the last row shown. */
export interface Cursor {
  /** [] ungrouped, [group key] or [group key, sub-group key]. */
  path: string[];
  /** Lines already shown. */
  offset: number;
  /** The last row shown, so rows added or removed in between don't shift the page. */
  after: Id | null;
}

const PREFIX = 'c1:';

/** The cursor as the opaque text sent to the browser. */
export function encodeCursor(cursor: Cursor): string {
  return PREFIX + JSON.stringify([cursor.path, cursor.offset, cursor.after]);
}

/** A cursor back from the browser, or null when it isn't one. */
export function decodeCursor(text: string): Cursor | null {
  if (!text.startsWith(PREFIX)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(PREFIX.length));
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const [path, offset, after] = raw as unknown[];
  if (!Array.isArray(path) || path.length > 2) return null;
  if (!path.every((key): key is string => typeof key === 'string')) return null;
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) return null;
  if (after !== null && typeof after !== 'string') return null;
  return { path, offset, after };
}

/**
 * Where the next page starts: just after the cursor's last row while it's still there. If it has
 * gone (deleted, or it no longer matches), the row after it now sits one place earlier.
 */
export function pageStart(ids: readonly Id[], cursor: Cursor): number {
  if (cursor.after === null) return Math.min(cursor.offset, ids.length);
  const at = ids.indexOf(cursor.after);
  return at >= 0 ? at + 1 : Math.min(Math.max(0, cursor.offset - 1), ids.length);
}

/** `size` items from `start`, and the cursor that goes on after them (null at the end). */
export function takePage<T>(
  items: readonly T[],
  idOf: (item: T) => Id,
  path: string[],
  start: number,
  size: number,
): { page: T[]; next: string | null } {
  const page = items.slice(start, start + Math.max(0, size));
  const end = start + page.length;
  if (end >= items.length) return { page, next: null };
  const last = end > 0 ? items[end - 1] : undefined;
  return { page, next: encodeCursor({ path, offset: end, after: last ? idOf(last) : null }) };
}

/**
 * Shares `cap` rows out among groups that want `wants[i]` each, evenly: groups that want fewer
 * leave the rest to the others, and leftovers go to the earlier groups.
 */
export function shareRows(wants: readonly number[], cap: number): number[] {
  const got = wants.map(() => 0);
  let left = Math.max(0, cap);
  let open = wants.flatMap((want, i) => (want > 0 ? [i] : []));
  while (left > 0 && open.length) {
    const share = Math.max(1, Math.floor(left / open.length));
    const still: number[] = [];
    for (const i of open) {
      const want = wants[i] ?? 0;
      const give = Math.min(share, want - (got[i] ?? 0), left);
      got[i] = (got[i] ?? 0) + give;
      left -= give;
      if ((got[i] ?? 0) < want) still.push(i);
    }
    open = still;
  }
  return got;
}
