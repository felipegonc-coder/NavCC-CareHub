// Search requests (spec 3.2 and 3.3). Postgres finds the matches; then access is checked on every
// search, before anything is counted, ranked or shown, so losing access removes results at once.
import {
  highlightRanges,
  makeSnippet,
  parseQuery,
  SEARCH_MAX_RESULTS,
  SEARCH_PAGE_SIZE,
  wordsOf,
  searchRequestSchema,
  type MatchWord,
  type ParsedQuery,
  type SearchIcon,
  type SearchMatch,
  type SearchRequest,
  type SearchResponse,
  type SearchResult,
  type SearchTerm,
} from '@carehub/extras/search';
import { atLeast } from '@carehub/shared';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, Tx } from '../../db';
import { uuidArray } from './indexer';
import { searchPages, type SearchKind } from './pages';

export type SearchInput = z.output<typeof searchRequestSchema>;
export interface Searcher {
  userId: string;
  workspaceId: string;
}

/** Ranking help from other features: ✓ Verified pages (Knowledge base), recently opened pages. */
export type SearchBoost = (
  db: Db | Tx,
  context: Searcher & { pageIds: readonly string[] },
) => Promise<Map<string, { boost?: number; verified?: boolean }>>;
const boosts = new Map<string, SearchBoost>();

/** Adds a boost under `name`; the returned function removes it. */
export function registerSearchBoost(name: string, boost: SearchBoost): () => void {
  boosts.set(name, boost);
  return () => {
    if (boosts.get(name) === boost) boosts.delete(name);
  };
}

/** Matches are checked for access among at most this many. */
const CANDIDATES = 2 * SEARCH_MAX_RESULTS;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const config = (name: 'english' | 'simple') => sql.raw(`'${name}'`);

/** One term as a tsquery: its English word forms or its plain words. */
function termQuery(term: SearchTerm): SQL {
  const parts = wordsOf(term.text);
  const last = parts.pop();
  if (!term.prefix || last === undefined) {
    return sql`(phraseto_tsquery('english', ${term.text}) || phraseto_tsquery('simple', ${term.text}))`;
  }
  // `last` is only letters and digits, so it's safe in to_tsquery's syntax.
  const start = (name: 'english' | 'simple') => {
    const prefix = sql`to_tsquery(${config(name)}, ${`${last}:*`})`;
    return parts.length === 0
      ? prefix
      : sql`(phraseto_tsquery(${config(name)}, ${parts.join(' ')}) && ${prefix})`;
  };
  return sql`(${start('english')} || ${start('simple')})`;
}

const groupQuery = (group: SearchTerm[]) => sql`(${sql.join(group.map(termQuery), sql` || `)})`;

/** Every group (`all`) or at least one (`any`), and none of the excluded words. */
function fullQuery(parsed: ParsedQuery, match: SearchMatch): SQL | null {
  if (parsed.all.length === 0) return null;
  const groups = parsed.all.map(groupQuery);
  const found = match === 'any' ? [sql`(${sql.join(groups, sql` || `)})`] : groups;
  const excluded = parsed.none.map((term) => sql`(!! ${termQuery({ ...term, prefix: false })})`);
  return sql`(${sql.join([...found, ...excluded], sql` && `)})`;
}

/** With `any`: how many of the word groups an entry matches (0 with `all`, where all do). */
function hitCount(parsed: ParsedQuery, match: SearchMatch): SQL {
  if (match === 'all' || parsed.all.length < 2) return sql`0`;
  return sql`(${sql.join(
    parsed.all.map((group) => sql`(e.doc_tsv @@ ${groupQuery(group)})::int`),
    sql` + `,
  )})`;
}

const ORDER: Record<SearchInput['sort'], SQL> = {
  best: sql`hits DESC, tier, e.updated_at DESC, e.page_id`,
  edited_desc: sql`e.updated_at DESC, e.page_id`,
  edited_asc: sql`e.updated_at, e.page_id`,
  created_desc: sql`e.created_at DESC, e.page_id`,
  created_asc: sql`e.created_at, e.page_id`,
};

/** Of the spaces and pages in an "In" filter, those the person can open. */
async function openableIn(db: Db, userId: string, ids: readonly string[]): Promise<string[]> {
  const access = await searchPages().getAccessForPages(db, userId, ids);
  const canOpen = (id: string) => atLeast(access.get(id) ?? 'none', 'view');
  const spaces = await searchPages().getSpaces(
    db,
    userId,
    ids.filter((id) => !canOpen(id)),
  );
  return ids.filter((id) => canOpen(id) || spaces.has(id));
}

type Candidate = {
  page_id: string;
  hits: number;
  tier: number;
  updated_at: Date;
  archived: boolean;
};

const EMPTY: SearchResponse = { results: [], total: 0, nextCursor: null };

/**
 * One page of results for a search, checked against what the person can open. Other features call
 * it too, for example the assistant panel with `match: 'any'` and `searchWords(question)`.
 */
export async function runSearch(
  db: Db,
  searcher: Searcher,
  request: SearchRequest,
): Promise<SearchResponse> {
  const input: SearchInput = searchRequestSchema.parse(request);
  const { filters } = input;
  const parsed = parseQuery(input.text, { prefix: input.match === 'all' });
  const query = fullQuery(parsed, input.match);
  if (!query) return EMPTY;
  const where: SQL[] = [
    sql`e.workspace_id = ${searcher.workspaceId}`,
    sql`e.trashed_at IS NULL`,
    sql`e.doc_tsv @@ ${query}`,
  ];
  if (filters.titleOnly) where.push(sql`ts_filter(e.doc_tsv, '{a}') @@ ${query}`);
  if (!filters.includeArchived) where.push(sql`e.archived_at IS NULL`);
  if (filters.types?.length) {
    // Files are searched once file text is indexed (SR-D1).
    const kinds = filters.types.filter((type): type is SearchKind => type !== 'file');
    if (kinds.length === 0) return EMPTY;
    where.push(sql`e.kind = ANY(${sql.param(kinds)}::text[])`);
  }
  if (filters.createdBy?.length)
    where.push(sql`e.created_by = ANY(${uuidArray(filters.createdBy)})`);
  if (filters.editedBy?.length) where.push(sql`e.updated_by = ANY(${uuidArray(filters.editedBy)})`);
  if (filters.date) {
    const column = filters.date.field === 'created' ? sql`e.created_at` : sql`e.updated_at`;
    if (filters.date.from) where.push(sql`${column} >= ${new Date(filters.date.from)}`);
    if (filters.date.to) where.push(sql`${column} < ${new Date(filters.date.to)}`);
  }
  if (filters.in?.length) {
    // A crafted filter for a space or page the person can't open finds nothing from it.
    const ids = await openableIn(db, searcher.userId, filters.in);
    if (ids.length === 0) return EMPTY;
    const list = uuidArray(ids);
    where.push(
      sql`(e.page_id = ANY(${list}) OR e.ancestor_ids && ${list} OR e.space_id = ANY(${list}))`,
    );
  }
  const key = parsed.key ?? '';
  const { rows: matches } = await db.execute<Candidate>(sql`
    SELECT e.page_id, e.updated_at, e.archived_at IS NOT NULL AS archived,
      ${hitCount(parsed, input.match)} AS hits,
      CASE WHEN ${key}::text <> '' AND e.title_key = ${key}::text THEN 0
        WHEN ${key}::text <> '' AND starts_with(e.title_key, ${key}::text) THEN 1
        WHEN ts_filter(e.doc_tsv, '{a}') @@ ${query} THEN 2
        WHEN ts_filter(e.doc_tsv, '{b}') @@ ${query} THEN 3
        ELSE 4 END AS tier
    FROM search_entries e
    WHERE ${sql.join(where, sql` AND `)}
    ORDER BY ${ORDER[input.sort]}
    LIMIT ${CANDIDATES}`);

  const access = await searchPages().getAccessForPages(
    db,
    searcher.userId,
    matches.map((match) => match.page_id),
  );
  const visible = matches
    .filter((match) => atLeast(access.get(match.page_id) ?? 'none', 'view'))
    .slice(0, SEARCH_MAX_RESULTS);
  const extra = await boostsFor(
    db,
    searcher,
    visible.map((match) => match.page_id),
  );
  if (input.sort === 'best') {
    const now = Date.now();
    const score = (match: Candidate) =>
      (extra.get(match.page_id)?.boost ?? 0) +
      (now - match.updated_at.getTime() < WEEK_MS ? 1 : 0) -
      (match.archived ? 2 : 0);
    // Postgres sorted by words matched and tier, then newest edit; the score only reorders within.
    const order = new Map(visible.map((match, index) => [match.page_id, index]));
    visible.sort(
      (a, b) =>
        b.hits - a.hits ||
        a.tier - b.tier ||
        score(b) - score(a) ||
        (order.get(a.page_id) ?? 0) - (order.get(b.page_id) ?? 0),
    );
  }
  const offset = Number(input.cursor ?? 0);
  const end = offset + (input.limit ?? SEARCH_PAGE_SIZE);
  const shown = visible.slice(offset, end);
  const results = await describeResults(
    db,
    searcher,
    shown.map((match) => match.page_id),
    {
      words: parsed.words,
      snippets: !input.filters.titleOnly,
      verified: new Set(
        shown.flatMap((match) => (extra.get(match.page_id)?.verified ? [match.page_id] : [])),
      ),
    },
  );
  return {
    results,
    total: visible.length,
    nextCursor: end < visible.length ? String(end) : null,
  };
}

async function boostsFor(db: Db, searcher: Searcher, pageIds: string[]) {
  const all = new Map<string, { boost: number; verified: boolean }>();
  if (pageIds.length === 0) return all;
  for (const boost of boosts.values()) {
    const found = await boost(db, { ...searcher, pageIds });
    for (const [id, { boost: by = 0, verified = false }] of found) {
      const before = all.get(id) ?? { boost: 0, verified: false };
      all.set(id, {
        boost:
          before.boost + Math.max(-2, Math.min(2, by)) + (verified && !before.verified ? 1 : 0),
        verified: before.verified || verified,
      });
    }
  }
  return all;
}

type Detail = {
  page_id: string;
  kind: SearchKind;
  title: string;
  icon: unknown;
  space_id: string | null;
  ancestors: string[];
  body: string;
  extra: string;
  created_at: Date;
  updated_at: Date;
  updated_by: string | null;
  editor_name: string | null;
  archived_at: Date | null;
};

function iconOf(icon: unknown): SearchIcon | null {
  const value = icon as { type?: unknown; emoji?: unknown; name?: unknown; color?: unknown } | null;
  if (value?.type === 'emoji' && typeof value.emoji === 'string') {
    return { type: 'emoji', emoji: value.emoji };
  }
  if (value?.type === 'icon' && typeof value.name === 'string') {
    return {
      type: 'icon',
      name: value.name,
      color: typeof value.color === 'string' ? value.color : null,
    };
  }
  return null;
}

export interface DescribeOptions {
  /** The words to mark in titles and snippets. */
  words?: readonly MatchWord[];
  snippets?: boolean;
  verified?: ReadonlySet<string>;
}

/**
 * Result rows in the order given: paths, badges and snippets. Call it with pages the person can
 * open only; parent pages they can't open are left out of paths.
 */
export async function describeResults(
  db: Db,
  searcher: Searcher,
  pageIds: readonly string[],
  { words = [], snippets = false, verified }: DescribeOptions = {},
): Promise<SearchResult[]> {
  if (pageIds.length === 0) return [];
  const { rows } = await db.execute<Detail>(sql`
    SELECT e.page_id, e.kind, e.title, e.icon, e.space_id, e.ancestor_ids::text[] AS ancestors,
      e.body, e.extra, e.created_at, e.updated_at, e.updated_by, e.archived_at,
      u.name AS editor_name
    FROM search_entries e LEFT JOIN users u ON u.id = e.updated_by
    WHERE e.page_id = ANY(${uuidArray(pageIds)})`);
  const details = new Map(rows.map((row) => [row.page_id, row]));
  const parentIds = [...new Set(rows.flatMap((row) => row.ancestors))];
  const parentAccess = await searchPages().getAccessForPages(db, searcher.userId, parentIds);
  const openParents = parentIds.filter((id) => atLeast(parentAccess.get(id) ?? 'none', 'view'));
  const { rows: parents } =
    openParents.length === 0
      ? { rows: [] }
      : await db.execute<{ page_id: string; title: string }>(
          sql`SELECT page_id, title FROM search_entries WHERE page_id = ANY(${uuidArray(openParents)})`,
        );
  const parentTitles = new Map(parents.map((row) => [row.page_id, row.title]));
  const spaceIds = [...new Set(rows.flatMap((row) => (row.space_id ? [row.space_id] : [])))];
  const spaces = await searchPages().getSpaces(db, searcher.userId, spaceIds);

  return pageIds.flatMap((id): SearchResult[] => {
    const row = details.get(id);
    if (!row) return [];
    const space = row.space_id ? spaces.get(row.space_id)?.name : undefined;
    const path = row.ancestors.flatMap((id) => parentTitles.get(id) ?? []);
    const parentId = row.ancestors[row.ancestors.length - 1];
    return [
      {
        id: row.page_id,
        kind: row.kind,
        title: row.title,
        titleRanges: highlightRanges(row.title, words),
        icon: iconOf(row.icon),
        path: space ? [space, ...path] : path,
        snippet: snippets ? makeSnippet(`${row.body}\n${row.extra}`, words) : null,
        createdAt: row.created_at.toISOString(),
        editedAt: row.updated_at.toISOString(),
        editedBy:
          row.updated_by && row.editor_name ? { id: row.updated_by, name: row.editor_name } : null,
        rowIn: row.kind === 'row' && parentId ? (parentTitles.get(parentId) ?? null) : null,
        verified: verified?.has(id) ?? false,
        archived: row.archived_at !== null,
      },
    ];
  });
}
