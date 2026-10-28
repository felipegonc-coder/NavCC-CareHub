// Remind me can be opened from anywhere (the page "…" menu, Ctrl+K, an event's panel, search);
// RemindMeOverlay, which the app shell renders once, shows it.
import { useSyncExternalStore } from 'react';
import type { RemindMeTarget } from './choices';

export interface RemindMeRequest {
  /** A new number each time, so a new request starts afresh. */
  id: number;
  /** Null: there's nothing to remind about here (Ctrl+K away from a page). */
  target: RemindMeTarget | null;
  /** Where focus goes back to when it closes. */
  returnFocus: HTMLElement | null;
}

let current: RemindMeRequest | null = null;
let lastId = 0;
const listeners = new Set<() => void>();

function publish(next: RemindMeRequest | null) {
  current = next;
  for (const listener of listeners) listener();
}

/** The focused element, or the button that opened the menu it's in (the menu is closing). */
function focusOrigin(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  const menu = active.closest('[role="menu"]');
  const opener = menu?.id
    ? [...document.querySelectorAll<HTMLElement>('[aria-controls]')].find(
        (element) => element.getAttribute('aria-controls') === menu.id,
      )
    : undefined;
  return opener ?? active;
}

/** Opens Remind me for a page or an event; focus goes back where it was when it closes. */
export function openRemindMe(target: RemindMeTarget | null): void {
  lastId += 1;
  publish({ id: lastId, target, returnFocus: focusOrigin() });
}

export function closeRemindMe(): void {
  publish(null);
}

export function useRemindMeRequest(): RemindMeRequest | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}

/** The page open at `pathname` (`/p/<pageId>`), if any. */
export function pageIdIn(pathname: string): string | null {
  return /^\/p\/([0-9a-f-]{36})\/?$/i.exec(pathname)?.[1] ?? null;
}
