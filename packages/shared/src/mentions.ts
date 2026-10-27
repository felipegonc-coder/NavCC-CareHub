import { z } from 'zod';
import { pageUrl } from './urls';

// Mentions of people (Comments and mentions spec, section 3.3). The editor sends each @person
// typed into page text with POST /api/mentions; mentions in comments come from the comment's
// `<@userId>` tokens (see `mentionedUserIds`).

/** A mention typed into page text waits this long; deleting it in that time cancels the notice. */
export const MENTION_DELAY_MS = 10_000;
/** The sentence sent with a page-text mention is cut to this many characters. */
export const MENTION_SNIPPET_MAX_CHARS = 300;
/** Most people notified for one comment, and in one "Can they open it?" check. */
export const MENTION_MAX_PEOPLE = 50;

/**
 * `waiting`: the notice goes at `sendAt`. `quiet`: no notice ("Mention without notifying", or
 * yourself). `cancelled`: deleted in time. `no_access`: the person couldn't open the page.
 */
export const MENTION_STATUSES = ['waiting', 'sent', 'quiet', 'cancelled', 'no_access'] as const;
export type MentionStatus = (typeof MENTION_STATUSES)[number];

const uuid = (what: string) => z.uuid({ error: `That ${what} ID isn't right.` });

/** POST /api/mentions: someone with Can edit typed @person into a block of the page. */
export const createMentionSchema = z.object({
  pageId: uuid('page'),
  blockId: z.string().regex(/^[\w-]{1,64}$/, { error: "That block ID isn't right." }),
  userId: uuid('person'),
  /** The sentence the mention is in, for the notice. */
  snippet: z
    .string()
    .max(100_000)
    .transform((text) =>
      Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, MENTION_SNIPPET_MAX_CHARS).join(''),
    )
    .default(''),
  /** False for "Mention without notifying". */
  notify: z.boolean().default(true),
});
export type CreateMentionInput = z.infer<typeof createMentionSchema>;

/** "a, B,a," → ['a', 'b']. */
const idList = (ids: string) => [
  ...new Set(
    ids
      .split(',')
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean),
  ),
];

/** GET /api/mentions/can-open?pageId=&userIds=<id>,<id>: for the @ menu and group mentions. */
export const canOpenQuerySchema = z.object({
  pageId: uuid('page'),
  userIds: z
    .string()
    .transform(idList)
    .pipe(
      z
        .array(uuid('person'))
        .min(1, { error: 'Say who to check.' })
        .max(MENTION_MAX_PEOPLE, { error: `At most ${MENTION_MAX_PEOPLE} people at a time.` }),
    ),
});

export interface MentionView {
  id: string;
  pageId: string;
  /** Set for page text; `commentId` is set for comments. */
  blockId: string | null;
  commentId: string | null;
  userId: string;
  status: MentionStatus;
  /** When the notice goes (`waiting`) or was due; null when there's none. */
  sendAt: string | null;
}

/** POST /api/mentions */
export interface CreateMentionResponse {
  mention: MentionView;
}

/** GET /api/mentions/can-open: the people in `cantOpen` show "Can't open this page". */
export interface CanOpenResponse {
  canOpen: string[];
  cantOpen: string[];
}

/** Opens the page at the block (Pages and blocks: "Copy link to block"). */
export function blockUrl(pageId: string, blockId: string): string {
  return `${pageUrl(pageId)}#${encodeURIComponent(blockId)}`;
}

/** Opens the page at the comment's spot, with its thread open. */
export function commentUrl(pageId: string, commentId: string): string {
  return `${pageUrl(pageId)}?comment=${encodeURIComponent(commentId)}`;
}
