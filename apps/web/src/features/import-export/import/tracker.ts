import type { ImportView } from '@carehub/extras/import-export/import/index';
import { useSyncExternalStore } from 'react';
import { ApiError } from '../../../lib/api';
import { importsApi } from './client';

// The imports this tab follows, for the progress panel (Import and export spec, section 2): the
// ones started here and, after a reload, the person's imports that are still going. Each is
// checked every 2 seconds until it ends.

export interface FollowedImports {
  /** Newest first. */
  imports: readonly ImportView[];
  /** The panel shows; closing it doesn't stop the imports. */
  open: boolean;
}

const GOING: ReadonlySet<ImportView['status']> = new Set(['uploading', 'waiting', 'running']);

/** Still uploading, waiting in line or running. */
export const isGoing = (view: ImportView) => GOING.has(view.status);

export interface TrackerOptions {
  get?: (id: string) => Promise<ImportView>;
  list?: () => Promise<ImportView[]>;
  /** Milliseconds between checks. */
  every?: number;
}

export function createTracker({
  get = (id) => importsApi.get(id),
  list = () => importsApi.list(),
  every = 2_000,
}: TrackerOptions = {}) {
  let state: FollowedImports = { imports: [], open: false };
  const listeners = new Set<() => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  // Bumped on every change, so an answer that arrives after a newer one is dropped.
  const versions = new Map<string, number>();

  const set = (next: Partial<FollowedImports>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const unschedule = (id: string) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
  };

  // An upload this tab didn't start may have stopped with its tab, so it's checked less often.
  const schedule = (view: ImportView, slower = 1) => {
    unschedule(view.id);
    const wait = every * slower * (view.status === 'uploading' ? 15 : 1);
    if (isGoing(view))
      timers.set(
        view.id,
        setTimeout(() => void check(view.id), wait),
      );
  };

  const put = (view: ImportView, open: boolean) => {
    const before = state.imports.find((item) => item.id === view.id);
    versions.set(view.id, (versions.get(view.id) ?? 0) + 1);
    const imports = before
      ? state.imports.map((item) => (item.id === view.id ? view : item))
      : [view, ...state.imports];
    // Until the 🔔 notice can reopen it, the panel opens again when an import ends.
    const ended = before !== undefined && isGoing(before) && !isGoing(view);
    set({ imports, open: open || ended || state.open });
    schedule(view);
  };

  async function check(id: string) {
    timers.delete(id);
    const version = versions.get(id);
    try {
      const view = await get(id);
      if (versions.get(id) === version && state.imports.some((item) => item.id === id)) {
        put(view, false);
      }
    } catch (error) {
      const current = state.imports.find((item) => item.id === id);
      if (!current || versions.get(id) !== version) return;
      if (error instanceof ApiError && error.status === 404) dismiss(id);
      // Offline or a hiccup: check again, less often.
      else schedule(current, 5);
    }
  }

  function dismiss(id: string) {
    unschedule(id);
    versions.delete(id);
    const imports = state.imports.filter((item) => item.id !== id);
    set({ imports, open: state.open && imports.length > 0 });
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    snapshot: () => state,
    /** Shows the import in the panel and checks on it until it ends. */
    follow: (view: ImportView) => put(view, true),
    /** A newer view of a followed import, such as the answer to Cancel or Undo. */
    update(view: ImportView) {
      if (state.imports.some((item) => item.id === view.id)) put(view, false);
    },
    /** Takes a finished import out of the panel. */
    dismiss,
    open: () => set({ open: state.imports.length > 0 }),
    close: () => set({ open: false }),
    /** After a reload: follows the person's imports that are still going, without opening. */
    async resume() {
      const imports = await list().catch(() => []);
      for (const view of imports.filter(isGoing).reverse()) {
        if (!state.imports.some((item) => item.id === view.id)) put(view, false);
      }
    },
    /** Stops every check (tests, sign-out). */
    stop() {
      for (const id of [...timers.keys()]) unschedule(id);
    },
  };
}

export type ImportTracker = ReturnType<typeof createTracker>;

/** The tab's tracker, shared by the Import screen and the progress panel. */
export const importTracker = createTracker();

export function useFollowedImports(tracker: ImportTracker = importTracker): FollowedImports {
  return useSyncExternalStore(tracker.subscribe, tracker.snapshot, tracker.snapshot);
}
