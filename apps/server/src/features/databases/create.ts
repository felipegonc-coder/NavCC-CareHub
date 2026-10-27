// createDatabase and duplicateDatabase (decision 0200; api.ts offers them to other lanes): each
// checks the person's access first and refuses (403) before any change, then writes the database
// page, its settings, its template pages, form links and repeat state, and its rows, in the
// caller's transaction. Rows are written here (their pages and db_rows entries) until the row
// server's createRows lands; then these call it. Page content isn't copied yet: that waits for
// core's page copy. seedDatabase is the seed's: a database at the top of a space.
import { randomUUID } from 'node:crypto';
import type { AccessLevel, Id, Property, Row } from '@carehub/databases';
import { atLeast } from '@carehub/databases/access';
import { parseRequest } from '@carehub/databases/schemas';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../db';
import { getAccessForPages } from '../pages';
import {
  DEFINITION_MESSAGES,
  THIS_DATABASE,
  databaseDefinitionSchema,
  duplicateInputSchema,
  planCopy,
  planDefinition,
  topLevelDefinitionSchema,
  type DatabaseDefinition,
  type DatabasePlan,
  type DuplicateInput,
  type PlannedDefinition,
  type PlannedRow,
  type TopLevelDefinition,
} from './define';
import { forbidden, invalid, invalidRequest, notFound } from './errors';
import { hiddenProperties } from './http';
import { createDatabasePage, createTemplatePage, loadPagePlace, type PagePlace } from './pages';
import { isUuid } from './record';
import {
  insertDatabase,
  loadDatabase,
  loadRelatedDatabases,
  loadRows,
  saveRepeatState,
  uuidList,
  type Executor,
} from './store';
import { keepLinkCode, newLinkCode } from './view-routes';

/** What createDatabase made: the database page's id, and its views, templates and rows in order. */
export interface CreatedDatabase {
  databaseId: Id;
  viewIds: Id[];
  templateIds: Id[];
  rowIds: Id[];
}

/** What duplicateDatabase made. Properties, options and views keep their ids in the copy. */
export interface DatabaseCopy {
  databaseId: Id;
  /** Original template id → the copy's. */
  templateIds: Record<Id, Id>;
  /** Original row id → the copy's (the rows that were copied). */
  rowIds: Record<Id, Id>;
}

/** Rows written (and checked for access) per statement. */
const ROW_BATCH = 500;
/** Other databases a definition's relations and buttons may point at. */
const MOST_TARGETS = 25;

type Place = PagePlace & { level: AccessLevel };

/** A page `by` can edit to put a database under: 404 if it's gone, 403 below Can edit. */
async function editablePage(tx: Tx, by: string, pageId: string): Promise<Place> {
  const page = await loadPagePlace(tx, pageId);
  if (!page || page.inTrash) throw notFound();
  const level = (await getAccessForPages(tx, by, [page.id])).get(page.id) ?? 'none';
  if (!atLeast(level, 'edit')) throw forbidden();
  if (page.kind === 'database') throw invalidRequest();
  return { ...page, level };
}

/** The other databases a property points at: a relation's target, a button step's database. */
function targetsOf(prop: Property): Id[] {
  const config = prop.config;
  if (config.type === 'relation') return [config.targetDatabaseId];
  if (config.type !== 'button') return [];
  return config.actions.flatMap((action) =>
    action.kind === 'add_row' || action.kind === 'edit_rows' ? [action.databaseId] : [],
  );
}

/**
 * The databases a definition points at, each in this workspace, not in Trash and one `by` can
 * open (403 otherwise), with the ones they relate to: database id → its properties.
 */
async function relatedDatabases(
  tx: Tx,
  by: string,
  workspaceId: string,
  properties: readonly Property[],
): Promise<Map<Id, Property[]>> {
  const ids = [...new Set(properties.flatMap(targetsOf))].filter((id) => id !== THIS_DATABASE);
  const related = new Map<Id, Property[]>();
  if (ids.length === 0) return related;
  if (ids.length > MOST_TARGETS || !ids.every(isUuid)) throw invalidRequest();
  const levels = await getAccessForPages(tx, by, ids);
  for (const id of ids) {
    const found = await loadDatabase(tx, id);
    if (!found || found.workspaceId !== workspaceId || found.inTrash) throw invalidRequest();
    if (!atLeast(levels.get(id), 'view')) throw forbidden();
    related.set(id, found.properties);
  }
  for (const [id, list] of await loadRelatedDatabases(tx, [...related.values()].flat())) {
    if (!related.has(id)) related.set(id, list);
  }
  return related;
}

/** The icon and cover of pages, as stored. */
async function pageLooks(
  db: Executor,
  ids: readonly string[],
): Promise<Map<string, { icon: unknown; cover: unknown }>> {
  const list = ids.filter(isUuid);
  if (list.length === 0) return new Map();
  const { rows } = await db.execute<{ id: string; icon: unknown; cover: unknown }>(
    sql`SELECT id, icon, cover FROM pages WHERE id = ANY(${uuidList(list)})`,
  );
  return new Map(rows.map((r) => [r.id, { icon: r.icon, cover: r.cover }]));
}

const emojiIcon = (emoji: string | null) => (emoji ? { type: 'emoji', emoji } : null);

/**
 * The rows' pages and db_rows entries, as `by`'s, a millisecond apart so they keep their order
 * (a copy takes the original page's icon and cover). Replaced by the row server's createRows.
 */
async function writeRows(
  tx: Tx,
  input: {
    databaseId: Id;
    workspaceId: string;
    spaceId: string;
    by: string;
    rows: readonly PlannedRow[];
    now: Date;
  },
): Promise<void> {
  for (let start = 0; start < input.rows.length; start += ROW_BATCH) {
    const batch = input.rows.slice(start, start + ROW_BATCH);
    const looks = await pageLooks(
      tx,
      batch.flatMap((row) => (row.sourceId ? [row.sourceId] : [])),
    );
    const json = JSON.stringify(
      batch.map((row, i) => {
        const look = row.sourceId ? looks.get(row.sourceId) : undefined;
        return {
          id: row.id,
          title: row.title,
          icon: look ? look.icon : emojiIcon(row.icon),
          cover: look?.cover ?? null,
          pos: `r${String(start + i).padStart(6, '0')}`,
          values: row.values,
          n: row.uniqueNumber,
          form: row.formViewId,
          stamp: new Date(input.now.getTime() + start + i).toISOString(),
        };
      }),
    );
    await tx.execute(sql`
      INSERT INTO pages (id, workspace_id, space_id, parent_id, kind, title, icon, cover, position,
        created_by, created_at, updated_by, updated_at)
      SELECT r.id, ${input.workspaceId}, ${input.spaceId}, ${input.databaseId}, 'row', r.title,
        r.icon, r.cover, r.pos, ${input.by}, r.stamp, ${input.by}, r.stamp
      FROM jsonb_to_recordset(${json}::jsonb)
        AS r(id uuid, title text, icon jsonb, cover jsonb, pos text, stamp timestamptz)`);
    await tx.execute(sql`
      INSERT INTO db_rows (page_id, database_id, workspace_id, "values", unique_number, created_by,
        created_at, edited_by, edited_at, form_view_id)
      SELECT r.id, ${input.databaseId}, ${input.workspaceId}, r."values", r.n, ${input.by},
        r.stamp, ${input.by}, r.stamp, r.form
      FROM jsonb_to_recordset(${json}::jsonb)
        AS r(id uuid, "values" jsonb, n int, form text, stamp timestamptz)`);
  }
}

interface NewPage {
  id: Id;
  workspaceId: string;
  spaceId: string;
  /** The page it goes under; null: the top of the space. */
  parentId: string | null;
  title: string;
  inline: boolean;
  icon: unknown;
  cover: unknown;
  by: string;
}

/** Everything a plan says: the page, its settings, template pages, form links, repeats and rows. */
async function writeDatabase(tx: Tx, plan: DatabasePlan, page: NewPage): Promise<void> {
  const place = { workspaceId: page.workspaceId, spaceId: page.spaceId };
  await createDatabasePage(tx, {
    id: page.id,
    ...place,
    parentId: page.parentId,
    title: page.title,
    inline: page.inline,
    icon: page.icon,
    cover: page.cover,
    createdBy: page.by,
  });
  await insertDatabase(tx, {
    id: page.id,
    workspaceId: page.workspaceId,
    ...plan.settings,
    nextUniqueNumber: plan.nextUniqueNumber,
  });
  for (const template of plan.templatePages) {
    await createTemplatePage(tx, {
      ...template,
      ...place,
      databaseId: page.id,
      createdBy: page.by,
    });
  }
  for (const view of plan.settings.views) await keepLinkCode(tx, page.id, view);
  const now = new Date();
  for (const template of plan.settings.templates) {
    if (template.repeat) await saveRepeatState(tx, page.id, template, now);
  }
  await writeRows(tx, { ...place, databaseId: page.id, by: page.by, rows: plan.rows, now });
}

/** A definition's plan, with new ids for the database, its templates and its rows. */
function planNew(
  def: PlannedDefinition,
  place: { workspaceId: string; spaceId: string },
  related: Map<Id, Property[]>,
): { databaseId: Id; plan: DatabasePlan } {
  const databaseId = randomUUID();
  const plan = planDefinition(def, {
    databaseId,
    workspaceId: place.workspaceId,
    spaceId: place.spaceId,
    templateIds: (def.templates ?? []).map(() => randomUUID()),
    rowIds: (def.rows ?? []).map(() => randomUUID()),
    linkCode: newLinkCode,
    related,
  });
  return { databaseId, plan };
}

const created = (databaseId: Id, plan: DatabasePlan): CreatedDatabase => ({
  databaseId,
  viewIds: plan.settings.views.map((v) => v.id),
  templateIds: plan.templatePages.map((t) => t.id),
  rowIds: plan.rows.map((r) => r.id),
});

/**
 * A new database from a definition (define.ts), under a page `by` can edit. Refused before any
 * change: 400 for a definition that isn't valid (with where), 404 for a parent that's gone, 403
 * below Can edit there, for a related database `by` can't open, or for settings that take Full
 * access without it.
 */
export async function createDatabase(
  tx: Tx,
  definition: DatabaseDefinition,
): Promise<CreatedDatabase> {
  const parsed = parseRequest(databaseDefinitionSchema, definition);
  if (!parsed.ok) throw invalid(DEFINITION_MESSAGES.invalidAt(parsed.path));
  const def = parsed.value;
  const under = await editablePage(tx, def.by, def.parentId);
  const related = await relatedDatabases(tx, def.by, under.workspaceId, def.properties);
  const { databaseId, plan } = planNew(def, under, related);
  if (plan.needsFull && !atLeast(under.level, 'full')) throw forbidden();
  await writeDatabase(tx, plan, {
    id: databaseId,
    workspaceId: under.workspaceId,
    spaceId: under.spaceId,
    parentId: under.id,
    title: def.title,
    inline: def.inline ?? false,
    icon: emojiIcon(def.icon ?? null),
    cover: null,
    by: def.by,
  });
  return created(databaseId, plan);
}

/**
 * A database at the top of a space, from a definition checked like createDatabase's: for the seed,
 * which adds fictional data as the server, so the person's access isn't checked. Not offered to
 * other lanes (they put databases under a page).
 */
export async function seedDatabase(
  tx: Tx,
  input: { workspaceId: string; spaceId: string; definition: TopLevelDefinition },
): Promise<CreatedDatabase> {
  const parsed = parseRequest(topLevelDefinitionSchema, input.definition);
  if (!parsed.ok) throw invalid(DEFINITION_MESSAGES.invalidAt(parsed.path));
  const def = parsed.value;
  const related = await relatedDatabases(tx, def.by, input.workspaceId, def.properties);
  const { databaseId, plan } = planNew(def, input, related);
  await writeDatabase(tx, plan, {
    id: databaseId,
    workspaceId: input.workspaceId,
    spaceId: input.spaceId,
    parentId: null,
    title: def.title,
    inline: false,
    icon: emojiIcon(def.icon ?? null),
    cover: null,
    by: def.by,
  });
  return created(databaseId, plan);
}

/** The database's rows (not in Trash) this person can open, oldest first. */
async function openableRows(tx: Tx, by: string, databaseId: Id): Promise<Row[]> {
  const rows = await loadRows(tx, databaseId);
  const open = new Set<string>();
  for (let start = 0; start < rows.length; start += ROW_BATCH) {
    const ids = rows.slice(start, start + ROW_BATCH).map((row) => row.id);
    const levels = await getAccessForPages(tx, by, ids);
    for (const id of ids) if (atLeast(levels.get(id), 'view')) open.add(id);
  }
  return rows.filter((row) => open.has(row.id));
}

/**
 * A copy of a database (planCopy) under a page `by` can edit, with the rows they can open when
 * `includeRows`. Refused before any change: 404 for a database or parent that's gone, 403 when
 * they can't open the database, can't edit the parent, or can't see some of its properties.
 */
export async function duplicateDatabase(tx: Tx, input: DuplicateInput): Promise<DatabaseCopy> {
  const parsed = parseRequest(duplicateInputSchema, input);
  if (!parsed.ok) throw invalidRequest();
  const { databaseId, parentId, includeRows, by } = parsed.value;
  const source = await loadDatabase(tx, databaseId);
  if (!source || source.inTrash) throw notFound();
  const level = (await getAccessForPages(tx, by, [source.id])).get(source.id) ?? 'none';
  if (!atLeast(level, 'view')) throw forbidden();
  const under = await editablePage(tx, by, parentId);
  if (under.workspaceId !== source.workspaceId) throw invalidRequest();
  if ((await hiddenProperties(tx, by, source)).size > 0) {
    throw forbidden(DEFINITION_MESSAGES.copyHidden);
  }
  const rows = includeRows ? await openableRows(tx, by, source.id) : [];
  const copyId = randomUUID();
  const templateIds = new Map(source.templates.map((t) => [t.id, randomUUID()]));
  const rowIds = new Map(rows.map((row) => [row.id, randomUUID()]));
  const plan = planCopy(source, {
    databaseId: copyId,
    templateIds,
    rows,
    rowIds,
    linkCode: newLinkCode,
    by,
  });
  const looks = await pageLooks(tx, [source.id]);
  await writeDatabase(tx, plan, {
    id: copyId,
    workspaceId: under.workspaceId,
    spaceId: under.spaceId,
    parentId: under.id,
    title: parsed.value.title ?? source.title,
    inline: parsed.value.inline ?? source.inline,
    icon: source.pageIcon ?? null,
    cover: looks.get(source.id)?.cover ?? null,
    by,
  });
  return {
    databaseId: copyId,
    templateIds: Object.fromEntries(templateIds),
    rowIds: Object.fromEntries(rowIds),
  };
}
