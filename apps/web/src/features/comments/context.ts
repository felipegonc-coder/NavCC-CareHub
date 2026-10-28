import type { CommentPerson } from '@carehub/shared';
import { createContext, useContext } from 'react';
import type { CommentActions } from './hooks';

/** What a thread needs from the panel around it. */
export interface CommentsContextValue {
  pageId: string;
  people: Record<string, CommentPerson>;
  canComment: boolean;
  viewer: CommentPerson | undefined;
  actions: CommentActions;
}

export const CommentsContext = createContext<CommentsContextValue | null>(null);

export function useCommentsContext(): CommentsContextValue {
  const value = useContext(CommentsContext);
  if (!value) throw new Error('A comment thread needs a <CommentsContext> around it.');
  return value;
}
