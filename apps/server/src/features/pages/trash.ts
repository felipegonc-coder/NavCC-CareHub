// Trash (Page history and Trash 3.4; decision 0012, point 17). A page, database or row goes to
// Trash with everything under it as one entry, and comes back the same way, in the same place.
// Access checks and events are the caller's.
import type { TrashEntryJson, TrashQuery } from '@carehub/shared';
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db';
import { resolvePages, type Executor, type Viewer } from './access';
import { conflict, iso, isUuid, notFound, uuidArray } from './http';
import { ancestorsOf, person } from './pages';
import { restoreSpace } from './spaces';

/** Days an entry stays in Trash; `pages.trashRetentionDays` replaces it with workspace settings. */
export const TRASH_RETENTION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

/** An entry's pages (`pageIds`, the page included) for `page.trashed`, `.restored` and `.deleted`. */
export type TrashedPages = {
  pageId: string;
  workspaceId: string;
  spaceId: string;
  pageIds: string[];
};
type Moved = { id: string; workspaceId: string; spaceId: string };

function entryOf(pageId: string, rows: Moved[]): TrashedPages | null {
  const page = rows.find((row) => row.id === pageId);
  if (!page) return null;
  const { workspaceId, spaceId } = page;
  return { pageId, workspaceId, spaceId, pageIds: rows.map((row) => row.id) };
}
const moved = sql`RETURNING id, workspace_id AS "workspaceId", space_id AS "spaceId"`;

/** 0007: moves a page, database or row to Trash with its sub-pages, databases and rows. */
export const trashPage = (tx: Executor, pageId: string, by: string): Promise<TrashedPages> =>
  trashPages(tx, [pageId], by);

/**
 * Moves pages to Trash as one entry, each with what's under it (Import's undo). The first live
 * one is the entry's page; others must be in its space, or they're left where they are.
 */
export async function trashPages(
  tx: Executor,
  pageIds: readonly string[],
  by: string,
): Promise<TrashedPages> {
  const ids = uuidArray(pageIds.filter(isUuid));
  const { rows } = await tx.execute<Moved & { root: string }>(sql`
    WITH RECURSIVE live AS (
      SELECT p.id, p.space_id FROM pages p JOIN spaces s ON s.id = p.space_id
      WHERE p.id = ANY(${ids}) AND p.deleted_at IS NULL AND s.deleted_at IS NULL
    ), root AS (
      SELECT id, space_id FROM live ORDER BY array_position(${ids}, id) LIMIT 1
    ), below AS (
      SELECT id FROM live WHERE space_id = (SELECT space_id FROM root)
      UNION SELECT p.id FROM pages p JOIN below b ON p.parent_id = b.id WHERE p.deleted_at IS NULL
    )
    UPDATE pages SET deleted_at = now(), deleted_by = ${by}::uuid,
      trash_root_id = (SELECT id FROM root)
    WHERE id IN (SELECT id FROM below) AND deleted_at IS NULL ${moved}, trash_root_id AS root`);
  const entry = rows[0] ? entryOf(rows[0].root, rows) : null;
  if (!entry) throw notFound();
  return entry;
}

export type TrashPlace = { type: 'page' | 'space'; id: string };

/** Where a page in Trash was, when that's in Trash too: its parents in Trash, then its space. */
export async function placesInTrash(db: Executor, pageId: string): Promise<TrashPlace[]> {
  const { rows } = await db.execute<TrashPlace>(sql`
    WITH RECURSIVE up AS (
      SELECT parent_id AS id, 1 AS depth FROM pages WHERE id = ${pageId} AND parent_id IS NOT NULL
      UNION ALL
      SELECT a.parent_id, up.depth + 1 FROM up JOIN pages a ON a.id = up.id
      WHERE a.deleted_at IS NOT NULL AND a.parent_id IS NOT NULL AND up.depth < 1000
    )
    SELECT * FROM (
      SELECT 'page' AS type, a.id, up.depth FROM up JOIN pages a ON a.id = up.id
      WHERE a.deleted_at IS NOT NULL
      UNION ALL
      SELECT 'space', s.id, 1000000 FROM pages p JOIN spaces s ON s.id = p.space_id
      WHERE p.id = ${pageId} AND s.deleted_at IS NOT NULL
    ) places ORDER BY depth`);
  return rows.map(({ type, id }) => ({ type, id }));
}

/** The page and what's under it from the same entry; null when it isn't in Trash (any more). */
async function restoreOne(tx: Executor, pageId: string, by: string) {
  const { rows } = await tx.execute<Moved>(sql`
    WITH RECURSIVE below AS (
      SELECT id, trash_root_id AS root FROM pages
      WHERE (id = ${pageId} OR trash_root_id = ${pageId}) AND deleted_at IS NOT NULL
      UNION SELECT p.id, b.root FROM pages p JOIN below b
        ON p.parent_id = b.id AND p.trash_root_id = b.root
    )
    UPDATE pages p SET deleted_at = NULL, deleted_by = NULL, trash_root_id = NULL,
      updated_by = CASE WHEN p.id = ${pageId} THEN ${by}::uuid ELSE p.updated_by END,
      updated_at = CASE WHEN p.id = ${pageId} THEN now() ELSE p.updated_at END
    FROM below WHERE p.id = below.id AND p.deleted_at IS NOT NULL
    RETURNING p.id, p.workspace_id AS "workspaceId", p.space_id AS "spaceId"`);
  return entryOf(pageId, rows);
}

/**
 * 0007: brings a page back from Trash where it was, with what went with it. When the page or
 * space it was in is in Trash too, it refuses (409) unless `withParents` brings those back first
 * ("Restore both"), or `alone` restores it anyway so that the caller can move it ("Move to…").
 */
export async function restorePage(
  tx: Executor,
  pageId: string,
  by: string,
  options: { withParents?: boolean; alone?: boolean } = {},
): Promise<{ pages: TrashedPages[]; spaceIds: string[] }> {
  if (!isUuid(pageId)) throw notFound();
  const places = await placesInTrash(tx, pageId);
  if (places.length > 0 && !options.withParents && !options.alone) {
    throw conflict('The page or space it was in is in Trash too.');
  }
  const pages: TrashedPages[] = [];
  const spaceIds: string[] = [];
  for (const place of options.withParents ? places.reverse() : []) {
    if (place.type === 'space') {
      await restoreSpace(tx, place.id);
      spaceIds.push(place.id);
    } else {
      const step = await restoreOne(tx, place.id, by);
      if (step) pages.push(step);
    }
  }
  const own = await restoreOne(tx, pageId, by);
  if (own) pages.push(own);
  // Not in Trash itself, nor in a page or space in Trash.
  else if (places.length === 0) throw notFound();
  return { pages, spaceIds };
}

/** Each top page (`top` is a condition on `p`) with everything under it. */
async function subtrees(db: Executor, top: SQL): Promise<TrashedPages[]> {
  const { rows } = await db.execute<Moved & { top: string }>(sql`
    WITH RECURSIVE below AS (
      SELECT p.id, p.id AS top FROM pages p WHERE ${top}
      UNION SELECT p.id, b.top FROM pages p JOIN below b ON p.parent_id = b.id
    )
    SELECT p.id, b.top, p.workspace_id AS "workspaceId", p.space_id AS "spaceId"
    FROM below b JOIN pages p ON p.id = b.id`);
  const tops = [...new Set(rows.map((row) => row.top))];
  return tops.map((top) =>
    entryOf(
      top,
      rows.filter((row) => row.top === top),
    )!,
  );
}

/**
 * Deletes a page in Trash (or in a space in Trash) for good, with everything under it. Other
 * features' rows for these pages go with them by cascade, or on `page.deleted`.
 */
export async function deletePageForever(tx: Executor, pageId: string): Promise<TrashedPages> {
  if (!isUuid(pageId)) throw notFound();
  // With the entry's other pages at the top (trashPages).
  const tops = await subtrees(
    tx,
    sql`(p.id = ${pageId} AND (p.deleted_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM spaces s WHERE s.id = p.space_id AND s.deleted_at IS NOT NULL)))
      OR (p.trash_root_id = ${pageId} AND p.id <> ${pageId} AND NOT EXISTS (
        SELECT 1 FROM pages a WHERE a.id = p.parent_id AND a.trash_root_id = ${pageId}))`,
  );
  const entry = tops.find((top) => top.pageId === pageId);
  if (!entry) throw notFound();
  await tx.execute(sql`DELETE FROM pages WHERE id = ${pageId} OR trash_root_id = ${pageId}`);
  return { ...entry, pageIds: [...new Set(tops.flatMap((top) => top.pageIds))] };
}

/** Deletes a space in Trash for good, with its pages: one entry per page at its top. */
export async function deleteSpaceForever(tx: Executor, spaceId: string): Promise<TrashedPages[]> {
  const entries = await subtrees(tx, sql`p.space_id = ${spaceId} AND p.parent_id IS NULL`);
  const { rows } = await tx.execute(sql`
    DELETE FROM spaces WHERE id = ${spaceId} AND deleted_at IS NOT NULL RETURNING id`);
  if (rows.length === 0) throw notFound();
  return entries;
}

/** Deletes for good what's been in Trash longer than the Trash period (HT-12). */
export async function purgeTrash(db: Db, now = new Date()): Promise<TrashedPages[]> {
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY).toISOString();
  const { rows } = await db.execute<{ id: string; isSpace: boolean }>(sql`
    SELECT id, false AS "isSpace", deleted_at FROM pages
    WHERE deleted_at < ${cutoff}::timestamptz AND trash_root_id = id
    UNION ALL
    SELECT id, true, deleted_at FROM spaces WHERE deleted_at < ${cutoff}::timestamptz
    ORDER BY deleted_at`);
  const gone: TrashedPages[] = [];
  for (const { id, isSpace } of rows) {
    await db
      .transaction(async (tx) => {
        gone.push(
          ...(isSpace ? await deleteSpaceForever(tx, id) : [await deletePageForever(tx, id)]),
        );
      })
      // Already gone with a parent or a space deleted before it.
      .catch((error: unknown) => {
        if ((error as { statusCode?: number }).statusCode !== 404) throw error;
      });
  }
  return gone;
}

type EntryRow = Omit<TrashEntryJson, 'ancestors' | 'canDeleteForever'> & {
  mine: boolean;
  owns?: boolean;
};
const BATCH = 200;
const LIMIT = 100;

/**
 * GET /api/trash: newest first, what the person may restore: what they deleted, pages they have
 * Full access on (grants on pages in Trash don't change), and spaces they own or Admins.
 */
export async function listTrash(
  db: Executor,
  viewer: Viewer,
  workspace: { id: string; isAdmin: boolean },
  query: TrashQuery,
): Promise<TrashEntryJson[]> {
  const { q, deletedBy, spaceId, type } = query;
  const deletesAt = (column: string) =>
    iso(`${column} + interval '${TRASH_RETENTION_DAYS * 24} hours'`);
  const filters = (alias: 'p' | 's', title: string, space: string, before?: string) =>
    sql.join(
      [
        q ? sql`strpos(lower(${sql.raw(title)}), lower(${q})) > 0` : sql`true`,
        deletedBy ? sql`${sql.raw(alias)}.deleted_by = ${deletedBy}::uuid` : sql`true`,
        spaceId ? sql`${sql.raw(space)} = ${spaceId}::uuid` : sql`true`,
        before
          ? sql`date_trunc('milliseconds', ${sql.raw(alias)}.deleted_at) < ${before}::timestamptz`
          : sql`true`,
      ],
      sql` AND `,
    );
  const entries: TrashEntryJson[] = [];
  if (type === undefined || type === 'space') {
    const { rows } = await db.execute<EntryRow>(sql`
      SELECT s.id, 'space' AS type, s.name AS title, s.icon, NULL AS space,
        (SELECT count(*) FROM pages c WHERE c.space_id = s.id AND c.deleted_at IS NULL
          AND c.kind <> 'row')::int AS "subPages",
        (SELECT count(*) FROM pages c WHERE c.space_id = s.id AND c.deleted_at IS NULL
          AND c.kind = 'row')::int AS rows,
        ${person('s.deleted_by')} AS "deletedBy", ${iso('s.deleted_at')} AS "deletedAt",
        ${deletesAt('s.deleted_at')} AS "deletesAt", s.deleted_by = ${viewer.userId} AS mine,
        EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = s.id AND m.role = 'owner'
          AND m.principal_type = 'user' AND m.principal_id = ${viewer.userId}) AS owns
      FROM spaces s
      WHERE s.workspace_id = ${workspace.id} AND s.deleted_at IS NOT NULL AND s.kind <> 'personal'
        AND ${filters('s', 's.name', 's.id', query.before)}`);
    for (const { mine, owns, ...row } of rows) {
      const manages = workspace.isAdmin || owns === true;
      if (manages || mine) entries.push({ ...row, ancestors: [], canDeleteForever: manages });
    }
  }
  let before = query.before;
  while (type !== 'space') {
    const { rows } = await db.execute<EntryRow>(sql`
      SELECT p.id, p.kind AS type, p.title, p.icon,
        json_build_object('id', s.id, 'name', s.name, 'kind', s.kind) AS space,
        (SELECT count(*) FROM pages c WHERE c.trash_root_id = p.id AND c.id <> p.id
          AND c.kind <> 'row')::int AS "subPages",
        (SELECT count(*) FROM pages c WHERE c.trash_root_id = p.id AND c.id <> p.id
          AND c.kind = 'row')::int AS rows,
        ${person('p.deleted_by')} AS "deletedBy", ${iso('p.deleted_at')} AS "deletedAt",
        ${deletesAt('p.deleted_at')} AS "deletesAt", p.deleted_by = ${viewer.userId} AS mine
      FROM pages p JOIN spaces s ON s.id = p.space_id
      WHERE p.workspace_id = ${workspace.id} AND p.deleted_at IS NOT NULL
        AND p.trash_root_id = p.id AND s.deleted_at IS NULL
        AND ${type ? sql`p.kind = ${type}` : sql`true`}
        AND ${filters('p', 'p.title', 'p.space_id', before)}
      ORDER BY p.deleted_at DESC, p.id LIMIT ${BATCH}`);
    const levels = await resolvePages(
      db,
      viewer,
      rows.map((row) => row.id),
    );
    for (const { mine, ...row } of rows) {
      const full = levels.get(row.id)?.level === 'full';
      if (!full && !mine) continue;
      const ancestors = await ancestorsOf(db, viewer, row.id, true);
      entries.push({ ...row, ancestors, canDeleteForever: full });
    }
    if (rows.length < BATCH || entries.length >= LIMIT) break;
    before = rows.at(-1)!.deletedAt;
  }
  entries.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return entries.slice(0, LIMIT);
}
