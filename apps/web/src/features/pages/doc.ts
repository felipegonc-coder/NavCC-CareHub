// The page's content: one Y.Doc per page, edited live through the collaboration server (decision
// 0007, section 4.2).
import type { CollabProvider } from '@carehub/editor';
import { useMemo } from 'react';
import * as Y from 'yjs';

export interface PageDoc {
  ydoc: Y.Doc;
  /** The live connection; null while there is none, and the blocks stay in this tab. */
  provider: CollabProvider | null;
}

/**
 * The live document of page `pageId`. Until the collaboration client for /api/collab lands, the
 * document lives in this tab only; that client replaces the inside of this hook, not its callers.
 */
export function usePageDoc(pageId: string): PageDoc {
  return useMemo(() => ({ ydoc: new Y.Doc({ guid: pageId }), provider: null }), [pageId]);
}
