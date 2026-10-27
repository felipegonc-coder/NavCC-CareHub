// Server functions for other lanes (decision 0200, "api.ts"). Row writes take the caller's
// transaction from runRowWrites, which commits and then announces them (events, live nudges and
// Person notices); each write runs in its own savepoint, so a refused one (HttpError 400, 403 or
// 404) leaves the caller's transaction usable. Reads give only what that person may see. The Team
// tools calendar's database layers keep that lane's signatures.
import {
  DEFAULT_TIME_ZONE,
  dateValueDays,
  findProperty,
  isCalendarDate,
  isInstant,
  isValidDateValue,
  isValidTimeZone,
  readValue,
  type AccessLevel,
  type DateValue,
  type EvalContext,
  type FilterGroup,
  type Id,
  type Property,
  type Row,
  type Viewer,
  type WeekDay,
} from '@carehub/databases';
import { atLeast, can, canChangeProperty, type PropertyViewer } from '@carehub/databases/access';
import { withoutHidden } from '@carehub/databases/engine';
import { filterPredicate } from '@carehub/databases/filter';
import { formatValue } from '@carehub/databases/values';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { getAccessForPages, getPageAccess } from '../pages';
import { forbidden, invalidRequest, notFound } from './errors';
import type { RowSource } from './events';
import { visibleIds } from './meta';
import { isUuid, type DatabaseRecord } from './record';
import { isRelation, linksOf } from './row-logic';
import {
  addRow,
  changeRows,
  mergeEffects,
  publishRowEffects,
  restoreRows as restoreRowsOf,
  trashRows as trashRowsOf,
  type Actor,
  type RowEffects,
} from './rows';
import {
  loadDatabase,
  loadPropertyViewer,
  loadRelatedProperties,
  loadRows,
  takeUniqueNumbers,
  uuidList,
  type Executor,
} from './store';

export { onDatabaseEvent, type DatabaseEvent, type RowSource } from './events';

/** findRowIds and listDatedRows answer at most this many rows. */
export const MAX_FOUND_ROWS = 1_000;

// ------------------------------------------------------------------ who and where

type UserFacts = { time_zone: string | null; use_24h: boolean | null; week_start: number | null };

/** A person's settings, as presets, filters and dates read them; null when there's no such person. */
async function viewerFor(db: Executor, userId: string): Promise<Viewer | null> {
  if (!isUuid(userId)) return null;
  const { rows } = await db.execute<UserFacts>(sql`
    SELECT time_zone, use_24h, week_start FROM users WHERE id = ${userId}`);
  const user = rows[0];
  if (!user) return null;
  return {
    userId,
    timeZone: user.time_zone ?? DEFAULT_TIME_ZONE,
    weekStart: (user.week_start ?? 0) as WeekDay,
    hour12: !user.use_24h,
    now: new Date(),
  };
}

/** Who is writing: a person (403 when there's no such person) or an anonymous form answer. */
async function actorFor(
  db: Executor,
  userId: string | null,
  record: DatabaseRecord,
  source: RowSource,
): Promise<Actor> {
  if (userId === null) {
    if (source !== 'form') throw forbidden();
    const viewer: Viewer = {
      userId: '',
      timeZone: DEFAULT_TIME_ZONE,
      weekStart: 0,
      hour12: true,
      now: new Date(),
    };
    return { userId: null, viewer, propertyViewer: { userId: '', groupIds: [] }, source };
  }
  const viewer = await viewerFor(db, userId);
  if (!viewer) throw forbidden();
  const propertyViewer = await loadPropertyViewer(db, userId, record.workspaceId);
  return { userId, viewer, propertyViewer, source };
}

/** The database, or 404 when it's missing or in Trash. */
async function liveDatabase(db: Executor, id: string): Promise<DatabaseRecord> {
  const record = isUuid(id) ? await loadDatabase(db, id) : null;
  if (!record || record.inTrash) throw notFound();
  return record;
}

/** The person's level on the database: 403 below Can view. */
async function databaseLevel(db: Executor, actor: Actor, record: DatabaseRecord) {
  if (actor.userId === null) throw forbidden();
  const level = await getPageAccess(db, actor.userId, record.id);
  if (!atLeast(level, 'view')) throw forbidden();
  return level;
}

/** The row's database: 404 when the row is missing or in Trash, or isn't a database row. */
async function rowDatabase(db: Executor, rowId: string): Promise<DatabaseRecord> {
  if (!isUuid(rowId)) throw notFound();
  const { rows } = await db.execute<{ database_id: string }>(sql`
    SELECT r.database_id FROM db_rows r JOIN pages p ON p.id = r.page_id
    WHERE r.page_id = ${rowId} AND p.deleted_at IS NULL`);
  const databaseId = rows[0]?.database_id;
  if (!databaseId) throw notFound();
  return liveDatabase(db, databaseId);
}

/** The ids of the properties this person can see (property access, here and across relations). */
async function seenBy(db: Executor, record: DatabaseRecord, who: PropertyViewer) {
  return visibleIds(record.properties, who, await loadRelatedProperties(db, record.properties));
}

/** Linked rows not in Trash, and the titles of the ones the person can open. */
async function linkedRows(db: Executor, userId: string, ids: readonly string[]) {
  const live = new Set<string>();
  const titles = new Map<string, string>();
  const wanted = [...new Set(ids)].filter(isUuid);
  if (wanted.length === 0) return { live, titles };
  const { rows } = await db.execute<{ id: string; title: string }>(sql`
    SELECT id, title FROM pages
    WHERE id = ANY(${uuidList(wanted)}) AND kind = 'row' AND deleted_at IS NULL`);
  for (const row of rows) live.add(row.id);
  const levels = await getAccessForPages(db, userId, [...live]);
  for (const row of rows) if (atLeast(levels.get(row.id), 'view')) titles.set(row.id, row.title);
  return { live, titles };
}

/** People's names by id. */
async function userNames(db: Executor, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)].filter(isUuid);
  if (wanted.length === 0) return new Map();
  const { rows } = await db.execute<{ id: string; name: string }>(sql`
    SELECT id, name FROM users WHERE id = ANY(${uuidList(wanted)})`);
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ------------------------------------------------------------------ writes

/** The effects of the writes made in each runRowWrites transaction, until it commits. */
const pending = new WeakMap<Tx, RowEffects[]>();

/**
 * Runs `work` in a transaction for createRow, createRows, updateRows, trashRows and restoreRows,
 * commits, then announces what they wrote. Nothing is announced when `work` throws.
 */
export async function runRowWrites<T>(
  app: FastifyInstance,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  const written: RowEffects[] = [];
  const result = await app.db.transaction(async (tx) => {
    pending.set(tx, written);
    try {
      return await work(tx);
    } finally {
      pending.delete(tx);
    }
  });
  await publishRowEffects(app, mergeEffects(written));
  return result;
}

/** One write in a savepoint of a runRowWrites transaction; its effects wait for the commit. */
async function inSavepoint<T>(
  tx: Tx,
  write: (sp: Tx) => Promise<{ value: T; effects: RowEffects }>,
): Promise<T> {
  const written = pending.get(tx);
  if (!written) throw new Error('Row writes need the transaction that runRowWrites passes in.');
  const { value, effects } = await tx.transaction(write);
  written.push(effects);
  return value;
}

const nothing = <T>(value: T) => ({ value, effects: mergeEffects([]) });

export interface CreateRowInput {
  databaseId: string;
  /** null: an empty row. Left out: the database's default template. */
  templateId?: Id | null;
  /** By property id, as the row routes take them; the Name property's id sets the title. */
  values?: Readonly<Record<Id, unknown>>;
  /** null: an anonymous form answer (source 'form' only). */
  actorUserId: string | null;
  source: RowSource;
  /** With source 'form': the form view (of this database) that made the row, kept on it. */
  formId?: string;
  /** For the created event, when a response has an id of its own. */
  responseId?: string;
}

/**
 * Adds a row with every check the routes make: who may add rows, template presets, value checks,
 * ID numbers and two-way relations. 404 when the database is missing or in Trash.
 *
 * A form answer (source 'form') needs `formId` to name one of the database's form views (400
 * otherwise); the respondent's access to the database isn't checked (the forms server checked the
 * form's gate), and the links it sends need only be rows of their database, not in Trash (the forms
 * server checked the respondent can open them). Property access lists still apply to them.
 */
export function createRow(tx: Tx, input: CreateRowInput): Promise<{ rowId: string }> {
  return inSavepoint(tx, async (sp) => {
    const record = await liveDatabase(sp, input.databaseId);
    const form = input.source === 'form' ? formOf(record, input.formId) : null;
    const actor = await actorFor(sp, input.actorUserId, record, input.source);
    const level = form ? 'edit_content' : await databaseLevel(sp, actor, record);
    const { rowId, effects } = await addRow(
      sp,
      record,
      { templateId: input.templateId, values: input.values },
      actor,
      level,
      form ? { formId: form.id, responseId: input.responseId } : {},
    );
    return { value: { rowId }, effects };
  });
}

/** The form view a form answer names: 400 unless it's one of this database's form views. */
function formOf(record: DatabaseRecord, formId: string | undefined) {
  const form = record.views.find((v) => v.id === formId);
  if (!form || form.layout !== 'form') throw invalidRequest();
  return form;
}

export interface CreateRowsInput {
  databaseId: string;
  /** Each new row's values; a template only where a row names one (unlike createRow). */
  rows: readonly { values?: Readonly<Record<Id, unknown>>; templateId?: Id | null }[];
  actorUserId: string;
  source: RowSource;
  /** Sets db_rows.import_id (so the import can be undone). */
  importId?: string;
}

/**
 * Adds rows in order, each checked as createRow checks it; one refusal adds none. Form answers go
 * through createRow (400 for source 'form').
 */
export function createRows(tx: Tx, input: CreateRowsInput): Promise<{ rowIds: string[] }> {
  return inSavepoint(tx, async (sp) => {
    if (input.source === 'form') throw invalidRequest();
    const record = await liveDatabase(sp, input.databaseId);
    const actor = await actorFor(sp, input.actorUserId, record, input.source);
    const level = await databaseLevel(sp, actor, record);
    if (!can('add_rows', level, { locked: record.locked })) throw forbidden();
    if (input.importId !== undefined && !isUuid(input.importId)) throw invalidRequest();
    if (input.rows.length === 0) return nothing({ rowIds: [] });
    const numbered = record.properties.some((p) => p.config.type === 'unique_id');
    const numbers = numbered ? await takeUniqueNumbers(sp, record.id, input.rows.length) : [];
    const rowIds: string[] = [];
    const all: RowEffects[] = [];
    for (const [i, row] of input.rows.entries()) {
      const { rowId, effects } = await addRow(
        sp,
        record,
        { templateId: row.templateId ?? null, values: row.values },
        actor,
        level,
        { importId: input.importId, uniqueNumber: numbers[i] ?? null },
      );
      rowIds.push(rowId);
      all.push(effects);
    }
    return { value: { rowIds }, effects: mergeEffects(all) };
  });
}

export interface UpdateRowsInput {
  databaseId: string;
  rowIds: readonly string[];
  /** The same values on every row, as the row routes take them (null clears one). */
  values: Readonly<Record<Id, unknown>>;
  actorUserId: string;
  source: RowSource;
}

/**
 * Sets values on rows of the database as PATCH does: 404 unless every row is there and not in
 * Trash, 403 unless the person can edit each one. Answers the rows that changed.
 */
export function updateRows(tx: Tx, input: UpdateRowsInput): Promise<{ rowIds: string[] }> {
  return inSavepoint(tx, async (sp) => {
    const record = await liveDatabase(sp, input.databaseId);
    const actor = await actorFor(sp, input.actorUserId, record, input.source);
    if (input.rowIds.length === 0) return nothing({ rowIds: [] });
    if (!input.rowIds.every(isUuid)) throw notFound();
    const { rowIds, effects } = await changeRows(sp, record, input.rowIds, input.values, actor);
    return { value: { rowIds }, effects };
  });
}

export interface MoveRowsInput {
  databaseId: string;
  rowIds: readonly string[];
  actorUserId: string;
}

/** Moves rows to Trash as the routes do. Answers the rows that moved. */
export function trashRows(tx: Tx, input: MoveRowsInput): Promise<{ rowIds: string[] }> {
  return inSavepoint(tx, async (sp) => {
    const record = await liveDatabase(sp, input.databaseId);
    await actorFor(sp, input.actorUserId, record, 'user');
    if (input.rowIds.length === 0) return nothing({ rowIds: [] });
    if (!input.rowIds.every(isUuid)) throw notFound();
    const { rowIds, effects } = await trashRowsOf(sp, record, input.rowIds, input.actorUserId);
    return { value: { rowIds }, effects };
  });
}

/** Brings rows back from Trash as the routes do (Undo). Answers the rows that came back. */
export function restoreRows(tx: Tx, input: MoveRowsInput): Promise<{ rowIds: string[] }> {
  return inSavepoint(tx, async (sp) => {
    const record = await liveDatabase(sp, input.databaseId);
    const actor = await actorFor(sp, input.actorUserId, record, 'user');
    const level = await databaseLevel(sp, actor, record);
    if (input.rowIds.length === 0) return nothing({ rowIds: [] });
    if (!input.rowIds.every(isUuid)) throw notFound();
    const { rowIds, effects } = await restoreRowsOf(
      sp,
      record,
      input.rowIds,
      input.actorUserId,
      level,
    );
    return { value: { rowIds }, effects };
  });
}

// ------------------------------------------------------------------ reads

/** The row and what this person may see of it: 404 missing or in Trash, 403 when they can't open it. */
async function openRow(db: Executor, userId: string, rowId: string) {
  const record = await rowDatabase(db, rowId);
  const [row] = await loadRows(db, record.id, [rowId]);
  if (!row) throw notFound();
  const access = isUuid(userId) ? await getPageAccess(db, userId, rowId) : 'none';
  if (!atLeast(access, 'view')) throw forbidden();
  const who = await loadPropertyViewer(db, userId, record.workspaceId);
  const visible = await seenBy(db, record, who);
  return { record, row, access, visible };
}

/** Values of the properties they can see; relations keep the rows they can open, not in Trash. */
async function shownValues(
  db: Executor,
  userId: string,
  record: DatabaseRecord,
  row: Row,
  visible: ReadonlySet<Id>,
): Promise<Record<Id, unknown>> {
  const out: Record<Id, unknown> = {};
  const relations: Property[] = [];
  for (const prop of record.properties) {
    const value = row.values[prop.id];
    if (!visible.has(prop.id) || value === undefined || value === null) continue;
    if (isRelation(prop)) relations.push(prop);
    out[prop.id] = value;
  }
  const { titles } = await linkedRows(
    db,
    userId,
    relations.flatMap((p) => linksOf(out[p.id])),
  );
  for (const prop of relations) {
    const kept = linksOf(out[prop.id]).filter((id) => titles.has(id));
    if (kept.length > 0) out[prop.id] = kept;
    else delete out[prop.id];
  }
  return out;
}

export interface RowRead {
  rowId: string;
  databaseId: string;
  title: string;
  /** Stored values of the properties they can see. Person values are user ids. */
  values: Record<Id, unknown>;
  uniqueNumber: number | null;
  createdBy: string | null;
  createdAt: string;
  editedBy: string | null;
  editedAt: string;
  /** Their level on the row. */
  access: AccessLevel;
}

/** The row as `userId` may see it (automations, buttons, the "/button" block). */
export async function readRow(
  db: Executor,
  input: { userId: string; rowId: string },
): Promise<RowRead> {
  const { record, row, access, visible } = await openRow(db, input.userId, input.rowId);
  return {
    rowId: row.id,
    databaseId: record.id,
    title: row.title,
    values: await shownValues(db, input.userId, record, row, visible),
    uniqueNumber: row.uniqueNumber,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    editedBy: row.editedBy,
    editedAt: row.editedAt,
    access,
  };
}

/**
 * Each asked property's value as text, as a cell shows it (dates in the person's time zone,
 * people's names, linked rows' titles). Properties they can't see are left out.
 */
export async function readRowText(
  db: Executor,
  input: { userId: string; rowId: string; propertyIds: readonly Id[] },
): Promise<Record<Id, string>> {
  const { record, row, visible } = await openRow(db, input.userId, input.rowId);
  const asked = input.propertyIds
    .map((id) => findProperty(record.properties, id))
    .filter((p): p is Property => p !== undefined && visible.has(p.id));
  const people: string[] = [];
  const links: string[] = [];
  for (const prop of asked) {
    const type = prop.config.type;
    if (type === 'person') people.push(...linksOf(row.values[prop.id]));
    if (type === 'created_by' && row.createdBy) people.push(row.createdBy);
    if (type === 'edited_by' && row.editedBy) people.push(row.editedBy);
    if (isRelation(prop)) links.push(...linksOf(row.values[prop.id]));
  }
  const [viewer, names, linked] = await Promise.all([
    viewerFor(db, input.userId),
    userNames(db, people),
    linkedRows(db, input.userId, links),
  ]);
  if (!viewer) throw forbidden();
  const values: Row['values'] = { ...row.values };
  for (const prop of asked) {
    if (isRelation(prop))
      values[prop.id] = linksOf(row.values[prop.id]).filter((id) => linked.live.has(id));
  }
  const ctx: EvalContext = {
    properties: record.properties,
    viewer,
    userName: (id) => names.get(id),
    rowTitle: (id) => linked.titles.get(id),
  };
  const shown = { ...row, values };
  const out: Record<Id, string> = {};
  for (const prop of asked) {
    out[prop.id] = formatValue(prop, readValue(shown, prop), ctx, { forExport: true });
  }
  return out;
}

/** The database's rows this person can open, each with their level; null below Can view. */
async function openRows(db: Executor, userId: string, record: DatabaseRecord) {
  const viewer = await viewerFor(db, userId);
  if (!viewer) return null;
  const level = await getPageAccess(db, userId, record.id);
  if (!atLeast(level, 'view')) return null;
  const [rows, who] = await Promise.all([
    loadRows(db, record.id),
    loadPropertyViewer(db, userId, record.workspaceId),
  ]);
  const levels = await getAccessForPages(
    db,
    userId,
    rows.map((r) => r.id),
  );
  const open = rows.flatMap((row) => {
    const access = levels.get(row.id) ?? 'none';
    return atLeast(access, 'view') ? [{ row, access }] : [];
  });
  return { viewer, who, visible: await seenBy(db, record, who), open };
}

/**
 * The rows (not in Trash) this person can open that match `filter` as they see it: properties
 * they can't see read as empty. Oldest first, at most `limit` (up to MAX_FOUND_ROWS); null: all.
 * Formula and rollup conditions read empty until computed values land.
 */
export async function findRowIds(
  db: Executor,
  input: { userId: string; databaseId: string; filter: FilterGroup | null; limit?: number },
): Promise<{ rowId: string; access: AccessLevel }[]> {
  const record = await liveDatabase(db, input.databaseId);
  const seen = await openRows(db, input.userId, record);
  if (!seen) throw forbidden();
  const { viewer, visible, open } = seen;
  const limit = Math.min(Math.max(Math.floor(input.limit ?? MAX_FOUND_ROWS), 0), MAX_FOUND_ROWS);
  const test = filterPredicate(input.filter, {
    properties: record.properties,
    viewer,
    userName: () => undefined,
  });
  const out: { rowId: string; access: AccessLevel }[] = [];
  for (const { row, access } of open) {
    if (out.length >= limit) break;
    if (test(withoutHidden(row, visible, true))) out.push({ rowId: row.id, access });
  }
  return out;
}

// ------------------------------------------------------------------ calendar layers (Team tools)

/** 'YYYY-MM-DD'. */
export type CivilDate = string;
/** A CivilDate for all-day dates, or a UTC instant ('2026-10-27T16:00:00Z') for timed ones. */
export type When = string;

/** Who is looking, in which workspace (the databases package has its own Viewer). */
export interface CalendarViewer {
  userId: string;
  workspaceId: string;
}

export interface DateSource {
  databaseId: string;
  /** '' when untitled. */
  title: string;
  /** They can edit its rows and change one of its date properties (a row can still say no). */
  canEdit: boolean;
  /** At least one. */
  dateProperties: { propertyId: string; name: string }[];
  /** The views whose filter a layer can use (not forms or dashboards). */
  views: { viewId: string; name: string }[];
}

/** Add layer picker: the workspace's databases they can open with a Date property they can see. */
export async function listDateSources(db: Executor, viewer: CalendarViewer): Promise<DateSource[]> {
  if (!isUuid(viewer.userId) || !isUuid(viewer.workspaceId)) return [];
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT d.page_id AS id FROM db_databases d JOIN pages p ON p.id = d.page_id
    WHERE d.workspace_id = ${viewer.workspaceId} AND p.deleted_at IS NULL
      AND d.properties @> '[{"config": {"type": "date"}}]'::jsonb
    ORDER BY lower(p.title), d.page_id`);
  if (rows.length === 0) return [];
  const [levels, who] = await Promise.all([
    getAccessForPages(
      db,
      viewer.userId,
      rows.map((r) => r.id),
    ),
    loadPropertyViewer(db, viewer.userId, viewer.workspaceId),
  ]);
  const out: DateSource[] = [];
  for (const { id } of rows) {
    const level = levels.get(id) ?? 'none';
    if (!atLeast(level, 'view')) continue;
    const record = await loadDatabase(db, id);
    if (!record || record.inTrash) continue;
    const visible = await seenBy(db, record, who);
    const dates = record.properties.filter((p) => p.config.type === 'date' && visible.has(p.id));
    if (dates.length === 0) continue;
    out.push({
      databaseId: record.id,
      title: record.title,
      canEdit:
        can('edit_rows', level, { locked: record.locked }) &&
        dates.some((p) => canChangeProperty(p, who, level)),
      dateProperties: dates.map((p) => ({ propertyId: p.id, name: p.name })),
      views: record.views
        .filter((v) => v.layout !== 'form' && v.layout !== 'dashboard')
        .map((v) => ({ viewId: v.id, name: v.name })),
    });
  }
  return out;
}

export interface DatedRowsQuery {
  databaseId: string;
  propertyId: string;
  /** That view's filter (as the person sees it); null: every row. */
  viewId: string | null;
  from: CivilDate;
  /** Exclusive. */
  to: CivilDate;
  /** IANA; decides which days timed rows fall on. */
  timeZone: string;
  /** Up to MAX_FOUND_ROWS (the most when left out). */
  limit?: number;
}

export interface DatedRow {
  rowId: string;
  /** '' when untitled. */
  title: string;
  allDay: boolean;
  start: When;
  /** As stored: an all-day date's last day (inclusive), a timed one's end; null: no end. */
  end: When | null;
  canEdit: boolean;
}

/**
 * The rows this person can open whose date overlaps [from, to) in `timeZone`, earliest first, at
 * most `limit`. Null when the layer is gone for them: the database is missing, in Trash, in another
 * workspace or one they can't open; the view is missing; the property is missing, hidden from them
 * or no longer a Date. 400 when the range or time zone doesn't read.
 */
export async function listDatedRows(
  db: Executor,
  viewer: CalendarViewer,
  q: DatedRowsQuery,
): Promise<{ rows: DatedRow[]; truncated: boolean } | null> {
  if (!isCalendarDate(q.from) || !isCalendarDate(q.to) || q.to < q.from) throw invalidRequest();
  if (!isValidTimeZone(q.timeZone)) throw invalidRequest();
  const record = isUuid(q.databaseId) ? await loadDatabase(db, q.databaseId) : null;
  if (!record || record.inTrash || record.workspaceId !== viewer.workspaceId) return null;
  const seen = await openRows(db, viewer.userId, record);
  if (!seen) return null;
  const { who, visible, open } = seen;
  const prop = findProperty(record.properties, q.propertyId);
  if (!prop || !visible.has(prop.id) || prop.config.type !== 'date') return null;
  const view = q.viewId === null ? null : record.views.find((v) => v.id === q.viewId);
  if (view === undefined) return null;
  const test = filterPredicate(view?.filter ?? null, {
    properties: record.properties,
    viewer: { ...seen.viewer, timeZone: q.timeZone },
    userName: () => undefined,
  });
  const found: { first: CivilDate; row: DatedRow }[] = [];
  for (const { row, access } of open) {
    const value = row.values[prop.id];
    if (!isValidDateValue(value)) continue;
    const days = dateValueDays(value, q.timeZone);
    if (days.start >= q.to || days.end < q.from) continue;
    if (!test(withoutHidden(row, visible, true))) continue;
    const canEdit =
      can('edit_rows', access, { locked: record.locked }) && canChangeProperty(prop, who, access);
    found.push({
      first: days.start,
      row: {
        rowId: row.id,
        title: row.title,
        allDay: !value.hasTime,
        start: value.start,
        end: value.end,
        canEdit,
      },
    });
  }
  found.sort(
    (a, b) =>
      (a.first < b.first ? -1 : a.first > b.first ? 1 : 0) ||
      Number(b.row.allDay) - Number(a.row.allDay) ||
      (a.row.start < b.row.start ? -1 : a.row.start > b.row.start ? 1 : 0),
  );
  const limit = Math.min(Math.max(Math.floor(q.limit ?? MAX_FOUND_ROWS), 0), MAX_FOUND_ROWS);
  return { rows: found.slice(0, limit).map((f) => f.row), truncated: found.length > limit };
}

export interface RowDatePatch {
  propertyId: string;
  allDay: boolean;
  start: When;
  /** An all-day date's last day (inclusive) or a timed one's end; null or left out: no end. */
  end?: When | null;
}

/** The stored date for a calendar patch, or null when it doesn't read. */
function storedDate(patch: RowDatePatch): Pick<DateValue, 'start' | 'end' | 'hasTime'> | null {
  const end = patch.end ?? null;
  if (patch.allDay) {
    if (!isCalendarDate(patch.start) || (end !== null && !isCalendarDate(end))) return null;
    if (end !== null && end < patch.start) return null;
    return {
      start: patch.start,
      end: end !== null && end > patch.start ? end : null,
      hasTime: false,
    };
  }
  if (!isInstant(patch.start) || (end !== null && !isInstant(end))) return null;
  if (end !== null && Date.parse(end) < Date.parse(patch.start)) return null;
  return { start: patch.start, end, hasTime: true };
}

/**
 * Moves a row's date (dragging it on the calendar) as editing the cell does, in a savepoint of the
 * runRowWrites transaction. 404 when the row or property is gone for them (missing, in Trash, in
 * another workspace, or they can't open or see it); 400 when the property isn't a Date or the date
 * doesn't read; 403 unless they can edit the row and change the property.
 */
export function setRowDate(
  tx: Tx,
  viewer: CalendarViewer,
  rowId: string,
  patch: RowDatePatch,
): Promise<void> {
  return inSavepoint(tx, async (sp) => {
    const record = await rowDatabase(sp, rowId);
    if (record.workspaceId !== viewer.workspaceId) throw notFound();
    const actor = await actorFor(sp, viewer.userId, record, 'user');
    if (!atLeast(await getPageAccess(sp, viewer.userId, rowId), 'view')) throw notFound();
    const prop = findProperty(record.properties, patch.propertyId);
    const visible = await seenBy(sp, record, actor.propertyViewer);
    if (!prop || !visible.has(prop.id)) throw notFound();
    if (prop.config.type !== 'date') throw invalidRequest();
    const moved = storedDate(patch);
    if (!moved) throw invalidRequest();
    const [row] = await loadRows(sp, record.id, [rowId]);
    if (!row) throw notFound();
    // Its reminder and time zone stay while it stays all-day or timed (they differ between the two).
    const current = row.values[prop.id];
    const kept: Partial<DateValue> =
      isValidDateValue(current) && current.hasTime === moved.hasTime ? current : {};
    const next: DateValue = { ...kept, ...moved };
    const { effects } = await changeRows(sp, record, [rowId], { [prop.id]: next }, actor);
    return { value: undefined, effects };
  });
}
