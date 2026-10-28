// The page model's tables (migration 202610270036_pages_spaces_access.sql), read for the index.
// features/pages exports access only, so pages and their parents are read here.
import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import type { IndexPage, SearchKind } from './pages';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuids = (ids: readonly string[]) => sql`${sql.param([...ids])}::uuid[]`;

type Timestamp = Date | string;
type PageRow = {
  id: string;
  workspace_id: string;
  space_id: string;
  parent_id: string | null;
  ancestor_ids: string[];
  kind: SearchKind;
  title: string;
  icon: unknown;
  created_by: string | null;
  created_at: Timestamp;
  updated_by: string | null;
  updated_at: Timestamp;
  archived_at: Timestamp | null;
  trashed: boolean;
};

/**
 * The pages that still exist, Trash included, with their parent pages (top first). A page counts
 * as archived when it, a parent page or its space is, and as in Trash the same way.
 */
export async function getPagesForIndex(
  db: Db | Tx,
  pageIds: readonly string[],
): Promise<Map<string, IndexPage>> {
  const ids = [...new Set(pageIds)].filter((id) => UUID.test(id));
  if (ids.length === 0) return new Map();
  const { rows } = await db.execute<PageRow>(sql`
    WITH RECURSIVE up AS (
      SELECT p.id AS page_id, p.parent_id AS node_id, 1 AS depth
      FROM pages p WHERE p.id = ANY(${uuids(ids)}) AND p.parent_id IS NOT NULL
      UNION ALL
      SELECT up.page_id, a.parent_id, up.depth + 1
      FROM up JOIN pages a ON a.id = up.node_id
      WHERE a.parent_id IS NOT NULL AND up.depth < 1000
    ),
    parents AS (
      SELECT up.page_id, array_agg(up.node_id ORDER BY up.depth DESC)::text[] AS ids,
        max(a.archived_at) AS archived_at, bool_or(a.deleted_at IS NOT NULL) AS trashed
      FROM up JOIN pages a ON a.id = up.node_id
      GROUP BY up.page_id
    )
    SELECT p.id, p.workspace_id, p.space_id, p.parent_id,
      coalesce(parents.ids, '{}') AS ancestor_ids, p.kind, p.title, p.icon,
      p.created_by, p.created_at, p.updated_by, p.updated_at,
      coalesce(p.archived_at, parents.archived_at, s.archived_at) AS archived_at,
      p.deleted_at IS NOT NULL OR coalesce(parents.trashed, false) OR s.deleted_at IS NOT NULL
        AS trashed
    FROM pages p JOIN spaces s ON s.id = p.space_id
    LEFT JOIN parents ON parents.page_id = p.id
    WHERE p.id = ANY(${uuids(ids)})`);
  return new Map(
    rows.map((row): [string, IndexPage] => [
      row.id,
      {
        id: row.id,
        workspaceId: row.workspace_id,
        spaceId: row.space_id,
        parentId: row.parent_id,
        ancestorIds: row.ancestor_ids,
        kind: row.kind,
        title: row.title,
        icon: row.icon,
        createdBy: row.created_by,
        createdAt: new Date(row.created_at),
        updatedBy: row.updated_by,
        updatedAt: new Date(row.updated_at),
        archivedAt: row.archived_at === null ? null : new Date(row.archived_at),
        trashed: row.trashed,
      },
    ]),
  );
}

/** Page IDs in ID order after `afterId`, Trash included, for building the index. */
export async function listPageIds(
  db: Db | Tx,
  { afterId, limit }: { afterId: string | null; limit: number },
): Promise<string[]> {
  const after = afterId === null ? sql`true` : sql`id > ${afterId}::uuid`;
  const { rows } = await db.execute<{ id: string }>(
    sql`SELECT id FROM pages WHERE ${after} ORDER BY id LIMIT ${limit}`,
  );
  return rows.map((row) => row.id);
}
