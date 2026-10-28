import { useSyncExternalStore } from 'react';

// Whether the search window is open. Ctrl+K, Ctrl+P, the sidebar's Search and other features
// (openSearch) all open the one window in the shell's overlays.
let open = false;
const listeners = new Set<() => void>();

function setOpen(next: boolean) {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

/** Opens the search window. */
export const openSearch = () => setOpen(true);
export const closeSearch = () => setOpen(false);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSearchOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}
