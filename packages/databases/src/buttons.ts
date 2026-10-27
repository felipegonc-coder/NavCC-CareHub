/**
 * The Button property (Templates and buttons 3.4): who can press a button, checks before one is
 * saved, the plan for one press, the run log and Undo. A press acts with the presser's own access,
 * and every right is checked for every step before anything runs. Pure: the server passes in the
 * rows, the presser's access, the time (presser.now) and a formula evaluator, then carries out the
 * plan.
 */
import { atLeast, can, databasePageAccess } from './access';
import { addDecimal, fitsNumberLimits, isCanonicalDecimal } from './decimal';
import { filterPredicate, validateFilter } from './filter';
import { newId } from './ids';
import { findOptionByName } from './options';
import { isSafeWebLink } from './richtext';
import { findProperty } from './row';
import { isStoredType } from './schema';
import { TEMPLATE_MESSAGES, isDynamicDate, resolveDynamicDate } from './templates';
import {
  LIMITS,
  ME,
  THIS_PAGE,
  type AccessLevel,
  type ButtonAction,
  type ComputedValue,
  type ConfigOf,
  type DatabaseGrant,
  type EvalContext,
  type FilterGroup,
  type FilterNode,
  type Id,
  type Instant,
  type Property,
  type PropertyConfig,
  type PropertyType,
  type Row,
  type SelectOption,
  type ValueEdit,
  type Viewer,
} from './types';
import { VALUE_MESSAGES, validateValue, type ValueResult } from './values';

/**
 * Messages. The first group is the spec's, word for word; the next three came with security issue
 * #46; the next three are the request schemas' own; the rest are ours (the spec has no wording).
 */
export const BUTTON_MESSAGES = {
  cantPress: 'Only people who can edit this page',
  noActions: 'Add an action',
  noAccess: "You don't have access to this database.",
  cantAddRows: (database: string) => `You can't add rows to ${database}.`,
  inTrash: (database: string) => `${database} is in Trash.`,
  stepFailed: (step: number, reason: string) => `Couldn't finish step ${step}: ${reason}`,
  skipped: (count: number) => `${count} skipped`,
  done: 'Done',
  undo: 'Undo',
  unsent: "Sent messages can't be unsent.",

  hiddenProperty: "This button uses a property you can't see.",
  cantChange: (property: string) => `You can't change '${property}'.`,
  viewersChangeRows: "People who can only view can't run steps that change rows.",

  openAfterAdd: 'Open the new page after adding it.',
  variableNames: 'Variable names must be different.',
  unsafeLink: 'Only http and https links.',

  tooManyActions: 'Up to 10 actions.',
  tooManyPeople: 'Up to 50 people.',
  tooManyRecipients: 'This message would go to more than 50 people.',
  tooManyRows: 'More than 500 rows match.',
  noDatabase: "That database doesn't exist.",
  cantEditRow: "You can't edit this row.",
  cantEditRows: (database: string) => `You can't edit rows in ${database}.`,
  usedTooSoon: (variable: string) => `'${variable}' is used before it's defined.`,
  addRemove: 'Only Multi-select, Person and Relation properties can add or remove items.',
  addNumber: 'Only Number properties can be added to.',
  formulaTarget: "Files and checklists can't be set by a formula.",
  messageProperty: 'Messages can only go to people in a Person, Created by or Edited by property.',
} as const;
const M = BUTTON_MESSAGES;

/**
 * The inputs every button formula can read, like properties: prop("pressed_by") is the presser,
 * prop("pressed_at") the moment of the press and prop("this_row") the button's row. Variables are
 * read the same way, by their id.
 */
export const BUTTON_INPUTS = {
  pressedBy: 'pressed_by',
  pressedAt: 'pressed_at',
  thisRow: 'this_row',
} as const;

/** A Button property's settings. */
export type ButtonConfig = ConfigOf<'button'>;
type OpenIn = Extract<ButtonAction, { kind: 'open_page' }>['openIn'];
type OpenAdded = NonNullable<Extract<ButtonAction, { kind: 'add_row' }>['open']>;

/**
 * One row a run changed, for Undo and the run log: property id → stored value (null: empty) before
 * and after. The row's Name is in `title`.
 */
export interface RowChange {
  databaseId: Id;
  rowId: Id;
  /** The run added this row (Undo moves it to Trash). */
  added: boolean;
  before: Record<Id, unknown>;
  after: Record<Id, unknown>;
  title?: { before: string; after: string };
}

/** One press in a button's run log: who, when, the result, the failed step and what changed. */
export interface ButtonRun {
  by: Id;
  at: Instant;
  outcome: 'done' | 'failed';
  /** 1-based; null when nothing failed, or when it failed before any step. */
  failedStep: number | null;
  message: string | null;
  changes: RowChange[];
  /** Rows "Edit rows" left alone because the presser can't edit them. */
  skipped: number;
  /** People sent a message (Undo can't unsend it). */
  messaged: number;
}

/** One step for the server to carry out, in order. Confirmations and variables are already done. */
export type PlannedStep =
  | { step: number; kind: 'set_values'; changes: RowChange[] }
  | { step: number; kind: 'edit_rows'; changes: RowChange[]; skipped: number }
  | {
      step: number;
      kind: 'add_row';
      /** One change: the new row's id and the values to set after its template's. */
      changes: RowChange[];
      templateId: Id | null;
      open: OpenAdded | null;
    }
  | { step: number; kind: 'open_page'; pageId: Id; openIn: OpenIn }
  | { step: number; kind: 'open_link'; url: string }
  | { step: number; kind: 'send_message'; userIds: Id[]; message: string };

/** A press that goes ahead: carry out `steps` in order, then add `run` to the log (appendRun). */
export interface ReadyRun {
  status: 'ready';
  steps: PlannedStep[];
  run: ButtonRun;
  /** Until when "Done · Undo" shows (8 seconds); null when nothing changed. */
  undoUntil: Instant | null;
}

/** Ask first: Continue presses again with `confirmed` one higher; Cancel stops with no changes. */
export interface ConfirmRun {
  status: 'confirm';
  step: number;
  title: string;
  message: string;
  confirmLabel: string;
}

/** Nothing runs. `forbidden`: the presser's own access said no (a direct request gets 403). */
export interface RefusedRun {
  status: 'refused';
  step: number | null;
  message: string;
  forbidden: boolean;
  run: ButtonRun;
}

/** What planRun decided. */
export type RunPlan = ReadyRun | ConfirmRun | RefusedRun;

/** A database as a press sees it: every property (hidden ones too), with the presser's grant. */
export interface ButtonDatabase {
  id: Id;
  title: string;
  properties: readonly Property[];
  /** The presser's grant (DatabaseMeta.viewerAccess). */
  access: DatabaseGrant;
  /** Their rows-only share has Can add rows. */
  canAddRows?: boolean;
  inTrash?: boolean;
  /** Its rows, for "Edit rows" (rows the presser can't view are left out here). */
  rows?: readonly Row[];
}

/** Everything a press needs besides the button and its row. */
export interface RunContext {
  /** Who pressed; presser.now is the moment of the press. */
  presser: Viewer;
  /** The button's own database. */
  database: ButtonDatabase;
  /** Another database a step names; null when there's no such database. */
  databaseById(id: Id): ButtonDatabase | null;
  /** The presser's level on a row (accessToRow). */
  rowAccess(databaseId: Id, row: Row): AccessLevel;
  /** canSeeProperty from ./access, for the presser. */
  canSeeProperty(databaseId: Id, prop: Property): boolean;
  /** canChangeProperty from ./access, for the presser at this level. */
  canChangeProperty(databaseId: Id, prop: Property, level: AccessLevel): boolean;
  /** Works out a formula on a row (Formulas); variables and inputs by id. Errors come back as kind 'error'. */
  evaluate(
    formula: string,
    row: Row,
    variables: Readonly<Record<Id, ComputedValue>>,
  ): ComputedValue;
  /** The property and variable ids a formula reads; default: every prop("<id>") in it. */
  formulaReads?(formula: string): Id[];
  /** For filters on Person properties. */
  userName(id: Id): string | undefined;
  /** For filters on formulas and rollups. */
  computed?(row: Row, propertyId: Id): ComputedValue;
  /** How many "Show a confirmation" steps the presser has already continued past. */
  confirmed?: number;
  /** Ids for added rows (default: newId). */
  newId?(): Id;
}

/** What validateButton found: the first problem (step 1-based, null for the whole button) and warnings. */
export interface ButtonCheck {
  error: { step: number | null; message: string } | null;
  warnings: string[];
}

/** What Undo does: values to put back, added rows to move to Trash, how many stay, and the note. */
export interface UndoPlan {
  writes: { databaseId: Id; rowId: Id; values: Record<Id, unknown>; title?: string }[];
  trash: { databaseId: Id; rowId: Id }[];
  /** Changes left as they are because someone changed them since. */
  kept: number;
  /** "Sent messages can't be unsent." when the run sent any; otherwise null. */
  note: string | null;
}

// ---------------------------------------------------------------- pressing

/**
 * Whether someone with this level on the row may press its button: Can edit content or higher by
 * default ("editors"), Can view or higher for "Anyone who can view". Each step still needs the
 * presser's own access (planRun checks it).
 */
export function canPress(
  level: AccessLevel | null | undefined,
  whoCanPress: 'editors' | 'viewers' = 'editors',
): boolean {
  return atLeast(level, whoCanPress === 'viewers' ? 'view' : 'edit_content');
}

/** Why the button shows greyed out for this person, or null when they can press it. */
export function whyCantPress(
  level: AccessLevel | null | undefined,
  config: ButtonConfig,
): string | null {
  if (!canPress(level, config.whoCanPress)) return M.cantPress;
  return config.actions.length ? null : M.noActions;
}

// ---------------------------------------------------------------- checking settings

/**
 * Checks a button's settings before they're saved. Up to 10 steps; every property a step sets
 * exists, stores a value and gets one that fits (Today and Now only on dates, Me only in Person
 * lists, This page only in Relation lists); "Edit rows" filters fit their database; "Open a page"
 * with no page comes after an "Add a row"; links are http or https; a message goes to at most 50
 * people, through Person, Created by or Edited by properties only; variable names are different and
 * each variable is defined before a formula uses it. `propertiesOf` gives another database's
 * properties (null: no such database); without it, steps there skip the property checks. Warns
 * when anyone who can view may press it but a step changes rows.
 */
export function validateButton(
  config: ButtonConfig,
  properties: readonly Property[],
  propertiesOf?: (databaseId: Id) => readonly Property[] | null,
): ButtonCheck {
  const { actions } = config;
  const changesRows = actions.some((a) => CHANGES_ROWS.has(a.kind));
  const warnings = config.whoCanPress === 'viewers' && changesRows ? [M.viewersChangeRows] : [];
  const fail = (step: number | null, message: string): ButtonCheck => ({
    error: { step, message },
    warnings,
  });
  if (actions.length > LIMITS.buttonActions) return fail(null, M.tooManyActions);
  const variables = actions.flatMap((a) => (a.kind === 'define_variables' ? a.variables : []));
  const names = variables.map((v) => v.name.trim().toLowerCase());
  if (new Set(names).size < names.length) return fail(null, M.variableNames);
  const defined = new Set<Id>(Object.values(BUTTON_INPUTS));
  const tooSoon = (formula: string): string | null => {
    const ids = formulaIds(formula);
    const v = variables.find((x) => ids.includes(x.id) && !defined.has(x.id));
    return v ? M.usedTooSoon(v.name) : null;
  };
  let added = false;
  for (const [i, a] of actions.entries()) {
    let problem: string | null = null;
    switch (a.kind) {
      case 'set_values':
        problem = editsProblem({ ...asEdits(a.values), ...a.edits }, properties, tooSoon);
        break;
      case 'add_row':
      case 'edit_rows': {
        const props = propertiesOf ? propertiesOf(a.databaseId) : undefined;
        if (props === null) problem = M.noDatabase;
        else if (a.kind === 'edit_rows' && props) problem = validateFilter(a.filter, props);
        problem ??= editsProblem(a.edits, props ?? undefined, tooSoon);
        added ||= a.kind === 'add_row';
        break;
      }
      case 'open_page':
        if (a.pageId === null && !added) problem = M.openAfterAdd;
        break;
      case 'open_link':
        if (!isSafeWebLink(a.url)) problem = M.unsafeLink;
        break;
      case 'send_message':
        problem = messageProblem(a.to, properties);
        break;
      case 'define_variables':
        for (const v of a.variables) {
          problem ??= tooSoon(v.formula);
          defined.add(v.id);
        }
        break;
      case 'confirm':
        break;
    }
    if (problem) return fail(i + 1, problem);
  }
  return { error: null, warnings };
}

const CHANGES_ROWS: ReadonlySet<ButtonAction['kind']> = new Set([
  'set_values',
  'add_row',
  'edit_rows',
]);

/** The first problem with a step's value edits (on unknown databases, only formula order). */
function editsProblem(
  edits: Record<Id, ValueEdit>,
  props: readonly Property[] | undefined,
  tooSoon: (formula: string) => string | null,
): string | null {
  for (const [id, edit] of Object.entries(edits)) {
    const prop = props ? findProperty(props, id) : undefined;
    if (props && !prop) return TEMPLATE_MESSAGES.noProperty;
    const early = 'formula' in edit ? tooSoon(edit.formula) : null;
    if (early) return early;
    const misfit = prop ? editProblem(prop, edit) : null;
    if (misfit) return misfit;
  }
  return null;
}

/** Why this edit can't go on this property, or null. */
function editProblem(prop: Property, edit: ValueEdit): string | null {
  const t = prop.config.type;
  if (!isStoredType(t)) return VALUE_MESSAGES.readOnly;
  if ('formula' in edit) return t === 'files' || t === 'checklist' ? M.formulaTarget : null;
  if ('addNumber' in edit) {
    if (t !== 'number') return M.addNumber;
    return fitsNumberLimits(edit.addNumber) ? null : VALUE_MESSAGES.number;
  }
  if ('set' in edit) return setProblem(prop, edit.set);
  if (t !== 'multi_select' && t !== 'person' && t !== 'relation') return M.addRemove;
  return 'add' in edit ? setProblem(prop, edit.add) : null;
}

/** Why a set value can't go on this property (checked like a template preset), or null. */
function setProblem(prop: Property, raw: unknown): string | null {
  const t = prop.config.type;
  if (isDynamicDate(raw)) return t === 'date' ? null : TEMPLATE_MESSAGES.dynamicDate;
  const list: readonly unknown[] = Array.isArray(raw) ? raw : [];
  if (list.includes(ME) && t !== 'person') return TEMPLATE_MESSAGES.me;
  if (list.includes(THIS_PAGE) && t !== 'relation') return TEMPLATE_MESSAGES.thisPage;
  const bare = (t === 'person' && raw === ME) || (t === 'relation' && raw === THIS_PAGE);
  const result = validateValue(prop, bare ? [raw] : raw);
  return result.ok ? null : result.error;
}

/** Why a message can't go as set up: too many people, or a property that doesn't hold people. */
function messageProblem(
  to: { userIds: Id[]; propertyIds: Id[] },
  properties: readonly Property[],
): string | null {
  if (new Set(to.userIds).size > LIMITS.buttonMessagePeople) return M.tooManyPeople;
  for (const id of to.propertyIds) {
    const t = findProperty(properties, id)?.config.type;
    if (t === undefined) return TEMPLATE_MESSAGES.noProperty;
    if (t !== 'person' && t !== 'created_by' && t !== 'edited_by') return M.messageProperty;
  }
  return null;
}

// ---------------------------------------------------------------- planning a press

/** Why a press stops before anything runs; `forbidden` when the presser's access said no. */
class Stop extends Error {
  readonly step: number | null;
  readonly forbidden: boolean;
  constructor(step: number | null, message: string, forbidden = false) {
    super(message);
    this.step = step;
    this.forbidden = forbidden;
  }
}

/**
 * Plans one press of a Button property on a row, as the presser. First, for every step, what the
 * presser's own access allows: pressing it, editing this row, adding or editing rows there, and
 * seeing and changing each property a step sets, filters on, messages through or a formula or
 * variable reads. If anything isn't allowed, nothing runs and the reason is given ("You can't add
 * rows to Tickets."). Then each step is worked out in order on the rows as the earlier steps leave
 * them: values resolved (Today and Now plus days in the presser's time zone, Me, This page,
 * formulas, items added or removed, exact sums), rows matched (up to 500 to change; rows the
 * presser can't edit are skipped and counted), links and recipients checked. If that fails,
 * nothing runs either ("Couldn't finish step 2: Tickets is in Trash."). A confirmation not yet
 * continued past comes back first. The ready plan has the run log entry, with what Undo needs.
 */
export function planRun(button: Property<ButtonConfig>, row: Row, ctx: RunContext): RunPlan {
  const base: ButtonRun = {
    by: ctx.presser.userId,
    at: ctx.presser.now.toISOString(),
    outcome: 'done',
    failedStep: null,
    message: null,
    changes: [],
    skipped: 0,
    messaged: 0,
  };
  try {
    checkRights(button, row, ctx);
    return planSteps(button.config.actions, row, ctx, base);
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    const message = e.forbidden || e.step === null ? e.message : M.stepFailed(e.step, e.message);
    const run: ButtonRun = { ...base, outcome: 'failed', failedStep: e.step, message };
    return { status: 'refused', step: e.step, message, forbidden: e.forbidden, run };
  }
}

/** Pass one: what the presser's own access allows, for every step, before anything runs. */
function checkRights(button: Property<ButtonConfig>, row: Row, ctx: RunContext): void {
  const db = ctx.database;
  const level = ctx.rowAccess(db.id, row);
  if (!atLeast(level, 'view')) throw new Stop(null, M.noAccess, true);
  if (!ctx.canSeeProperty(db.id, button)) throw new Stop(null, M.hiddenProperty, true);
  if (!canPress(level, button.config.whoCanPress)) throw new Stop(null, M.cantPress, true);
  if (!button.config.actions.length) throw new Stop(null, M.noActions);
  for (const [i, a] of button.config.actions.entries()) {
    const step = i + 1;
    if (a.kind === 'set_values') {
      if (!atLeast(level, 'edit_content')) throw new Stop(step, M.cantEditRow, true);
      checkEdits(step, db, { ...asEdits(a.values), ...a.edits }, level, ctx);
    } else if (a.kind === 'add_row' || a.kind === 'edit_rows') {
      const target = findDatabase(a.databaseId, ctx);
      if (!target) continue; // planning says so
      const grant = databasePageAccess(target.access);
      if (grant === 'none') throw new Stop(step, M.noAccess, true);
      if (a.kind === 'add_row') {
        const canAddRows = target.canAddRows === true;
        if (!can('add_rows', target.access, { locked: false, canAddRows })) {
          throw new Stop(step, M.cantAddRows(target.title), true);
        }
      } else {
        const rows = target.rows ?? [];
        const editable = (r: Row) => atLeast(ctx.rowAccess(target.id, r), 'edit_content');
        if (!atLeast(grant, 'edit_content') && !rows.some(editable)) {
          throw new Stop(step, M.cantEditRows(target.title), true);
        }
        for (const id of filterIds(a.filter)) checkSee(step, target, id, ctx);
      }
      checkEdits(step, target, a.edits, 'edit_content', ctx);
    } else if (a.kind === 'send_message') {
      for (const id of a.to.propertyIds) checkSee(step, db, id, ctx);
    } else if (a.kind === 'define_variables') {
      for (const v of a.variables) checkReads(step, db, v.formula, ctx);
    }
  }
}

/** Each property a step sets must be one the presser can see and change; so must its formulas' reads. */
function checkEdits(
  step: number,
  db: ButtonDatabase,
  edits: Record<Id, ValueEdit>,
  level: AccessLevel,
  ctx: RunContext,
): void {
  for (const [id, edit] of Object.entries(edits)) {
    checkSee(step, db, id, ctx);
    const prop = findProperty(db.properties, id);
    if (prop && isStoredType(prop.config.type) && !ctx.canChangeProperty(db.id, prop, level)) {
      throw new Stop(step, M.cantChange(prop.name), true);
    }
    if ('formula' in edit) checkReads(step, db, edit.formula, ctx);
  }
}

/** Refuses when the property with this id, if the database has one, is hidden from the presser. */
function checkSee(step: number, db: ButtonDatabase, id: Id, ctx: RunContext): void {
  const prop = findProperty(db.properties, id);
  if (prop && !ctx.canSeeProperty(db.id, prop)) throw new Stop(step, M.hiddenProperty, true);
}

/** A formula may read only what the presser can see: here, in the button's database or a linked one. */
function checkReads(step: number, home: ButtonDatabase, formula: string, ctx: RunContext): void {
  const near = [home, ctx.database];
  const linked = near
    .flatMap((db) => db.properties)
    .flatMap((p) => (p.config.type === 'relation' ? [p.config.targetDatabaseId] : []));
  const dbs = [...near, ...linked.flatMap((id) => findDatabase(id, ctx) ?? [])];
  for (const id of ctx.formulaReads?.(formula) ?? formulaIds(formula)) {
    for (const db of dbs) checkSee(step, db, id, ctx);
  }
}

/** Pass two: works out each step in order, on the rows as the earlier steps leave them. */
function planSteps(
  actions: readonly ButtonAction[],
  row: Row,
  ctx: RunContext,
  base: ButtonRun,
): RunPlan {
  const { presser, database: db } = ctx;
  const rows = new Map<Id, Row>();
  const addedTo = new Map<Id, Row[]>();
  const current = (r: Row): Row => rows.get(r.id) ?? r;
  const vars: Record<Id, ComputedValue> = {
    [BUTTON_INPUTS.pressedBy]: { kind: 'person', value: presser.userId },
    [BUTTON_INPUTS.pressedAt]: {
      kind: 'date',
      value: { start: base.at, end: null, hasTime: true },
    },
    [BUTTON_INPUTS.thisRow]: { kind: 'page', value: row.id },
  };
  const steps: PlannedStep[] = [];
  let lastAdded: Id | null = null;
  let confirms = 0;
  let ask: ConfirmRun | null = null;

  /** Applies a step's edits to one row; its formulas read `source`. */
  const edit = (
    step: number,
    target: ButtonDatabase,
    r: Row,
    edits: Record<Id, ValueEdit>,
    source: Row,
    added: boolean,
  ): RowChange => {
    const env: EditEnv = {
      presser,
      thisRow: row.id,
      evaluate: (f) => ctx.evaluate(f, source, vars),
    };
    const change: RowChange = { databaseId: target.id, rowId: r.id, added, before: {}, after: {} };
    let next = r;
    for (const [id, e] of Object.entries(edits)) {
      const prop = findProperty(target.properties, id);
      if (!prop) throw new Stop(step, TEMPLATE_MESSAGES.noProperty);
      const old = readStored(next, prop);
      const result = resolveEdit(prop, e, old, env);
      if (!result.ok) throw new Stop(step, result.error);
      if (sameValue(old, result.value)) continue;
      next = writeStored(next, prop, result.value);
      if (prop.config.type === 'title') change.title = { before: r.title, after: next.title };
      else {
        change.before[id] = old;
        change.after[id] = result.value;
      }
    }
    rows.set(next.id, next);
    return change;
  };

  for (const [i, a] of actions.entries()) {
    const step = i + 1;
    switch (a.kind) {
      case 'set_values': {
        const here = current(row);
        const change = edit(step, db, here, { ...asEdits(a.values), ...a.edits }, here, false);
        steps.push({ step, kind: a.kind, changes: [change].filter(hasChanges) });
        break;
      }
      case 'add_row': {
        const target = openDatabase(step, a.databaseId, ctx);
        const id = ctx.newId?.() ?? newId();
        const { at, by } = base;
        const blank: Row = {
          ...{ id, title: '', values: {}, createdAt: at, createdBy: by },
          ...{ editedAt: at, editedBy: by, uniqueNumber: null },
        };
        const change = edit(step, target, blank, a.edits, current(row), true);
        addedTo.set(target.id, [...(addedTo.get(target.id) ?? []), blank]);
        lastAdded = id;
        const templateId = a.templateId ?? null;
        steps.push({ step, kind: a.kind, changes: [change], templateId, open: a.open ?? null });
        break;
      }
      case 'edit_rows': {
        const target = openDatabase(step, a.databaseId, ctx);
        const problem = validateFilter(a.filter, target.properties);
        if (problem) throw new Stop(step, problem);
        const filterCtx: EvalContext = {
          properties: target.properties,
          viewer: presser,
          userName: ctx.userName,
          ...(ctx.computed ? { computed: ctx.computed } : {}),
        };
        const test = filterPredicate(withThisPage(a.filter, row.id), filterCtx);
        const pool = [...(target.rows ?? []), ...(addedTo.get(target.id) ?? [])].map(current);
        const level = (r: Row) => ctx.rowAccess(target.id, r);
        const matches = pool.filter((r) => atLeast(level(r), 'view') && test(r));
        const editable = matches.filter((r) => atLeast(level(r), 'edit_content'));
        if (editable.length > LIMITS.buttonEditRows) throw new Stop(step, M.tooManyRows);
        const changes = editable.map((r) => edit(step, target, r, a.edits, r, false));
        const skipped = matches.length - editable.length;
        steps.push({ step, kind: a.kind, changes: changes.filter(hasChanges), skipped });
        break;
      }
      case 'open_page': {
        const pageId = a.pageId ?? lastAdded;
        if (pageId === null) throw new Stop(step, M.openAfterAdd);
        steps.push({ step, kind: a.kind, pageId, openIn: a.openIn });
        break;
      }
      case 'open_link':
        if (!isSafeWebLink(a.url)) throw new Stop(step, M.unsafeLink);
        steps.push({ step, kind: a.kind, url: a.url });
        break;
      case 'send_message': {
        const userIds = recipients(step, a.to, current(row), db);
        steps.push({ step, kind: a.kind, userIds, message: a.message });
        break;
      }
      case 'confirm':
        if (confirms++ >= (ctx.confirmed ?? 0)) {
          const { title, message, confirmLabel } = a;
          ask ??= { status: 'confirm', step, title, message, confirmLabel };
        }
        break;
      case 'define_variables':
        for (const v of a.variables) {
          const value = ctx.evaluate(v.formula, current(row), vars);
          if (value.kind === 'error') throw new Stop(step, value.message);
          vars[v.id] = value;
        }
        break;
    }
  }
  if (ask) return ask;
  const run = summarize(base, steps);
  return { status: 'ready', steps, run, undoUntil: undoUntil(run) };
}

/** The database a step names, if it exists and isn't in Trash. */
function openDatabase(step: number, id: Id, ctx: RunContext): ButtonDatabase {
  const db = findDatabase(id, ctx);
  if (!db) throw new Stop(step, M.noDatabase);
  if (db.inTrash) throw new Stop(step, M.inTrash(db.title));
  return db;
}

/** Everyone a message goes to: the people named, plus the people in those properties of the row. */
function recipients(
  step: number,
  to: { userIds: Id[]; propertyIds: Id[] },
  row: Row,
  db: ButtonDatabase,
): Id[] {
  const people = new Set(to.userIds);
  for (const id of to.propertyIds) {
    const t = findProperty(db.properties, id)?.config.type;
    if (t === undefined) throw new Stop(step, TEMPLATE_MESSAGES.noProperty);
    if (t === 'created_by' && row.createdBy) people.add(row.createdBy);
    else if (t === 'edited_by' && row.editedBy) people.add(row.editedBy);
    else if (t === 'person') {
      const ids: unknown = row.values[id];
      if (Array.isArray(ids)) for (const x of ids) if (typeof x === 'string') people.add(x);
    } else if (t !== 'created_by' && t !== 'edited_by') throw new Stop(step, M.messageProperty);
  }
  if (people.size > LIMITS.buttonMessagePeople) throw new Stop(step, M.tooManyRecipients);
  return [...people];
}

// ---------------------------------------------------------------- resolving values

/** What resolving a value needs: the presser, the button's row (This page) and the formulas. */
interface EditEnv {
  presser: Pick<Viewer, 'userId' | 'timeZone' | 'now'>;
  thisRow: Id;
  evaluate(formula: string): ComputedValue;
}

const fail = (error: string): ValueResult => ({ ok: false, error });

/** One ValueEdit as the stored value it leaves (checked the way a cell is); `old` is the value now. */
function resolveEdit(prop: Property, edit: ValueEdit, old: unknown, env: EditEnv): ValueResult {
  const c = prop.config;
  if ('set' in edit) return resolveSet(prop, edit.set, env);
  if ('formula' in edit) {
    if (c.type === 'files' || c.type === 'checklist') return fail(M.formulaTarget);
    const value = env.evaluate(edit.formula);
    return value.kind === 'error' ? fail(value.message) : fromComputed(prop, value);
  }
  if ('addNumber' in edit) {
    if (c.type !== 'number') return fail(M.addNumber);
    const start = isCanonicalDecimal(old) ? old : '0';
    const sum = fitsNumberLimits(edit.addNumber) ? addDecimal(start, edit.addNumber) : '';
    return fitsNumberLimits(sum) ? { ok: true, value: sum } : fail(VALUE_MESSAGES.number);
  }
  if (c.type !== 'multi_select' && c.type !== 'person' && c.type !== 'relation') {
    return fail(M.addRemove);
  }
  const have: readonly unknown[] = Array.isArray(old) ? old : [];
  if ('add' in edit) {
    const ids = swapIds(c.type, edit.add, env);
    return validateValue(prop, c.type !== 'multi_select' && c.single ? ids : [...have, ...ids]);
  }
  const drop = new Set(swapIds(c.type, edit.remove, env));
  return validateValue(
    prop,
    have.filter((id) => !drop.has(id)),
  );
}

/** A set value: Today or Now (plus days) in the presser's time zone, Me, This page, or a stored value. */
function resolveSet(prop: Property, value: unknown, env: EditEnv): ValueResult {
  const t = prop.config.type;
  if (isDynamicDate(value)) {
    if (t !== 'date') return fail(TEMPLATE_MESSAGES.dynamicDate);
    return validateValue(prop, resolveDynamicDate(value, env.presser));
  }
  const bare = (t === 'person' && value === ME) || (t === 'relation' && value === THIS_PAGE);
  const list: readonly unknown[] | null = bare ? [value] : Array.isArray(value) ? value : null;
  return validateValue(prop, list ? swapIds(t, list, env) : value);
}

/** Me in a Person list becomes the presser; This page in a Relation list, the button's row. */
function swapIds(t: PropertyType, list: readonly unknown[], env: EditEnv): unknown[] {
  return list.map((id) => {
    if (t === 'person' && id === ME) return env.presser.userId;
    return t === 'relation' && id === THIS_PAGE ? env.thisRow : id;
  });
}

/** A formula's result as this property's stored value (options by name), checked like a typed value. */
function fromComputed(prop: Property, value: ComputedValue): ValueResult {
  const t = prop.config.type;
  const many = t === 'multi_select' || t === 'person' || t === 'relation';
  const items = value.kind === 'list' ? value.value : value.kind === 'empty' ? [] : [value];
  const pieces = items.map((item) => storedPiece(prop.config, item));
  if (pieces.includes(undefined) || (!many && pieces.length > 1))
    return fail(VALUE_MESSAGES.invalid);
  return validateValue(prop, many ? pieces : (pieces[0] ?? null));
}

/** One computed value as (a piece of) what this property stores, or undefined when it doesn't fit. */
function storedPiece(c: PropertyConfig, v: ComputedValue): unknown {
  switch (c.type) {
    case 'select':
    case 'status':
    case 'multi_select':
      return v.kind === 'text' ? findOptionByName<SelectOption>(c.options, v.value)?.id : undefined;
    case 'person':
      return v.kind === 'person' ? v.value : undefined;
    case 'relation':
      return v.kind === 'page' ? v.value : undefined;
    case 'date':
      return v.kind === 'date' ? v.value : undefined;
    case 'checkbox':
      return v.kind === 'boolean' ? v.value : undefined;
    case 'number':
      return v.kind === 'number' ? v.value : undefined;
    default:
      if (v.kind === 'text' || v.kind === 'number' || v.kind === 'boolean') return String(v.value);
      return undefined;
  }
}

// ---------------------------------------------------------------- the run log and Undo

/**
 * The run as it ends when the server couldn't carry out step `step` of a ready plan (a write
 * failed): later steps don't run, earlier steps' changes stay (Undo still works for them), and the
 * message names the step and why ("Couldn't finish step 2: Tickets is in Trash.").
 */
export function failRun(plan: ReadyRun, step: number, reason: string): ReadyRun {
  const steps = plan.steps.filter((s) => s.step < step);
  const message = M.stepFailed(step, reason);
  const run = summarize({ ...plan.run, outcome: 'failed', failedStep: step, message }, steps);
  return { status: 'ready', steps, run, undoUntil: undoUntil(run) };
}

/** A button's run log with this run added: newest first, the latest 50 kept. */
export function appendRun(log: readonly ButtonRun[], run: ButtonRun): ButtonRun[] {
  return [run, ...log].slice(0, LIMITS.buttonRunLog);
}

/**
 * What shows after a run besides the ✓: the failure message; "Done · Undo" when it changed
 * something ("Done · 3 skipped · Undo" when "Edit rows" skipped some); "3 skipped" when it only
 * skipped; otherwise null.
 */
export function runToast(run: ButtonRun): string | null {
  if (run.outcome === 'failed') return run.message;
  const skipped = run.skipped ? [M.skipped(run.skipped)] : [];
  if (!run.changes.length) return skipped[0] ?? null;
  return [M.done, ...skipped, M.undo].join(' · ');
}

/**
 * What Undo does for a run, within 8 seconds of it (null after that, or when it changed nothing):
 * put back each value nobody has changed since, and move the rows it added to Trash unless someone
 * changed them since. `current` reads a row as it is now (null when it's gone). The note says sent
 * messages can't be unsent.
 */
export function planUndo(
  run: ButtonRun,
  current: (databaseId: Id, rowId: Id) => Row | null,
  now: Date,
): UndoPlan | null {
  if (!run.changes.length || now.getTime() > Date.parse(run.at) + LIMITS.undoToastMs) return null;
  const undo: UndoPlan = { writes: [], trash: [], kept: 0, note: run.messaged ? M.unsent : null };
  for (const c of run.changes) {
    const row = current(c.databaseId, c.rowId);
    if (!row) continue;
    const ids = Object.keys(c.after);
    const same = ids.filter((id) => sameValue(row.values[id], c.after[id]));
    const titleSame = c.title !== undefined && row.title === c.title.after;
    const titleKept = c.title !== undefined && !titleSame;
    const where = { databaseId: c.databaseId, rowId: c.rowId };
    if (c.added) {
      if (same.length === ids.length && !titleKept) undo.trash.push(where);
      else undo.kept += 1;
      continue;
    }
    undo.kept += ids.length - same.length + (titleKept ? 1 : 0);
    const values = Object.fromEntries(same.map((id) => [id, c.before[id] ?? null]));
    const title = titleSame && c.title ? { title: c.title.before } : {};
    if (same.length || titleSame) undo.writes.push({ ...where, values, ...title });
  }
  return undo;
}

/** The run log entry for these steps: changes merged per row (first before, last after). */
function summarize(base: ButtonRun, steps: readonly PlannedStep[]): ButtonRun {
  const byRow = new Map<Id, RowChange>();
  const people = new Set<Id>();
  let skipped = 0;
  for (const s of steps) {
    if (s.kind === 'send_message') for (const id of s.userIds) people.add(id);
    if (s.kind === 'edit_rows') skipped += s.skipped;
    for (const c of 'changes' in s ? s.changes : []) {
      const m = byRow.get(c.rowId);
      if (!m) byRow.set(c.rowId, { ...c, before: { ...c.before }, after: { ...c.after } });
      else {
        m.before = { ...c.before, ...m.before };
        Object.assign(m.after, c.after);
        if (c.title) m.title = { before: m.title?.before ?? c.title.before, after: c.title.after };
      }
    }
  }
  return { ...base, changes: [...byRow.values()], skipped, messaged: people.size };
}

const undoUntil = (run: ButtonRun): Instant | null =>
  run.changes.length ? new Date(Date.parse(run.at) + LIMITS.undoToastMs).toISOString() : null;

// ---------------------------------------------------------------- small helpers

const asEdits = (values: Record<Id, unknown>): Record<Id, ValueEdit> =>
  Object.fromEntries(Object.entries(values).map(([id, set]) => [id, { set }]));

const hasChanges = (c: RowChange): boolean =>
  c.added || c.title !== undefined || Object.keys(c.after).length > 0;

const findDatabase = (id: Id, ctx: RunContext): ButtonDatabase | null =>
  id === ctx.database.id ? ctx.database : ctx.databaseById(id);

/** A row's stored value for a property (the Name is the title); null when empty. */
const readStored = (row: Row, prop: Property): unknown =>
  prop.config.type === 'title' ? row.title || null : (row.values[prop.id] ?? null);

const writeStored = (row: Row, prop: Property, value: unknown): Row =>
  prop.config.type === 'title'
    ? { ...row, title: typeof value === 'string' ? value : '' }
    : { ...row, values: { ...row.values, [prop.id]: value } };

/** Stored values compared deeply, ignoring key order (jsonb reorders keys); absent equals null. */
function sameValue(a: unknown, b: unknown): boolean {
  if ((a ?? null) === (b ?? null)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((k) => sameValue(x[k], y[k]));
}

const PROP_REF = /prop\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g;

/** Every id a formula reads with prop("<id>"): properties, variables and inputs. */
const formulaIds = (formula: string): Id[] =>
  [...formula.matchAll(PROP_REF)].map((m) => m[1] ?? '');

/** The property ids a filter uses, at any depth. */
const filterIds = (node: FilterNode | null): Id[] =>
  !node ? [] : node.kind === 'group' ? node.children.flatMap(filterIds) : [node.propertyId];

/** The filter with This page in its conditions swapped for the button's row. */
function withThisPage(filter: FilterGroup | null, rowId: Id): FilterGroup | null {
  const swap = (n: FilterNode): FilterNode => {
    if (n.kind === 'group') return { ...n, children: n.children.map(swap) };
    if (!Array.isArray(n.value)) return n;
    return { ...n, value: (n.value as readonly Id[]).map((v) => (v === THIS_PAGE ? rowId : v)) };
  };
  return filter && { ...filter, children: filter.children.map(swap) };
}
