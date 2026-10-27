// Databases other features set up (decision 0200: createDatabase and duplicateDatabase in api.ts):
// a definition, or a copy of a database, checked the way the routes check each part and turned
// into what create.ts saves. Pure: create.ts checks access, makes the ids, loads the databases
// these read and writes the pages and rows.
import { isDeepStrictEqual } from 'node:util';
import {
  LIMITS,
  ME,
  THIS_PAGE,
  findProperty,
  titleProperty,
  type ButtonAction,
  type Id,
  type Property,
  type RepeatSchedule,
  type RichText,
  type Row,
  type RowAccessRule,
  type RowPageLayout,
  type RowTemplate,
  type View,
  type ViewLayout,
} from '@carehub/databases';
import {
  iconSchema,
  idSchema,
  lineSchema,
  propertySchema,
  richTextSchema,
  rowAccessRulesSchema,
  rowPageLayoutSchema,
  rowTemplateSchema,
  valuesSchema,
  viewSchema,
} from '@carehub/databases/schemas';
import { validateValue } from '@carehub/databases/values';
import { z } from 'zod';
import { planAccessRules } from './access-rules';
import { DATABASE_MESSAGES, invalid, invalidRequest } from './errors';
import {
  PROPERTY_MESSAGES,
  checkedConfig,
  nameTaken,
  relationPair,
  type RelatedDatabases,
} from './properties';
import type { DatabaseRecord, DatabaseSettings } from './record';
import { pageIdSchema, viewChangeRequest } from './requests';
import { planNewTemplate } from './templates';
import {
  formCopiedBy,
  hasOpenFormAccess,
  planEditView,
  planNewView,
  type ViewEditor,
  type ViewPatch,
} from './views';

/** In a definition: a relation, or a button step, that points at the database being made. */
export const THIS_DATABASE = 'this_database';

/** Sample rows a definition can bring. */
export const DEFINITION_ROWS = 100;

/** Messages, word for word (for the developers who write definitions). */
export const DEFINITION_MESSAGES = {
  invalidAt: (path: readonly (string | number)[]) =>
    `That database definition isn't valid (at ${path.join('.') || 'the top'}).`,
  twoWay: 'A two-way relation in a definition pairs two properties of the new database.',
  copyHidden: "Some of this database's properties are hidden from you, so it can't be copied.",
} as const;

/** A view: its layout's defaults, then any settings PATCH /:id/views/:vid takes, checked the same way. */
export interface DefinitionView {
  layout: Exclude<ViewLayout, 'dashboard'>;
  /** Absent: the layout's name, numbered when taken ("Board 2"). */
  name?: string;
  /**
   * A form's settings are a whole FormDefinition (the package's defaultForm is a good start); its
   * link code is replaced. `defaultTemplateId` may name a template by its key.
   */
  settings?: Omit<ViewPatch, 'manualOrder'>;
}

/** A row template; its id (its page's) is new. */
export interface DefinitionTemplate {
  /** How the definition's `defaultTemplate` and views' `defaultTemplateId` name it. */
  key?: string;
  /** Absent: "New template", numbered when taken. */
  name?: string;
  icon?: string | null;
  /** Presets by property id, checked like cells (Today, Now, Me and This page work too). */
  values?: Partial<Record<Id, unknown>>;
  /** Runs as `by`. */
  repeat?: RepeatSchedule | null;
}

/** A sample row. */
export interface DefinitionRow {
  title: string;
  icon?: string | null;
  /** By property id, checked like cells; ME in a Person value is `by`. */
  values?: Partial<Record<Id, unknown>>;
}

/**
 * A new database for createDatabase, as a starter template or another feature sets it up. Property
 * ids are the definition's own and are kept (each once); relations point at THIS_DATABASE or at a
 * database `by` can open (one-way), and two-way relations pair two of its own properties; a
 * button's "Add a row" step on THIS_DATABASE names its template by key. Lock,
 * wiki, row access rules, property access and forms open to guests, anyone or anonymous answers
 * take Full access on the parent page.
 */
export interface DatabaseDefinition {
  /** The page it goes under: `by` needs Can edit there, and it can't be a database. */
  parentId: string;
  /** Shown inside the parent page by a database block (true) or its own page (false, the default). */
  inline?: boolean;
  title: string;
  /** An emoji. */
  icon?: string | null;
  description?: RichText;
  /** Exactly one Name (title) property. */
  properties: Property[];
  /** In tab order; absent or empty: one Table view. */
  views?: DefinitionView[];
  templates?: DefinitionTemplate[];
  /** The key of the database's default template. */
  defaultTemplate?: string | null;
  accessRules?: RowAccessRule[];
  rowPageLayout?: RowPageLayout | null;
  /** Adds the "Parent item" and "Sub-items" relations. */
  subItems?: boolean;
  /** Adds the "Blocked by" and "Blocking" relations. */
  dependencies?: { shift: 'shift' | 'none' } | null;
  /** A Knowledge base wiki. */
  wiki?: boolean;
  locked?: boolean;
  /** Up to DEFINITION_ROWS sample rows, oldest first. */
  rows?: DefinitionRow[];
  /** The person making it: their access is checked, and the pages and rows are theirs. */
  by: string;
}

const definitionViewSchema = z.strictObject({
  layout: viewSchema.shape.layout.exclude(['dashboard']),
  name: viewSchema.shape.name.optional(),
  settings: viewChangeRequest.omit({ version: true }).optional(),
});

const template = rowTemplateSchema.shape;

const definitionTemplateSchema = z.strictObject({
  key: idSchema.optional(),
  name: template.name.optional(),
  icon: template.icon.optional(),
  values: template.values.optional(),
  repeat: template.repeat,
});

const definitionRowSchema = z.strictObject({
  title: lineSchema(LIMITS.title),
  icon: iconSchema.nullable().optional(),
  values: valuesSchema.optional(),
});

/** What createDatabase checks a definition against before anything else. */
export const databaseDefinitionSchema = z.strictObject({
  parentId: pageIdSchema,
  inline: z.boolean().optional(),
  title: lineSchema(LIMITS.title),
  icon: iconSchema.nullable().optional(),
  description: richTextSchema().optional(),
  properties: z.array(propertySchema).min(1).max(LIMITS.properties),
  views: z.array(definitionViewSchema).max(LIMITS.views).optional(),
  templates: z.array(definitionTemplateSchema).max(LIMITS.templates).optional(),
  defaultTemplate: idSchema.nullable().optional(),
  accessRules: rowAccessRulesSchema.optional(),
  rowPageLayout: rowPageLayoutSchema.nullable().optional(),
  subItems: z.boolean().optional(),
  dependencies: z
    .strictObject({ shift: z.enum(['shift', 'none']) })
    .nullable()
    .optional(),
  wiki: z.boolean().optional(),
  locked: z.boolean().optional(),
  rows: z.array(definitionRowSchema).max(DEFINITION_ROWS).optional(),
  by: pageIdSchema,
});
export type CheckedDefinition = z.output<typeof databaseDefinitionSchema>;

/** A definition for the top of a space (the seed's): no parent page, so never inline. */
export type TopLevelDefinition = Omit<DatabaseDefinition, 'parentId' | 'inline'>;
export const topLevelDefinitionSchema = databaseDefinitionSchema.omit({
  parentId: true,
  inline: true,
});

/** What planDefinition reads: the database itself (where it goes is create.ts's business). */
export type PlannedDefinition = Omit<CheckedDefinition, 'parentId' | 'inline'>;
type CheckedView = NonNullable<PlannedDefinition['views']>[number];

/** What duplicateDatabase takes. */
export interface DuplicateInput {
  databaseId: string;
  /** The page the copy goes under: `by` needs Can edit there. */
  parentId: string;
  /** Copy the rows `by` can open too: titles, icons, covers and values (page content comes later). */
  includeRows: boolean;
  /** The person copying: they need to see the database and every property. */
  by: string;
  /** Absent: the original's title. */
  title?: string;
  /** Absent: as the original. */
  inline?: boolean;
}

export const duplicateInputSchema = z.strictObject({
  databaseId: pageIdSchema,
  parentId: pageIdSchema,
  includeRows: z.boolean(),
  by: pageIdSchema,
  title: lineSchema(LIMITS.title).optional(),
  inline: z.boolean().optional(),
});

/** A row to write: its page and its db_rows entry. */
export interface PlannedRow {
  id: Id;
  /** The row this one copies, for its page's icon and cover. */
  sourceId: Id | null;
  title: string;
  /** An emoji (a copy takes the original page's icon instead). */
  icon: string | null;
  values: Partial<Record<Id, unknown>>;
  uniqueNumber: number | null;
  formViewId: Id | null;
}

/** What create.ts writes for a new database. */
export interface DatabasePlan {
  settings: DatabaseSettings;
  nextUniqueNumber: number;
  /** Each template's page: its id and title (the Name preset). */
  templatePages: { id: Id; title: string }[];
  rows: PlannedRow[];
  /** Some of it takes Full access: lock, wiki, row rules, property access or an open form. */
  needsFull: boolean;
}

export interface DefinitionContext {
  /** The new database page's id. */
  databaseId: Id;
  workspaceId: string;
  spaceId: string;
  /** Page ids for the definition's templates and rows, in order. */
  templateIds: readonly Id[];
  rowIds: readonly Id[];
  /** A new form link code. */
  linkCode: () => string;
  /** The databases its relations and buttons point at, and the ones those relate to. */
  related: RelatedDatabases;
  /** Whether `by` can change this property's values (a form question needs it). */
  canChange: (prop: Property) => boolean;
}

const none: ReadonlySet<Id> = new Set();

function blankRecord(def: PlannedDefinition, ctx: DefinitionContext): DatabaseRecord {
  const at = new Date(0);
  return {
    id: ctx.databaseId,
    workspaceId: ctx.workspaceId,
    spaceId: ctx.spaceId,
    parentId: null,
    title: def.title,
    pageIcon: null,
    inline: false,
    inTrash: false,
    description: [],
    properties: [],
    views: [],
    templates: [],
    accessRules: [],
    defaultTemplateId: null,
    locked: false,
    wiki: false,
    rowPageLayout: null,
    subItems: null,
    dependencies: null,
    deletedProperties: [],
    version: 1,
    nextUniqueNumber: 1,
    createdAt: at,
    updatedAt: at,
  };
}

/** The template a definition's key names. */
function keyed(keys: ReadonlyMap<string, Id>, key: string): Id {
  const id = keys.get(key);
  if (id === undefined) throw invalidRequest();
  return id;
}

/** The definition's template keys → their page ids (each key once). */
function templateKeys(def: PlannedDefinition, ctx: DefinitionContext): Map<string, Id> {
  const keys = new Map<string, Id>();
  (def.templates ?? []).forEach((t, i) => {
    const id = ctx.templateIds[i];
    if (id === undefined) throw new Error('Each template needs a page id.');
    if (t.key === undefined) return;
    if (keys.has(t.key)) throw invalidRequest();
    keys.set(t.key, id);
  });
  return keys;
}

/**
 * THIS_DATABASE in a relation or a button step, as the new database's id. An "Add a row" step
 * there names its template by key.
 */
function pointedHere(prop: Property, databaseId: Id, keys: ReadonlyMap<string, Id>): Property {
  const here = (id: Id) => (id === THIS_DATABASE ? databaseId : id);
  const config = prop.config;
  if (config.type === 'relation') {
    return { ...prop, config: { ...config, targetDatabaseId: here(config.targetDatabaseId) } };
  }
  if (config.type !== 'button') return prop;
  const actions = config.actions.map((action): ButtonAction => {
    if (action.kind === 'edit_rows') return { ...action, databaseId: here(action.databaseId) };
    if (action.kind !== 'add_row' || action.databaseId !== THIS_DATABASE) return action;
    const step = { ...action, databaseId };
    if (typeof action.templateId === 'string') step.templateId = keyed(keys, action.templateId);
    return step;
  });
  return { ...prop, config: { ...config, actions } };
}

/** A two-way relation pairs two relations of the new database that point at each other. */
function checkPair(prop: Property, properties: readonly Property[], databaseId: Id): void {
  const config = prop.config;
  if (config.type !== 'relation' || config.twoWayPropertyId === null) return;
  const twin = findProperty(properties, config.twoWayPropertyId);
  const back = twin?.config;
  const paired =
    config.targetDatabaseId === databaseId &&
    twin !== undefined &&
    twin.id !== prop.id &&
    back?.type === 'relation' &&
    back.targetDatabaseId === databaseId &&
    back.twoWayPropertyId === prop.id;
  if (!paired) throw invalid(DEFINITION_MESSAGES.twoWay);
}

type OwnProperties = Pick<DatabaseSettings, 'properties' | 'subItems' | 'dependencies'>;

/**
 * The definition's properties: one Name, names no other property has, two-way pairs inside the
 * new database, sub-items and dependencies, and settings checkedConfig passes. A formula that
 * reads another needs that one's result kind first, so the settings are checked in rounds until
 * nothing changes; a property that still fails then is refused.
 */
function definedProperties(
  def: PlannedDefinition,
  ctx: DefinitionContext,
  keys: ReadonlyMap<string, Id>,
): OwnProperties {
  let properties = def.properties.map((p) => pointedHere(p, ctx.databaseId, keys));
  if (properties.filter((p) => p.config.type === 'title').length !== 1) {
    throw invalid(PROPERTY_MESSAGES.oneName);
  }
  if (new Set(properties.map((p) => p.id)).size !== properties.length) throw invalidRequest();
  properties.forEach((p, i) => {
    if (nameTaken(properties.slice(0, i), p.name)) throw invalid(PROPERTY_MESSAGES.nameTaken);
  });
  for (const p of properties) checkPair(p, properties, ctx.databaseId);
  let subItems: DatabaseSettings['subItems'] = null;
  if (def.subItems) {
    const names = ['Parent item', 'Sub-items'] as const;
    const [parent, children] = relationPair(ctx.databaseId, properties, names, true);
    properties = [...properties, parent, children];
    subItems = { parentPropertyId: parent.id, childrenPropertyId: children.id };
  }
  let dependencies: DatabaseSettings['dependencies'] = null;
  if (def.dependencies) {
    const names = ['Blocked by', 'Blocking'] as const;
    const [blockedBy, blocking] = relationPair(ctx.databaseId, properties, names, false);
    properties = [...properties, blockedBy, blocking];
    dependencies = {
      blockedByPropertyId: blockedBy.id,
      blockingPropertyId: blocking.id,
      shift: def.dependencies.shift,
    };
  }
  if (properties.length > LIMITS.properties) throw invalid(DATABASE_MESSAGES.tooManyProperties);
  let failure: unknown = null;
  for (let round = 0; round <= LIMITS.computedChain + 1; round++) {
    const own = { id: ctx.databaseId, properties };
    failure = null;
    const next = properties.map((p) => {
      try {
        return { ...p, config: checkedConfig(p, own, ctx.related) };
      } catch (error) {
        failure ??= error;
        return p;
      }
    });
    const settled = next.every((p, i) => isDeepStrictEqual(p.config, properties[i]?.config));
    properties = next;
    if (settled) break;
  }
  if (failure !== null) throw failure;
  return { properties, subItems, dependencies };
}

/** The definition's templates, each checked like POST /:id/templates. */
function definedTemplates(
  record: DatabaseRecord,
  def: PlannedDefinition,
  ctx: DefinitionContext,
): RowTemplate[] {
  let current = record;
  (def.templates ?? []).forEach((t, i) => {
    const id = ctx.templateIds[i];
    if (id === undefined) throw new Error('Each template needs a page id.');
    const input = { name: t.name, icon: t.icon, values: t.values, repeat: t.repeat };
    const plan = planNewTemplate(current, id, input, { userId: def.by, hidden: none });
    current = { ...current, templates: plan.templates };
  });
  return current.templates;
}

/** The definition's views, made like POST /:id/views and set up like PATCH /:id/views/:vid. */
function definedViews(
  record: DatabaseRecord,
  def: PlannedDefinition,
  ctx: DefinitionContext,
  keys: ReadonlyMap<string, Id>,
): { views: View[]; needsFull: boolean } {
  let current = record;
  let needsFull = false;
  const editor: ViewEditor = {
    userId: def.by,
    hidden: none,
    canChange: (id) => {
      const prop = findProperty(record.properties, id);
      return prop !== undefined && ctx.canChange(prop);
    },
  };
  const list: CheckedView[] = def.views && def.views.length > 0 ? def.views : [{ layout: 'table' }];
  for (const v of list) {
    const linkCode = v.layout === 'form' ? ctx.linkCode() : undefined;
    const made = planNewView(current, { layout: v.layout, name: v.name, linkCode }, editor);
    current = { ...current, views: made.views };
    const patch = Object.fromEntries(
      Object.entries(v.settings ?? {}).filter(([, value]) => value !== undefined),
    ) as ViewPatch;
    if (typeof patch.defaultTemplateId === 'string') {
      patch.defaultTemplateId = keyed(keys, patch.defaultTemplateId);
    }
    if (Object.keys(patch).length === 0) continue;
    const plan = planEditView(current, made.view.id, patch, editor);
    current = { ...current, views: plan.views };
    if (plan.formAccess || plan.formResponses || hasOpenFormAccess(plan.view)) needsFull = true;
  }
  return { views: current.views, needsFull };
}

/** The sample rows: values checked like cells, ME as `by`, ID numbers when there's an ID. */
function definedRows(
  record: DatabaseRecord,
  def: PlannedDefinition,
  ctx: DefinitionContext,
): PlannedRow[] {
  const numbered = record.properties.some((p) => p.config.type === 'unique_id');
  return (def.rows ?? []).map((row, i): PlannedRow => {
    const id = ctx.rowIds[i];
    if (id === undefined) throw new Error('Each row needs a page id.');
    const values: Partial<Record<Id, unknown>> = {};
    for (const [propertyId, raw] of Object.entries(row.values ?? {})) {
      const prop = findProperty(record.properties, propertyId);
      if (!prop || prop.config.type === 'title') throw invalidRequest();
      const sent =
        prop.config.type === 'person' && Array.isArray(raw)
          ? raw.map((each: unknown) => (each === ME ? def.by : each))
          : raw;
      const result = validateValue(prop, sent);
      if (!result.ok) throw invalid(result.error);
      if (result.newOptions?.length) throw invalidRequest();
      if (result.value !== null) values[propertyId] = result.value;
    }
    return {
      id,
      sourceId: null,
      title: row.title,
      icon: row.icon ?? null,
      values,
      uniqueNumber: numbered ? i + 1 : null,
      formViewId: null,
    };
  });
}

/** A template page's title: the template's Name preset, or none. */
function presetTitle(properties: readonly Property[], template: RowTemplate): string {
  const value = template.values[titleProperty(properties).id];
  return typeof value === 'string' ? value : '';
}

const pagesFor = (properties: readonly Property[], templates: readonly RowTemplate[]) =>
  templates.map((t) => ({ id: t.id, title: presetTitle(properties, t) }));

/** The highest ID number the rows have, plus one (1 without any). */
const nextNumber = (rows: readonly PlannedRow[]): number =>
  rows.reduce((top, row) => Math.max(top, row.uniqueNumber ?? 0), 0) + 1;

/**
 * A new database from a checked definition, each part checked like the route that changes it:
 * properties, then templates, views (whose defaults may name templates), row access rules, the
 * row page layout and the sample rows.
 */
export function planDefinition(def: PlannedDefinition, ctx: DefinitionContext): DatabasePlan {
  const keys = templateKeys(def, ctx);
  let record: DatabaseRecord = { ...blankRecord(def, ctx), ...definedProperties(def, ctx, keys) };
  record = { ...record, templates: definedTemplates(record, def, ctx) };
  const views = definedViews(record, def, ctx, keys);
  record = { ...record, views: views.views };
  const accessRules = def.accessRules?.length ? planAccessRules(record, def.accessRules, none) : [];
  const layout = def.rowPageLayout ?? null;
  if (layout && !layout.pinned.every((id) => findProperty(record.properties, id))) {
    throw invalidRequest();
  }
  const defaultTemplateId =
    def.defaultTemplate === undefined || def.defaultTemplate === null
      ? null
      : keyed(keys, def.defaultTemplate);
  const rows = definedRows(record, def, ctx);
  const needsFull =
    views.needsFull ||
    accessRules.length > 0 ||
    def.wiki === true ||
    def.locked === true ||
    record.properties.some((p) => p.access !== undefined);
  return {
    settings: {
      description: def.description ?? [],
      properties: record.properties,
      views: record.views,
      templates: record.templates,
      accessRules,
      defaultTemplateId,
      locked: def.locked ?? false,
      wiki: def.wiki ?? false,
      rowPageLayout: layout,
      subItems: record.subItems,
      dependencies: record.dependencies,
      deletedProperties: [],
    },
    nextUniqueNumber: nextNumber(rows),
    templatePages: pagesFor(record.properties, record.templates),
    rows,
    needsFull,
  };
}

export interface CopyContext {
  /** The copy's page id. */
  databaseId: Id;
  /** Original template id → the copy's (its page id). */
  templateIds: ReadonlyMap<Id, Id>;
  /** The rows to copy (ones the person can open), oldest first. */
  rows: readonly Row[];
  /** Original row id → the copy's. */
  rowIds: ReadonlyMap<Id, Id>;
  /** A new form link code. */
  linkCode: () => string;
  /** The person copying: repeating templates run as them. */
  by: Id;
}

/** A button step of the original, pointing at the copy where it pointed at the original. */
function copiedAction(action: ButtonAction, sourceId: Id, ctx: CopyContext): ButtonAction {
  switch (action.kind) {
    case 'add_row': {
      if (action.databaseId !== sourceId) return action;
      const copy = { ...action, databaseId: ctx.databaseId };
      if (typeof action.templateId === 'string') {
        copy.templateId = ctx.templateIds.get(action.templateId) ?? null;
      }
      return copy;
    }
    case 'edit_rows':
      return action.databaseId === sourceId ? { ...action, databaseId: ctx.databaseId } : action;
    case 'open_page': {
      const row = action.pageId === null ? undefined : ctx.rowIds.get(action.pageId);
      return row ? { ...action, pageId: row } : action;
    }
    default:
      return action;
  }
}

/**
 * A property of the copy: relations to the original point at the copy (a two-way pair stays one),
 * two-way relations to other databases become one-way (those databases don't change), and button
 * steps on the original act on the copy.
 */
function copiedProperty(prop: Property, sourceId: Id, ctx: CopyContext): Property {
  const config = prop.config;
  if (config.type === 'relation') {
    if (config.targetDatabaseId === sourceId) {
      return { ...prop, config: { ...config, targetDatabaseId: ctx.databaseId } };
    }
    return config.twoWayPropertyId === null
      ? prop
      : { ...prop, config: { ...config, twoWayPropertyId: null } };
  }
  if (config.type !== 'button') return prop;
  const actions = config.actions.map((action) => copiedAction(action, sourceId, ctx));
  return { ...prop, config: { ...config, actions } };
}

/**
 * A copy of a database the person can see whole: the same properties, options, views and rules
 * (their ids kept), new template pages and form links, and the rows given. Links between the
 * original's rows point at their copies (links to rows left out are dropped); forms notify no one
 * until people ask, and their questions are the person copying's; repeating templates run as
 * them. Deleted properties, sharing and page content aren't copied.
 */
export function planCopy(source: DatabaseRecord, ctx: CopyContext): DatabasePlan {
  const selfLinks = new Set(
    source.properties
      .filter((p) => p.config.type === 'relation' && p.config.targetDatabaseId === source.id)
      .map((p) => p.id),
  );
  /** A link list with the copies of the rows (and This page); null when none are left. */
  const relinked = (value: unknown): unknown => {
    if (!Array.isArray(value)) return null;
    const ids = value.flatMap((id: unknown) => {
      if (id === THIS_PAGE) return [id];
      const copy = typeof id === 'string' ? ctx.rowIds.get(id) : undefined;
      return copy ? [copy] : [];
    });
    return ids.length > 0 ? ids : null;
  };
  const copiedValues = (values: Partial<Record<Id, unknown>>): Partial<Record<Id, unknown>> => {
    const out: Partial<Record<Id, unknown>> = {};
    for (const [id, value] of Object.entries(values)) {
      const kept = selfLinks.has(id) ? relinked(value) : value;
      if (kept !== null && kept !== undefined) out[id] = kept;
    }
    return out;
  };
  const templateOf = (id: Id): Id => {
    const copy = ctx.templateIds.get(id);
    if (copy === undefined) throw new Error('Each template needs a page id.');
    return copy;
  };

  const properties = source.properties.map((p) => copiedProperty(p, source.id, ctx));
  const templates = source.templates.map((t): RowTemplate => {
    const copy: RowTemplate = { ...structuredClone(t), id: templateOf(t.id) };
    copy.values = copiedValues(t.values);
    if (t.repeat) copy.repeat = { ...t.repeat, ownerId: ctx.by };
    return copy;
  });
  const views = source.views.map((v): View => {
    const copy: View = structuredClone(v);
    copy.manualOrder = v.manualOrder.flatMap((id) => {
      const row = ctx.rowIds.get(id);
      return row ? [row] : [];
    });
    if (typeof v.defaultTemplateId === 'string') {
      const id = ctx.templateIds.get(v.defaultTemplateId);
      if (id) copy.defaultTemplateId = id;
      else delete copy.defaultTemplateId;
    }
    if (copy.form) {
      const fresh = { linkCode: ctx.linkCode(), linkChangedAt: null, notifyUserIds: [] };
      copy.form = formCopiedBy({ ...copy.form, ...fresh }, ctx.by);
    }
    return copy;
  });
  const rows = ctx.rows.map((row): PlannedRow => {
    const id = ctx.rowIds.get(row.id);
    if (id === undefined) throw new Error('Each row needs a page id.');
    return {
      id,
      sourceId: row.id,
      title: row.title,
      icon: row.icon ?? null,
      values: copiedValues(row.values),
      uniqueNumber: row.uniqueNumber,
      formViewId: row.formId ?? null,
    };
  });
  const defaultTemplateId =
    source.defaultTemplateId === null
      ? null
      : (ctx.templateIds.get(source.defaultTemplateId) ?? null);
  return {
    settings: {
      description: structuredClone(source.description),
      properties,
      views,
      templates,
      accessRules: structuredClone(source.accessRules),
      defaultTemplateId,
      locked: source.locked,
      wiki: source.wiki === true,
      rowPageLayout: source.rowPageLayout,
      subItems: source.subItems,
      dependencies: source.dependencies,
      deletedProperties: [],
    },
    nextUniqueNumber: nextNumber(rows),
    templatePages: pagesFor(properties, templates),
    rows,
    needsFull: false,
  };
}
