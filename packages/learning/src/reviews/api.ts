import { z } from 'zod';
import { CourseSchema } from '../format/course';
import { IdSchema, IsoDateTimeSchema, LIMITS } from '../format/primitives';

// Requests and replies for the review endpoints in docs/learning/api.md (decision 0309): links that share a
// course's draft with colleagues, and the comments they leave on its lessons, blocks and quiz questions.

/** The header that carries a review link's token, never a path or query (decision 0309). */
export const REVIEW_TOKEN_HEADER = 'X-Review-Token';

/** How many days a review link works. */
export const REVIEW_LINK_DAYS = [7, 30, 90] as const;
export const DEFAULT_REVIEW_LINK_DAYS = 30;
export const REVIEW_LIMITS = { linksPerCourse: 20, commentsPerCourse: 2000 } as const;

export const ReviewLinkDaysSchema = z.literal(REVIEW_LINK_DAYS, {
  error: 'Choose 7, 30 or 90 days.',
});
export type ReviewLinkDays = z.infer<typeof ReviewLinkDaysSchema>;

export const CreateReviewLinkRequestSchema = z.object({
  days: ReviewLinkDaysSchema.default(DEFAULT_REVIEW_LINK_DAYS),
});
export type CreateReviewLinkRequest = z.infer<typeof CreateReviewLinkRequestSchema>;

/** Someone in the workspace, by name. */
export const ReviewPersonSchema = z.object({ id: z.string(), name: z.string() });

/** A review link as Studio lists it, which is never with its token. */
export const ReviewLinkSchema = z.object({
  id: IdSchema,
  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  createdBy: ReviewPersonSchema,
});
export type ReviewLink = z.infer<typeof ReviewLinkSchema>;

/** A new link: the only time its token is sent, inside `url` (`/learning/review#<token>`). */
export const NewReviewLinkSchema = ReviewLinkSchema.extend({ url: z.string() });
export type NewReviewLink = z.infer<typeof NewReviewLinkSchema>;

/** A comment on a lesson, or on one block or quiz question in it. */
export const ReviewCommentSchema = z.object({
  id: IdSchema,
  lessonId: IdSchema,
  blockId: IdSchema.optional(),
  questionId: IdSchema.optional(),
  body: z.string(),
  author: ReviewPersonSchema,
  createdAt: IsoDateTimeSchema,
  resolved: z.boolean(),
});
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

/** `blockId` is a block of a content lesson, `questionId` a question of a quiz lesson; neither means the lesson. */
export const CreateReviewCommentRequestSchema = z
  .object({
    lessonId: IdSchema,
    blockId: IdSchema.optional(),
    questionId: IdSchema.optional(),
    body: z
      .string()
      .trim()
      .min(1, { error: 'Write a comment first.' })
      .max(LIMITS.longText, { error: `Keep it under ${LIMITS.longText} characters.` }),
  })
  .refine((input) => input.blockId === undefined || input.questionId === undefined, {
    error: 'Comment on a block or a question, not both.',
    path: ['questionId'],
  });
export type CreateReviewCommentRequest = z.infer<typeof CreateReviewCommentRequestSchema>;

/** What a reviewer opens: the draft, read-only, and the comments left through the same link. */
export const ReviewReplySchema = z.object({
  course: CourseSchema,
  comments: z.array(ReviewCommentSchema),
  expiresAt: IsoDateTimeSchema,
});
export type ReviewReply = z.infer<typeof ReviewReplySchema>;

export const UpdateReviewCommentRequestSchema = z.object({ resolved: z.boolean() });
export type UpdateReviewCommentRequest = z.infer<typeof UpdateReviewCommentRequestSchema>;
