/** Undo and redo history for any immutable value (the Studio keeps the course here). */
export type EditHistory<T> = {
  past: T[];
  present: T;
  future: T[];
  group: string | null; // what the last edit was, for coalescing rapid edits to the same field
  at: number; // when the last edit happened (ms)
};

/** At most this many steps can be undone. */
export const HISTORY_LIMIT = 100;
/** Edits in the same group less than this far apart (ms) become one undo step. */
export const COALESCE_MS = 1000;

/** A history with nothing to undo. */
export function createHistory<T>(present: T): EditHistory<T> {
  return { past: [], present, future: [], group: null, at: 0 };
}

/**
 * Records `next` as the new present. Pass `group` (e.g. "text:<blockId>") and `at` (Date.now()) for typing:
 * edits to the same group within a second are merged into one step. Same value = no change. Clears redo.
 */
export function pushHistory<T>(
  history: EditHistory<T>,
  next: T,
  options: { group?: string; at?: number } = {},
): EditHistory<T> {
  if (Object.is(next, history.present)) return history;
  const group = options.group ?? null;
  const at = options.at ?? history.at;
  const merge =
    group !== null &&
    group === history.group &&
    at - history.at < COALESCE_MS &&
    history.past.length > 0;
  const past = merge ? history.past : [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], group, at };
}

/** Steps back one edit (unchanged when there is nothing to undo). */
export function undoHistory<T>(history: EditHistory<T>): EditHistory<T> {
  const previous = history.past[history.past.length - 1];
  if (history.past.length === 0) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous as T,
    future: [history.present, ...history.future],
    group: null,
    at: history.at,
  };
}

/** Re-applies the last undone edit (unchanged when there is nothing to redo). */
export function redoHistory<T>(history: EditHistory<T>): EditHistory<T> {
  if (history.future.length === 0) return history;
  const [next, ...future] = history.future as [T, ...T[]];
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future,
    group: null,
    at: history.at,
  };
}

/** Whether there is an edit to undo. */
export const canUndo = (history: EditHistory<unknown>): boolean => history.past.length > 0;
/** Whether there is an edit to redo. */
export const canRedo = (history: EditHistory<unknown>): boolean => history.future.length > 0;
