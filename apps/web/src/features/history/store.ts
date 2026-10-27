// Which page's Version history window is open, shared by the page menu item, Ctrl+Alt+H,
// `?version=` links and the window itself.
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
