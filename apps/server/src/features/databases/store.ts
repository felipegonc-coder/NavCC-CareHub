// Loading and saving databases (decision 0200), for these routes and the rows, query, jobs and forms
// files next to them. Settings writes go through changeDatabase (or lockDatabase, checkVersion and
// saveSettings in one transaction): the database's row is locked with select ... for no key update
// (so rows can still be added meanwhile), a stale version is refused with 409, and every save bumps
// the version. A write that changes two databases (both sides of a two-way relation) locks them in
// id order through changeDatabase's alsoLock. Row writes never lock the database row;
// takeUniqueNumbers is one short update.
import type { Id, Property, Row, Viewer } from '@carehub/databases';
import type { PropertyViewer } from '@carehub/databases/access';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import { changed, notFound } from './errors';
import {
  iconText,
  isUuid,
  type DatabaseRecord,
  type DatabaseSettings,
  type TypeChange,
} from './record';
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
 * Locks this database and the others in `alsoLock` in id order, so two writes that lock the same
 * pair can't deadlock; others that don't exist are skipped. 404 if this one is missing.
 */
async function lockInOrder(tx: Tx, id: string, alsoLock: readonly string[]) {
  const key = id.toLowerCase();
  const ids = [...new Set([key, ...alsoLock.map((other) => other.toLowerCase())])].sort();
  let current: DatabaseRecord | null = null;
  for (const each of ids) {
    const record = await selectDatabase(tx, each, true);
    if (each === key) current = record;
  }
  if (!current) throw notFound();
  return current;
}

/**
 * One settings write: locks the database, checks the version, asks `change` for the new settings
 * (it may throw, or use the transaction for other writes) and saves them with a new version. An
 * empty change saves nothing and keeps the version. Publish events after this resolves (committed).
 * `alsoLock` names other databases `change` will lock too (with lockDatabase): they're locked
 * first, with this one, in id order.
 */
export function changeDatabase(
  db: Db,
  id: string,
  version: number,
  change: (
    current: DatabaseRecord,
    tx: Tx,
  ) => Partial<DatabaseSettings> | Promise<Partial<DatabaseSettings>>,
  options: { alsoLock?: readonly string[] } = {},
): Promise<DatabaseRecord> {
  return db.transaction(async (tx) => {
    const current = await lockInOrder(tx, id, options.alsoLock ?? []);
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

async function selectRows(
  db: Executor,
  databaseId: string,
  opts: { rowIds?: readonly string[] | undefined; withTrash: boolean },
): Promise<Row[]> {
  if (!isUuid(databaseId)) return [];
  const only = opts.rowIds ? sql`AND r.page_id = ANY(${uuidList(opts.rowIds)})` : sql.raw('');
  const live = opts.withTrash ? sql.raw('') : sql.raw('AND p.deleted_at IS NULL');
  const { rows } = await db.execute<RowRow>(sql`
    SELECT r.page_id AS id, p.title, p.icon, r."values", r.unique_number, r.created_by,
      r.created_at, r.edited_by, r.edited_at, r.form_view_id
    FROM db_rows r JOIN pages p ON p.id = r.page_id
    WHERE r.database_id = ${databaseId} ${live} ${only}
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
 * The database's rows (not in Trash), oldest first, as the package's Row with every stored value:
 * strip what the viewer can't see before answering (engine projectRow). `rowIds` picks some.
 */
export function loadRows(
  db: Executor,
  databaseId: string,
  rowIds?: readonly string[],
): Promise<Row[]> {
  return selectRows(db, databaseId, { rowIds, withTrash: false });
}

/** Every row of the database, in Trash too, oldest first: for settings writes that change values. */
export function loadEveryRow(db: Executor, databaseId: string): Promise<Row[]> {
  return selectRows(db, databaseId, { withTrash: true });
}

/** One cell to save: null (or undefined) empties it. */
export type CellWrite = { rowId: Id; propertyId: Id; value: unknown };

const CELL_BATCH = 2_000;

/**
 * Saves cells of rows in these databases (a settings write's value changes, both sides of a
 * two-way relation), a few thousand rows per statement. Row edit times stay as they are.
 */
export async function writeCells(
  tx: Executor,
  databaseIds: readonly string[],
  cells: readonly CellWrite[],
): Promise<void> {
  const byRow = new Map<string, Map<Id, unknown>>();
  for (const cell of cells) {
    if (!isUuid(cell.rowId)) continue;
    let row = byRow.get(cell.rowId);
    if (!row) byRow.set(cell.rowId, (row = new Map()));
    row.set(cell.propertyId, cell.value ?? null);
  }
  const list = [...byRow].map(([rowId, row]) => {
    const entries = [...row];
    return {
      row_id: rowId,
      puts: Object.fromEntries(entries.filter(([, v]) => v !== null)),
      drops: entries.filter(([, v]) => v === null).map(([id]) => id),
    };
  });
  for (let i = 0; i < list.length; i += CELL_BATCH) {
    const batch = JSON.stringify(list.slice(i, i + CELL_BATCH));
    await tx.execute(sql`
      UPDATE db_rows r
      SET "values" = (r."values" - ARRAY(SELECT jsonb_array_elements_text(c.drops))) || c.puts
      FROM jsonb_to_recordset(${batch}::jsonb) AS c(row_id uuid, puts jsonb, drops jsonb)
      WHERE r.page_id = c.row_id AND r.database_id = ANY(${uuidList(databaseIds)})`);
  }
}

/** Takes one property's values out of every row of the database: row id → value (for restore). */
export async function takePropertyValues(
  tx: Executor,
  databaseId: string,
  propertyId: Id,
): Promise<Record<string, unknown>> {
  if (!isUuid(databaseId)) return {};
  const { rows } = await tx.execute<{ id: string; value: unknown }>(sql`
    UPDATE db_rows r SET "values" = r."values" - ${propertyId}::text
    FROM (
      SELECT page_id, "values" -> ${propertyId}::text AS value FROM db_rows
      WHERE database_id = ${databaseId} AND ("values" -> ${propertyId}::text) IS NOT NULL
    ) o
    WHERE r.page_id = o.page_id
    RETURNING o.page_id AS id, o.value`);
  return Object.fromEntries(rows.map((r) => [r.id, r.value]));
}

/** Puts saved values back (restore): row id → value. Rows that no longer exist are skipped. */
export function putPropertyValues(
  tx: Executor,
  databaseId: string,
  propertyId: Id,
  values: Readonly<Record<string, unknown>>,
): Promise<void> {
  const cells = Object.entries(values).map(([rowId, value]) => ({ rowId, propertyId, value }));
  return writeCells(tx, [databaseId], cells);
}

/** Copies one property's values to another property of the same rows (duplicate). */
export async function copyPropertyValues(
  tx: Executor,
  databaseId: string,
  fromId: Id,
  toId: Id,
): Promise<void> {
  if (!isUuid(databaseId)) return;
  await tx.execute(sql`
    UPDATE db_rows SET "values" = "values" || jsonb_build_object(${toId}::text, "values" -> ${fromId}::text)
    WHERE database_id = ${databaseId} AND ("values" -> ${fromId}::text) IS NOT NULL`);
}

/** How long a type change can be undone (the screen offers Undo for 8 seconds; Ctrl+Z longer). */
export const TYPE_CHANGE_UNDO_MS = 10 * 60_000;
const UNDO_WINDOW = sql.raw(`interval '${TYPE_CHANGE_UNDO_MS / 1000} seconds'`);

/**
 * Keeps a type change for Undo and answers its id and when Undo stops working. Prunes up to 100
 * expired ones (anywhere, skipping any another write holds).
 */
export async function keepTypeChange(
  tx: Executor,
  databaseId: string,
  change: Omit<TypeChange, 'id' | 'changedAt'>,
): Promise<{ id: string; undoUntil: string }> {
  await tx.execute(sql`
    DELETE FROM db_type_changes WHERE id IN (
      SELECT id FROM db_type_changes WHERE changed_at < now() - ${UNDO_WINDOW}
      LIMIT 100 FOR UPDATE SKIP LOCKED)`);
  const json = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;
  const { rows } = await tx.execute<{ id: string; changed_at: Date | string }>(sql`
    INSERT INTO db_type_changes (database_id, property_id, changed_by, property, "values", settings)
    VALUES (${databaseId}, ${change.propertyId}, ${change.changedBy}, ${json(change.property)},
      ${json(change.values)}, ${json(change.settings)})
    RETURNING id, changed_at`);
  const kept = rows[0];
  if (!kept) throw notFound();
  const until = Date.parse(instant(kept.changed_at)) + TYPE_CHANGE_UNDO_MS;
  return { id: kept.id, undoUntil: new Date(until).toISOString() };
}

type TypeChangeRow = {
  id: string;
  property_id: string;
  changed_by: string;
  changed_at: Date | string;
  property: TypeChange['property'];
  values: TypeChange['values'] | null;
  settings: TypeChange['settings'] | null;
};

const toTypeChange = (r: TypeChangeRow): TypeChange => ({
  id: r.id,
  propertyId: r.property_id,
  changedBy: r.changed_by,
  changedAt: instant(r.changed_at),
  property: r.property,
  values: r.values ?? {},
  settings: r.settings ?? {},
});

/** A kept type change of this database, or null. No checks: takeTypeChange decides. */
export async function loadTypeChange(
  db: Executor,
  databaseId: string,
  id: string,
): Promise<TypeChange | null> {
  if (!isUuid(databaseId) || !isUuid(id)) return null;
  const { rows } = await db.execute<TypeChangeRow>(sql`
    SELECT id, property_id, changed_by, changed_at, property, "values", settings
    FROM db_type_changes WHERE id = ${id} AND database_id = ${databaseId}`);
  const row = rows[0];
  return row ? toTypeChange(row) : null;
}

/**
 * Takes a type change out for Undo, when it can still be undone: made by this person, less than
 * 10 minutes ago, and the newest of its property. Null otherwise.
 */
export async function takeTypeChange(
  tx: Executor,
  databaseId: string,
  id: string,
  userId: string,
): Promise<TypeChange | null> {
  if (!isUuid(databaseId) || !isUuid(id) || !isUuid(userId)) return null;
  const { rows } = await tx.execute<TypeChangeRow>(sql`
    DELETE FROM db_type_changes c
    WHERE c.id = ${id} AND c.database_id = ${databaseId} AND c.changed_by = ${userId}
      AND c.changed_at >= now() - ${UNDO_WINDOW}
      AND NOT EXISTS (
        SELECT 1 FROM db_type_changes l
        WHERE l.database_id = c.database_id AND l.property_id = c.property_id
          AND l.changed_at > c.changed_at)
    RETURNING c.id, c.property_id, c.changed_by, c.changed_at, c.property, c."values", c.settings`);
  const row = rows[0];
  return row ? toTypeChange(row) : null;
}

/**
 * Gives ID numbers to rows that have none (numberExistingRows worked them out) and moves the
 * database's counter past them, so they're never given again.
 */
export async function numberRows(
  tx: Executor,
  databaseId: string,
  numbers: ReadonlyMap<Id, number>,
): Promise<void> {
  const list = [...numbers].filter(([id]) => isUuid(id)).map(([id, n]) => ({ row_id: id, n }));
  if (!isUuid(databaseId) || list.length === 0) return;
  const highest = list.reduce((max, r) => Math.max(max, r.n), 0);
  await tx.execute(sql`
    UPDATE db_rows r SET unique_number = c.n
    FROM jsonb_to_recordset(${JSON.stringify(list)}::jsonb) AS c(row_id uuid, n int)
    WHERE r.page_id = c.row_id AND r.database_id = ${databaseId} AND r.unique_number IS NULL`);
  await tx.execute(sql`
    UPDATE db_databases SET next_unique_number = GREATEST(next_unique_number, ${highest + 1}::int)
    WHERE page_id = ${databaseId}`);
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
 * to `limit` databases: database id → its properties. What formulas, rollups and buttons read.
 */
export async function loadRelatedDatabases(
  db: Executor,
  properties: readonly Property[],
  limit = 25,
): Promise<Map<Id, Property[]>> {
  const out = new Map<Id, Property[]>();
  const seen = new Set<string>();
  let next = relationTargets(properties);
  while (seen.size < limit) {
    const batch = next.filter((id) => isUuid(id) && !seen.has(id)).slice(0, limit - seen.size);
    if (batch.length === 0) break;
    for (const id of batch) seen.add(id);
    const { rows } = await db.execute<{ id: string; properties: Property[] | null }>(
      sql`SELECT page_id AS id, properties FROM db_databases WHERE page_id = ANY(${uuidList(batch)})`,
    );
    for (const r of rows) out.set(r.id, r.properties ?? []);
    next = relationTargets(rows.flatMap((r) => r.properties ?? []));
  }
  return out;
}

/**
 * The properties of related databases (loadRelatedDatabases) by property id: what formulas and
 * rollups read across relations, for property access (meta.ts visibleIds).
 */
export async function loadRelatedProperties(
  db: Executor,
  properties: readonly Property[],
  limit = 25,
): Promise<Map<Id, Property>> {
  const out = new Map<Id, Property>();
  for (const list of (await loadRelatedDatabases(db, properties, limit)).values()) {
    for (const p of list) out.set(p.id, p);
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

/** A workspace member, for names in values and Text to Person. */
export type Member = { id: string; name: string; email: string };

/** The workspace's members with their names and sign-in emails. */
export async function loadMembers(db: Executor, workspaceId: string): Promise<Member[]> {
  if (!isUuid(workspaceId)) return [];
  const { rows } = await db.execute<Member>(sql`
    SELECT u.id, u.name, u.email FROM workspace_members m JOIN users u ON u.id = m.user_id
    WHERE m.workspace_id = ${workspaceId}`);
  return rows;
}

type ClockRow = { time_zone: string | null; use_24h: boolean | null; week_start: number | null };

const weekDay = (n: number | null | undefined): Viewer['weekStart'] =>
  n === 1 || n === 2 || n === 3 || n === 4 || n === 5 || n === 6 ? n : 0;

/** The person as the package's Viewer: their time zone, clock and first day of the week. */
export async function loadViewer(db: Executor, userId: string, now = new Date()): Promise<Viewer> {
  const { rows } = isUuid(userId)
    ? await db.execute<ClockRow>(
        sql`SELECT time_zone, use_24h, week_start FROM users WHERE id = ${userId}`,
      )
    : { rows: [] };
  const row = rows[0];
  return {
    userId,
    timeZone: row?.time_zone || 'America/Denver',
    weekStart: weekDay(row?.week_start),
    hour12: row?.use_24h !== true,
    now,
  };
}

/** Titles of pages that aren't in Trash, by id. Check access first. */
export async function loadPageTitles(
  db: Executor,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const list = ids.filter(isUuid);
  if (list.length === 0) return new Map();
  const { rows } = await db.execute<{ id: string; title: string }>(sql`
    SELECT id, title FROM pages WHERE id = ANY(${uuidList(list)}) AND deleted_at IS NULL`);
  return new Map(rows.map((r) => [r.id, r.title]));
}
