import {
  NewReviewLinkSchema,
  ReviewCommentSchema,
  ReviewLinkSchema,
  type Id,
  type ReviewComment,
  type ReviewLink,
  type ReviewLinkDays,
} from '@carehub/learning';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api, apiPath, isRetryable, LEARNING_API, noContent } from '../data';

// Studio's review calls (docs/learning/api.md, learning.build): review links for a course, and the comments left
// through all of them.

export const reviewLinksKey = (courseId: Id) => ['learning', 'review-links', courseId] as const;
export const reviewCommentsKey = (courseId: Id) =>
  ['learning', 'review-comments', courseId] as const;

const retry = (failures: number, error: unknown) => failures < 1 && isRetryable(error);
const linksPath = (courseId: Id) => apiPath('studio', 'courses', courseId, 'review-links');
const commentsPath = (courseId: Id) => apiPath('studio', 'courses', courseId, 'comments');

/** Where the comments download as CSV, dated in the author's time zone. */
export const reviewCommentsCsvHref = (courseId: Id) =>
  LEARNING_API + apiPath('studio', 'courses', courseId, 'comments.csv');

/** The links that still open the draft, newest first. */
export function useReviewLinks(courseId: Id) {
  return useQuery({
    queryKey: reviewLinksKey(courseId),
    queryFn: ({ signal }) => api('GET', linksPath(courseId), z.array(ReviewLinkSchema), { signal }),
    retry,
  });
}

/** Makes a link. Its address comes back only in this reply, so show it now. */
export function useShareForReview(courseId: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (days: ReviewLinkDays) =>
      api('POST', linksPath(courseId), { days }, NewReviewLinkSchema),
    // Links go into the list without their address: only the panel that made one shows it, once.
    onSuccess: ({ id, createdAt, expiresAt, createdBy }) => {
      const link: ReviewLink = { id, createdAt, expiresAt, createdBy };
      client.setQueryData<ReviewLink[]>(reviewLinksKey(courseId), (links) => [
        link,
        ...(links ?? []),
      ]);
    },
  });
}

/** Stops a link: it stops opening the draft at once, and its comments stay. */
export function useStopSharing(courseId: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (linkId: Id) => api('DELETE', apiPath('studio', 'review-links', linkId), noContent),
    onSuccess: (_nothing, linkId) => {
      client.setQueryData<ReviewLink[]>(reviewLinksKey(courseId), (links) =>
        links?.filter((link) => link.id !== linkId),
      );
    },
  });
}

/** Every comment on the course, through any link, oldest first. */
export function useCourseReviewComments(courseId: Id) {
  return useQuery({
    queryKey: reviewCommentsKey(courseId),
    queryFn: ({ signal }) =>
      api('GET', commentsPath(courseId), z.array(ReviewCommentSchema), { signal }),
    retry,
  });
}

/** Marks a comment resolved, or open again. */
export function useResolveComment(courseId: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resolved }: { id: Id; resolved: boolean }) =>
      api('PATCH', apiPath('studio', 'comments', id), { resolved }, ReviewCommentSchema),
    onSuccess: (comment) => {
      client.setQueryData<ReviewComment[]>(reviewCommentsKey(courseId), (comments) =>
        comments?.map((each) => (each.id === comment.id ? comment : each)),
      );
    },
  });
}
