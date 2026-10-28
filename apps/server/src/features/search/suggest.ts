// Did you mean (spec 3.2) and the people offered in the Created by and Edited by chips (spec 2).
// Both come only from pages the person can open, checked on every request as in search.
import {
  fold,
  SEARCH_MAX_RESULTS,
  SEARCH_PEOPLE_SHOWN,
  suggestText,
  wordsOf,
  type SearchPeopleQuery,
  type SearchPerson,
} from '@carehub/extras/search';
import { atLeast } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../../db';
import { uuidArray } from './indexer';
import { searchPages } from './pages';
import type { SearchInput, Searcher } from './search';

/** How many of the most recently edited pages are looked at. */
const SCANNED = 2 * SEARCH_MAX_RESULTS;

type Entry = {
  page_id: string;
  title_key: string;
  created_by: string | null;
  updated_by: string | null;
};

/** The workspace's most recently edited pages that the person can open, Trash left out. */
async function openableEntries(db: Db, searcher: Searcher, withArchived: boolean) {
  const { rows } = await db.execute<Entry>(sql`
    SELECT page_id, title_key, created_by, updated_by FROM search_entries
    WHERE workspace_id = ${searcher.workspaceId} AND trashed_at IS NULL
      AND (${withArchived}::boolean OR archived_at IS NULL)
    ORDER BY updated_at DESC
    LIMIT ${SCANNED}`);
  const access = await searchPages().getAccessForPages(
    db,
    searcher.userId,
    rows.map((row) => row.page_id),
  );
  return rows.filter((row) => atLeast(access.get(row.page_id) ?? 'none', 'view'));
}

/** The search text with a title word one or two letters off instead of a word no title has. */
export async function didYouMean(
  db: Db,
  searcher: Searcher,
  input: SearchInput,
): Promise<string | null> {
  const entries = await openableEntries(db, searcher, input.filters.includeArchived === true);
  const titleWords = new Map<string, number>();
  for (const entry of entries) {
    for (const word of new Set(wordsOf(entry.title_key))) {
      titleWords.set(word, (titleWords.get(word) ?? 0) + 1);
    }
  }
  return suggestText(input.text, titleWords);
}

/** Who created (or last edited) pages the person can open, most pages first, by name. */
export async function searchPeople(
  db: Db,
  searcher: Searcher,
  query: SearchPeopleQuery,
): Promise<SearchPerson[]> {
  const pages = new Map<string, number>();
  for (const entry of await openableEntries(db, searcher, true)) {
    const id = query.role === 'created' ? entry.created_by : entry.updated_by;
    if (id) pages.set(id, (pages.get(id) ?? 0) + 1);
  }
  if (pages.size === 0) return [];
  const { rows } = await db.execute<{ id: string; name: string }>(
    sql`SELECT id, name FROM users WHERE id = ANY(${uuidArray([...pages.keys()])})`,
  );
  const typed = wordsOf(fold(query.q ?? ''));
  const named = (person: SearchPerson) => {
    const words = wordsOf(fold(person.name));
    return typed.every((part) => words.some((word) => word.startsWith(part)));
  };
  return rows
    .filter(named)
    .sort((a, b) => (pages.get(b.id) ?? 0) - (pages.get(a.id) ?? 0) || a.name.localeCompare(b.name))
    .slice(0, SEARCH_PEOPLE_SHOWN)
    .map(({ id, name }) => ({ id, name }));
}
