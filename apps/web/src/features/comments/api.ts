import type { CommentsResponse, CreateCommentInput, CreateCommentResponse } from '@carehub/shared';
import { api, ApiError } from '../../lib/api';

/** The query key of a page's threads. */
export const commentsKey = (pageId: string) => ['comments', pageId] as const;

/** Open tabs of a page hear `comments.changed` here after every change (Can view needed). */
export const commentsTopic = (pageId: string) => `comments:${pageId}`;

const id = encodeURIComponent;

/** `/api/comments` (see apps/server/src/features/comments/README.md). */
export const commentsApi = {
  /** Every thread of the page, open and resolved, with its comments. */
  list: (pageId: string, signal?: AbortSignal) =>
    api.get<CommentsResponse>(`/api/comments?pageId=${id(pageId)}&status=all`, { signal }),
  /** A reply with `threadId` (it reopens a resolved thread), else a new thread. */
  create: (input: CreateCommentInput) => api.post<CreateCommentResponse>('/api/comments', input),
  edit: (commentId: string, text: string) => api.patch(`/api/comments/${id(commentId)}`, { text }),
  remove: (commentId: string) => api.delete(`/api/comments/${id(commentId)}`),
  resolve: (threadId: string, resolved: boolean) =>
    api.patch(`/api/comments/threads/${id(threadId)}`, { resolved }),
};

/** Words for a failed call: the server's message, or a general one. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}
