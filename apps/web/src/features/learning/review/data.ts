import {
  REVIEW_TOKEN_HEADER,
  ReviewCommentSchema,
  ReviewReplySchema,
  type CreateReviewCommentRequest,
  type ReviewReply,
} from '@carehub/learning';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, isRetryable } from '../data';

// The review screen's calls (docs/learning/api.md): the shared draft with this link's comments, and a new
// comment. The token goes in the X-Review-Token header, never in the path (0309).

export const reviewKey = (token: string) => ['learning', 'review', token] as const;

const withToken = (token: string) => ({ [REVIEW_TOKEN_HEADER]: token });

/** GET /review: the draft and the comments left through this link. A stopped or expired link is a 404. */
export function useReview(token: string) {
  return useQuery({
    queryKey: reviewKey(token),
    queryFn: ({ signal }) =>
      api('GET', '/review', ReviewReplySchema, { signal, headers: withToken(token) }),
    retry: (failures, error) => failures < 1 && isRetryable(error),
  });
}

/** POST /review/comments. The new comment goes straight into the cached review. */
export function useAddReviewComment(token: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReviewCommentRequest) =>
      api('POST', '/review/comments', input, ReviewCommentSchema, { headers: withToken(token) }),
    onSuccess: (comment) => {
      client.setQueryData<ReviewReply>(
        reviewKey(token),
        (review) => review && { ...review, comments: [...review.comments, comment] },
      );
    },
  });
}
