// Changes made on a page's screen: shown everywhere at once, and undone if the server refuses.
import { useToast } from '@carehub/ui';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { ApiError } from '../../lib/api';
import { changePage, pagesKeys, type PageChange, type PageDetail } from './api';
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

/**
 * Changes page `id` on the server, showing `shown` on its screen at once (and a new icon in every
 * list); if the server refuses, it all goes back and a toast titled `failed` says why. Resolves
 * to whether the server took the change.
 */
export function useChangePage(id: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useCallback(
    async (change: PageChange, shown: Partial<PageDetail>, failed: string): Promise<boolean> => {
      const key = pagesKeys.page(id);
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<PageDetail>(key);
      queryClient.setQueryData<PageDetail>(key, (data) => data && { ...data, ...shown });
      if (shown.icon !== undefined) showEverywhere(queryClient, id, { icon: shown.icon });
      try {
        await changePage(id, change);
        return true;
      } catch (error) {
        queryClient.setQueryData(key, before);
        if (shown.icon !== undefined)
          showEverywhere(queryClient, id, { icon: before?.icon ?? null });
        toast({ title: failed, description: reasonOf(error), variant: 'danger' });
        return false;
      } finally {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    [id, queryClient, toast],
  );
}
