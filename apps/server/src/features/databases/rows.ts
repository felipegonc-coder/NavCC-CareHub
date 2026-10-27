// Row writes (decision 0200): add rows, change their values, move them to Trash and back. Values
// are checked with the package (row-logic.ts); two-way relations change on both sides; each changed
// property gets one history entry (db_row_changes); and nothing is announced before the commit:
// every write returns its RowEffects for publishRowEffects (events, live nudges, Person notices).
// Rows are locked (select ... for update, in id order) while they're written; the database's row
// never is, and ID numbers are taken before the transaction.
import { randomUUID } from 'node:crypto';
import {
  findProperty,
  titleProperty,
  type AccessLevel,
  type ConfigOf,
  type Id,
  type Property,
  type Viewer,
} from '@carehub/databases';
import { atLeast, can, type PropertyViewer } from '@carehub/databases/access';
import { prefillFromFilter } from '@carehub/databases/filter';
import { valueForGroup } from '@carehub/databases/group';
import { linkDiff, twoWayWrites } from '@carehub/databases/relations';
import { defaultTemplate, newRowValues } from '@carehub/databases/templates';
import { validateValue } from '@carehub/databases/values';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db, Tx } from '../../db';
import { publishTopic } from '../live';
import { sendNotice } from '../notices';
import { getAccessForPages } from '../pages';
import { forbidden, invalid, invalidRequest, notFound } from './errors';
import type { DatabaseEvent, RowSource } from './events';
import type { DatabaseRecord } from './record';
import {
  addedPeople,
  checkPresets,
  checkValues,
  isRelation,
  keepHiddenLinks,
  linksOf,
  notifies,
  sameValue,
  type ValuesCheck,
} from './row-logic';
import { createRowPage, restorePages, setPageTitle, trashPages } from './row-pages';
import { dbRowChanges, dbRows } from './schema';
import { loadDatabase, loadRows, takeUniqueNumbers, uuidList, type Executor } from './store';

/** Notice texts: generic, never a title (only the card shows the row). */
export const ROW_NOTICES = {
  sender: 'Databases',
  addedToRow: 'You were added to a row',
  addedToRows: (count: number) => `You were added to ${count} rows`,
} as const;

/** Live nudges list at most this many row ids (events stay small); more means "reload all". */
export const LIVE_ROW_IDS = 40;

/** Who is writing. */
export interface Actor {
  /** null: an anonymous form answer (adding a row only). */
  userId: string | null;
  /** Their settings, for presets such as Today and Me. */
  viewer: Viewer;
  /** For property access lists. */
  propertyViewer: PropertyViewer;
  source: RowSource;
}

/** What a committed write announces (publishRowEffects). */
export interface RowEffects {
  events: DatabaseEvent[];
  /** Database id → its rows that changed, and whether it has row access rules. */
  live: Map<string, { rowIds: Set<string>; ruled: boolean }>;
  /** People newly named in a Person property that notifies. */
  added: { workspaceId: string; databaseId: string; rowId: string; userId: string }[];
}

const noEffects = (): RowEffects => ({ events: [], live: new Map(), added: [] });

/** Several writes' effects as one (one live nudge per database). */
export function mergeEffects(list: readonly RowEffects[]): RowEffects {
  const out = noEffects();
  for (const effects of list) {
    out.events.push(...effects.events);
    out.added.push(...effects.added);
    for (const [databaseId, entry] of effects.live) {
      const into = out.live.get(databaseId) ?? { rowIds: new Set<string>(), ruled: entry.ruled };
      for (const id of entry.rowIds) into.rowIds.add(id);
      into.ruled ||= entry.ruled;
      out.live.set(databaseId, into);
    }
  }
  return out;
}

function touch(effects: RowEffects, record: DatabaseRecord, rowIds: readonly string[]) {
  const entry = effects.live.get(record.id) ?? {
    rowIds: new Set<string>(),
    ruled: record.accessRules.length > 0,
  };
  for (const id of rowIds) entry.rowIds.add(id);
  effects.live.set(record.id, entry);
}

/** 403, or 400 with the package's message. */
function refused(check: Extract<ValuesCheck, { ok: false }>): Error {
  if (check.status === 403) return forbidden();
  return check.message ? invalid(check.message) : invalidRequest();
}

// ------------------------------------------------------------------ rows locked for a write

interface LockedRow {
  id: string;
  databaseId: string;
  workspaceId: string;
  values: Record<Id, unknown>;
  /** Each property this write set: its value before. */
  before: Map<Id, unknown>;
  rename?: { propertyId: Id; before: string; after: string };
}

type Change = { propertyId: Id; before: unknown; after: unknown };

type LockedFacts = {
  id: string;
  database_id: string;
  workspace_id: string;
  values: Record<Id, unknown> | null;
};

/** The rows one transaction writes, each locked when first read. */
function rowWrites(tx: Tx, by: string | null) {
  const rows = new Map<string, LockedRow>();

  /** Locks and reads rows not read yet; rows in Trash or missing stay out. */
  async function lock(ids: readonly string[]): Promise<void> {
    const wanted = [...new Set(ids)].filter((id) => !rows.has(id));
    if (wanted.length === 0) return;
    const { rows: found } = await tx.execute<LockedFacts>(sql`
      SELECT r.page_id AS id, r.database_id, r.workspace_id, r."values"
      FROM db_rows r JOIN pages p ON p.id = r.page_id
      WHERE r.page_id = ANY(${uuidList(wanted)}) AND p.deleted_at IS NULL
      ORDER BY r.page_id
      FOR UPDATE OF r`);
    for (const r of found) {
      const values = { ...(r.values ?? {}) };
      rows.set(r.id, {
        id: r.id,
        databaseId: r.database_id,
        workspaceId: r.workspace_id,
        values,
        before: new Map(),
      });
    }
  }

  function set(row: LockedRow, propertyId: Id, value: unknown): void {
    if (!row.before.has(propertyId)) row.before.set(propertyId, row.values[propertyId] ?? null);
    if (value === null || value === undefined) delete row.values[propertyId];
    else row.values[propertyId] = value;
  }

  /** Saves the rows that changed, with one history entry per changed property. */
  async function flush(): Promise<{ row: LockedRow; changes: Change[] }[]> {
    const saved: { row: LockedRow; changes: Change[] }[] = [];
    for (const row of rows.values()) {
      const changes: Change[] = [];
      for (const [propertyId, before] of row.before) {
        const after = row.values[propertyId] ?? null;
        if (!sameValue(before, after)) changes.push({ propertyId, before, after });
      }
      if (row.rename && row.rename.before !== row.rename.after) {
        const { propertyId, before, after } = row.rename;
        changes.push({ propertyId, before, after });
        await setPageTitle(tx, row.id, after, by);
      }
      if (changes.length === 0) continue;
      await tx
        .update(dbRows)
        .set({ values: row.values, editedBy: by, editedAt: sql`now()` })
        .where(eq(dbRows.pageId, row.id));
      await tx.insert(dbRowChanges).values(
        changes.map((c) => ({
          rowId: row.id,
          databaseId: row.databaseId,
          by,
          propertyId: c.propertyId,
          before: c.before,
          after: c.after,
        })),
      );
      saved.push({ row, changes });
    }
    return saved;
  }

  return { rows, lock, set, flush };
}

type RowWrites = ReturnType<typeof rowWrites>;

/** Databases by id, each read once per write. */
function databaseCache(db: Executor, record: DatabaseRecord) {
  const cache = new Map<string, Promise<DatabaseRecord | null>>([
    [record.id, Promise.resolve(record)],
  ]);
  return (id: string) => {
    let found = cache.get(id);
    if (!found) cache.set(id, (found = loadDatabase(db, id)));
    return found;
  };
}

/**
 * Keeps a two-way relation in step after `source`'s cell changed from `before`: rows linked now
 * list the source in their partner property, and unlinked ones stop.
 */
async function keepTwoWayInStep(
  writes: RowWrites,
  record: DatabaseRecord,
  source: LockedRow,
  prop: Property<ConfigOf<'relation'>>,
  before: unknown,
  databases: (id: string) => Promise<DatabaseRecord | null>,
): Promise<void> {
  const partnerId = prop.config.twoWayPropertyId;
  if (!partnerId) return;
  const target = await databases(prop.config.targetDatabaseId);
  const partner = target?.properties.find((p) => p.id === partnerId);
  if (!target || !isRelation(partner)) return;
  const diff = linkDiff(linksOf(before), linksOf(source.values[prop.id]));
  if (diff.added.length === 0 && diff.removed.length === 0) return;
  await writes.lock([...diff.added, ...diff.removed]);
  const rowIn = (databaseId: string) => (rowId: Id) => {
    const row = writes.rows.get(rowId);
    return row?.databaseId === databaseId ? row : undefined;
  };
  const partnerRow = rowIn(target.id);
  const sourceRow = rowIn(record.id);
  if (partner.config.single) {
    // The partner keeps one link, so the rows it lets go drop their link back on this side.
    await writes.lock(diff.added.flatMap((id) => linksOf(partnerRow(id)?.values[partner.id])));
  }
  const cells = twoWayWrites(
    source.id,
    diff,
    partner,
    (rowId) => linksOf(partnerRow(rowId)?.values[partner.id]),
    (rowId) => linksOf(sourceRow(rowId)?.values[prop.id]),
  );
  for (const cell of cells) {
    const onPartner = cell.propertyId === partner.id;
    const row = onPartner ? partnerRow(cell.rowId) : sourceRow(cell.rowId);
    if (!row) continue; // not a row there, or in Trash: nothing to keep in step
    const result = validateValue(onPartner ? partner : prop, cell.value);
    if (!result.ok) throw invalid(result.error);
    writes.set(row, cell.propertyId, result.value);
  }
}

/** Rows of `databaseId` among `ids` that aren't in Trash. */
async function liveRowsOf(db: Executor, databaseId: string, ids: readonly string[]) {
  if (ids.length === 0) return new Set<string>();
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT r.page_id AS id FROM db_rows r JOIN pages p ON p.id = r.page_id
    WHERE r.database_id = ${databaseId} AND r.page_id = ANY(${uuidList(ids)})
      AND p.deleted_at IS NULL`);
  return new Set(rows.map((r) => r.id));
}

/**
 * 400 unless every link sent is a row of the relation's database, not in Trash, that the person
 * can open (they only ever see those). `userId` null: a form answer, whose links the forms server
 * checked against the respondent. `selfId` is a new row linking to itself.
 */
async function checkSentLinks(
  db: Executor,
  userId: string | null,
  record: DatabaseRecord,
  values: Readonly<Record<Id, unknown>>,
  selfId?: string,
): Promise<void> {
  const byTarget = new Map<string, Set<string>>();
  for (const [propertyId, value] of Object.entries(values)) {
    const prop = findProperty(record.properties, propertyId);
    if (!isRelation(prop)) continue;
    const target = prop.config.targetDatabaseId;
    const ids = byTarget.get(target) ?? new Set<string>();
    for (const id of linksOf(value)) if (!(id === selfId && target === record.id)) ids.add(id);
    byTarget.set(target, ids);
  }
  const all = [...byTarget.values()].flatMap((ids) => [...ids]);
  if (all.length === 0) return;
  const levels = userId === null ? null : await getAccessForPages(db, userId, all);
  for (const [target, ids] of byTarget) {
    const live = await liveRowsOf(db, target, [...ids]);
    for (const id of ids) {
      if (!live.has(id) || (levels && !atLeast(levels.get(id), 'view'))) throw invalidRequest();
    }
  }
}

/** Preset links (a template's) to rows that are gone are left out. */
async function withoutGoneLinks(
  db: Executor,
  record: DatabaseRecord,
  values: Record<Id, unknown>,
  selfId: string,
): Promise<Record<Id, unknown>> {
  const out = { ...values };
  for (const [propertyId, value] of Object.entries(values)) {
    const prop = findProperty(record.properties, propertyId);
    if (!isRelation(prop)) continue;
    const target = prop.config.targetDatabaseId;
    const live = await liveRowsOf(db, target, linksOf(value));
    const kept = linksOf(value).filter(
      (id) => live.has(id) || (id === selfId && target === record.id),
    );
    if (kept.length > 0) out[propertyId] = kept;
    else delete out[propertyId];
  }
  return out;
}

/** Events, live nudges and Person notices for rows a committed write saved. */
async function noteSaved(
  effects: RowEffects,
  saved: readonly { row: LockedRow; changes: Change[] }[],
  databases: (id: string) => Promise<DatabaseRecord | null>,
  actor: Actor,
  skipRowId?: string,
): Promise<void> {
  const actorId = actor.userId;
  for (const { row, changes } of saved) {
    const record = await databases(row.databaseId);
    if (!record) continue;
    touch(effects, record, [row.id]);
    if (row.id === skipRowId) continue;
    effects.events.push({
      name: 'databases.row.updated',
      payload: {
        workspaceId: row.workspaceId,
        databaseId: row.databaseId,
        rowId: row.id,
        actorId,
        propertyIds: changes.map((c) => c.propertyId),
        source: actor.source,
      },
    });
    if (actor.source === 'import') continue;
    for (const change of changes) {
      const prop = findProperty(record.properties, change.propertyId);
      if (!prop || !notifies(prop)) continue;
      for (const userId of addedPeople(change.before, change.after)) {
        if (userId === actorId) continue;
        effects.added.push({
          workspaceId: row.workspaceId,
          databaseId: row.databaseId,
          rowId: row.id,
          userId,
        });
      }
    }
  }
}

// ------------------------------------------------------------------ adding rows

export interface NewRow {
  title?: string;
  values?: Readonly<Record<Id, unknown>>;
  /** null: an empty row. Left out: the view's or the database's default template. */
  templateId?: Id | null;
  /** The view it's added in: its filter prefill, and the value of the group `groupKey` names. */
  viewId?: Id;
  groupKey?: string;
}

/** What api.ts adds to a new row. */
export interface NewRowExtras {
  /** The form (view id) and response that made it, for its event; the form is kept on the row. */
  formId?: string;
  responseId?: string;
  /** The import that made it (db_rows.import_id, for undoing the import). */
  importId?: string;
  /** An ID number taken already (createRows takes them all at once); left out: one is taken. */
  uniqueNumber?: number | null;
}

/**
 * Adds a row for someone with `access` on the database: the values they send over the template's
 * presets, the view's filter prefill and the group's value; an ID number when the database has an
 * ID property; two-way partners updated. Refuses (403, 400) before anything is saved.
 */
export async function addRow(
  db: Db,
  record: DatabaseRecord,
  input: NewRow,
  actor: Actor,
  access: AccessLevel,
  extras: NewRowExtras = {},
): Promise<{ rowId: string; effects: RowEffects }> {
  const locked = { locked: record.locked };
  if (!can('add_rows', access, locked)) throw forbidden();
  if (input.templateId && !can('use_templates', access, locked)) throw forbidden();
  const view =
    input.viewId === undefined ? null : (record.views.find((v) => v.id === input.viewId) ?? null);
  if (input.viewId !== undefined && !view) throw invalidRequest();
  const template =
    input.templateId === undefined
      ? defaultTemplate(view, record)
      : (record.templates.find((t) => t.id === input.templateId) ?? null);
  if (input.templateId && !template) throw invalidRequest();

  const rowId = randomUUID();
  const { viewer, propertyViewer } = actor;
  const grouping = view?.grouping ?? null;
  const groupValue =
    grouping && input.groupKey !== undefined
      ? valueForGroup(grouping, input.groupKey, {
          properties: record.properties,
          viewer,
          userName: () => undefined,
        })
      : null;
  const presets = newRowValues({
    properties: record.properties,
    template,
    filterPrefill: view ? prefillFromFilter(view.filter, record.properties, viewer) : null,
    groupValue,
    viewer: {
      userId: viewer.userId,
      timeZone: viewer.timeZone,
      now: viewer.now,
      thisPageId: rowId,
    },
  });
  const preset = checkPresets(presets, record.properties, propertyViewer, access);
  const sent = checkValues(input.values ?? {}, record.properties, propertyViewer, access);
  if (!sent.ok) throw refused(sent);
  let title = sent.checked.title ?? preset.title ?? '';
  if (input.title !== undefined) {
    const named = validateValue(titleProperty(record.properties), input.title);
    if (!named.ok) throw invalid(named.error);
    title = typeof named.value === 'string' ? named.value : '';
  }
  const linker = actor.source === 'form' ? null : actor.userId;
  await checkSentLinks(db, linker, record, sent.checked.values, rowId);
  const values: Record<Id, unknown> = {
    ...(await withoutGoneLinks(db, record, preset.values, rowId)),
  };
  for (const [id, value] of Object.entries(sent.checked.values)) {
    if (value === null) delete values[id];
    else values[id] = value;
  }

  const numbered = record.properties.some((p) => p.config.type === 'unique_id');
  const uniqueNumber =
    extras.uniqueNumber !== undefined
      ? extras.uniqueNumber
      : ((numbered ? await takeUniqueNumbers(db, record.id, 1) : [])[0] ?? null);
  const actorId = actor.userId;
  const effects = noEffects();
  const databases = databaseCache(db, record);
  const saved = await db.transaction(async (tx) => {
    await createRowPage(tx, {
      id: rowId,
      workspaceId: record.workspaceId,
      spaceId: record.spaceId,
      databaseId: record.id,
      title,
      createdBy: actorId,
    });
    await tx.insert(dbRows).values({
      pageId: rowId,
      databaseId: record.id,
      workspaceId: record.workspaceId,
      values,
      uniqueNumber,
      createdBy: actorId,
      editedBy: actorId,
      formViewId: extras.formId ?? null,
      importId: extras.importId ?? null,
    });
    const writes = rowWrites(tx, actorId);
    const row: LockedRow = {
      id: rowId,
      databaseId: record.id,
      workspaceId: record.workspaceId,
      values: { ...values },
      before: new Map(),
    };
    writes.rows.set(rowId, row);
    for (const prop of record.properties) {
      if (isRelation(prop) && prop.id in values) {
        await keepTwoWayInStep(writes, record, row, prop, null, databases);
      }
    }
    return writes.flush();
  });

  effects.events.push({
    name: 'databases.row.created',
    payload: {
      workspaceId: record.workspaceId,
      databaseId: record.id,
      rowId,
      actorId,
      source: actor.source,
      ...(extras.formId === undefined ? {} : { formId: extras.formId }),
      ...(extras.responseId === undefined ? {} : { responseId: extras.responseId }),
    },
  });
  touch(effects, record, [rowId]);
  await noteSaved(effects, saved, databases, actor, rowId);
  if (actor.source !== 'import') {
    for (const prop of record.properties) {
      if (!notifies(prop)) continue;
      for (const userId of addedPeople(null, values[prop.id])) {
        if (userId === actorId) continue;
        effects.added.push({
          workspaceId: record.workspaceId,
          databaseId: record.id,
          rowId,
          userId,
        });
      }
    }
  }
  return { rowId, effects };
}

// ------------------------------------------------------------------ changing values

/**
 * Sets the same values on rows of a database (one row for PATCH /:id/rows/:rowId; the changed
 * properties only). Every row must be in the database and not in Trash (404) and editable by the
 * person (403), checked before anything changes. A relation keeps the links the person can't open;
 * the Name property's id renames the row. Returns the rows that changed.
 */
export async function changeRows(
  db: Db,
  record: DatabaseRecord,
  rowIds: readonly string[],
  input: Readonly<Record<Id, unknown>>,
  actor: Actor,
): Promise<{ rowIds: string[]; effects: RowEffects }> {
  const ids = [...new Set(rowIds)];
  const userId = actor.userId;
  if (userId === null) throw forbidden();
  const [rows, levels] = await Promise.all([
    loadRows(db, record.id, ids),
    getAccessForPages(db, userId, ids),
  ]);
  if (rows.length !== ids.length) throw notFound();
  for (const id of ids) {
    if (!can('edit_rows', levels.get(id), { locked: record.locked })) throw forbidden();
  }
  const sent = checkValues(input, record.properties, actor.propertyViewer, 'edit_content');
  if (!sent.ok) throw refused(sent);
  const { title, values } = sent.checked;
  await checkSentLinks(db, userId, record, values);

  const relations = record.properties.filter((p) => isRelation(p) && p.id in values);
  const links = new Set<string>();
  for (const row of rows) {
    for (const prop of relations) for (const id of linksOf(row.values[prop.id])) links.add(id);
  }
  const linkLevels =
    links.size > 0
      ? await getAccessForPages(db, userId, [...links])
      : new Map<string, AccessLevel>();
  const canOpen = (id: Id) => atLeast(linkLevels.get(id), 'view');
  const titles = new Map(rows.map((r) => [r.id, r.title]));
  const titleId = titleProperty(record.properties).id;
  const databases = databaseCache(db, record);

  const saved = await db.transaction(async (tx) => {
    const writes = rowWrites(tx, userId);
    await writes.lock(ids);
    for (const id of ids) {
      const row = writes.rows.get(id);
      if (!row || row.databaseId !== record.id) throw notFound();
      const was = titles.get(id) ?? '';
      if (title !== undefined && title !== was) {
        row.rename = { propertyId: titleId, before: was, after: title };
      }
      for (const [propertyId, value] of Object.entries(values)) {
        const prop = findProperty(record.properties, propertyId);
        if (!isRelation(prop)) {
          writes.set(row, propertyId, value);
          continue;
        }
        const result = validateValue(prop, keepHiddenLinks(value, row.values[propertyId], canOpen));
        if (!result.ok) throw invalid(result.error);
        writes.set(row, propertyId, result.value);
      }
    }
    for (const id of ids) {
      const row = writes.rows.get(id);
      if (!row) continue;
      for (const prop of relations) {
        if (!isRelation(prop)) continue;
        await keepTwoWayInStep(writes, record, row, prop, row.before.get(prop.id), databases);
      }
    }
    return writes.flush();
  });

  const effects = noEffects();
  await noteSaved(effects, saved, databases, actor);
  const changed = new Set(saved.map((s) => s.row.id));
  return { rowIds: ids.filter((id) => changed.has(id)), effects };
}

// ------------------------------------------------------------------ Trash

/**
 * Moves rows to Trash (Undo is restoreRows). Every row must be in the database (404) and editable
 * by the person (403). Relations keep their links: cells leave rows in Trash out until they're back.
 */
export async function trashRows(
  db: Db,
  record: DatabaseRecord,
  rowIds: readonly string[],
  userId: string,
): Promise<{ rowIds: string[]; effects: RowEffects }> {
  const ids = [...new Set(rowIds)];
  const [live, levels] = await Promise.all([
    liveRowsOf(db, record.id, ids),
    getAccessForPages(db, userId, ids),
  ]);
  if (live.size !== ids.length) throw notFound();
  for (const id of ids) {
    if (!can('edit_rows', levels.get(id), { locked: record.locked })) throw forbidden();
  }
  const moved = await db.transaction((tx) => trashPages(tx, ids, userId));
  return { rowIds: moved, effects: movedEffects(record, moved, userId, 'databases.row.trashed') };
}

/**
 * Brings rows back from Trash: rows of this database that went to Trash on their own. The person
 * needs to be able to edit the database's rows, or be the one who moved them (Undo).
 */
export async function restoreRows(
  db: Db,
  record: DatabaseRecord,
  rowIds: readonly string[],
  userId: string,
  access: AccessLevel,
): Promise<{ rowIds: string[]; effects: RowEffects }> {
  const ids = [...new Set(rowIds)];
  const { rows } = await db.execute<{ id: string; deleted_by: string | null }>(sql`
    SELECT p.id, p.deleted_by FROM db_rows r JOIN pages p ON p.id = r.page_id
    WHERE r.database_id = ${record.id} AND p.id = ANY(${uuidList(ids)})
      AND p.deleted_at IS NOT NULL AND p.trash_root_id = p.id`);
  if (rows.length !== ids.length) throw notFound();
  const mayEdit = can('edit_rows', access, { locked: record.locked });
  if (!rows.every((r) => mayEdit || r.deleted_by === userId)) throw forbidden();
  const back = await db.transaction((tx) => restorePages(tx, ids, userId));
  return { rowIds: back, effects: movedEffects(record, back, userId, 'databases.row.restored') };
}

function movedEffects(
  record: DatabaseRecord,
  rowIds: string[],
  actorId: string,
  name: 'databases.row.trashed' | 'databases.row.restored',
): RowEffects {
  const effects = noEffects();
  if (rowIds.length === 0) return effects;
  const payload = { workspaceId: record.workspaceId, databaseId: record.id, rowIds, actorId };
  effects.events.push({ name, payload });
  touch(effects, record, rowIds);
  return effects;
}

// ------------------------------------------------------------------ after the commit

/** Tells people they were added to rows they can open: one notice per person and database. */
async function sendPersonNotices(app: FastifyInstance, added: RowEffects['added']) {
  const groups = new Map<string, { workspaceId: string; databaseId: string; userId: string }>();
  const rowsOf = new Map<string, Set<string>>();
  for (const a of added) {
    const key = `${a.userId} ${a.databaseId}`;
    groups.set(key, { workspaceId: a.workspaceId, databaseId: a.databaseId, userId: a.userId });
    rowsOf.set(key, (rowsOf.get(key) ?? new Set<string>()).add(a.rowId));
  }
  for (const [key, group] of groups) {
    try {
      const rowIds = [...(rowsOf.get(key) ?? [])];
      const levels = await getAccessForPages(app.db, group.userId, rowIds);
      const open = rowIds.filter((id) => atLeast(levels.get(id), 'view'));
      const [first] = open;
      if (!first) continue;
      const one = open.length === 1;
      await sendNotice({
        workspaceId: group.workspaceId,
        userId: group.userId,
        kind: 'alert',
        sender: ROW_NOTICES.sender,
        icon: '👤',
        title: one ? ROW_NOTICES.addedToRow : ROW_NOTICES.addedToRows(open.length),
        card: { type: 'page', pageId: one ? first : group.databaseId },
      });
    } catch (err) {
      app.log.warn({ err }, 'databases: a Person notice was not sent');
    }
  }
}

/**
 * Announces a committed write: its events through app.events, a `rows-changed` nudge on each
 * database's live topic (without row ids where row access rules decide who sees what, or when
 * there are too many), then Person notices (a failure is logged, never thrown).
 */
export async function publishRowEffects(app: FastifyInstance, effects: RowEffects): Promise<void> {
  for (const event of effects.events) app.events.emit(event.name, event.payload);
  for (const [databaseId, { rowIds, ruled }] of effects.live) {
    const ids = [...rowIds];
    publishTopic(
      `db:${databaseId}`,
      ruled || ids.length > LIVE_ROW_IDS
        ? { type: 'rows-changed' }
        : { type: 'rows-changed', data: { rowIds: ids } },
    );
  }
  await sendPersonNotices(app, effects.added);
}
