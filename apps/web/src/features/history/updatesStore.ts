// Which page's Updates panel is open, shared by the page menu item, other features (the top
// bar's 🕘 once there's a slot for it) and the panel itself.
import { useSyncExternalStore } from 'react';
import type { HistoryPageRef } from './store';

let open: HistoryPageRef | null = null;
const listeners = new Set<() => void>();

function changed(next: HistoryPageRef | null) {
  open = next;
  for (const listener of listeners) listener();
}

/** Opens the Updates panel for `page`. */
export function openUpdates(page: HistoryPageRef): void {
  changed({ id: page.id, title: page.title });
}

export function closeUpdates(): void {
  if (open !== null) changed(null);
}

/** The page whose Updates are open, or null. */
export function currentUpdates(): HistoryPageRef | null {
  return open;
}

/** `currentUpdates()`, kept up to date. */
export function useUpdatesPage(): HistoryPageRef | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    currentUpdates,
    () => null,
  );
}
