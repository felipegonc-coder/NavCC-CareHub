/**
 * Who can do what in a database: access levels, sharing ("Only rows they're in", Can add rows),
 * row access rules and property access (Databases 3.12 and 5, Roles and permissions, Templates
 * and buttons 5). Pure: the server passes in what sharing says and enforces the answers on every
 * read and write.
 */
import { findProperty } from './row';
import { isStoredType } from './schema';
import {
  ACCESS_LEVELS,
  LIMITS,
  type AccessLevel,
  type DatabaseGrant,
  type FilterNode,
  type Id,
  type Principal,
  type Property,
  type Row,
  type RowAccessRule,
  type View,
  type Viewer,
} from './types';

/** Messages, word for word. */
export const ACCESS_MESSAGES = {
  losesAccess: "You'll lose access to this row.",
  tooManyRules: 'Up to 10 rules.',
  noProperty: "That property doesn't exist.",
  ruleProperty: 'Rules can only use a Person or Created by property.',
  ruleLevel: 'Choose Can view, Can comment, Can edit or Full access.',
  ruleTaken: (propertyName: string) => `'${propertyName}' already has a rule.`,
  hiddenProperty: "This view uses a property you can't see.",
} as const;

/** How each level is named in Share menus and rules. */
export const ACCESS_LABELS: Record<AccessLevel, string> = {
  none: 'No access',
  view: 'Can view',
  comment: 'Can comment',
  edit_content: 'Can edit content',
  edit: 'Can edit',
  full: 'Full access',
};

/** How each database sharing level is named, "Only rows they're in" included. */
export const GRANT_LABELS: Record<DatabaseGrant, string> = {
  ...ACCESS_LABELS,
  rows_only: "Only rows they're in",
};

/** A database's Share menu, top to bottom. Guests never get Full access. */
export const DATABASE_GRANTS = [
  'full',
  'edit',
  'edit_content',
  'rows_only',
  'comment',
  'view',
] as const satisfies readonly DatabaseGrant[];

/** The levels a row access rule can give. */
export const RULE_LEVELS = [
  'view',
  'comment',
  'edit',
  'full',
] as const satisfies readonly AccessLevel[];

const rank = (level: AccessLevel | null | undefined): number =>
  level ? ACCESS_LEVELS.indexOf(level) : 0;

/** True when level `a` is `b` or higher (missing counts as 'none'). Compare levels only with this. */
export function atLeast(a: AccessLevel | null | undefined, b: AccessLevel): boolean {
  return rank(a) >= rank(b);
}

/** The highest of these levels. Missing ones (null or undefined) count as 'none'. */
export function maxAccess(...levels: readonly (AccessLevel | null | undefined)[]): AccessLevel {
  let best: AccessLevel = 'none';
  for (const level of levels) if (level && !atLeast(best, level)) best = level;
  return best;
}

/**
 * The highest of the grants that reach one database (its space, parent pages, its own sharing,
 * groups, roles). 'rows_only' is above none and below Can view, which already shows every row.
 */
export function maxGrant(...grants: readonly (DatabaseGrant | null | undefined)[]): DatabaseGrant {
  const best = maxAccess(...grants.map((g) => (g === 'rows_only' ? null : g)));
  return best === 'none' && grants.includes('rows_only') ? 'rows_only' : best;
}

/** What a database grant gives on the database page itself: 'rows_only' is Can view there. */
export function databasePageAccess(grant: DatabaseGrant | null | undefined): AccessLevel {
  return grant === 'rows_only' ? 'view' : (grant ?? 'none');
}

/**
 * What a database grant passes down to every row: Can edit content becomes Can edit (values and
 * content), and 'rows_only' passes nothing, so rows start at none until a rule lifts them.
 */
export function inheritedRowAccess(grant: DatabaseGrant | null | undefined): AccessLevel {
  if (!grant || grant === 'rows_only') return 'none';
  return grant === 'edit_content' ? 'edit' : grant;
}

/** True when this property names this person in this row (a Person property, or Created by). */
function namesUser(row: Row, prop: Property, userId: Id): boolean {
  switch (prop.config.type) {
    case 'person': {
      const people = row.values[prop.id];
      return Array.isArray(people) && people.includes(userId);
    }
    case 'created_by':
      return row.createdBy === userId;
    default:
      return false;
  }
}

/**
 * The access row rules give someone on one row: the highest level of the rules whose property
 * names them in that row. Rules on deleted properties or other types give nothing, and anonymous
 * form responses (no Created by) match no Created by rule.
 */
export function ruleAccess(
  row: Row,
  rules: readonly RowAccessRule[],
  userId: Id | null | undefined,
  properties: readonly Property[],
): AccessLevel {
  if (!userId) return 'none';
  let best: AccessLevel = 'none';
  for (const rule of rules) {
    if (atLeast(best, rule.level)) continue;
    const prop = findProperty(properties, rule.propertyId);
    if (prop && namesUser(row, prop, userId)) best = rule.level;
  }
  return best;
}

/**
 * What decides one person's access to one row: the pure rule behind the server's row resolver
 * (`inherited` is what it has as ctx.inherited, `direct` its ctx.grantLevel for the row page).
 */
export interface RowAccessInput {
  /** Their grant on the database, which every row inherits (see inheritedRowAccess). */
  inherited: DatabaseGrant | null | undefined;
  /** The row page's own sharing. */
  direct?: AccessLevel | null | undefined;
  /** What row access rules give them on this row (ruleAccess). */
  rule?: AccessLevel | null | undefined;
  /** They created this row through a rows-only share with Can add rows: they see it. */
  addedByThem?: boolean;
}

/**
 * Someone's access to one row: the highest of what the database passes down, the row page's own
 * sharing and the matching rules. On 'rows_only', rows they added with Can add rows are at least
 * Can view (a Created by rule can give more).
 */
export function rowAccess(input: RowAccessInput): AccessLevel {
  const added = input.addedByThem === true && input.inherited === 'rows_only' ? 'view' : null;
  return maxAccess(inheritedRowAccess(input.inherited), input.direct, input.rule, added);
}

/** Someone, and what they're given, for the functions that check rows one by one. */
export interface AccessSubject {
  userId: Id | null;
  /** Their grant on the database (DatabaseMeta.viewerAccess). */
  database: DatabaseGrant;
  /** A rows-only share that lets them add rows (DatabaseMeta.viewerCanAddRows). */
  canAddRows?: boolean;
  rules: readonly RowAccessRule[];
  properties: readonly Property[];
  /** The row page's own sharing for them, if any. */
  direct?: (rowId: Id) => AccessLevel | null | undefined;
}

/** Someone's access to a row, rules and the row's own sharing included. */
export function accessToRow(row: Row, who: AccessSubject): AccessLevel {
  return rowAccess({
    inherited: who.database,
    direct: who.direct?.(row.id),
    rule: ruleAccess(row, who.rules, who.userId, who.properties),
    addedByThem: who.canAddRows === true && who.userId !== null && row.createdBy === who.userId,
  });
}

/**
 * The rows someone can open (Can view or higher). Everything that shows rows uses only these:
 * views, counts, totals, charts, search, exports, relation titles, rollups and formulas.
 */
export function openableRows<R extends Row>(rows: readonly R[], who: AccessSubject): R[] {
  if (atLeast(inheritedRowAccess(who.database), 'view')) return [...rows];
  return rows.filter((row) => atLeast(accessToRow(row, who), 'view'));
}

/** Everything the permission tables cover. */
export const DB_ACTIONS = [
  'view',
  'comment',
  'edit_rows',
  'add_rows',
  'use_templates',
  'export',
  'import',
  'create_options',
  'edit_views',
  'edit_properties',
  'edit_forms',
  'manage_templates',
  'lock',
  'share',
  'delete_database',
  'set_row_rules',
  'set_property_access',
  'manage_form_access',
  'submit_form',
  'toggle_responses',
  'change_form_link',
] as const;
export type DbAction = (typeof DB_ACTIONS)[number];

/** The level an action needs, and whether Lock structure stops it. */
interface ActionRule {
  min: AccessLevel;
  structure?: true;
}

const ACTION_RULES: Record<DbAction, ActionRule> = {
  view: { min: 'view' },
  comment: { min: 'comment' },
  edit_rows: { min: 'edit_content' },
  add_rows: { min: 'edit_content' },
  use_templates: { min: 'edit_content' },
  export: { min: 'view' },
  import: { min: 'edit' },
  create_options: { min: 'edit' },
  edit_views: { min: 'edit', structure: true },
  edit_properties: { min: 'edit', structure: true },
  edit_forms: { min: 'edit', structure: true },
  manage_templates: { min: 'edit', structure: true },
  lock: { min: 'full' },
  share: { min: 'full' },
  delete_database: { min: 'full' },
  set_row_rules: { min: 'full' },
  set_property_access: { min: 'full' },
  manage_form_access: { min: 'full' },
  submit_form: { min: 'edit' },
  toggle_responses: { min: 'full' },
  change_form_link: { min: 'full' },
};

/** What can() needs besides the person's level. */
export interface CanOptions {
  /** Lock structure is on: properties, views, forms and templates can't change; rows can. */
  locked: boolean;
  /** Their rows-only share has Can add rows (DatabaseMeta.viewerCanAddRows). */
  canAddRows?: boolean;
  /** submit_form: the form's link is taking responses (false while the database is in Trash). */
  accepting?: boolean;
}

/**
 * Whether someone may do this, from the permission tables. `access` is their level where it
 * happens: for view, comment, edit_rows or use_templates on one row, their level on that row
 * (accessToRow); otherwise their grant on the database (DatabaseMeta.viewerAccess). Can edit
 * content adds, edits and deletes rows and uses templates; it doesn't create options, import or
 * change properties, views, forms, templates or sharing. 'rows_only' is Can view on the database
 * page: no adding rows, or using templates for new ones, without Can add rows. A form link that's
 * taking responses lets anyone submit (who may respond is checked elsewhere); otherwise submitting
 * needs Can edit (testing from the Form view). A linked view's settings use the access to the page
 * that holds it; a two-way relation needs edit_properties on both databases.
 */
export function can(
  action: DbAction,
  access: DatabaseGrant | null | undefined,
  opts: CanOptions,
): boolean {
  const rule = ACTION_RULES[action] as ActionRule | undefined;
  if (!rule) return false;
  if (rule.structure && opts.locked) return false;
  if (action === 'submit_form' && opts.accepting === true) return true;
  const level = databasePageAccess(access);
  const adding = action === 'add_rows' || action === 'use_templates';
  if (adding && opts.canAddRows === true && atLeast(level, 'view')) return true;
  return atLeast(level, rule.min);
}

/** The properties a row access rule can use: Person and Created by. */
export function ruleProperties(properties: readonly Property[]): Property[] {
  return properties.filter((p) => p.config.type === 'person' || p.config.type === 'created_by');
}

/** Checks a database's row access rules before they're saved; the first problem, or null. */
export function validateRules(
  rules: readonly RowAccessRule[],
  properties: readonly Property[],
): string | null {
  if (rules.length > LIMITS.rowAccessRules) return ACCESS_MESSAGES.tooManyRules;
  const used = new Set<Id>();
  for (const rule of rules) {
    const prop = findProperty(properties, rule.propertyId);
    if (!prop) return ACCESS_MESSAGES.noProperty;
    if (prop.config.type !== 'person' && prop.config.type !== 'created_by') {
      return ACCESS_MESSAGES.ruleProperty;
    }
    if (!(RULE_LEVELS as readonly string[]).includes(rule.level)) return ACCESS_MESSAGES.ruleLevel;
    if (used.has(prop.id)) return ACCESS_MESSAGES.ruleTaken(prop.name);
    used.add(prop.id);
  }
  return null;
}

/**
 * True when saving `after` would take away someone's own access to a row they can open now (for
 * example taking themselves out of the Person property a rule uses), so the screen asks first:
 * "You'll lose access to this row."
 */
export function losesOwnAccess(before: Row, after: Row, who: AccessSubject): boolean {
  return atLeast(accessToRow(before, who), 'view') && !atLeast(accessToRow(after, who), 'view');
}

/** Who's looking, for property access lists. */
export type PropertyViewer = Pick<Viewer, 'userId' | 'roleId' | 'groupIds'>;

/** True when the list names this person: them, a group they're in, or their workspace role. */
export function namesViewer(list: readonly Principal[], who: PropertyViewer): boolean {
  return list.some((p) => {
    if (p.type === 'user') return p.id === who.userId;
    if (p.type === 'group') return who.groupIds?.includes(p.id) === true;
    return p.type === 'role' && who.roleId !== undefined && p.id === who.roleId;
  });
}

/**
 * Whether someone who can see a row can see this property: everyone with access, unless its see
 * list leaves them out. The Name property is always visible.
 */
export function canSeeProperty(prop: Property, who: PropertyViewer): boolean {
  const see = prop.access?.see ?? null;
  return prop.config.type === 'title' || see === null || namesViewer(see, who);
}

/**
 * Whether someone can change this property's values where they have `access` (their level on the
 * row, or on the database for many rows at once): it takes Can edit content or higher, seeing the
 * property, and being on its change list if it has one. The list only narrows, never adds. Values
 * Care Hub fills in itself (created and edited, ID, formulas, rollups) never change by hand.
 */
export function canChangeProperty(
  prop: Property,
  who: PropertyViewer,
  access: AccessLevel | null | undefined,
): boolean {
  if (!isStoredType(prop.config.type) || !atLeast(access, 'edit_content')) return false;
  if (prop.config.type === 'title') return true;
  const change = prop.access?.change ?? null;
  return canSeeProperty(prop, who) && (change === null || namesViewer(change, who));
}

/** The properties someone can see, in order. The server leaves the others out of everything. */
export function visibleProperties<P extends Property>(
  properties: readonly P[],
  who: PropertyViewer,
): P[] {
  return properties.filter((p) => canSeeProperty(p, who));
}

/**
 * True when a view filters (at any depth), sorts or groups by a property this person can't see.
 * The view then shows "This view uses a property you can't see." and no rows; people who can edit
 * views can still change it. Pass the view with their own changes ("for you only") applied.
 */
export function viewUsesHiddenProperty(
  view: Pick<View, 'filter' | 'sorts' | 'grouping'> & Partial<Pick<View, 'subGrouping'>>,
  properties: readonly Property[],
  who: PropertyViewer,
): boolean {
  const hidden = new Set(properties.filter((p) => !canSeeProperty(p, who)).map((p) => p.id));
  if (hidden.size === 0) return false;
  const inFilter = (node: FilterNode): boolean =>
    node.kind === 'group' ? node.children.some(inFilter) : hidden.has(node.propertyId);
  const groupings = [view.grouping, view.subGrouping];
  return (
    (view.filter ? inFilter(view.filter) : false) ||
    view.sorts.some((s) => hidden.has(s.propertyId)) ||
    groupings.some((g) => (g ? hidden.has(g.propertyId) : false))
  );
}
