// Changes made on a page's screen: shown at once, sent to the server, and undone if refused.
import { useToast } from '@carehub/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { changePage, pagesKeys, type PageChange, type PageDetail } from './api';
import { reasonOf, showEverywhere } from './PageHeader';

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
