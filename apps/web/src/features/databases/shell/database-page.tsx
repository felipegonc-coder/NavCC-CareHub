/**
 * A database's own page (the page view's `pageKindViews.database`): the database whose id is the
 * page's, with the view the link names in `?v=`. Picking another view updates the link.
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { DatabaseView } from './database-view';

/** The link's view parameter: `/p/<databaseId>?v=<viewId>`. */
export const VIEW_PARAM = 'v';

export interface DatabasePageProps {
  /** The page of kind 'database'; its id is the database's. */
  page: { id: string };
}

export function DatabasePage({ page }: DatabasePageProps) {
  const [params, setParams] = useSearchParams();
  const viewId = params.get(VIEW_PARAM) ?? undefined;
  const followView = useCallback(
    (picked: string) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set(VIEW_PARAM, picked);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return <DatabaseView databaseId={page.id} viewId={viewId} onViewChange={followView} />;
}
