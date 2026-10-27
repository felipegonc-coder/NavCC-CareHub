// Recent pages and searches (spec 2, Before typing; 3.4), and the counted search terms Analytics
// shows. Each person reads and changes only their own lists; Analytics gets numbers, never who.
import { createHmac, randomBytes } from 'node:crypto';
import {
  RECENT_PAGES_SHOWN,
  RECENT_SEARCHES_KEPT,
  SEARCH_TERM_MAX,
  searchFiltersSchema,
  type RecentSearch,
  type searchHistorySchema,
  type SearchResult,
} from '@carehub/extras/search';
import { atLeast } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Tx } from '../../db';
import { uuidArray } from './indexer';
import { searchPages } from './pages';
import { describeResults, type Searcher, type SearchBoost } from './search';

export type SearchHistory = z.output<typeof searchHistorySchema>;

// stand-in: the workspace time zone from S1's settings replaces this; America/Denver until then.
const TERM_TIME_ZONE = 'America/Denver';

/** Records that someone opened a page they can open; pages search doesn't know are skipped. */
export async function recordVisit(db: Db, userId: string, pageId: string, at?: Date) {
  const access = await searchPages().getAccessForPages(db, userId, [pageId]);
  if (!atLeast(access.get(pageId) ?? 'none', 'view')) return;
  await db.execute(sql`
    INSERT INTO search_visits (user_id, page_id, workspace_id, opened_at)
    SELECT ${userId}, page_id, workspace_id, ${at ?? sql`clock_timestamp()`}
    FROM search_entries WHERE page_id = ${pageId}
    ON CONFLICT (user_id, page_id) DO UPDATE SET opened_at = excluded.opened_at,
      workspace_id = excluded.workspace_id`);
}

const viewedSchema = z.object({
  pageId: z.uuid(),
  userId: z.uuid().optional(),
  by: z.uuid().optional(),
});

/** Core's page.viewed event, read loosely (decision 0007, 2.4). */
export async function recordViewed(db: Db, payload: unknown): Promise<void> {
  const parsed = viewedSchema.safeParse(payload);
  const userId = parsed.data?.userId ?? parsed.data?.by;
  if (parsed.data && userId) await recordVisit(db, userId, parsed.data.pageId);
}

/** The last pages the person opened and can still open, newest first. */
export async function recentPages(db: Db, searcher: Searcher): Promise<SearchResult[]> {
  const { rows } = await db.execute<{ page_id: string }>(sql`
    SELECT v.page_id FROM search_visits v
    JOIN search_entries e ON e.page_id = v.page_id AND e.trashed_at IS NULL
    WHERE v.user_id = ${searcher.userId} AND v.workspace_id = ${searcher.workspaceId}
      AND e.workspace_id = ${searcher.workspaceId}
    ORDER BY v.opened_at DESC LIMIT ${RECENT_PAGES_SHOWN * 5}`);
  const ids = rows.map((row) => row.page_id);
  const access = await searchPages().getAccessForPages(db, searcher.userId, ids);
  const open = ids.filter((id) => atLeast(access.get(id) ?? 'none', 'view'));
  return describeResults(db, searcher, open.slice(0, RECENT_PAGES_SHOWN));
}

/** Pages opened in the last 30 days rank higher (spec 3.2). */
export const openedRecently: SearchBoost = async (db, { userId, pageIds }) => {
  const { rows } = await db.execute<{ page_id: string }>(sql`
    SELECT page_id FROM search_visits
    WHERE user_id = ${userId} AND page_id = ANY(${uuidArray(pageIds)})
      AND opened_at > now() - interval '30 days'`);
  return new Map(rows.map((row) => [row.page_id, { boost: 1 }]));
};

type RecentRow = { id: string; text: string; filters: unknown; searched_at: Date };

export async function recentSearches(db: Db | Tx, searcher: Searcher): Promise<RecentSearch[]> {
  const { rows } = await db.execute<RecentRow>(sql`
    SELECT id, text, filters, searched_at FROM search_recent
    WHERE user_id = ${searcher.userId} AND workspace_id = ${searcher.workspaceId}
    ORDER BY searched_at DESC, id LIMIT ${RECENT_SEARCHES_KEPT}`);
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    filters: searchFiltersSchema.catch({}).parse(row.filters),
    searchedAt: row.searched_at.toISOString(),
  }));
}

/** Removes one of the person's own recent searches; anyone else's stay as they are. */
export async function removeRecentSearch(db: Db | Tx, searcher: Searcher, id: string) {
  await db.execute(sql`
    DELETE FROM search_recent
    WHERE id = ${id} AND user_id = ${searcher.userId} AND workspace_id = ${searcher.workspaceId}`);
}

export async function clearRecentSearches(db: Db | Tx, searcher: Searcher) {
  await db.execute(sql`
    DELETE FROM search_recent
    WHERE user_id = ${searcher.userId} AND workspace_id = ${searcher.workspaceId}`);
}

/** A search that ended: saved to Recent searches when asked, and counted for Analytics. */
export async function recordSearch(
  db: Db,
  searcher: Searcher,
  search: SearchHistory,
  now?: Date,
): Promise<void> {
  if (search.save) await saveRecentSearch(db, searcher, search, now);
  if (search.opened) await recordVisit(db, searcher.userId, search.opened, now);
  await countSearchTerm(db, searcher, search, now);
}

async function saveRecentSearch(db: Db, searcher: Searcher, search: SearchHistory, now?: Date) {
  const { userId, workspaceId } = searcher;
  await db.execute(sql`
    INSERT INTO search_recent (user_id, workspace_id, text, filters, searched_at)
    VALUES (${userId}, ${workspaceId}, ${search.text}, ${JSON.stringify(search.filters)}::jsonb,
      ${now ?? sql`clock_timestamp()`})
    ON CONFLICT (user_id, workspace_id, lower(text)) DO UPDATE
      SET text = excluded.text, filters = excluded.filters, searched_at = excluded.searched_at`);
  await db.execute(sql`
    DELETE FROM search_recent WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
      AND id NOT IN (
        SELECT id FROM search_recent WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
        ORDER BY searched_at DESC, id LIMIT ${RECENT_SEARCHES_KEPT})`);
}

/** "  Refund   Policy" → "refund policy": lowercase, single spaces, up to 100 characters. */
export function searchTermOf(text: string): string {
  const term = text.trim().replace(/\s+/g, ' ').toLowerCase();
  return [...term].slice(0, SEARCH_TERM_MAX).join('').trim();
}

/** "2026-10-27": the day in the workspace's time zone. */
export function termDayOf(at: Date | string): string {
  if (typeof at === 'string') return z.iso.date().parse(at);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TERM_TIME_ZONE }).format(at);
}

/** Today's key for recognising a repeat search; made on the first search of the day. */
async function dayKey(db: Db, day: string): Promise<Uint8Array> {
  const { rows } = await db.execute<{ key: Uint8Array }>(sql`
    WITH made AS (
      INSERT INTO search_term_keys (day, key) VALUES (${day}::date, ${randomBytes(32)})
      ON CONFLICT (day) DO NOTHING RETURNING key)
    SELECT key FROM made UNION ALL SELECT key FROM search_term_keys WHERE day = ${day}::date`);
  // Made at the same moment by another search: read it now that it's there.
  const key =
    rows[0]?.key ??
    (
      await db.execute<{ key: Uint8Array }>(
        sql`SELECT key FROM search_term_keys WHERE day = ${day}::date`,
      )
    ).rows[0]?.key;
  if (!key) throw new Error('search: no key for the day');
  return key;
}

let forgottenBefore = '';

async function countSearchTerm(db: Db, searcher: Searcher, search: SearchHistory, now?: Date) {
  const term = searchTermOf(search.text);
  if (!term) return;
  const day = termDayOf(now ?? new Date());
  if (forgottenBefore !== day) {
    // Earlier days' keys and hashes go, so nobody can be traced from them later.
    await db.execute(sql`DELETE FROM search_term_people WHERE day < ${day}::date`);
    await db.execute(sql`DELETE FROM search_term_keys WHERE day < ${day}::date`);
    forgottenBefore = day;
  }
  const hash = createHmac('sha256', await dayKey(db, day))
    .update(`${searcher.workspaceId}\n${searcher.userId}\n${term}`)
    .digest();
  const { rows: added } = await db.execute<{ day: string }>(sql`
    INSERT INTO search_term_people (day, person_hash) VALUES (${day}::date, ${hash})
    ON CONFLICT DO NOTHING RETURNING day::text`);
  await db.execute(sql`
    INSERT INTO search_terms AS t (workspace_id, day, term, searches, people, no_results, opened)
    VALUES (${searcher.workspaceId}, ${day}::date, ${term}, 1, ${added.length > 0 ? 1 : 0},
      ${search.found === 0 ? 1 : 0}, ${search.opened ? 1 : 0})
    ON CONFLICT (workspace_id, day, term) DO UPDATE SET searches = t.searches + 1,
      people = t.people + excluded.people, no_results = t.no_results + excluded.no_results,
      opened = t.opened + excluded.opened`);
}

export interface SearchTermCount {
  term: string;
  searches: number;
  /** At least this many different people searched it (people are counted per day). */
  people: number;
  noResults: number;
  opened: number;
}

type TermRow = {
  term: string;
  searches: number;
  people: number;
  no_results: number;
  opened: number;
};

/**
 * A workspace's counted search terms between two days, both included, most searched first, for
 * Analytics. A term is listed once 2 different people searched it on one day: people are counted
 * per day without saving who, so one person on two days never lists it.
 */
export async function listSearchTerms(
  db: Db | Tx,
  workspaceId: string,
  period: { from: Date | string; to: Date | string },
): Promise<SearchTermCount[]> {
  const { rows } = await db.execute<TermRow>(sql`
    SELECT term, sum(searches)::int AS searches, max(people) AS people,
      sum(no_results)::int AS no_results, sum(opened)::int AS opened
    FROM search_terms
    WHERE workspace_id = ${workspaceId}
      AND day BETWEEN ${termDayOf(period.from)}::date AND ${termDayOf(period.to)}::date
    GROUP BY term HAVING max(people) >= 2
    ORDER BY searches DESC, term LIMIT 500`);
  return rows.map(({ no_results, ...row }) => ({ ...row, noResults: no_results }));
}
