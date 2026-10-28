// When the index is updated (spec 3.3): page events at once (new pages and renames within 2
// seconds, Trash and Archive at once), content edits by polling page_docs every 2 seconds, and
// pages missing from the index when the server starts (for example made by the seed).
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db';
import {
  exactTime,
  indexPages,
  markTrashed,
  pageIdsOf,
  removeFromIndex,
  subtreeIds,
  uuidArray,
} from './indexer';
import { searchPages } from './pages';
import { recordViewed } from './recent';

const POLL_MS = 2000;
/** Saves that commit a little late are still picked up. */
const OVERLAP = "interval '30 seconds'";

export interface ContentCursor {
  /** Exact ISO time (exactTime). */
  at: string;
  pageId: string;
}

const FIRST_ID = '00000000-0000-0000-0000-000000000000';

/** Where content polling starts: just before the newest text the index has read. */
export async function contentCursorStart(db: Db): Promise<ContentCursor> {
  const { rows } = await db.execute<{ at: string }>(sql`
    SELECT ${exactTime(`(coalesce(max(text_seen_at), now()) - ${OVERLAP})`)} AS at
    FROM search_entries`);
  return { at: rows[0]?.at ?? new Date().toISOString(), pageId: FIRST_ID };
}

/** Indexes pages whose text changed after the cursor; returns the new cursor. */
export async function syncContent(db: Db, cursor: ContentCursor): Promise<ContentCursor> {
  // stand-in: the event page.contentSaved (S4) replaces this polling.
  const { rows } = await db.execute<{ page_id: string; at: string }>(sql`
    SELECT page_id, ${exactTime('text_updated_at')} AS at FROM page_docs
    WHERE (text_updated_at, page_id) > (${cursor.at}::timestamptz, ${cursor.pageId}::uuid)
    ORDER BY text_updated_at, page_id LIMIT 200`);
  const late = await db.execute<{ page_id: string }>(sql`
    SELECT d.page_id FROM page_docs d JOIN search_entries e ON e.page_id = d.page_id
    WHERE d.text_updated_at > now() - ${sql.raw(OVERLAP)}
      AND e.text_seen_at IS DISTINCT FROM d.text_updated_at`);
  await indexPages(
    db,
    [...rows, ...late.rows].map((row) => row.page_id),
  );
  const last = rows[rows.length - 1];
  return last ? { at: last.at, pageId: last.page_id } : cursor;
}

/** Indexes the pages the page model has and the index doesn't. */
export async function indexMissingPages(db: Db): Promise<void> {
  let afterId: string | null = null;
  for (;;) {
    const ids = await searchPages().listPageIds(db, { afterId, limit: 500 });
    if (ids.length === 0) return;
    const { rows } = await db.execute<{ page_id: string }>(
      sql`SELECT page_id FROM search_entries WHERE page_id = ANY(${uuidArray(ids)})`,
    );
    const known = new Set(rows.map((row) => row.page_id));
    await indexPages(
      db,
      ids.filter((id) => !known.has(id)),
    );
    afterId = ids[ids.length - 1] ?? null;
  }
}

type LooseEvents = { on(name: string, handler: (payload: unknown) => unknown): () => void };

/** Error codes only: a failed query's message can hold page text. */
function codeOf(error: unknown): string {
  const { code, cause } = (error ?? {}) as { code?: unknown; cause?: { code?: unknown } };
  return String(code ?? cause?.code ?? 'unknown');
}

/** Subscribes to page events and starts polling; both stop when the app closes. */
export function startSearchSync(app: FastifyInstance): void {
  const db = app.db;
  const safely = (what: string, run: () => Promise<unknown>) =>
    run().catch((error: unknown) => {
      app.log.warn({ code: codeOf(error) }, `search: ${what} failed`);
    });
  // Core's page events, read loosely: core declares their payloads (decision 0007, 2.4).
  const events = app.events as unknown as LooseEvents;
  const reindex = (payload: unknown) =>
    safely('indexing', () => indexPages(db, pageIdsOf(payload)));
  // The pages under it too: their Trash and Archive state comes from the page model.
  const reindexSubtree = (payload: unknown) =>
    safely('indexing', async () => {
      const ids = pageIdsOf(payload);
      await indexPages(db, [...ids, ...(await subtreeIds(db, ids))]);
    });
  const unsubscribe = [
    events.on('page.created', reindex),
    events.on('page.updated', reindex),
    events.on('page.kindChanged', reindex),
    events.on('page.restored', reindexSubtree),
    events.on('page.archived', reindexSubtree),
    events.on('page.unarchived', reindexSubtree),
    events.on('page.viewed', (payload) =>
      safely('recording a visit', () => recordViewed(db, payload)),
    ),
    events.on('page.trashed', (payload) =>
      safely('Trash', () => markTrashed(db, pageIdsOf(payload))),
    ),
    events.on('page.deleted', (payload) =>
      safely('removing', () => removeFromIndex(db, pageIdsOf(payload))),
    ),
  ];

  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<unknown> | undefined;
  let cursor: ContentCursor | undefined;
  const tick = () => {
    running ??= safely('content sync', async () => {
      cursor ??= await contentCursorStart(db);
      cursor = await syncContent(db, cursor);
    }).finally(() => {
      running = undefined;
    });
  };
  app.addHook('onReady', async () => {
    running = safely('catching up', () => indexMissingPages(db)).finally(() => {
      running = undefined;
    });
    timer = setInterval(tick, POLL_MS);
    timer.unref();
  });
  app.addHook('onClose', async () => {
    clearInterval(timer);
    for (const off of unsubscribe) off();
    await running;
  });
}
