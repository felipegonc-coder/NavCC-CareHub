// What the page menu items share with the overlay that shows the Export dialog: which page it's
// open for, whether Export shows on a page, and the router's navigate for Print.
import { useSyncExternalStore } from 'react';

/** The page the dialog exports (the page menu's page). */
export interface ExportTarget {
  id: string;
  kind: 'page' | 'database' | 'row';
  title: string;
}

let target: ExportTarget | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openExportDialog(page: ExportTarget): void {
  target = { id: page.id, kind: page.kind, title: page.title };
  listeners.forEach((listener) => listener());
}

export function closeExportDialog(): void {
  target = null;
  listeners.forEach((listener) => listener());
}

export function useExportTarget(): ExportTarget | null {
  return useSyncExternalStore(
    subscribe,
    () => target,
    () => null,
  );
}

// Page menu items decide at once whether they show, so the overlay asks the server as each page
// opens and remembers the answer (IE-16). Until it knows, Export stays hidden.
const allowed = new Map<string, boolean>();

export function exportAllowed(pageId: string): boolean {
  return allowed.get(pageId) === true;
}

export function rememberExportAllowed(pageId: string, value: boolean): void {
  allowed.set(pageId, value);
}

let navigate: ((to: string) => void) | null = null;

/** The overlay hands over the router's navigate; the returned function takes it back. */
export function setExportNavigate(next: (to: string) => void): () => void {
  navigate = next;
  return () => {
    if (navigate === next) navigate = null;
  };
}

/** Opens a Care Hub path: with the router when it's there, else as a new page load. */
export function goTo(path: string): void {
  if (navigate) navigate(path);
  else window.location.assign(path);
}

/** The Print view of a page; `pdf` adds the Save as PDF hint and opens the print dialog. */
export function printPath(pageId: string, options: { pdf?: boolean; dialog?: boolean } = {}) {
  const query = options.pdf ? '?pdf=1' : options.dialog ? '?dialog=1' : '';
  return `/p/${encodeURIComponent(pageId)}/print${query}`;
}

/** For tests: forgets the dialog, the answers and navigate. */
export function resetExportStore(): void {
  target = null;
  allowed.clear();
  navigate = null;
  listeners.forEach((listener) => listener());
}
