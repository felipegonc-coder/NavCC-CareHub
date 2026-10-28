// Button presses (decision 0200; Templates and buttons 3.4). The package plans a press with the
// presser's own access; this file loads what the plan reads, carries it out in one transaction
// through the rows API (source 'button'), keeps the run log (the newest 50 per button) and undoes
// a run within 8 seconds for the person who pressed. Messages go out as notices after the commit,
// only to people who can open the row: each one filled in with its reader's own access, with only
// the page cards they can open. Buttons are off on archived pages (TB-15), and only Admins can
// press a step that sends to Everyone or to roles (TB-14, checked at the press for now). Only
// workspace members can press (not guests).
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_TIME_ZONE,
  LIMITS,
  findProperty,
  isValidTimeZone,
  titleProperty,
  type AccessLevel,
  type ComputedValue,
  type Id,
  type Property,
  type Row,
  type Viewer,
  type WeekDay,
} from '@carehub/databases';
import {
  accessToRow,
  atLeast,
  canChangeProperty,
  canSeeProperty,
  type PropertyViewer,
} from '@carehub/databases/access';
import {
  BUTTON_MESSAGES,
  failRun,
  fillMessage,
  planRun,
  planUndo,
  runToast,
  type ButtonConfig,
  type ButtonDatabase,
  type ButtonRun,
  type MessageReader,
  type MessageStep,
  type PlannedStep,
  type ReadyRun,
  type RowChange,
  type RunContext,
} from '@carehub/databases/buttons';
import {
  PATTERNS,
  basicSchema,
  buttonEvaluator,
  buttonFormulas,
  buttonFormulaReads,
  formulaBudget,
  type FormulaContext,
  type FormulaSchema,
} from '@carehub/databases/formula';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../core/errors';
import type { Tx } from '../../db';
import { NOTICE_LIMITS, sendNotice } from '../notices';
import { getAccessForPages } from '../pages';
import { createRow, runRowWrites, trashRows, updateRows } from './api';
import { forbidden, invalid, notFound } from './errors';
import { isUuid, type DatabaseRecord } from './record';
import { loadDatabase, loadPropertyViewer, loadRows, uuidList, type Executor } from './store';

/** Our words for what the package has none for. */
export const BUTTON_RUN_MESSAGES = {
  cantUndo: "This run can't be undone anymore.",
  archived: 'This page is archived.',
} as const;

/**
 * A "Send a message" notice is titled with the button's label; these words stand in when the label
 * is empty. The text is the message with its fill-ins, and the cards show the step's pages.
 */
export const BUTTON_NOTICES = {
  title: 'A button sent you a message',
} as const;

/** Where the screen goes after a press, in step order. */
export type RunOpen =
  | { kind: 'page'; pageId: string; openIn: 'side_peek' | 'center_peek' | 'full_page' | 'new_tab' }
  | { kind: 'link'; url: string };

/** What a press answers (a refusal of the presser's own access is a 403 instead). */
export type PressAnswer =
  | { status: 'confirm'; step: number; title: string; message: string; confirmLabel: string }
  | {
      status: 'done' | 'failed';
      runId: string;
      /** What shows after the ✓ (runToast): "Done · Undo", the failure, or null. */
      message: string | null;
      /** Until when Undo works; null when nothing changed. */
      undoUntil: string | null;
      open: RunOpen[];
    };

export interface PressInput {
  /** The button's database (not in Trash), the row pressed on and the presser's level on it. */
  record: DatabaseRecord;
  row: Row;
  rowLevel: AccessLevel;
  button: Property<ButtonConfig>;
  presser: Viewer;
  presserName: string;
  /** How many "Show a confirmation" steps they continued past. */
  confirmed: number;
}

/** One run in a button's log, without the values it changed (the reader may not see them). */
export interface RunEntry {
  id: string;
  by: string | null;
  at: string;
  outcome: 'done' | 'failed';
  failedStep: number | null;
  message: string | null;
  /** Rows it changed or added. */
  rows: number;
  skipped: number;
  messaged: number;
  undone: boolean;
}

/** One person's notice from a message step: their text and the cards of the pages they can open. */
type Delivery = { userId: string; text: string; cards: string[] };

const isButton = (prop: Property | undefined): prop is Property<ButtonConfig> =>
  prop?.config.type === 'button';

/** The Button property with this id, or 404. */
export function buttonOf(record: DatabaseRecord, propertyId: unknown): Property<ButtonConfig> {
  const prop =
    typeof propertyId === 'string' ? findProperty(record.properties, propertyId) : undefined;
  if (!isButton(prop)) throw notFound();
  return prop;
}

// ---------------------------------------------------------------- what a press reads

interface Loaded {
  /** The button's database, the databases its steps name and the ones those relate to. */
  records: Map<string, DatabaseRecord>;
  /** The presser's level on each of those database pages ('none' in Trash). */
  levels: Map<string, AccessLevel>;
  /** "Edit rows" targets: the rows the presser can open. */
  rows: Map<string, Row[]>;
  /** The presser's level on each row loaded, and on the row pressed on. */
  rowLevels: Map<string, AccessLevel>;
  /** The presser as property access lists read them, by workspace. */
  viewers: Map<string, PropertyViewer>;
  people: People;
}

interface People {
  names: Map<string, string>;
  /** Members (not guests). */
  members: string[];
  /** Role id → its members (not guests); every role of the workspace is here. */
  roles: Map<string, string[]>;
  /** Members whose role has the workspace.admin permission. */
  admins: Set<string>;
}

const relationTargets = (record: DatabaseRecord): string[] =>
  record.properties.flatMap((p) =>
    p.config.type === 'relation' ? [p.config.targetDatabaseId] : [],
  );

async function loadRecords(tx: Executor, records: Map<string, DatabaseRecord>, ids: string[]) {
  for (const id of new Set(ids)) {
    if (records.has(id) || !isUuid(id)) continue;
    const record = await loadDatabase(tx, id);
    if (record) records.set(id, record);
  }
}

async function loadPeople(tx: Executor, workspaceId: string): Promise<People> {
  const { rows: members } = await tx.execute<{
    user_id: string;
    role_id: string | null;
    kind: string;
    name: string;
  }>(sql`
    SELECT m.user_id, m.role_id, m.kind, u.name
    FROM workspace_members m JOIN users u ON u.id = m.user_id
    WHERE m.workspace_id = ${workspaceId} AND m.removed_at IS NULL`);
  const { rows: roles } = await tx.execute<{ id: string; permissions: string[] | null }>(
    sql`SELECT id, permissions FROM roles WHERE workspace_id = ${workspaceId}`,
  );
  const adminRoles = new Set(
    roles.filter((r) => (r.permissions ?? []).includes('workspace.admin')).map((r) => r.id),
  );
  const people: People = {
    names: new Map(members.map((m) => [m.user_id, m.name])),
    members: [],
    roles: new Map(roles.map((r) => [r.id, []])),
    admins: new Set(),
  };
  for (const m of members) {
    if (m.kind === 'guest') continue;
    people.members.push(m.user_id);
    if (m.role_id) people.roles.get(m.role_id)?.push(m.user_id);
    if (m.role_id && adminRoles.has(m.role_id)) people.admins.add(m.user_id);
  }
  return people;
}

async function loadForPress(tx: Tx, input: PressInput): Promise<Loaded> {
  const { record: home, presser } = input;
  const actions = input.button.config.actions;
  const records = new Map([[home.id, home]]);
  await loadRecords(
    tx,
    records,
    actions.flatMap((a) => (a.kind === 'add_row' || a.kind === 'edit_rows' ? [a.databaseId] : [])),
  );
  await loadRecords(tx, records, [...records.values()].flatMap(relationTargets));
  const levels = await getAccessForPages(tx, presser.userId, [...records.keys()]);
  const viewers = new Map<string, PropertyViewer>();
  for (const workspaceId of new Set([...records.values()].map((r) => r.workspaceId))) {
    viewers.set(workspaceId, await loadPropertyViewer(tx, presser.userId, workspaceId));
  }
  const rows = new Map<string, Row[]>();
  const rowLevels = new Map<string, AccessLevel>([[input.row.id, input.rowLevel]]);
  for (const a of actions) {
    const target = a.kind === 'edit_rows' ? records.get(a.databaseId) : undefined;
    if (!target || rows.has(target.id) || !atLeast(levels.get(target.id), 'view')) continue;
    const all = await loadRows(tx, target.id);
    const access = await getAccessForPages(
      tx,
      presser.userId,
      all.map((r) => r.id),
    );
    for (const [id, level] of access) if (id !== input.row.id) rowLevels.set(id, level);
    rows.set(
      target.id,
      all.filter((r) => atLeast(rowLevels.get(r.id), 'view')),
    );
  }
  const people = await loadPeople(tx, home.workspaceId);
  return { records, levels, rows, rowLevels, viewers, people };
}

/** The package's view of everything a press reads, and the database of each row it plans. */
function runContext(input: PressInput, loaded: Loaded): RunContext {
  const { records, levels, rows, rowLevels, viewers, people } = loaded;
  const { presser, button } = input;
  const homeOf = new Map<string, string>([[input.row.id, input.record.id]]);
  for (const [databaseId, list] of rows) for (const r of list) homeOf.set(r.id, databaseId);
  const viewerOf = (databaseId: Id): PropertyViewer => {
    const workspaceId = records.get(databaseId)?.workspaceId;
    return (workspaceId && viewers.get(workspaceId)) || { userId: presser.userId, groupIds: [] };
  };
  const asButtonDatabase = (record: DatabaseRecord): ButtonDatabase => ({
    id: record.id,
    title: record.title,
    properties: record.properties,
    access: levels.get(record.id) ?? 'none',
    inTrash: record.inTrash,
    rows: rows.get(record.id) ?? [],
  });

  const budget = formulaBudget({});
  const schemas = new Map<string, FormulaSchema>();
  const schemaOf = (record: DatabaseRecord): FormulaSchema => {
    let schema = schemas.get(record.id);
    if (!schema) {
      const related = (relationId: Id) => {
        const prop = findProperty(record.properties, relationId);
        const target =
          prop?.config.type === 'relation' ? records.get(prop.config.targetDatabaseId) : undefined;
        return target ? schemaOf(target) : null;
      };
      const deleted = record.deletedProperties.map((d) => ({
        id: d.property.id,
        name: d.property.name,
      }));
      schema = basicSchema(record.properties, related, deleted);
      schemas.set(record.id, schema);
    }
    return schema;
  };
  const userName = (id: Id) => people.names.get(id);
  // Formulas read their own row; related rows and formula values come with the query engine's
  // server part, as everywhere on the server for now.
  const formulaContext = (record: DatabaseRecord): FormulaContext => ({
    properties: record.properties,
    viewer: presser,
    userName,
    page: () => null,
    userEmail: () => undefined,
    budget,
    patterns: PATTERNS,
  });
  const contexts = new Map<string, FormulaContext>();
  const variables = button.config.actions.flatMap((a) =>
    a.kind === 'define_variables' ? a.variables : [],
  );
  const evaluate = buttonEvaluator(buttonFormulas(schemaOf(input.record), variables), (row) => {
    const record = records.get(homeOf.get(row.id) ?? '');
    if (!record) return null;
    let ctx = contexts.get(record.id);
    if (!ctx) contexts.set(record.id, (ctx = formulaContext(record)));
    return { schema: schemaOf(record), ctx };
  });

  // planRun asks for one id per "Add a row" step, in order: remember which database each is for.
  const addedTo = button.config.actions.flatMap((a) =>
    a.kind === 'add_row' ? [a.databaseId] : [],
  );
  let added = 0;
  return {
    presser,
    database: asButtonDatabase(input.record),
    databaseById: (id) => {
      const record = records.get(id);
      return record ? asButtonDatabase(record) : null;
    },
    rowAccess: (databaseId, row) => {
      const known = rowLevels.get(row.id);
      if (known) return known;
      const record = records.get(databaseId);
      if (!record) return 'none';
      return accessToRow(row, {
        userId: presser.userId,
        database: levels.get(databaseId) ?? 'none',
        rules: record.accessRules,
        properties: record.properties,
      });
    },
    canSeeProperty: (databaseId, prop) => canSeeProperty(prop, viewerOf(databaseId)),
    canChangeProperty: (databaseId, prop, level) =>
      canChangeProperty(prop, viewerOf(databaseId), level),
    evaluate,
    formulaReads: buttonFormulaReads,
    userName,
    membersOf: (kind, id) => (kind === 'role' ? (people.roles.get(id) ?? null) : null),
    everyone: () => people.members,
    confirmed: input.confirmed,
    newId: () => {
      const id = randomUUID();
      homeOf.set(id, addedTo[added] ?? input.record.id);
      added += 1;
      return id;
    },
  };
}

// ---------------------------------------------------------------- carrying out a plan

/** The values a change writes, as the rows API takes them (the Name property's id renames). */
function valuesOf(change: RowChange, records: Map<string, DatabaseRecord>): Record<Id, unknown> {
  const record = records.get(change.databaseId);
  if (!change.title || !record) return { ...change.after };
  return { ...change.after, [titleProperty(record.properties).id]: change.title.after };
}

/** A step's row changes, grouped by database and identical values: one updateRows call each. */
function sameWrites(changes: readonly RowChange[], records: Map<string, DatabaseRecord>) {
  const groups = new Map<
    string,
    { databaseId: string; values: Record<Id, unknown>; changes: RowChange[] }
  >();
  for (const change of changes) {
    const values = valuesOf(change, records);
    const key = JSON.stringify([change.databaseId, Object.entries(values).sort()]);
    const group = groups.get(key);
    if (group) group.changes.push(change);
    else groups.set(key, { databaseId: change.databaseId, values, changes: [change] });
  }
  return [...groups.values()];
}

/** The title of the first of these rows that's in Trash ('Untitled' without one), or null. */
async function trashedTitle(tx: Tx, rowIds: readonly string[]): Promise<string | null> {
  if (!rowIds.some(isUuid)) return null;
  const { rows } = await tx.execute<{ title: string }>(sql`
    SELECT title FROM pages
    WHERE id = ANY(${uuidList(rowIds)}) AND deleted_at IS NOT NULL
    ORDER BY array_position(${uuidList(rowIds)}, id)
    LIMIT 1`);
  const found = rows[0];
  return found ? found.title.trim() || 'Untitled' : null;
}

/**
 * Why a write was refused, as the run log says it; null when it isn't a refusal (a real error).
 * `rowIds` are the rows the step writes.
 */
async function refusal(
  tx: Tx,
  error: unknown,
  step: PlannedStep,
  rowIds: readonly string[],
  records: Map<string, DatabaseRecord>,
): Promise<string | null> {
  if (!(error instanceof HttpError) || error.statusCode >= 500) return null;
  const databaseId = 'changes' in step ? step.changes[0]?.databaseId : undefined;
  const title = (databaseId && records.get(databaseId)?.title) || '';
  if (error.statusCode === 403) {
    if (step.kind === 'add_row') return BUTTON_MESSAGES.cantAddRows(title);
    if (step.kind === 'edit_rows') return BUTTON_MESSAGES.cantEditRows(title);
    return BUTTON_MESSAGES.cantEditRow;
  }
  if (error.statusCode === 404 && step.kind === 'add_row') return BUTTON_MESSAGES.noDatabase;
  if (error.statusCode === 404) {
    // A row it writes went to Trash after the run was planned (someone else's change).
    const trashed = await trashedTitle(tx, rowIds);
    if (trashed !== null) return BUTTON_MESSAGES.inTrash(trashed);
  }
  return error.message;
}

interface Outcome {
  run: ButtonRun;
  undoUntil: string | null;
  open: RunOpen[];
  deliveries: Delivery[];
}

/**
 * Carries out a ready plan's steps in order. A refused write stops the run there: what earlier
 * steps wrote stays (and Undo still works for it), and so does what the failed step wrote before
 * its refusal (an "Edit rows" step writes its rows in groups).
 */
async function carryOut(
  tx: Tx,
  input: PressInput,
  loaded: Loaded,
  plan: ReadyRun,
): Promise<Outcome> {
  const actorUserId = input.presser.userId;
  const created = new Map<string, string>();
  const idOf = (id: string) => created.get(id) ?? id;
  const done: PlannedStep[] = [];
  const open: RunOpen[] = [];
  const sends: MessageStep[] = [];
  let ended: ReadyRun = plan;
  for (const step of plan.steps) {
    const written: RowChange[] = [];
    try {
      if (step.kind === 'set_values' || step.kind === 'edit_rows') {
        for (const group of sameWrites(step.changes, loaded.records)) {
          await updateRows(tx, {
            databaseId: group.databaseId,
            rowIds: group.changes.map((c) => idOf(c.rowId)),
            values: group.values,
            actorUserId,
            source: 'button',
          });
          written.push(...group.changes);
        }
      } else if (step.kind === 'add_row') {
        const [change] = step.changes;
        if (change) {
          const { rowId } = await createRow(tx, {
            databaseId: change.databaseId,
            templateId: step.templateId,
            values: valuesOf(change, loaded.records),
            actorUserId,
            source: 'button',
          });
          created.set(change.rowId, rowId);
          if (step.open) open.push({ kind: 'page', pageId: rowId, openIn: step.open });
        }
      } else if (step.kind === 'open_page') {
        open.push({ kind: 'page', pageId: idOf(step.pageId), openIn: step.openIn });
      } else if (step.kind === 'open_link') {
        open.push({ kind: 'link', url: step.url });
      } else {
        sends.push(step);
      }
    } catch (error) {
      const rowIds = 'changes' in step ? step.changes.map((c) => idOf(c.rowId)) : [];
      const reason = await refusal(tx, error, step, rowIds, loaded.records);
      if (reason === null) throw error;
      // Half a step lower, so failRun keeps what this step wrote before the refusal.
      const partial: PlannedStep[] = written.length
        ? [{ step: step.step - 0.5, kind: 'set_values', changes: written }]
        : [];
      ended = failRun({ ...plan, steps: [...done, ...partial] }, step.step, reason);
      break;
    }
    done.push(step);
  }
  const changes = await storedChanges(
    tx,
    ended.run.changes.map((c) => ({ ...c, rowId: idOf(c.rowId) })),
  );
  const deliveries = await messagesFor(tx, input, loaded.people, sends);
  const messaged = new Set(deliveries.map((d) => d.userId)).size;
  const run: ButtonRun = { ...ended.run, changes, messaged };
  return { run, undoUntil: changes.length ? ended.undoUntil : null, open, deliveries };
}

/** Each change's `after` as stored (relations keep hidden links), for Undo to compare. */
async function storedChanges(tx: Tx, changes: RowChange[]): Promise<RowChange[]> {
  const byDatabase = new Map<string, string[]>();
  for (const c of changes)
    byDatabase.set(c.databaseId, [...(byDatabase.get(c.databaseId) ?? []), c.rowId]);
  const stored = new Map<string, Row>();
  for (const [databaseId, rowIds] of byDatabase) {
    for (const row of await loadRows(tx, databaseId, rowIds)) stored.set(row.id, row);
  }
  return changes.map((c) => {
    const row = stored.get(c.rowId);
    if (!row) return c;
    const after = Object.fromEntries(
      Object.keys(c.after).map((id) => [id, row.values[id] ?? null]),
    );
    const title = c.title ? { title: { before: c.title.before, after: row.title } } : {};
    return { ...c, after, ...title };
  });
}

// ---------------------------------------------------------------- messages

/** Fill-ins as the package reads them: a name in braces, on one line. */
const FILL_IN = /\{([^{}\r\n]{1,100})\}/g;
const loose = (name: string) => name.replace(/\s+/g, '').toLowerCase();

/**
 * The rows a message's fill-ins may show by title: the linked rows of the relation properties and
 * the pages in the variables it names (by name, ignoring case and spaces, as fillMessage matches).
 */
function linkedRows(step: MessageStep): string[] {
  const named = new Set([...step.message.matchAll(FILL_IN)].map((m) => loose(m[1] ?? '')));
  const ids = new Set<string>();
  for (const prop of step.fill.properties) {
    if (prop.config.type !== 'relation' || !named.has(loose(prop.name))) continue;
    const linked: unknown = step.fill.row.values[prop.id];
    if (Array.isArray(linked)) for (const id of linked) if (typeof id === 'string') ids.add(id);
  }
  const pages = (value: ComputedValue | null) => {
    if (value?.kind === 'page') ids.add(value.value);
    if (value?.kind === 'list') value.value.forEach(pages);
  };
  for (const v of step.fill.variables) if (named.has(loose(v.name))) pages(v.value);
  return [...ids].filter(isUuid);
}

/** The titles of these pages that aren't in Trash. */
async function titlesOf(tx: Tx, pageIds: string[]): Promise<Map<string, string>> {
  if (pageIds.length === 0) return new Map();
  const { rows } = await tx.execute<{ id: string; title: string }>(sql`
    SELECT id, title FROM pages WHERE id = ANY(${uuidList(pageIds)}) AND deleted_at IS NULL`);
  return new Map(rows.map((r) => [r.id, r.title]));
}

type Settings = {
  id: string;
  time_zone: string | null;
  use_24h: boolean | null;
  week_start: number | null;
};

/** Each person's time zone and clock, for their fill-ins; `now` is the moment of the press. */
async function viewersOf(tx: Tx, userIds: string[], now: Date): Promise<Map<string, Viewer>> {
  if (userIds.length === 0) return new Map();
  const { rows } = await tx.execute<Settings>(sql`
    SELECT id, time_zone, use_24h, week_start FROM users WHERE id = ANY(${uuidList(userIds)})`);
  return new Map(
    rows.map((u): [string, Viewer] => [
      u.id,
      {
        userId: u.id,
        timeZone: u.time_zone && isValidTimeZone(u.time_zone) ? u.time_zone : DEFAULT_TIME_ZONE,
        weekStart: (u.week_start ?? 0) as WeekDay,
        hour12: !u.use_24h,
        now,
      },
    ]),
  );
}

/**
 * The notices of the message steps that ran, checked in the transaction: one for each person a
 * step goes to who can open the row. Each text has its fill-ins worked out with that person's own
 * access (fillMessage: a property or row they can't see comes out empty), and each notice carries
 * only the cards of pages they can open; the others are left off, so no title or icon shows.
 */
async function messagesFor(
  tx: Tx,
  input: PressInput,
  people: People,
  steps: readonly MessageStep[],
): Promise<Delivery[]> {
  const userIds = [...new Set(steps.flatMap((s) => s.userIds))].filter(isUuid);
  if (userIds.length === 0) return [];
  const rowId = input.row.id;
  const linked = [...new Set(steps.flatMap(linkedRows))];
  const pageIds = [...new Set([rowId, ...steps.flatMap((s) => s.pageIds), ...linked])];
  const titles = await titlesOf(tx, linked);
  const viewers = await viewersOf(tx, userIds, input.presser.now);
  const readers = new Map<string, { reader: MessageReader; canOpen: (id: string) => boolean }>();
  for (const [userId, viewer] of viewers) {
    const levels = await getAccessForPages(tx, userId, pageIds.filter(isUuid));
    const canOpen = (id: string) => atLeast(levels.get(id), 'view');
    if (!canOpen(rowId)) continue;
    const propertyViewer = await loadPropertyViewer(tx, userId, input.record.workspaceId);
    const reader: MessageReader = {
      viewer,
      name: people.names.get(userId) ?? '',
      canOpenRow: true,
      canSeeProperty: (prop) => canSeeProperty(prop, propertyViewer),
      userName: (id) => people.names.get(id),
      rowTitle: (id) => (canOpen(id) ? titles.get(id) : undefined),
    };
    readers.set(userId, { reader, canOpen });
  }
  return steps.flatMap((step) =>
    step.userIds.flatMap((userId) => {
      const found = readers.get(userId);
      if (!found) return [];
      const text = fillMessage(step, found.reader);
      return [{ userId, text, cards: step.pageIds.filter(found.canOpen) }];
    }),
  );
}

/** Adds the run to the button's log and keeps the newest 50. */
async function recordRun(tx: Tx, input: PressInput, run: ButtonRun): Promise<string> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    INSERT INTO db_button_runs (database_id, row_id, property_id, "by", "at", outcome, changes,
      failed_step, message, skipped, messaged)
    VALUES (${input.record.id}, ${input.row.id}, ${input.button.id}, ${run.by},
      ${run.at}::timestamptz, ${run.outcome}, ${JSON.stringify(run.changes)}::jsonb,
      ${run.failedStep}, ${run.message}, ${run.skipped}, ${run.messaged})
    RETURNING id`);
  await tx.execute(sql`
    DELETE FROM db_button_runs WHERE id IN (
      SELECT id FROM db_button_runs
      WHERE database_id = ${input.record.id} AND property_id = ${input.button.id}
      ORDER BY "at" DESC, id DESC OFFSET ${LIMITS.buttonRunLog})`);
  const id = rows[0]?.id;
  if (!id) throw new Error('The button run was not recorded.');
  return id;
}

/** Sends each notice after the commit; one that fails is logged and the others still go. */
async function deliver(app: FastifyInstance, input: PressInput, deliveries: Delivery[]) {
  const sender = input.presserName.trim().slice(0, NOTICE_LIMITS.sender) || 'Databases';
  const title =
    input.button.config.label.trim().slice(0, NOTICE_LIMITS.title) || BUTTON_NOTICES.title;
  for (const { userId, text, cards } of deliveries) {
    const shown = cards.slice(0, NOTICE_LIMITS.cards);
    try {
      await sendNotice({
        workspaceId: input.record.workspaceId,
        userId,
        kind: 'automation',
        sender,
        actorUserId: input.presser.userId,
        title,
        ...(text.trim() ? { text } : {}),
        ...(shown.length
          ? { cards: shown.map((pageId) => ({ type: 'page' as const, pageId })) }
          : {}),
      });
    } catch (err) {
      app.log.warn({ err }, 'databases: a button message was not sent');
    }
  }
}

/** Whether the page, a page above it or its space is archived: read-only, so buttons are off. */
async function isArchived(tx: Executor, pageId: string): Promise<boolean> {
  const { rows } = await tx.execute<{ archived: boolean | null }>(sql`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, space_id, archived_at, 0 AS depth FROM pages WHERE id = ${pageId}
      UNION ALL
      SELECT p.id, p.parent_id, p.space_id, p.archived_at, up.depth + 1
      FROM pages p JOIN up ON p.id = up.parent_id WHERE up.depth < 1000
    )
    SELECT bool_or(up.archived_at IS NOT NULL OR s.archived_at IS NOT NULL) AS archived
    FROM up JOIN spaces s ON s.id = up.space_id`);
  return rows[0]?.archived === true;
}

/** The first step that sends to Everyone or to roles, when the presser isn't an Admin (TB-14). */
function adminsOnlyStep(input: PressInput, people: People): number | null {
  if (people.admins.has(input.presser.userId)) return null;
  const i = input.button.config.actions.findIndex(
    (a) => a.kind === 'send_message' && (a.to.everyone === true || (a.to.roleIds ?? []).length > 0),
  );
  return i < 0 ? null : i + 1;
}

/**
 * Presses a button: plans the run, then carries it out and logs it in one transaction. Refusals of
 * the presser's own access answer 403 and aren't logged; a button with no steps answers 400; a
 * step that can't run is logged as a failed run. Every failure of a step says which one
 * ("Couldn't finish step 2: ...").
 */
export async function pressButton(app: FastifyInstance, input: PressInput): Promise<PressAnswer> {
  const deliveries: Delivery[] = [];
  const answer = await runRowWrites(app, async (tx): Promise<PressAnswer> => {
    if (await isArchived(tx, input.row.id)) throw forbidden(BUTTON_RUN_MESSAGES.archived);
    const loaded = await loadForPress(tx, input);
    const plan = planRun(input.button, input.row, runContext(input, loaded));
    // The Admin rule comes before any failure of a later step, and before a confirmation.
    const adminsOnly = adminsOnlyStep(input, loaded.people);
    const earlier =
      plan.status === 'refused' && (plan.step === null || plan.step < (adminsOnly ?? 0));
    if (adminsOnly !== null && !earlier) {
      throw forbidden(BUTTON_MESSAGES.stepFailed(adminsOnly, BUTTON_MESSAGES.adminsOnly));
    }
    if (plan.status === 'confirm') {
      const { status, step, title, message, confirmLabel } = plan;
      return { status, step, title, message, confirmLabel };
    }
    if (plan.status === 'refused') {
      if (plan.forbidden) {
        const { step, message } = plan;
        throw forbidden(step === null ? message : BUTTON_MESSAGES.stepFailed(step, message));
      }
      if (plan.step === null) throw invalid(plan.message);
      const runId = await recordRun(tx, input, plan.run);
      return { status: 'failed', runId, message: runToast(plan.run), undoUntil: null, open: [] };
    }
    const outcome = await carryOut(tx, input, loaded, plan);
    deliveries.push(...outcome.deliveries);
    const runId = await recordRun(tx, input, outcome.run);
    const { run, undoUntil, open } = outcome;
    return { status: run.outcome, runId, message: runToast(run), undoUntil, open };
  });
  await deliver(app, input, deliveries);
  return answer;
}

// ---------------------------------------------------------------- Undo and the run log

type RunRow = {
  id: string;
  by: string | null;
  at: Date | string;
  outcome: 'done' | 'failed';
  failed_step: number | null;
  message: string | null;
  changes: RowChange[] | null;
  skipped: number;
  messaged: number;
  undone_at: Date | string | null;
};

const RUN_COLUMNS = sql.raw(
  `id, "by", "at", outcome, failed_step, message, changes, skipped, messaged, undone_at`,
);

const instant = (value: Date | string) => new Date(value).toISOString();

/**
 * Undoes a run of a button of database `databaseId`: only the person who pressed, within 8
 * seconds, once. Values someone changed since stay, and so do rows they can't change any more
 * (`kept` counts both); `note` says sent messages can't be unsent.
 */
export async function undoRun(
  app: FastifyInstance,
  input: { databaseId: string; runId: unknown; userId: string },
): Promise<{ kept: number; note: string | null }> {
  if (!isUuid(input.runId)) throw notFound();
  const runId = input.runId;
  return runRowWrites(app, async (tx) => {
    const { rows } = await tx.execute<RunRow>(sql`
      SELECT ${RUN_COLUMNS} FROM db_button_runs
      WHERE id = ${runId} AND database_id = ${input.databaseId}`);
    const found = rows[0];
    if (!found) throw notFound();
    if (found.by !== input.userId) throw forbidden();
    const run: ButtonRun = {
      by: input.userId,
      at: instant(found.at),
      outcome: found.outcome,
      failedStep: found.failed_step,
      message: found.message,
      changes: found.changes ?? [],
      skipped: found.skipped,
      messaged: found.messaged,
    };
    const records = new Map<string, DatabaseRecord>();
    await loadRecords(
      tx,
      records,
      run.changes.map((c) => c.databaseId),
    );
    const current = new Map<string, Row>();
    for (const record of records.values()) {
      const ids = run.changes.filter((c) => c.databaseId === record.id).map((c) => c.rowId);
      for (const row of await loadRows(tx, record.id, ids)) current.set(row.id, row);
    }
    const plan = found.undone_at
      ? null
      : planUndo(run, (_databaseId, rowId) => current.get(rowId) ?? null, new Date());
    if (!plan) throw invalid(BUTTON_RUN_MESSAGES.cantUndo);
    const claimed = await tx.execute<{ id: string }>(sql`
      UPDATE db_button_runs SET undone_at = now()
      WHERE id = ${runId} AND undone_at IS NULL RETURNING id`);
    if (claimed.rows.length === 0) throw invalid(BUTTON_RUN_MESSAGES.cantUndo);

    let kept = plan.kept;
    for (const write of plan.writes) {
      const record = records.get(write.databaseId);
      const title =
        write.title !== undefined && record
          ? { [titleProperty(record.properties).id]: write.title }
          : {};
      try {
        await updateRows(tx, {
          databaseId: write.databaseId,
          rowIds: [write.rowId],
          values: { ...write.values, ...title },
          actorUserId: input.userId,
          source: 'button',
        });
      } catch (error) {
        if (!(error instanceof HttpError) || error.statusCode >= 500) throw error;
        kept += Object.keys(write.values).length + (write.title === undefined ? 0 : 1);
      }
    }
    for (const databaseId of new Set(plan.trash.map((t) => t.databaseId))) {
      const rowIds = plan.trash.filter((t) => t.databaseId === databaseId).map((t) => t.rowId);
      try {
        await trashRows(tx, { databaseId, rowIds, actorUserId: input.userId });
      } catch (error) {
        if (!(error instanceof HttpError) || error.statusCode >= 500) throw error;
        kept += rowIds.length;
      }
    }
    return { kept, note: plan.note };
  });
}

/** A button's run log, newest first. */
export async function listRuns(
  db: Executor,
  databaseId: string,
  propertyId: string,
): Promise<RunEntry[]> {
  const { rows } = await db.execute<RunRow>(sql`
    SELECT ${RUN_COLUMNS} FROM db_button_runs
    WHERE database_id = ${databaseId} AND property_id = ${propertyId}
    ORDER BY "at" DESC, id DESC LIMIT ${LIMITS.buttonRunLog}`);
  return rows.map((r) => ({
    id: r.id,
    by: r.by,
    at: instant(r.at),
    outcome: r.outcome,
    failedStep: r.failed_step,
    message: r.message,
    rows: (r.changes ?? []).length,
    skipped: r.skipped,
    messaged: r.messaged,
    undone: r.undone_at !== null,
  }));
}
