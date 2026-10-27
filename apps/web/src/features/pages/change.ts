// Changes made on a page's screen: shown everywhere at once, and undone if the server refuses.
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { pagesKeys } from './api';
import { patchCached, type ShownFields } from './page';

/** Page data in the cache; the person's settings and account aren't touched. */
const isPageData = (key: readonly unknown[]) => !['prefs', 'me'].includes(String(key[1]));

/** Shows `fields` of page `id` in every page list and screen at once, before the server answers. */
export function showEverywhere(queryClient: QueryClient, id: string, fields: ShownFields) {
  for (const [key, data] of queryClient.getQueriesData({ queryKey: pagesKeys.all })) {
    if (data !== undefined && isPageData(key)) {
      queryClient.setQueryData(key, patchCached(data, id, fields));
    }
  }
}

/** Why the server refused, when it says. */
export const reasonOf = (error: unknown) =>
  error instanceof ApiError && error.status < 500 ? error.message : undefined;
