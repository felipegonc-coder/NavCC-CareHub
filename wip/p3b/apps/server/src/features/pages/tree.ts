// The sidebar's page tree (Sidebar spec 3.2 and 5): built on the server for each person, so the
// titles of pages they can't open are never sent (SB-06).
import { atLeast, type AccessLevel, type PageIcon, type TreeNodeJson } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import { memberOf, resolvePages, type Executor, type Viewer } from './access';
import { forbidden, isUuid, notFound } from './http';

type TreeRow = {
  id: string;
  parentId: string | null;
  kind: 'page' | 'database' | 'row';
  isInline: boolean;
  title: string;
  icon: PageIcon | null;
  position: string;
};

function add<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** The space's pages and databases the person can open, in sidebar order (`PageTreeJson`). */
export async function spaceTree(db: Executor, viewer: Viewer, spaceId: string) {
  const { rows } = await db.execute<TreeRow>(sql`
    SELECT id, parent_id AS "parentId", kind, is_inline AS "isInline", title, icon, position
    FROM pages WHERE space_id = ${spaceId} AND deleted_at IS NULL ORDER BY position, id`);
  const under = new Map<string | null, TreeRow[]>();
  for (const row of rows) add(under, row.parentId, row);

  // Depth first from the top. Rows, inline databases and everything under them stay out.
  const inTree: TreeRow[] = [];
  const walk = (parentId: string | null) => {
    for (const row of under.get(parentId) ?? []) {
      if (row.kind === 'row' || row.isInline) continue;
      inTree.push(row);
      if (row.kind === 'page') walk(row.id);
    }
  };
  walk(null);

  const answers = await resolvePages(
    db,
    viewer,
    inTree.map((row) => row.id),
  );
  const levelOf = (id: string): AccessLevel => {
    const answer = answers.get(id);
    return answer && !answer.deleted ? answer.level : 'none';
  };
  const open = new Set(inTree.filter((row) => atLeast(levelOf(row.id), 'view')).map((r) => r.id));
  const shownUnder = new Map<string | null, TreeRow[]>();
  const pathHidden: TreeRow[] = [];
  for (const row of inTree) {
    if (!open.has(row.id)) continue;
    if (row.parentId !== null && !open.has(row.parentId)) pathHidden.push(row);
    else add(shownUnder, row.parentId, row);
  }

  const nodes: TreeNodeJson[] = [];
  const emit = (row: TreeRow, hidden: boolean) => {
    const children = row.kind === 'page' ? (shownUnder.get(row.id) ?? []) : [];
    nodes.push({
      id: row.id,
      parentId: hidden ? null : row.parentId,
      kind: row.kind === 'database' ? 'database' : 'page',
      title: row.title,
      icon: row.icon,
      position: row.position,
      hasChildren: children.length > 0,
      access: levelOf(row.id),
      ...(hidden ? { pathHidden: true as const } : {}),
    });
    for (const child of children) emit(child, false);
  };
  for (const row of shownUnder.get(null) ?? []) emit(row, false);
  for (const row of pathHidden) emit(row, true);
  return nodes;
}
