// Which page's Version history window is open, shared by the page menu item, Ctrl+Alt+H,
// `?version=` links and the window itself; and the restores this tab made, so it doesn't show its
// own restore note twice.
import { useSyncExternalStore } from 'react';

export interface HistoryPageRef {
  id: string;
  title: string;
}

export interface HistoryTarget {
  page: HistoryPageRef;
  /** The version to show first; the newest when null. */
  versionId: string | null;
}

let target: HistoryTarget | null = null;
const listeners = new Set<() => void>();

function changed(next: HistoryTarget | null) {
  target = next;
  for (const listener of listeners) listener();
}

/** Opens Version history for `page`, on `versionId` if given. */
export function openVersionHistory(page: HistoryPageRef, versionId: string | null = null): void {
  changed({ page: { id: page.id, title: page.title }, versionId });
}

export function closeVersionHistory(): void {
  if (target !== null) changed(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The open window's page and first version, or null while it's closed. */
export function currentVersionHistory(): HistoryTarget | null {
  return target;
}

/** `currentVersionHistory()`, kept up to date. */
export function useVersionHistoryTarget(): HistoryTarget | null {
  return useSyncExternalStore(subscribe, currentVersionHistory, () => null);
}

const restoring = new Map<string, Promise<unknown>>();
const restoredHere = new Set<string>();

/**
 * Runs a restore this tab asked for and remembers the version it saved, so the page watcher skips
 * the live note for it (the window shows the note itself).
 */
export function runRestore<T extends { version: { id: string } }>(
  pageId: string,
  restore: () => Promise<T>,
): Promise<T> {
  const run = restore().then((result) => {
    restoredHere.add(result.version.id);
    return result;
  });
  restoring.set(pageId, run);
  const done = () => {
    if (restoring.get(pageId) === run) restoring.delete(pageId);
  };
  run.then(done, done);
  return run;
}

/** True if this tab made the restore that saved `versionId`; waits for its own pending one. */
export async function isOwnRestore(pageId: string, versionId: string): Promise<boolean> {
  await restoring.get(pageId)?.catch(() => undefined);
  return restoredHere.has(versionId);
}
