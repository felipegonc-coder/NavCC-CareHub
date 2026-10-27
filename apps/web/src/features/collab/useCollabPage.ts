import type { EditorUser } from '@carehub/editor';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { firstName, presenceColor } from './presence';
import { acquirePage, releasePage, type PageSession, type PageState } from './session';

/** The signed-in person. */
export interface CollabMe {
  id: string;
  name: string;
}

export interface CollabPage extends PageState {
  /** You, as other people see you next to your caret: first name and presence color. */
  user: EditorUser;
  dismissNotice: () => void;
  /** Opens the page again after an error. */
  retry: () => void;
}

const noSubscribe = () => () => {};
const noState = () => null;

/**
 * Opens `pageId` for live co-editing while the component is mounted. Null until it's open, and
 * while `pageId` or `me` is null.
 */
export function useCollabPage(pageId: string | null, me: CollabMe | null): CollabPage | null {
  const userId = me?.id ?? null;
  const name = me?.name ?? '';
  const [session, setSession] = useState<PageSession | null>(null);

  useEffect(() => {
    if (!pageId || !userId) return;
    const opened = acquirePage(userId, pageId);
    setSession(opened);
    return () => {
      setSession(null);
      releasePage(opened);
    };
  }, [pageId, userId]);

  const current =
    session && session.pageId === pageId && session.userId === userId ? session : null;
  const state = useSyncExternalStore<PageState | null>(
    current?.subscribe ?? noSubscribe,
    current?.getState ?? noState,
  );
  const user = useMemo(
    () => ({ id: userId ?? '', name: firstName(name), color: presenceColor(userId ?? '') }),
    [userId, name],
  );
  return useMemo(
    () =>
      state && current
        ? {
            ...state,
            user,
            dismissNotice: () => current.dismissNotice(),
            retry: () => current.retry(),
          }
        : null,
    [state, current, user],
  );
}
