// Property changes (decision 0200; Databases spec 3.4): what adding, editing, changing the type of
// (and undoing that), deleting, restoring and duplicating a property does to a database's settings.
// Pure: the routes in
// property-routes.ts load what these need (related databases, rows) and write the values the plans
// ask for, inside the settings write's transaction.
import {
  LIMITS,
  findProperty,
  findPropertyByName,
  isStoredType,
  newId,
  type Id,
  type Property,
  type PropertyAccess,
  type PropertyConfig,
  type Row,
  type View,
  type ViewPropertySetting,
} from '@carehub/databases';
import { validateButton } from '@carehub/databases/buttons';
import { canConvert } from '@carehub/databases/convert';
import {
  CHAIN_MESSAGE,
  LOOP_MESSAGE,
  basicSchema,
  compileFormula,
  computedChainError,
  formulaDependencies,
  type ComputedNode,
  type FormulaSchema,
} from '@carehub/databases/formula';
import { rollupDependencies } from '@carehub/databases/rollup';
import { removeOptionFromRows, type OptionProperty } from '@carehub/databases/options';
import { normalizeIdPrefix } from '@carehub/databases/unique-id';
import { DATABASE_MESSAGES, invalid, invalidRequest, notFound } from './errors';
import type {
  DatabaseRecord,
  DatabaseSettings,
  DeletedProperty,
  TypeChange,
  TypeChangeSettings,
} from './record';
import type { CellWrite } from './store';

/** Messages, word for word. */
export const PROPERTY_MESSAGES = {
  nameTaken: 'A property with that name already exists.',
  oneName: 'A database has exactly one Name property.',
  keepName: "The Name property can't be deleted.",
  copyName: "The Name property can't be duplicated.",
  cantChange: "This property can't change to that type.",
  addOnly: 'Formulas, rollups, IDs and buttons can only be added as new properties.',
  cantUndo: "This change can't be undone anymore.",
  formula: 'This formula has a problem. Fix it to save.',
  loop: LOOP_MESSAGE,
  chain: CHAIN_MESSAGE,
  button: "One of this button's steps isn't valid.",
  usedByRule: 'A row access rule uses this property. Remove the rule first.',
  expired: "This property was deleted more than 30 days ago, so it can't be restored.",
} as const;

/** Related databases' properties by database id (store.ts loadRelatedDatabases). */
export type RelatedDatabases = ReadonlyMap<Id, readonly Property[]>;

/** One database's id and its properties as they will be after the change. */
export interface Own {
  id: Id;
  properties: readonly Property[];
}

const DAY_MS = 86_400_000;

/** Types a property is only ever added as: nothing turns into them (Databases spec 3.4). */
const ADDED_ONLY: ReadonlySet<PropertyConfig['type']> = new Set([
  'formula',
  'rollup',
  'unique_id',
  'button',
]);

/** True when another property already has this name (ignoring case and spaces, as formulas do). */
export function nameTaken(properties: readonly Property[], name: string, exceptId?: Id): boolean {
  return (
    findPropertyByName(
      properties.filter((p) => p.id !== exceptId),
      name,
    ) !== undefined
  );
}

/** `base`, or "base 2", "base 3"... the first name no other property has (100 characters at most). */
export function freeName(properties: readonly Property[], base: string, exceptId?: Id): string {
  if (!nameTaken(properties, base, exceptId)) return base;
  for (let i = 2; ; i++) {
    const suffix = ` ${i}`;
    const name = `${base.slice(0, LIMITS.propertyName - suffix.length).trimEnd()}${suffix}`;
    if (!nameTaken(properties, name, exceptId)) return name;
  }
}

/** The properties of a database these settings can read: this one's, or a related one's. */
const propertiesOf =
  (own: Own, related: RelatedDatabases) =>
  (databaseId: Id): readonly Property[] | null =>
    databaseId === own.id ? own.properties : (related.get(databaseId) ?? null);

/** The formula schema of a database, reading related databases through its relations. */
function schemaFor(
  properties: readonly Property[],
  lookup: (databaseId: Id) => readonly Property[] | null,
  depth: number,
): FormulaSchema {
  return basicSchema(properties, (relationPropertyId) => {
    const relation = findProperty(properties, relationPropertyId);
    if (relation?.config.type !== 'relation' || depth > LIMITS.formulaRelationDepth) return null;
    const target = lookup(relation.config.targetDatabaseId);
    return target ? schemaFor(target, lookup, depth + 1) : null;
  });
}

const isComputed = (p: Property | undefined): boolean =>
  p?.config.type === 'formula' || p?.config.type === 'rollup';

/** The properties a formula or rollup reads, here and in related databases. */
function readsOf(p: Property): Id[] {
  const config = p.config;
  if (config.type !== 'formula' && config.type !== 'rollup') return [];
  const reads =
    config.type === 'formula'
      ? formulaDependencies(config.expression)
      : rollupDependencies({ ...p, config });
  return [...reads.local, ...reads.related.map((r) => r.propertyId)];
}

/**
 * "This would make a loop." when a formula or rollup would read itself through any chain of
 * formulas and rollups (here or in related databases), or the chain message when it's too deep.
 */
export function loopProblem(prop: Property, own: Own, related: RelatedDatabases): string | null {
  if (!isComputed(prop)) return null;
  const byId = new Map<Id, Property>();
  for (const [databaseId, list] of related) {
    if (databaseId !== own.id) for (const p of list) byId.set(p.id, p);
  }
  for (const p of own.properties) byId.set(p.id, p);
  byId.set(prop.id, prop);
  const node = (p: Property): ComputedNode => ({
    id: p.id,
    name: p.name,
    uses: readsOf(p).filter((id) => isComputed(byId.get(id))),
  });
  const lookup = (id: Id): ComputedNode | undefined => {
    const p = byId.get(id);
    return p && isComputed(p) ? node(p) : undefined;
  };
  const kind = prop.config.type === 'rollup' ? 'rollup' : 'formula';
  const message = computedChainError(node(prop), lookup, kind);
  if (message === null) return null;
  return message === CHAIN_MESSAGE ? PROPERTY_MESSAGES.chain : PROPERTY_MESSAGES.loop;
}

/**
 * The settings as saved, checked against the database (with the property in place) and the ones it
 * relates to: no formula or rollup may loop, formulas must work (their result kind is worked out
 * here), rollups follow a relation of this database to a property that exists, relations point at
 * a known database, buttons pass the package's checks and ID prefixes are tidied.
 */
export function checkedConfig(prop: Property, own: Own, related: RelatedDatabases): PropertyConfig {
  // A loop is named as one first (a formula in a loop doesn't compile either).
  const problem = loopProblem(prop, own, related);
  if (problem) throw invalid(problem);
  const lookup = propertiesOf(own, related);
  const config = prop.config;
  let checked: PropertyConfig = config;
  switch (config.type) {
    case 'formula': {
      const compiled = compileFormula(config.expression, schemaFor(own.properties, lookup, 0));
      if (!compiled.ok) throw invalid(PROPERTY_MESSAGES.formula);
      checked = { ...config, resultKind: compiled.kind };
      break;
    }
    case 'rollup': {
      const relation = findProperty(own.properties, config.relationPropertyId);
      if (relation?.config.type !== 'relation') throw invalidRequest();
      const target = lookup(relation.config.targetDatabaseId);
      if (target && !findProperty(target, config.targetPropertyId)) throw invalidRequest();
      break;
    }
    case 'relation':
      if (lookup(config.targetDatabaseId) === null) throw invalidRequest();
      break;
    case 'button':
      if (validateButton(config, own.properties, lookup).error) {
        throw invalid(PROPERTY_MESSAGES.button);
      }
      break;
    case 'unique_id':
      checked = { ...config, prefix: normalizeIdPrefix(config.prefix) };
      break;
    default:
      break;
  }
  return checked;
}

/** Where a new property shows in one view ("Insert left or right"): after this column. */
export interface Placement {
  viewId?: Id | undefined;
  afterPropertyId?: Id | undefined;
}

/**
 * Views with a new property: shown in table views (or only in `place.viewId`, after its
 * `afterPropertyId` column), hidden in the others. Views that list it already are left alone.
 */
export function addToViews(views: readonly View[], prop: Property, place: Placement = {}): View[] {
  return views.map((view) => {
    if (view.properties.some((s) => s.propertyId === prop.id)) return view;
    const here = place.viewId === view.id;
    const visible = place.viewId ? here : view.layout === 'table';
    const setting: ViewPropertySetting =
      view.layout === 'table'
        ? { propertyId: prop.id, visible, width: 200 }
        : { propertyId: prop.id, visible };
    const list = [...view.properties];
    const at =
      here && place.afterPropertyId
        ? list.findIndex((s) => s.propertyId === place.afterPropertyId)
        : -1;
    if (at >= 0) list.splice(at + 1, 0, setting);
    else list.push(setting);
    return { ...view, properties: list };
  });
}

/** Views with a copy next to the original wherever the original is, shown the same way. */
export function copyInViews(views: readonly View[], from: Id, copy: Id): View[] {
  return views.map((view) => {
    const at = view.properties.findIndex((s) => s.propertyId === from);
    const original = view.properties[at];
    if (!original) return view;
    const list = [...view.properties];
    list.splice(at + 1, 0, { ...original, propertyId: copy });
    return { ...view, properties: list };
  });
}

function checkCount(count: number): void {
  if (count > LIMITS.properties) throw invalid(DATABASE_MESSAGES.tooManyProperties);
}

/** A new property as POST /:id/properties describes it. */
export interface NewPropertyInput extends Placement {
  name: string;
  config: PropertyConfig;
  description?: string | undefined;
  rowPage?: Property['rowPage'] | undefined;
  access?: PropertyAccess | undefined;
  /** The name of the matching property a two-way relation adds to its target. */
  twoWayName?: string | undefined;
}

export interface AddPlan {
  property: Property;
  /** The other side of a two-way relation to another database: add it there. */
  partner: Property | null;
  changes: Partial<DatabaseSettings>;
}

/** The two-way partner of a new relation: a relation back to `databaseId`. */
function partnerFor(prop: Property, databaseId: Id, name: string): Property {
  return {
    id: newId(),
    name,
    description: '',
    config: {
      type: 'relation',
      targetDatabaseId: databaseId,
      single: false,
      twoWayPropertyId: prop.id,
    },
    rowPage: 'always',
  };
}

/**
 * Adding a property: not a second Name, a name no other property has, at most 200 properties, and
 * settings that pass checkedConfig. A relation with a twoWayPropertyId (any id) is two-way: the
 * server makes the matching property (here for a relation to this database, otherwise `partner`
 * for the target). `related` must include the target of a new relation.
 */
export function planAdd(
  current: DatabaseRecord,
  input: NewPropertyInput,
  related: RelatedDatabases,
): AddPlan {
  if (input.config.type === 'title') throw invalid(PROPERTY_MESSAGES.oneName);
  if (nameTaken(current.properties, input.name)) throw invalid(PROPERTY_MESSAGES.nameTaken);
  const property: Property = {
    id: newId(),
    name: input.name,
    description: input.description ?? '',
    config: input.config,
    rowPage: input.rowPage ?? 'always',
  };
  if (input.access) property.access = input.access;
  let properties: Property[] = [...current.properties, property];
  let partner: Property | null = null;
  let samePartner: Property | null = null;
  const config = input.config;
  if (config.type === 'relation' && config.twoWayPropertyId !== null) {
    const here = config.targetDatabaseId === current.id;
    const base = input.twoWayName ?? (here ? input.name : current.title.trim() || 'Related');
    const made = partnerFor(property, current.id, here ? freeName(properties, base) : base);
    property.config = { ...config, twoWayPropertyId: made.id };
    if (here) {
      samePartner = made;
      properties = [...properties, made];
    } else {
      partner = made;
    }
  }
  checkCount(properties.length);
  const own: Own = { id: current.id, properties };
  property.config = checkedConfig(property, own, related);
  let views = addToViews(current.views, property, input);
  if (samePartner) views = addToViews(views, samePartner, { viewId: input.viewId });
  return { property, partner, changes: { properties, views } };
}

/** A change to one property as PATCH /:id/properties/:pid describes it. */
export interface PropertyChangeInput {
  name?: string | undefined;
  description?: string | undefined;
  config?: PropertyConfig | undefined;
  rowPage?: Property['rowPage'] | undefined;
  access?: PropertyAccess | undefined;
}

export interface EditPlan {
  before: Property;
  property: Property;
  /** The type changes: the route runs planConversion over every row (and saves its config). */
  conversion: boolean;
  /** A type change: the settings it turns off, as they were (kept with it for Undo). */
  turnedOff: TypeChangeSettings;
  /** Options taken out of a Select, Multi-select or Status: the route clears them from rows. */
  removedOptionIds: Id[];
  /** A two-way relation changing type: its partner becomes one-way. */
  partner: { databaseId: Id; propertyId: Id } | null;
  changes: Partial<DatabaseSettings>;
}

const optionIds = (config: PropertyConfig): Id[] =>
  config.type === 'select' || config.type === 'multi_select' || config.type === 'status'
    ? config.options.map((o) => o.id)
    : [];

/** Settings that point at properties, without the ones in `gone`. */
function forgetProperties(
  current: DatabaseRecord,
  gone: ReadonlySet<Id>,
): Partial<DatabaseSettings> {
  const changes: Partial<DatabaseSettings> = {};
  const sub = current.subItems;
  if (sub && (gone.has(sub.parentPropertyId) || gone.has(sub.childrenPropertyId))) {
    changes.subItems = null;
  }
  const deps = current.dependencies;
  if (deps && (gone.has(deps.blockedByPropertyId) || gone.has(deps.blockingPropertyId))) {
    changes.dependencies = null;
  }
  const layout = current.rowPageLayout;
  if (layout && layout.pinned.some((id) => gone.has(id))) {
    changes.rowPageLayout = { ...layout, pinned: layout.pinned.filter((id) => !gone.has(id)) };
  }
  return changes;
}

/** The settings `forgetProperties` turns off, as they were before. */
function settingsBefore(
  current: DatabaseRecord,
  off: Partial<DatabaseSettings>,
): TypeChangeSettings {
  const before: TypeChangeSettings = {};
  if (off.subItems !== undefined) before.subItems = current.subItems;
  if (off.dependencies !== undefined) before.dependencies = current.dependencies;
  if (off.rowPageLayout !== undefined) before.rowPageLayout = current.rowPageLayout;
  return before;
}

const usedByRule = (current: DatabaseRecord, id: Id): boolean =>
  current.accessRules.some((rule) => rule.propertyId === id);

/**
 * Changing a property: a free name; the Name property keeps its type; another type only where
 * canConvert allows it, and never into a Formula, Rollup, ID or Button (the route converts the
 * values); a relation keeps its target and its two-way partner; options taken out are cleared from
 * rows; new settings pass checkedConfig.
 */
export function planEdit(
  current: DatabaseRecord,
  propertyId: Id,
  input: PropertyChangeInput,
  related: RelatedDatabases,
): EditPlan {
  const before = findProperty(current.properties, propertyId);
  if (!before) throw notFound();
  const property: Property = { ...before };
  if (input.name !== undefined && input.name !== before.name) {
    if (nameTaken(current.properties, input.name, before.id)) {
      throw invalid(PROPERTY_MESSAGES.nameTaken);
    }
    property.name = input.name;
  }
  if (input.description !== undefined) property.description = input.description;
  if (input.rowPage !== undefined) property.rowPage = input.rowPage;
  if (input.access !== undefined) property.access = input.access;
  const plan: EditPlan = {
    before,
    property,
    conversion: false,
    turnedOff: {},
    removedOptionIds: [],
    partner: null,
    changes: {},
  };
  // A two-way partner in this database that becomes one-way.
  let loneId: Id | null = null;
  const next = input.config;
  if (next !== undefined) {
    const from = before.config;
    if (next.type !== from.type) {
      if (from.type === 'title' || next.type === 'title') throw invalid(PROPERTY_MESSAGES.oneName);
      if (ADDED_ONLY.has(next.type)) throw invalid(PROPERTY_MESSAGES.addOnly);
      if (!canConvert(from.type, next.type)) throw invalid(PROPERTY_MESSAGES.cantChange);
      if (usedByRule(current, before.id)) throw invalid(PROPERTY_MESSAGES.usedByRule);
      plan.conversion = true;
      if (from.type === 'relation' && from.twoWayPropertyId !== null) {
        if (from.targetDatabaseId === current.id) loneId = from.twoWayPropertyId;
        else
          plan.partner = { databaseId: from.targetDatabaseId, propertyId: from.twoWayPropertyId };
      }
      const off = forgetProperties(current, new Set([before.id]));
      plan.turnedOff = settingsBefore(current, off);
      Object.assign(plan.changes, off);
    } else if (next.type === 'relation' && from.type === 'relation') {
      if (
        next.targetDatabaseId !== from.targetDatabaseId ||
        next.twoWayPropertyId !== from.twoWayPropertyId
      ) {
        throw invalidRequest();
      }
    } else {
      const kept = new Set(optionIds(next));
      plan.removedOptionIds = optionIds(from).filter((id) => !kept.has(id));
    }
    property.config = next;
  }
  const properties = current.properties.map((p): Property => {
    if (p.id === before.id) return property;
    if (p.id !== loneId || p.config.type !== 'relation') return p;
    return { ...p, config: { ...p.config, twoWayPropertyId: null } };
  });
  if (next !== undefined) {
    property.config = checkedConfig(property, { id: current.id, properties }, related);
  }
  plan.changes.properties = properties;
  return plan;
}

/**
 * True when `p` is a relation to this database that is one-way (or already linked to
 * `propertyId`): the other side a type change left behind, ready to link back on Undo.
 */
export function waitsForPartner(p: Property | undefined, databaseId: Id, propertyId: Id): boolean {
  return (
    p?.config.type === 'relation' &&
    p.config.targetDatabaseId === databaseId &&
    (p.config.twoWayPropertyId === null || p.config.twoWayPropertyId === propertyId)
  );
}

/** The settings a type change turned off, back where they're still off and their properties are. */
function settingsBack(
  current: DatabaseRecord,
  propertyId: Id,
  saved: TypeChangeSettings,
  properties: readonly Property[],
): Partial<DatabaseSettings> {
  const changes: Partial<DatabaseSettings> = {};
  const here = (...ids: Id[]) =>
    ids.every((id) => {
      const p = findProperty(properties, id);
      return p?.config.type === 'relation' && p.config.targetDatabaseId === current.id;
    });
  const sub = saved.subItems;
  if (sub && current.subItems === null && here(sub.parentPropertyId, sub.childrenPropertyId)) {
    changes.subItems = sub;
  }
  const deps = saved.dependencies;
  if (
    deps &&
    current.dependencies === null &&
    here(deps.blockedByPropertyId, deps.blockingPropertyId)
  ) {
    changes.dependencies = deps;
  }
  const at = saved.rowPageLayout?.pinned.indexOf(propertyId) ?? -1;
  const layout = current.rowPageLayout;
  if (
    at >= 0 &&
    layout &&
    !layout.pinned.includes(propertyId) &&
    layout.pinned.length < LIMITS.rowPagePinned
  ) {
    const pinned = [...layout.pinned];
    pinned.splice(Math.min(at, pinned.length), 0, propertyId);
    changes.rowPageLayout = { ...layout, pinned };
  }
  return changes;
}

export interface UndoTypePlan {
  /** The property as it comes back. */
  property: Property;
  /** The two-way partner in another database to link back to it (the route saves that side). */
  partner: { databaseId: Id; propertyId: Id } | null;
  changes: Partial<DatabaseSettings>;
}

/**
 * Undoing a type change: the property comes back exactly as it was (a name taken meanwhile gets a
 * number), with the settings the change turned off where they're still off. A two-way partner left
 * one-way links back: in this database when it's still waiting, in another when `partnerBack`
 * says it can; otherwise this side comes back one-way. The route puts the values back.
 */
export function planUndoType(
  current: DatabaseRecord,
  change: Pick<TypeChange, 'property' | 'settings'>,
  related: RelatedDatabases,
  partnerBack: (partner: { databaseId: Id; propertyId: Id }) => boolean = () => false,
): UndoTypePlan {
  const id = change.property.id;
  if (!findProperty(current.properties, id)) throw invalid(PROPERTY_MESSAGES.cantUndo);
  if (usedByRule(current, id)) throw invalid(PROPERTY_MESSAGES.usedByRule);
  const property: Property = {
    ...change.property,
    name: freeName(current.properties, change.property.name, id),
  };
  let partner: UndoTypePlan['partner'] = null;
  let twinId: Id | null = null;
  const config = property.config;
  if (config.type === 'relation' && config.twoWayPropertyId !== null) {
    const link = { databaseId: config.targetDatabaseId, propertyId: config.twoWayPropertyId };
    if (link.databaseId !== current.id) {
      if (partnerBack(link)) partner = link;
    } else if (
      link.propertyId === id ||
      waitsForPartner(findProperty(current.properties, link.propertyId), current.id, id)
    ) {
      twinId = link.propertyId;
    }
    if (!partner && twinId === null) property.config = { ...config, twoWayPropertyId: null };
  }
  const properties = current.properties.map((p): Property => {
    if (p.id === id) return property;
    if (p.id !== twinId || p.config.type !== 'relation') return p;
    return { ...p, config: { ...p.config, twoWayPropertyId: id } };
  });
  property.config = checkedConfig(property, { id: current.id, properties }, related);
  return {
    property,
    partner,
    changes: { ...settingsBack(current, id, change.settings, properties), properties },
  };
}

/** Deleted properties still in their 30 days. */
export function liveDeleted(list: readonly DeletedProperty[], now: Date): DeletedProperty[] {
  const since = now.getTime() - LIMITS.deletedPropertyDays * DAY_MS;
  return list.filter((d) => Date.parse(d.deletedAt) >= since);
}

export interface DeletePlan {
  property: Property;
  /** Deleted here: the property, and its two-way partner when that's in this database too. */
  deletedIds: Id[];
  /** The two-way partner in another database, deleted with it. */
  partner: { databaseId: Id; propertyId: Id } | null;
  /** Settings without the deleted properties; the route adds them to deletedProperties. */
  changes: Partial<DatabaseSettings>;
}

/**
 * Deleting a property: never the Name property or one a row access rule uses. A two-way relation
 * takes its partner with it. Sub-items, dependencies and pinned row page properties that used it
 * are turned off or left out; views keep pointing at it, so a restore brings it back in place.
 */
export function planDelete(current: DatabaseRecord, propertyId: Id): DeletePlan {
  const property = findProperty(current.properties, propertyId);
  if (!property) throw notFound();
  if (property.config.type === 'title') throw invalid(PROPERTY_MESSAGES.keepName);
  const deletedIds = [property.id];
  let partner: DeletePlan['partner'] = null;
  const config = property.config;
  if (config.type === 'relation' && config.twoWayPropertyId !== null) {
    if (config.targetDatabaseId === current.id) {
      const twin = config.twoWayPropertyId;
      if (twin !== property.id && findProperty(current.properties, twin)) {
        deletedIds.push(twin);
      }
    } else {
      partner = { databaseId: config.targetDatabaseId, propertyId: config.twoWayPropertyId };
    }
  }
  if (deletedIds.some((id) => usedByRule(current, id))) throw invalid(PROPERTY_MESSAGES.usedByRule);
  const gone = new Set(deletedIds);
  return {
    property,
    deletedIds,
    partner,
    changes: {
      ...forgetProperties(current, gone),
      properties: current.properties.filter((p) => !gone.has(p.id)),
    },
  };
}

export interface RestorePlan {
  /** The properties back in the database (a same-database two-way partner too). */
  restored: DeletedProperty[];
  /** The two-way partner in another database, to restore there too. */
  partner: { databaseId: Id; propertyId: Id } | null;
  changes: Partial<DatabaseSettings>;
}

/**
 * Restoring a deleted property within 30 days, with its values (the route writes them back). A
 * name taken meanwhile gets a number ("Score 2"). A two-way partner in this database comes back
 * too; one in another database comes back when `partnerBack` says it can, else this side is
 * restored as one-way.
 */
export function planRestore(
  current: DatabaseRecord,
  propertyId: Id,
  now: Date,
  partnerBack: (partner: { databaseId: Id; propertyId: Id }) => boolean = () => false,
): RestorePlan {
  const entry = current.deletedProperties.find((d) => d.property.id === propertyId);
  if (!entry) throw notFound();
  const live = liveDeleted(current.deletedProperties, now);
  if (!live.includes(entry)) throw invalid(PROPERTY_MESSAGES.expired);
  const picked = [entry];
  let partner: RestorePlan['partner'] = null;
  const config = entry.property.config;
  const twinId = config.type === 'relation' ? config.twoWayPropertyId : null;
  if (config.type === 'relation' && twinId !== null && twinId !== propertyId) {
    const link = { databaseId: config.targetDatabaseId, propertyId: twinId };
    const here = config.targetDatabaseId === current.id;
    const twin = here ? live.find((d) => d.property.id === twinId) : undefined;
    if (twin) picked.push(twin);
    else if (!here && partnerBack(link)) partner = link;
    else picked[0] = oneWay(entry);
  }
  const properties = [...current.properties];
  const restored = picked.map((d) => {
    const property = { ...d.property, name: freeName(properties, d.property.name) };
    properties.push(property);
    return { ...d, property };
  });
  checkCount(properties.length);
  const back = new Set(picked.map((d) => d.property.id));
  return {
    restored,
    partner,
    changes: {
      properties,
      deletedProperties: live.filter((d) => !back.has(d.property.id)),
    },
  };
}

/** A deleted relation restored without its partner. */
function oneWay(entry: DeletedProperty): DeletedProperty {
  const config = entry.property.config;
  if (config.type !== 'relation') return entry;
  return {
    ...entry,
    property: { ...entry.property, config: { ...config, twoWayPropertyId: null } },
  };
}

export interface DuplicatePlan {
  source: Property;
  copy: Property;
  /** The copy gets the source's values (stored types only). */
  copyValues: boolean;
  changes: Partial<DatabaseSettings>;
}

/**
 * Duplicating a property: a copy with a numbered name next to it in every view, with its values.
 * A two-way relation's copy is one-way, so the target isn't changed. Never the Name property.
 */
export function planDuplicate(current: DatabaseRecord, propertyId: Id): DuplicatePlan {
  const source = findProperty(current.properties, propertyId);
  if (!source) throw notFound();
  if (source.config.type === 'title') throw invalid(PROPERTY_MESSAGES.copyName);
  const copy: Property = {
    ...source,
    id: newId(),
    name: freeName(current.properties, source.name),
  };
  if (source.config.type === 'relation') {
    copy.config = { ...source.config, twoWayPropertyId: null };
  }
  const at = current.properties.indexOf(source);
  const properties = [...current.properties];
  properties.splice(at + 1, 0, copy);
  checkCount(properties.length);
  return {
    source,
    copy,
    copyValues: isStoredType(source.config.type),
    changes: { properties, views: copyInViews(current.views, source.id, copy.id) },
  };
}

/** The cells that lose options taken out of a Select, Multi-select or Status property. */
export function clearedOptions(
  rows: readonly Row[],
  prop: OptionProperty,
  optionIds: readonly Id[],
): CellWrite[] {
  const changed = new Map<Id, unknown>();
  const now = (row: Row): Row =>
    changed.has(row.id)
      ? { ...row, values: { ...row.values, [prop.id]: changed.get(row.id) } }
      : row;
  for (const optionId of optionIds) {
    for (const change of removeOptionFromRows(rows.map(now), prop, optionId)) {
      changed.set(change.rowId, change.value);
    }
  }
  return [...changed].map(([rowId, value]) => ({ rowId, propertyId: prop.id, value }));
}
