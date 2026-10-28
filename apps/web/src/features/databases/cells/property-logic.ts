/**
 * The property menu's rules (spec 3.4): property names, the type changes on offer, how many values
 * a type change or a delete takes away, and where a new property goes in a view.
 */
import {
  defaultConfig,
  findPropertyByName,
  isEmptyValue,
  isStoredType,
  LIMITS,
  PROPERTY_TYPES,
  readValue,
  type ComputedValue,
  type DatabaseMeta,
  type EvalContext,
  type Id,
  type Property,
  type PropertyType,
  type View,
  type ViewPropertySetting,
} from '@carehub/databases';
import { canConvert, planConversion } from '@carehub/databases/convert';
import { wikiOnlyProblem } from '@carehub/databases/verification';
import type { QueryRow } from '../contract';
import { PROPERTY_TEXT } from './messages';
import { engineRow } from './row-cell';
import type { CellContext, PersonChoice } from './types';

/** People with Can edit or Full access change properties, unless Lock structure is on. */
export function canChangeProperties(meta: Pick<DatabaseMeta, 'viewerAccess' | 'locked'>): boolean {
  return (meta.viewerAccess === 'edit' || meta.viewerAccess === 'full') && !meta.locked;
}

/**
 * Why `name` can't be used (null: it can). Names are 1–100 characters and unique in the database,
 * ignoring case and spaces as formulas and CSV import match them. `selfId` is the property being
 * renamed.
 */
export function checkPropertyName(
  name: string,
  properties: readonly Property[],
  selfId?: Id,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return PROPERTY_TEXT.nameEmpty;
  if (trimmed.length > LIMITS.propertyName) return PROPERTY_TEXT.nameTooLong;
  const others = properties.filter((p) => p.id !== selfId);
  return findPropertyByName(others, trimmed) ? PROPERTY_TEXT.nameTaken(trimmed) : null;
}

/** `base`, or "base 2", "base 3"… when another property has that name. */
export function uniquePropertyName(base: string, properties: readonly Property[]): string {
  let name = base;
  for (let n = 2; findPropertyByName(properties, name); n++) name = `${base} ${n}`;
  return name;
}

/**
 * Formula, Rollup, ID, Button and Verification are only ever added as new properties; nothing
 * turns into them.
 */
type AddedOnly = 'formula' | 'rollup' | 'unique_id' | 'button' | 'verification';
/** What a property can change into from the menu. */
export type TargetType = Exclude<PropertyType, 'title' | 'relation' | AddedOnly>;
const ADDED_ONLY: ReadonlySet<PropertyType> = new Set<AddedOnly>([
  'formula',
  'rollup',
  'unique_id',
  'button',
  'verification',
]);

/** The types `property` can change to, in the type menu's order. Name never changes type. */
export function typeChoices(property: Property): TargetType[] {
  const from = property.config.type;
  return PROPERTY_TYPES.filter(
    (to): to is TargetType => !ADDED_ONLY.has(to) && canConvert(from, to),
  );
}

/**
 * Types a property can be added as from the menu. Relations (which pick their database) and
 * rollups (which pick a relation) are added from their settings. Verification is only for wiki
 * databases: a menu lists newPropertyTypes(meta).
 */
export type NewPropertyType = Exclude<PropertyType, 'title' | 'relation' | 'rollup'>;
export const NEW_PROPERTY_TYPES: readonly NewPropertyType[] = PROPERTY_TYPES.filter(
  (t): t is NewPropertyType => t !== 'title' && t !== 'relation' && t !== 'rollup',
);

/** The types this database can add from the menu: Verification only in a wiki database. */
export function newPropertyTypes(meta: Pick<DatabaseMeta, 'wiki'>): NewPropertyType[] {
  return NEW_PROPERTY_TYPES.filter((t) => wikiOnlyProblem(t, meta) === null);
}

const EMPTY: ComputedValue = { kind: 'empty' };

/** The member with exactly this name or email (Text → Person), ignoring case. */
function findPerson(people: readonly PersonChoice[], text: string): Id | undefined {
  const key = text.trim().toLowerCase();
  return people.find((p) => p.name.toLowerCase() === key || p.email?.toLowerCase() === key)?.id;
}

/**
 * How many of `rows` lose their value when `property` changes to `to` (planConversion over the
 * rows the screen has; the server counts every row again when it makes the change).
 */
export function clearedByChange(
  property: Property,
  to: TargetType,
  rows: readonly QueryRow[],
  ctx: CellContext,
  properties: readonly Property[],
  people: readonly PersonChoice[] = [],
): number {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const evalCtx: EvalContext = {
    ...ctx,
    properties,
    computed: (row, propertyId) => byId.get(row.id)?.computed[propertyId] ?? EMPTY,
  };
  const plan = planConversion(property, defaultConfig(to), rows.map(engineRow), evalCtx, {
    findUser: (text) => findPerson(people, text),
  });
  return plan.cleared;
}

/**
 * How many of `rows` have a value in `property` that deleting it removes. Only values kept in rows
 * count (automatic and computed ones aren't; verifications are), and an unticked checkbox or Not
 * verified is no value.
 */
export function rowsWithValues(property: Property, rows: readonly QueryRow[]): number {
  const type = property.config.type;
  if (type !== 'verification' && !isStoredType(type)) return 0;
  return rows.filter((row) => {
    const value = readValue(engineRow(row), property);
    return value !== false && !isEmptyValue(value);
  }).length;
}

export type InsertSide = 'left' | 'right';

/** A view's columns with `newId` shown just left or right of `anchorId` (at the end if it's missing). */
export function placeInView(
  columns: readonly ViewPropertySetting[],
  anchorId: Id,
  newId: Id,
  side: InsertSide,
): ViewPropertySetting[] {
  const rest = columns.filter((c) => c.propertyId !== newId);
  const entry: ViewPropertySetting = { propertyId: newId, visible: true };
  const at = rest.findIndex((c) => c.propertyId === anchorId);
  if (at < 0) return [...rest, entry];
  const index = side === 'left' ? at : at + 1;
  return [...rest.slice(0, index), entry, ...rest.slice(index)];
}

/** A view's columns with `propertyId` hidden (one the view doesn't list is hidden already). */
export function hideInView(
  columns: readonly ViewPropertySetting[],
  propertyId: Id,
): ViewPropertySetting[] {
  return columns.map((c) => (c.propertyId === propertyId ? { ...c, visible: false } : c));
}

/** The columns of `view` in a settings answer (the answer is newer than the screen's copy). */
export function viewColumns(
  answer: { views: readonly Pick<View, 'id' | 'properties'>[] },
  view: Pick<View, 'id' | 'properties'>,
): readonly ViewPropertySetting[] {
  return answer.views.find((v) => v.id === view.id)?.properties ?? view.properties;
}

/** The property in `after` that isn't in `before`: the one just added or duplicated. */
export function addedProperty(
  before: readonly Property[],
  after: readonly Property[],
): Property | undefined {
  const known = new Set(before.map((p) => p.id));
  return after.find((p) => !known.has(p.id));
}
