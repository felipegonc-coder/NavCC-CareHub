// Loading and saving databases (decision 0200), for these routes and the rows, query, jobs and forms
// files next to them. Settings writes go through changeDatabase (or lockDatabase, checkVersion and
// saveSettings in one transaction): the database's row is locked with select ... for no key update
// (so rows can still be added meanwhile), a stale version is refused with 409, and every save bumps
// the version. Row writes never lock the database row; takeUniqueNumbers is one short update.
import type { Id, Property, Row } from '@carehub/databases';
import type { PropertyViewer } from '@carehub/databases/access';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import { changed, notFound } from './errors';
import { iconText, isUuid, type DatabaseRecord, type DatabaseSettings } from './record';
import { dbDatabases } from './schema';

/** A database or a transaction. */
export type Executor = Db | Tx;

/** A uuid[] for `= ANY(...)`; fine when empty. */
export const uuidList = (ids: readonly string[]): SQL =>
  sql`ARRAY[${sql.join(
    ids.filter(isUuid).map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;

type DatabaseRow = {
  id: string;
  workspace_id: string;
  space_id: string;
  parent_id: string | null;
  title: string;
  icon: unknown;
  is_inline: boolean;
  in_trash: boolean;
  description: DatabaseSettings['description'] | null;
  properties: DatabaseSettings['properties'] | null;
  views: DatabaseSettings['views'] | null;
  templates: DatabaseSettings['templates'] | null;
  access_rules: DatabaseSettings['accessRules'] | null;
  default_template_id: string | null;
  locked: boolean;
  row_page_layout: DatabaseSettings['rowPageLayout'];
  sub_items: DatabaseSettings['subItems'];
  dependencies: DatabaseSettings['dependencies'];
  deleted_properties: DatabaseSettings['deletedProperties'] | null;
  next_unique_number: number;
  version: number;
  created_at: Date;
  updated_at: Date;
};

const toRecord = (r: DatabaseRow): DatabaseRecord => ({
  id: r.id,
  workspaceId: r.workspace_id,
  spaceId: r.space_id,
  parentId: r.parent_id,
  title: r.title,
  pageIcon: r.icon,
  inline: r.is_inline,
  inTrash: r.in_trash,
  description: r.description ?? [],
  properties: r.properties ?? [],
  views: r.views ?? [],
  templates: r.templates ?? [],
  accessRules: r.access_rules ?? [],
  defaultTemplateId: r.default_template_id,
  locked: r.locked,
  rowPageLayout: r.row_page_layout ?? null,
  subItems: r.sub_items ?? null,
  dependencies: r.dependencies ?? null,
  deletedProperties: r.deleted_properties ?? [],
  nextUniqueNumber: r.next_unique_number,
  version: r.version,
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

async function selectDatabase(db: Executor, id: string, lock: boolean) {
  if (!isUuid(id)) return null;
  const { rows } = await db.execute<DatabaseRow>(sql`
    SELECT d.page_id AS id, d.workspace_id, p.space_id, p.parent_id, p.title, p.icon, p.is_inline,
      p.deleted_at IS NOT NULL AS in_trash, d.description, d.properties, d.views, d.templates,
      d.access_rules, d.default_template_id, d.locked, d.row_page_layout, d.sub_items,
      d.dependencies, d.deleted_properties, d.next_unique_number, d.version, d.created_at,
      d.updated_at
    FROM db_databases d JOIN pages p ON p.id = d.page_id
    WHERE d.page_id = ${id}
    ${lock ? sql`FOR NO KEY UPDATE OF d` : sql.raw('')}`);
  const row = rows[0];
  return row ? toRecord(row) : null;
}

/** The database with this page id (in Trash too: see inTrash), or null. No access checks. */
export function loadDatabase(db: Executor, id: string): Promise<DatabaseRecord | null> {
  return selectDatabase(db, id, false);
}

/** In a transaction: the database, locked for a settings write until the transaction ends. 404 if missing. */
export async function lockDatabase(tx: Tx, id: string): Promise<DatabaseRecord> {
  const record = await selectDatabase(tx, id, true);
  if (!record) throw notFound();
  return record;
}

/** 409 "This database changed. Reload to see the latest." unless the client saw this version. */
export function checkVersion(record: DatabaseRecord, version: number): void {
  if (record.version !== version) throw changed();
}

/** Saves changed settings of a locked database and bumps its version; returns the saved database. */
export async function saveSettings(
  tx: Tx,
  record: DatabaseRecord,
  changes: Partial<DatabaseSettings>,
): Promise<DatabaseRecord> {
  const [saved] = await tx
    .update(dbDatabases)
    .set({ ...changes, version: sql`${dbDatabases.version} + 1`, updatedAt: sql`now()` })
    .where(eq(dbDatabases.pageId, record.id))
    .returning({ version: dbDatabases.version, updatedAt: dbDatabases.updatedAt });
  if (!saved) throw notFound();
  return { ...record, ...changes, version: saved.version, updatedAt: saved.updatedAt };
}

/**
 * One settings write: locks the database, checks the version, asks `change` for the new settings
 * (it may throw, or use the transaction for other writes) and saves them with a new version. An
 * empty change saves nothing and keeps the version. Publish events after this resolves (committed).
 */
export function changeDatabase(
  db: Db,
  id: string,
  version: number,
  change: (
    current: DatabaseRecord,
    tx: Tx,
  ) => Partial<DatabaseSettings> | Promise<Partial<DatabaseSettings>>,
): Promise<DatabaseRecord> {
  return db.transaction(async (tx) => {
    const current = await lockDatabase(tx, id);
    checkVersion(current, version);
    const changes = await change(current, tx);
    return Object.keys(changes).length === 0 ? current : saveSettings(tx, current, changes);
  });
}

/** Adds the db_databases row for a new database page (createDatabasePage made the page). */
export async function insertDatabase(
  tx: Executor,
  input: { id: string; workspaceId: string } & Partial<DatabaseSettings>,
): Promise<void> {
  const { id, workspaceId, ...settings } = input;
  await tx.insert(dbDatabases).values({ pageId: id, workspaceId, ...settings });
}

type RowRow = {
  id: string;
  title: string;
  icon: unknown;
  values: Partial<Record<Id, unknown>> | null;
  unique_number: number | null;
  created_by: string | null;
  created_at: Date;
  edited_by: string | null;
  edited_at: Date;
  form_view_id: string | null;
};

const instant = (value: Date | string) => new Date(value).toISOString();

/**
 * The database's rows (not in Trash), oldest first, as the package's Row with every stored value:
 * strip what the viewer can't see before answering (engine projectRow). `rowIds` picks some.
 */
export async function loadRows(
  db: Executor,
  databaseId: string,
  rowIds?: readonly string[],
): Promise<Row[]> {
  if (!isUuid(databaseId)) return [];
  const only = rowIds ? sql`AND r.page_id = ANY(${uuidList(rowIds)})` : sql.raw('');
  const { rows } = await db.execute<RowRow>(sql`
    SELECT r.page_id AS id, p.title, p.icon, r."values", r.unique_number, r.created_by,
      r.created_at, r.edited_by, r.edited_at, r.form_view_id
    FROM db_rows r JOIN pages p ON p.id = r.page_id
    WHERE r.database_id = ${databaseId} AND p.deleted_at IS NULL ${only}
    ORDER BY r.created_at, r.page_id`);
  return rows.map((r): Row => ({
    id: r.id,
    title: r.title,
    values: r.values ?? {},
    createdAt: instant(r.created_at),
    createdBy: r.created_by,
    editedAt: instant(r.edited_at),
    editedBy: r.edited_by,
    uniqueNumber: r.unique_number,
    icon: iconText(r.icon),
    formId: r.form_view_id,
  }));
}

/**
 * The next `count` ID numbers of the database (1, 2, 3, ... never reused), in one short update.
 * Take them just before inserting the rows, outside any long transaction.
 */
export async function takeUniqueNumbers(
  db: Executor,
  databaseId: string,
  count = 1,
): Promise<number[]> {
  if (!isUuid(databaseId) || !Number.isInteger(count) || count < 1) return [];
  const { rows } = await db.execute<{ first: number }>(sql`
    UPDATE db_databases SET next_unique_number = next_unique_number + ${count}::int
    WHERE page_id = ${databaseId}
    RETURNING next_unique_number - ${count}::int AS first`);
  const first = rows[0]?.first;
  if (first === undefined) throw notFound();
  return Array.from({ length: count }, (_, i) => first + i);
}

const relationTargets = (properties: readonly Property[]): string[] => [
  ...new Set(
    properties.flatMap((p) => (p.config.type === 'relation' ? [p.config.targetDatabaseId] : [])),
  ),
];

/**
 * The properties of the databases these properties relate to, and of the ones those relate to, up
 * to `limit` databases, by property id: what formulas and rollups read across relations, for
 * property access (meta.ts visibleIds and the engine's visiblePropertyIds).
 */
export async function loadRelatedProperties(
  db: Executor,
  properties: readonly Property[],
  limit = 25,
): Promise<Map<Id, Property>> {
  const out = new Map<Id, Property>();
  const seen = new Set<string>();
  let next = relationTargets(properties);
  while (seen.size < limit) {
    const batch = next.filter((id) => isUuid(id) && !seen.has(id)).slice(0, limit - seen.size);
    if (batch.length === 0) break;
    for (const id of batch) seen.add(id);
    const { rows } = await db.execute<{ properties: Property[] | null }>(
      sql`SELECT properties FROM db_databases WHERE page_id = ANY(${uuidList(batch)})`,
    );
    const found = rows.flatMap((r) => r.properties ?? []);
    for (const p of found) out.set(p.id, p);
    next = relationTargets(found);
  }
  return out;
}

/**
 * Who's looking, for property access lists: the person and their workspace role. Groups come with
 * the groups pull request.
 */
export async function loadPropertyViewer(
  db: Executor,
  userId: string,
  workspaceId: string,
): Promise<PropertyViewer> {
  if (!isUuid(userId) || !isUuid(workspaceId)) return { userId, groupIds: [] };
  const { rows } = await db.execute<{ role_id: string | null }>(sql`
    SELECT role_id FROM workspace_members
    WHERE workspace_id = ${workspaceId} AND user_id = ${userId}`);
  const roleId = rows[0]?.role_id;
  return roleId ? { userId, roleId, groupIds: [] } : { userId, groupIds: [] };
}
