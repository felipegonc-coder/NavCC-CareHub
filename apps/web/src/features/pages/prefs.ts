// Per-person sidebar settings (Sidebar spec, section 4), kept by the server under /api/me/prefs.
// A change shows at once and is saved half a second after the last one.
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { fetchPrefs, pagesKeys, savePref } from './api';

type Prefs = Record<string, unknown>;
const SAVE_DELAY = 500;
/** Open entries kept per person; past this the oldest are forgotten. */
const MAX_ITEMS = 500;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function writePref(queryClient: QueryClient, key: string, value: unknown) {
  queryClient.setQueryData<Prefs>(pagesKeys.prefs, (prefs) => ({ ...prefs, [key]: value }));
  clearTimeout(timers.get(key));
  const timer = setTimeout(() => {
    timers.delete(key);
    savePref(key, value).catch(() => undefined); // a setting that didn't save isn't worth an error
  }, SAVE_DELAY);
  timers.set(key, timer);
}

function usePrefs(): Prefs | undefined {
  return useQuery({ queryKey: pagesKeys.prefs, queryFn: fetchPrefs, staleTime: Infinity }).data;
}

export function useFlagPref(key: string, fallback: boolean): [boolean, (on: boolean) => void] {
  const queryClient = useQueryClient();
  const value = usePrefs()?.[key];
  const set = useCallback((on: boolean) => writePref(queryClient, key, on), [queryClient, key]);
  return [typeof value === 'boolean' ? value : fallback, set];
}

/** A saved set of strings, such as the open tree entries or the collapsed sections. */
export function useSetPref(
  key: string,
): [ReadonlySet<string>, (items: readonly string[], on: boolean) => void] {
  const queryClient = useQueryClient();
  const value = usePrefs()?.[key];
  const items = useMemo(() => new Set(Array.isArray(value) ? value.map(String) : []), [value]);
  const change = useCallback(
    (changed: readonly string[], on: boolean) => {
      const saved = queryClient.getQueryData<Prefs>(pagesKeys.prefs)?.[key];
      const list = (Array.isArray(saved) ? saved.map(String) : []).filter(
        (item) => !changed.includes(item),
      );
      if (on) list.push(...changed);
      writePref(queryClient, key, list.slice(-MAX_ITEMS));
    },
    [queryClient, key],
  );
  return [items, change];
}
