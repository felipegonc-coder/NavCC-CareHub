/**
 * A database's own page (the page view's `pageKindViews.database`): the database whose id is the
 * page's, with the view the link names in `?v=`. Picking another view updates the link. Delete
 * (in "…", Full access) moves the page to Trash, with its rows, and goes to the page it was in.
 */
import { pageUrl } from '@carehub/shared';
import { useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useDatabaseClient } from '../hooks';
import { DatabaseView } from './database-view';
import { errorText } from './states';
import { useToasts, WithToasts } from './toasts';

/** The link's view parameter: `/p/<databaseId>?v=<viewId>`. */
export const VIEW_PARAM = 'v';

export interface DatabasePageProps {
  /** The page of kind 'database'; its id is the database's. */
  page: { id: string };
}

export function DatabasePage(props: DatabasePageProps) {
  // Toasts sit outside the view, so a failed Delete can say why.
  return (
    <WithToasts>
      <DatabasePageBody {...props} />
    </WithToasts>
  );
}

function DatabasePageBody({ page }: DatabasePageProps) {
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
  const deletePage = useDeletePage(page.id);
  return (
    <DatabaseView
      databaseId={page.id}
      viewId={viewId}
      onViewChange={followView}
      onDelete={deletePage}
    />
  );
}

/** The `parentId` of a GET /api/pages/:id answer, or null at the top of a space. */
export function parentOf(answer: unknown): string | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const { parentId } = answer as { parentId?: unknown };
  return typeof parentId === 'string' && parentId !== '' ? parentId : null;
}

/**
 * Delete: DELETE /api/pages/:id (decision 0007), then the page it was in, or Home when it was at the
 * top of a space. The trashed page leaves the history, so Back doesn't land on it.
 */
function useDeletePage(pageId: string): () => void {
  const client = useDatabaseClient();
  const navigate = useNavigate();
  const toasts = useToasts();
  return useCallback(() => {
    const trash = async () => {
      const parentId = parentOf(await client.getPage(pageId));
      await client.trashPage(pageId);
      void navigate(parentId === null ? '/' : pageUrl(parentId), { replace: true });
    };
    trash().catch((error: unknown) => toasts.show({ message: errorText(error) }));
  }, [client, navigate, pageId, toasts]);
}
