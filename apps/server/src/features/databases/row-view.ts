// A row as one person may see it (GET /:id/rows/:rowId, and the answer to every row write), shaped
// like the view engine's rows: values of the properties they can see; relation links to rows they
// can open, with those rows' titles, and a count of the others ("1 row you can't open"); created
// and edited details only while a property that shows them is visible. Links to rows in Trash are
// left out (restoring the row puts them back). Formula and rollup results come with the query
// part's computed values; until then they're empty.
import type { AccessLevel, ComputedValue, Id, Row, Viewer } from '@carehub/databases';
import { atLeast } from '@carehub/databases/access';
import {
  hiddenMetaFields,
  projectRow,
  type ComputeContext,
  type Projection,
  type QueryRow,
} from '@carehub/databases/engine';
import { sql } from 'drizzle-orm';
import { getAccessForPages } from '../pages';
import { visibleIds } from './meta';
import type { DatabaseRecord } from './record';
import { isRelation, linksOf } from './row-logic';
import { loadPropertyViewer, loadRelatedProperties, uuidList, type Executor } from './store';

export interface RowAnswer extends QueryRow {
  databaseId: string;
  /** Titles of the linked rows shown in the values. */
  rowTitles: Record<Id, string>;
  /** The person's level on this row. */
  viewerAccess: AccessLevel;
}

const EMPTY: ComputedValue = { kind: 'empty' };

/** Linked rows that aren't in Trash, with their titles, and which of them the person can open. */
async function linkedRows(db: Executor, userId: string, ids: readonly string[]) {
  const live = new Map<string, string>();
  if (ids.length === 0) return { live, open: new Set<string>() };
  const { rows } = await db.execute<{ id: string; title: string }>(sql`
    SELECT id, title FROM pages
    WHERE id = ANY(${uuidList(ids)}) AND kind = 'row' AND deleted_at IS NULL`);
  for (const row of rows) live.set(row.id, row.title);
  const levels = await getAccessForPages(db, userId, [...live.keys()]);
  const open = new Set([...live.keys()].filter((id) => atLeast(levels.get(id), 'view')));
  return { live, open };
}

/** The row as `viewer` may see it, where they have `access`. */
export async function rowAnswer(
  db: Executor,
  input: { record: DatabaseRecord; row: Row; viewer: Viewer; access: AccessLevel },
): Promise<RowAnswer> {
  const { record, row, viewer } = input;
  const [who, related] = await Promise.all([
    loadPropertyViewer(db, viewer.userId, record.workspaceId),
    loadRelatedProperties(db, record.properties),
  ]);
  const visible = visibleIds(record.properties, who, related);
  const shown = record.properties.filter((p) => visible.has(p.id));
  const relations = shown.filter(isRelation);
  const linked = [...new Set(relations.flatMap((p) => linksOf(row.values[p.id])))];
  const { live, open } = await linkedRows(db, viewer.userId, linked);

  const values: Row['values'] = { ...row.values };
  for (const p of relations) {
    const links = linksOf(row.values[p.id]).filter((id) => live.has(id));
    values[p.id] = links.length > 0 ? links : null;
  }
  const ctx: ComputeContext = {
    properties: record.properties,
    viewer,
    userName: () => undefined,
    rowTitle: (id) => (open.has(id) ? live.get(id) : undefined),
    computed: () => EMPTY,
    openRow: () => undefined,
  };
  const projection: Projection = {
    properties: shown,
    ctx,
    hiddenMeta: hiddenMetaFields(record.properties, visible),
    titles: {},
    colorOf: () => ({ row: null, cells: {} }),
  };
  const line = { row: { ...row, values }, depth: 0, parentId: null, childCount: 0, context: false };
  const projected = projectRow(line, projection, false);
  return {
    ...projected,
    databaseId: record.id,
    rowTitles: projection.titles,
    viewerAccess: input.access,
  };
}
