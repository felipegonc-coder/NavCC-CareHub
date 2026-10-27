// Keeps search_entries in step with pages and their content (spec 3.3). Text is folded here, and
// Postgres builds the full-text vector: English word forms plus the plain words, so stop words
// ("it", "about") and beginnings of words still match.
import { fold, titleKey } from '@carehub/extras/search';
import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import { getPageText } from '../collab';
import { searchPages, type IndexPage, type SearchKind } from './pages';

/** Text a feature adds for its pages, such as a row's property values (decision 0007, 4.3). */
export type SearchTextSource = (db: Db | Tx, pageId: string) => Promise<string>;
const textSources = new Map<SearchKind, SearchTextSource>();

/** Adds text to every page of `kind`; the returned function removes it again. */
export function registerSearchText(kind: SearchKind, source: SearchTextSource): () => void {
  textSources.set(kind, source);
  return () => {
    if (textSources.get(kind) === source) textSources.delete(kind);
  };
}

/** Text past this many characters isn't searched (a tsvector holds up to 1 MB). */
const MAX_TEXT_CHARS = 200_000;
const BATCH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Postgres text can't hold NUL characters. */
const clean = (text: string) => text.replaceAll('\u0000', '').slice(0, MAX_TEXT_CHARS);

export const uuidArray = (ids: readonly string[]) => sql`${sql.param([...ids])}::uuid[]`;

/** A timestamp as exact ISO text: JavaScript dates drop microseconds, so cursors would slip. */
export const exactTime = (column: string) =>
  sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

let queue: Promise<unknown> = Promise.resolve();
/** One indexing run at a time, so a run that read older text never overwrites a newer one. */
function serially<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

/** The page IDs in an event payload (`pageId`, `pageIds`), ignoring anything else. */
export function pageIdsOf(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const { pageId, pageIds } = payload as { pageId?: unknown; pageIds?: unknown };
  const ids = [pageId, ...(Array.isArray(pageIds) ? pageIds : [])];
  return ids.filter((id): id is string => typeof id === 'string' && UUID.test(id));
}

interface StoredDoc {
  markdown: string;
  /** page_docs.text_updated_at, exact. */
  seenAt: string;
}

// stand-in: getPageContent and the event page.contentSaved (S4, #200) replace reading page_docs.
async function readDocs(db: Db | Tx, pageIds: readonly string[]): Promise<Map<string, StoredDoc>> {
  if (pageIds.length === 0) return new Map();
  const { rows } = await db.execute<{ page_id: string; markdown: string; seen_at: string }>(
    sql`SELECT page_id, markdown, ${exactTime('text_updated_at')} AS seen_at FROM page_docs
        WHERE page_id = ANY(${uuidArray(pageIds)})`,
  );
  return new Map(rows.map((row) => [row.page_id, { markdown: row.markdown, seenAt: row.seen_at }]));
}

function headingsOf(markdown: string): string {
  return Array.from(markdown.matchAll(/^#{1,6}[ \t]+(.+)$/gm), (match) => match[1]).join('\n');
}

const vector = (text: string) =>
  sql`(to_tsvector('english', ${text}::text) || to_tsvector('simple', ${text}::text))`;

async function writeEntry(db: Db, page: IndexPage, doc: StoredDoc | undefined): Promise<void> {
  const body = clean(await getPageText(db, page.id));
  const source = textSources.get(page.kind);
  const extra = source ? clean(await source(db, page.id)) : '';
  const title = clean(page.title);
  const headings = fold(headingsOf(doc?.markdown ?? ''));
  const text = fold(`${body}\n${extra}`);
  const [before] = (
    await db.execute<{ ancestors: string[]; space_id: string | null }>(
      sql`SELECT ancestor_ids::text[] AS ancestors, space_id FROM search_entries
          WHERE page_id = ${page.id}`,
    )
  ).rows;
  await db.execute(sql`
    INSERT INTO search_entries AS e (page_id, workspace_id, space_id, parent_id, ancestor_ids,
      kind, title, title_key, icon, body, extra, doc_tsv, created_by, created_at, updated_by,
      updated_at, archived_at, trashed_at, text_seen_at, indexed_at)
    VALUES (${page.id}, ${page.workspaceId}, ${page.spaceId}, ${page.parentId},
      ${uuidArray(page.ancestorIds)}, ${page.kind}, ${title}, ${titleKey(title)},
      ${page.icon === null || page.icon === undefined ? null : JSON.stringify(page.icon)}::jsonb,
      ${body}, ${extra},
      setweight(${vector(fold(title))}, 'A') || setweight(${vector(headings)}, 'B')
        || ${vector(text)},
      ${page.createdBy}, ${page.createdAt}, ${page.updatedBy}, ${page.updatedAt},
      ${page.archivedAt}, ${page.trashed ? sql`now()` : null}, ${doc?.seenAt ?? null}::timestamptz, now())
    ON CONFLICT (page_id) DO UPDATE SET workspace_id = excluded.workspace_id,
      space_id = excluded.space_id, parent_id = excluded.parent_id,
      ancestor_ids = excluded.ancestor_ids, kind = excluded.kind, title = excluded.title,
      title_key = excluded.title_key, icon = excluded.icon, body = excluded.body,
      extra = excluded.extra, doc_tsv = excluded.doc_tsv, created_by = excluded.created_by,
      created_at = excluded.created_at, updated_by = excluded.updated_by,
      updated_at = excluded.updated_at, archived_at = excluded.archived_at,
      trashed_at = CASE WHEN excluded.trashed_at IS NULL THEN NULL
        ELSE coalesce(e.trashed_at, excluded.trashed_at) END,
      text_seen_at = excluded.text_seen_at, indexed_at = now()`);
  const moved =
    before &&
    (before.space_id !== page.spaceId || before.ancestors.join() !== page.ancestorIds.join());
  if (moved) {
    // Pages under it keep their own parents below this one.
    await db.execute(sql`
      UPDATE search_entries SET space_id = ${page.spaceId}, indexed_at = now(),
        ancestor_ids = ${uuidArray(page.ancestorIds)}
          || ancestor_ids[array_position(ancestor_ids, ${page.id}::uuid):]
      WHERE ${page.id}::uuid = ANY(ancestor_ids)`);
  }
}

/** Indexes these pages again from the page model; pages that no longer exist leave the index. */
export async function indexPages(db: Db, pageIds: Iterable<string>): Promise<void> {
  const ids = [...new Set(pageIds)];
  for (let at = 0; at < ids.length; at += BATCH) {
    await serially(() => indexChunk(db, ids.slice(at, at + BATCH)));
  }
}

async function indexChunk(db: Db, chunk: string[]): Promise<void> {
  const found = await searchPages().getPagesForIndex(db, chunk);
  const gone = chunk.filter((id) => !found.has(id));
  if (gone.length > 0) {
    await db.execute(sql`DELETE FROM search_entries WHERE page_id = ANY(${uuidArray(gone)})`);
  }
  const docs = await readDocs(db, [...found.keys()]);
  let failed: unknown;
  for (const page of found.values()) {
    // One page that can't be read doesn't hold up the others.
    await writeEntry(db, page, docs.get(page.id)).catch((error: unknown) => {
      failed ??= error;
    });
  }
  if (failed !== undefined) throw failed;
}

/** The pages and everything under them that the index knows. */
export async function subtreeIds(db: Db | Tx, pageIds: readonly string[]): Promise<string[]> {
  if (pageIds.length === 0) return [];
  const ids = uuidArray(pageIds);
  const { rows } = await db.execute<{ page_id: string }>(
    sql`SELECT page_id FROM search_entries WHERE page_id = ANY(${ids}) OR ancestor_ids && ${ids}`,
  );
  return rows.map((row) => row.page_id);
}

/** Moved to Trash: gone from results at once, with everything under it. */
export async function markTrashed(db: Db, pageIds: readonly string[]): Promise<void> {
  if (pageIds.length === 0) return;
  const ids = uuidArray(pageIds);
  await serially(() =>
    db.execute(sql`
      UPDATE search_entries SET trashed_at = now()
      WHERE (page_id = ANY(${ids}) OR ancestor_ids && ${ids}) AND trashed_at IS NULL`),
  );
}

/** Deleted for good: leaves the index, with everything under it. */
export async function removeFromIndex(db: Db, pageIds: readonly string[]): Promise<void> {
  if (pageIds.length === 0) return;
  const ids = uuidArray(pageIds);
  await serially(() =>
    db.execute(
      sql`DELETE FROM search_entries WHERE page_id = ANY(${ids}) OR ancestor_ids && ${ids}`,
    ),
  );
}
