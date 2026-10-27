// Message search (Messages spec 3): words and their starts, "exact phrases", and the From, In,
// Date and Has filters, newest first, only in chats the person is in now. The words are matched
// with a Postgres tsvector and tsquery that @carehub/team-chat writes, so no text search
// configuration or extension is needed, and the GIN index keeps it fast (MS-21).
import {
  dateFilterRange,
  messageHas,
  messagePlainText,
  parseSearchQuery,
  SEARCH_RESULTS_MAX,
  searchVector,
  toTsQuery,
  type HasFilter,
  type MessageSearchBody,
  type NameOf,
} from '@carehub/team-chat';
import { toInstant } from '@carehub/team-time';
import { and, desc, eq, getTableColumns, gte, isNull, lt, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import { isUuid } from './people';
import { msgChats, msgMembers, msgMessages, type MessageRow } from './schema';

/** What search stores for a message: its words, and what it has for the Has filter. */
export interface MessageIndex {
  search: string;
  has: HasFilter[];
}

/** A deleted message or a system line: nothing to find. */
export const EMPTY_INDEX: MessageIndex = { search: '', has: [] };

/**
 * The index of a message as people read it: mentions as names ("@Avery Lin"). Page card titles
 * are left out, so search never reveals a page someone can't open.
 */
export function messageIndex(
  message: { text: string; mentions: readonly string[]; pageIds: readonly string[] },
  nameOf: NameOf,
): MessageIndex {
  const readable = messagePlainText(message.text, nameOf, { mentionable: message.mentions });
  return {
    search: searchVector([readable]),
    has: messageHas({ text: readable, attachmentKinds: [], pageCount: message.pageIds.length }),
  };
}

export interface SearchInput {
  workspaceId: string;
  viewerId: string;
  /** The searcher's time zone: the Date filter is in their days. */
  timeZone: string;
  body: MessageSearchBody;
}

/**
 * Up to 50 matching messages, newest first, from chats the person is in now (not ones they left
 * or were removed from). Deleted messages and system lines are never found. Nothing to look for
 * (no words and no filters) finds nothing.
 */
export async function searchMessages(
  db: Db | Tx,
  input: SearchInput,
): Promise<{ rows: MessageRow[]; hasMore: boolean }> {
  const { body } = input;
  const tsquery = toTsQuery(parseSearchQuery(body.q));
  const filtered = Boolean(body.fromUserId || body.chatId || body.date || body.has);
  if (!tsquery && !filtered) return { rows: [], hasMore: false };
  // Users and chats have UUIDs; any other ID matches nothing.
  if ((body.fromUserId && !isUuid(body.fromUserId)) || (body.chatId && !isUuid(body.chatId))) {
    return { rows: [], hasMore: false };
  }
  const range = body.date ? dateFilterRange(body.date) : null;
  const startOf = (day: string) => toInstant(`${day}T00:00`, input.timeZone);
  const found = await db
    .select({ message: getTableColumns(msgMessages) })
    .from(msgMessages)
    .innerJoin(msgChats, eq(msgChats.id, msgMessages.chatId))
    .innerJoin(
      msgMembers,
      and(
        eq(msgMembers.chatId, msgMessages.chatId),
        eq(msgMembers.userId, input.viewerId),
        isNull(msgMembers.leftAt),
      ),
    )
    .where(
      and(
        eq(msgChats.workspaceId, input.workspaceId),
        eq(msgMessages.kind, 'message'),
        isNull(msgMessages.deletedAt),
        tsquery ? sql`${msgMessages.search} @@ ${tsquery}::tsquery` : undefined,
        body.fromUserId ? eq(msgMessages.senderId, body.fromUserId) : undefined,
        body.chatId ? eq(msgMessages.chatId, body.chatId) : undefined,
        range?.start ? gte(msgMessages.createdAt, startOf(range.start)) : undefined,
        range?.end ? lt(msgMessages.createdAt, startOf(range.end)) : undefined,
        body.has ? sql`${body.has} = ANY(${msgMessages.has})` : undefined,
      ),
    )
    .orderBy(desc(msgMessages.createdAt), desc(msgMessages.id))
    .limit(SEARCH_RESULTS_MAX + 1);
  const rows = found.map(({ message }) => message);
  return { rows: rows.slice(0, SEARCH_RESULTS_MAX), hasMore: rows.length > SEARCH_RESULTS_MAX };
}
