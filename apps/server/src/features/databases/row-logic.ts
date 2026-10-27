// The rules for writing row values (Databases spec; decision 0200), with no database: which values
// someone may write and in what form, the links a relation cell keeps for them, and who a Person
// property newly names. rows.ts runs these for the routes and for api.ts.
import {
  findProperty,
  isStoredType,
  type AccessLevel,
  type ConfigOf,
  type Id,
  type Property,
} from '@carehub/databases';
import { canChangeProperty, canSeeProperty, type PropertyViewer } from '@carehub/databases/access';
import { VALUE_MESSAGES, validateValue } from '@carehub/databases/values';

/** Values in stored form (null clears one). The Name property's value is the row's title. */
export interface CheckedValues {
  title?: string;
  values: Record<Id, unknown>;
}

export type ValuesCheck =
  { ok: true; checked: CheckedValues } | { ok: false; status: 400 | 403; message?: string };

const put = (checked: CheckedValues, prop: Property, value: unknown) => {
  if (prop.config.type === 'title') checked.title = typeof value === 'string' ? value : '';
  else checked.values[prop.id] = value;
};

/**
 * Checks the values someone sends for a row where they have `access`. Properties they can't see,
 * and ids that aren't properties, are left out without a word: never written, never confirmed.
 * Values Care Hub fills in answer 400 "This property can't be edited."; a property they may not
 * change answers 403; a value that doesn't fit answers 400 with the package's message.
 *
 * A form answer (`formAnswer`) skips property access lists, see and change alike: the form decides
 * which properties it writes, and the check is made when the form is edited instead (a question
 * can only be mapped to a property the form's editor may change).
 */
export function checkValues(
  input: Readonly<Record<Id, unknown>>,
  properties: readonly Property[],
  viewer: PropertyViewer,
  access: AccessLevel,
  formAnswer = false,
): ValuesCheck {
  const checked: CheckedValues = { values: {} };
  for (const [id, raw] of Object.entries(input)) {
    const prop = findProperty(properties, id);
    if (!prop || !(formAnswer || canSeeProperty(prop, viewer))) continue;
    if (!isStoredType(prop.config.type)) {
      return { ok: false, status: 400, message: VALUE_MESSAGES.readOnly };
    }
    if (!formAnswer && !canChangeProperty(prop, viewer, access)) return { ok: false, status: 403 };
    const result = validateValue(prop, raw);
    if (!result.ok) return { ok: false, status: 400, message: result.error };
    put(checked, prop, result.value);
  }
  return { ok: true, checked };
}

/**
 * A new row's presets (its template, the view's filter and the group it was added in), kept only
 * for properties the person could set themselves and only when they still fit (an option may have
 * been deleted since). Empty presets are left out.
 */
export function checkPresets(
  presets: Readonly<Record<Id, unknown>>,
  properties: readonly Property[],
  viewer: PropertyViewer,
  access: AccessLevel,
): CheckedValues {
  const checked: CheckedValues = { values: {} };
  for (const [id, raw] of Object.entries(presets)) {
    const prop = findProperty(properties, id);
    if (!prop || !canChangeProperty(prop, viewer, access)) continue;
    const result = validateValue(prop, raw);
    if (result.ok && result.value !== null) put(checked, prop, result.value);
  }
  return checked;
}

/** The ids in a relation cell (anything else reads as none). */
export function linksOf(value: unknown): Id[] {
  return Array.isArray(value) ? value.filter((id): id is Id => typeof id === 'string') : [];
}

/**
 * A relation cell after someone edits it. They can only send the links they can see, so the links
 * they can't open stay, after theirs.
 */
export function keepHiddenLinks(
  sent: unknown,
  current: unknown,
  canOpen: (rowId: Id) => boolean,
): Id[] {
  const hidden = linksOf(current).filter((id) => !canOpen(id));
  return [...new Set([...linksOf(sent), ...hidden])];
}

/** The people a Person value names now and didn't before. */
export function addedPeople(before: unknown, after: unknown): Id[] {
  const was = new Set(linksOf(before));
  return [...new Set(linksOf(after))].filter((id) => !was.has(id));
}

/** True for a Person property that tells people when they're added (on unless turned off). */
export const notifies = (prop: Property): prop is Property<ConfigOf<'person'>> =>
  prop.config.type === 'person' && prop.config.notify !== false;

export const isRelation = (prop: Property | undefined): prop is Property<ConfigOf<'relation'>> =>
  prop?.config.type === 'relation';

/** JSON with object keys sorted, so values compare the same whichever order their keys are in. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Whether two stored values are the same (missing and null are both empty). */
export const sameValue = (a: unknown, b: unknown): boolean => stableJson(a) === stableJson(b);
