import { z } from 'zod';

// Comments (Comments and mentions spec, sections 3.1 and 4; decision 0007, section 4.3). Comment
// text is stored as written, with people mentioned as `<@userId>` tokens, as in Messages.

/** Most characters in one comment, counted as Postgres `char_length` counts them (code points). */
export const COMMENT_MAX_CHARS = 4000;
export const MAX_THREADS_PER_PAGE = 1000;
export const MAX_COMMENTS_PER_THREAD = 500;
/** The quoted text kept with a text comment is cut to this many characters. */
export const COMMENT_QUOTE_MAX_CHARS = 1000;

/** Where a thread is: the page, a stretch of text in a block, a whole block, or a row's property. */
export const COMMENT_SPOTS = ['page', 'text', 'block', 'property'] as const;
export type CommentSpot = (typeof COMMENT_SPOTS)[number];

const characters = (text: string) => Array.from(text).length;

/** Comment text: line breaks as "\n", trimmed, 1 to 4,000 characters. */
export const commentTextSchema = z
  .string({ error: 'Write a comment first.' })
  .transform((text) => text.replace(/\r\n?/g, '\n').trim())
  .pipe(
    z
      .string()
      .min(1, { error: 'Write a comment first.' })
      .refine((text) => characters(text) <= COMMENT_MAX_CHARS, {
        error: 'A comment can be up to 4,000 characters.',
      }),
  );

/** Editor block IDs and database property IDs. */
const spotIdSchema = z.string().regex(/^[\w-]{1,64}$/, { error: "That ID isn't right." });

/** POST /api/comments. Without `threadId` it starts a thread (see `spotOf`). */
export const createCommentSchema = z
  .object({
    pageId: z.uuid({ error: "That page ID isn't right." }),
    text: commentTextSchema,
    /** Replies in this thread; the fields below are only for a new thread. */
    threadId: z.uuid({ error: "That thread ID isn't right." }).optional(),
    blockId: spotIdSchema.optional(),
    /** The selected text, for a comment on part of the block's text. */
    quote: z
      .string()
      .max(100_000)
      .transform((text) => Array.from(text.trim()).slice(0, COMMENT_QUOTE_MAX_CHARS).join(''))
      .optional(),
    /** A row page's property. */
    propertyId: spotIdSchema.optional(),
  })
  .refine((input) => !(input.blockId && input.propertyId), {
    error: 'A comment goes on a block or on a property, not both.',
    path: ['propertyId'],
  })
  .refine((input) => !input.quote || Boolean(input.blockId), {
    error: 'Say which block the text is in.',
    path: ['blockId'],
  });
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

/** PATCH /api/comments/:id (the author only). */
export const editCommentSchema = z.object({ text: commentTextSchema });

/** PATCH /api/comments/threads/:id: resolve, or reopen. */
export const resolveThreadSchema = z.object({ resolved: z.boolean() });

/** GET /api/comments?pageId=&status= */
export const listCommentsQuerySchema = z.object({
  pageId: z.uuid({ error: "That page ID isn't right." }),
  status: z.enum(['open', 'resolved', 'all']).default('all'),
});

/** The spot a new thread gets from what was sent. */
export function spotOf(input: {
  blockId?: string;
  quote?: string;
  propertyId?: string;
}): CommentSpot {
  if (input.propertyId) return 'property';
  if (input.blockId) return input.quote ? 'text' : 'block';
  return 'page';
}

const MENTION = /<@([\w-]{1,64})>/g;

/** IDs of the people mentioned in comment text, each once, in order. */
export function mentionedUserIds(text: string): string[] {
  const ids = new Set<string>();
  for (const [, id] of text.matchAll(MENTION)) if (id) ids.add(id);
  return [...ids];
}

export interface CommentView {
  id: string;
  authorId: string;
  /** Empty once deleted. */
  text: string;
  createdAt: string;
  /** When the author last changed it ("edited"), or null. */
  editedAt: string | null;
  /** "This comment was deleted": the first comment keeps its place while its thread has replies. */
  deleted: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export interface CommentThreadView {
  id: string;
  pageId: string;
  spot: CommentSpot;
  blockId: string | null;
  propertyId: string | null;
  /** The text it's on, kept for "The text this was on was deleted." */
  quote: string | null;
  createdBy: string;
  createdAt: string;
  lastCommentAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  canResolve: boolean;
  comments: CommentView[];
}

export interface CommentPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** GET /api/comments?pageId=: the page's threads, the newest activity first. */
export interface CommentsResponse {
  threads: CommentThreadView[];
  /** Authors, resolvers and mentioned people; anyone missing here shows as "(removed)". */
  people: Record<string, CommentPerson>;
  canComment: boolean;
}

/** POST /api/comments */
export interface CreateCommentResponse {
  id: string;
  threadId: string;
}
