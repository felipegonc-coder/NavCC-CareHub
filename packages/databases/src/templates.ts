/**
 * Row templates (additions 6; Templates and buttons 3.2–3.3): presets resolved when a template is
 * used (Today + 3 days, Now, Me, This page), the values a new row starts with, applying a template
 * to an existing row, which template New uses, and checks before a template is saved.
 */
import {
  addDays,
  isValidDateValue,
  toCalendarDate,
  todayIn,
  zonedParts,
  zonedToInstant,
} from './dates';
import { findProperty } from './row';
import { isStoredType } from './schema';
import {
  LIMITS,
  ME,
  THIS_PAGE,
  type ConfigOf,
  type DatabaseMeta,
  type DateValue,
  type DynamicDate,
  type Id,
  type Property,
  type Row,
  type RowTemplate,
  type View,
  type Viewer,
} from './types';

/** Messages, word for word. */
export const TEMPLATE_MESSAGES = {
  tooMany: 'Up to 50 templates.',
  nameTooLong: 'Names can be up to 2,000 characters.',
  noProperty: "That property doesn't exist.",
  notPreset: "This property can't have a preset value.",
  dynamicDate: 'Only Date properties can be Today or Now.',
  me: 'Only Person properties can be Me.',
  thisPage: 'Only Relation properties can be This page.',
  onePerson: 'This property allows one person only.',
  oneRow: 'This relation allows one row only.',
} as const;

/** Who is using a template, and where: what its Today, Now, Me and This page become. */
export interface TemplateViewer extends Pick<Viewer, 'userId' | 'timeZone' | 'now'> {
  /** The page This page stands for: the new row (or the row a template is applied to). */
  thisPageId?: Id | null;
}

/** True for a preset date that resolves on use: Today or Now, plus a whole number of days. */
export function isDynamicDate(v: unknown): v is DynamicDate {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const { dynamic, offsetDays } = v as { dynamic?: unknown; offsetDays?: unknown };
  const offsetOk = offsetDays === undefined || Number.isSafeInteger(offsetDays);
  return (dynamic === 'today' || dynamic === 'now') && offsetOk;
}

/**
 * A preset date for this person: Today (+ offsetDays) is a day in their time zone; Now is this
 * moment with its time, moved by whole days on their clock (the time of day holds across clock
 * changes).
 */
export function resolveDynamicDate(
  value: DynamicDate,
  viewer: Pick<Viewer, 'timeZone' | 'now'>,
): DateValue {
  const days = value.offsetDays ?? 0;
  if (value.dynamic === 'today') {
    return { start: addDays(todayIn(viewer), days), end: null, hasTime: false };
  }
  if (days === 0) return { start: viewer.now.toISOString(), end: null, hasTime: true };
  const p = zonedParts(viewer.now, viewer.timeZone);
  const wall = zonedToInstant(addDays(toCalendarDate(p), days), p.hour, p.minute, viewer.timeZone);
  const withinMinute = ((viewer.now.getTime() % 60_000) + 60_000) % 60_000;
  return {
    start: new Date(Date.parse(wall) + withinMinute).toISOString(),
    end: null,
    hasTime: true,
  };
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const optionIds = (c: ConfigOf<'select'> | ConfigOf<'multi_select'> | ConfigOf<'status'>) =>
  new Set(c.options.map((o) => o.id));

/** A list of ids with `variable` swapped for what it stands for, without repeats; null when empty. */
function resolveIds(
  value: unknown,
  variable: string,
  standsFor: Id | null | undefined,
  single: boolean,
): Id[] | null {
  if (!Array.isArray(value)) return null;
  const ids = [...new Set(value.map((id: unknown) => (id === variable ? standsFor : id)))].filter(
    (id): id is Id => typeof id === 'string' && id !== '' && id !== ME && id !== THIS_PAGE,
  );
  if (!ids.length) return null;
  return single ? ids.slice(0, 1) : ids;
}

/**
 * One preset in stored form for this person: dates as above, Me in a person list is them, This
 * page in a relation is thisPageId (one person or row only keeps the first). Options deleted since
 * are dropped. null when nothing's left; anything else is a fresh copy.
 */
function resolvePreset(prop: Property, value: unknown, viewer: TemplateViewer): unknown {
  const c = prop.config;
  if (value === null || value === undefined || value === '') return null;
  switch (c.type) {
    case 'date':
      if (isDynamicDate(value)) return resolveDynamicDate(value, viewer);
      return isValidDateValue(value) ? copy(value) : null;
    case 'person':
      return resolveIds(value, ME, viewer.userId, c.single);
    case 'relation':
      return resolveIds(value, THIS_PAGE, viewer.thisPageId, c.single);
    case 'select':
    case 'status':
      return typeof value === 'string' && optionIds(c).has(value) ? value : null;
    case 'multi_select': {
      if (!Array.isArray(value)) return null;
      const known = optionIds(c);
      const kept = value.filter((id: unknown): id is Id => typeof id === 'string' && known.has(id));
      return kept.length ? kept : null;
    }
    default:
      return isDynamicDate(value) || (Array.isArray(value) && !value.length) ? null : copy(value);
  }
}

/**
 * A template's preset values resolved for the person using it. Properties that were deleted or
 * that can't hold a value (created and edited, ID, formula, rollup, button) are left out. The Name
 * preset, if any, is under the Name property's id (it becomes Row.title).
 */
export function resolveTemplateValues(
  template: Pick<RowTemplate, 'values'>,
  properties: readonly Property[],
  viewer: TemplateViewer,
): Record<Id, unknown> {
  const out: Record<Id, unknown> = {};
  for (const [id, value] of Object.entries(template.values)) {
    const prop = findProperty(properties, id);
    if (!prop || !isStoredType(prop.config.type)) continue;
    const resolved = resolvePreset(prop, value, viewer);
    if (resolved !== null) out[id] = resolved;
  }
  return out;
}

/** A property value set by where the row was added: a board column or lane, a calendar day. */
export interface GroupValue {
  propertyId: Id;
  /** null puts the row under "No value". */
  value: unknown;
}

/** What decides a new row's values. */
export interface NewRowInput {
  properties: readonly Property[];
  /** The template New uses (defaultTemplate), or null for an empty row. */
  template?: Pick<RowTemplate, 'values'> | null;
  /** Values from the view's simple filters (prefillFromFilter). */
  filterPrefill?: Readonly<Record<Id, unknown>> | null;
  /** Where the row was added: a column (and its lane on a board with sub-groups), or a day. */
  groupValue?: GroupValue | readonly GroupValue[] | null;
  /** The person adding it; thisPageId is the new row's id. */
  viewer: TemplateViewer;
}

/** The default status for new rows: the chosen default, else the first To-do option, else the first. */
export function defaultStatusId(config: ConfigOf<'status'>): Id | null {
  const options = config.options;
  const chosen = options.find((o) => o.id === config.defaultOptionId);
  return (chosen ?? options.find((o) => o.group === 'todo') ?? options[0])?.id ?? null;
}

/**
 * The values a new row starts with. The group value (column, lane or day) beats the filter
 * prefill, which beats the template; null in the group value or prefill leaves that property
 * empty. Status gets its default and checkboxes start unticked when nothing else sets them; the
 * rest stays empty. Only properties that store a value are included.
 */
export function newRowValues(input: NewRowInput): Record<Id, unknown> {
  const values: Record<Id, unknown> = {};
  const cleared = new Set<Id>();
  const put = (propertyId: Id, value: unknown) => {
    const prop = findProperty(input.properties, propertyId);
    if (!prop || !isStoredType(prop.config.type)) return;
    const resolved = resolvePreset(prop, value, input.viewer);
    if (resolved === null) {
      delete values[propertyId];
      cleared.add(propertyId);
    } else {
      values[propertyId] = resolved;
      cleared.delete(propertyId);
    }
  };
  if (input.template) {
    Object.assign(values, resolveTemplateValues(input.template, input.properties, input.viewer));
  }
  for (const [id, value] of Object.entries(input.filterPrefill ?? {})) put(id, value);
  const groups = input.groupValue ?? [];
  for (const g of Array.isArray(groups) ? groups : [groups]) put(g.propertyId, g.value);
  for (const prop of input.properties) {
    if (prop.id in values || cleared.has(prop.id)) continue;
    if (prop.config.type === 'checkbox') values[prop.id] = false;
    if (prop.config.type === 'status') {
      const status = defaultStatusId(prop.config);
      if (status) values[prop.id] = status;
    }
  }
  return values;
}

/** What applying a template changes on a row. */
export interface TemplatePatch {
  /** The new title, when it changes. */
  title?: string;
  /** Property id → new value, for the values that change. */
  values: Record<Id, unknown>;
}

/** Empty for applying a template: no value, or what every new row starts with. */
function isUnset(prop: Property, v: unknown): boolean {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return true;
  if (prop.config.type === 'checkbox') return v === false;
  return prop.config.type === 'status' && v === defaultStatusId(prop.config);
}

/**
 * The changes applying a template to an existing row makes ("Start with" on an empty row page, or
 * Apply template). Presets resolve as for a new row, This page being this row. They fill only
 * empty properties (an unticked checkbox and the default status count as empty) unless `replace`
 * ("Replace values") is on. Only what changes is returned; adding the template's content at the
 * end and saving a version first are the server's.
 */
export function applyTemplateValues(
  row: Pick<Row, 'id' | 'title' | 'values'>,
  template: Pick<RowTemplate, 'values'>,
  opts: { replace: boolean; properties: readonly Property[]; viewer: TemplateViewer },
): TemplatePatch {
  const viewer: TemplateViewer = { ...opts.viewer, thisPageId: row.id };
  const patch: TemplatePatch = { values: {} };
  const presets = resolveTemplateValues(template, opts.properties, viewer);
  for (const [id, value] of Object.entries(presets)) {
    const prop = findProperty(opts.properties, id);
    if (!prop) continue;
    if (prop.config.type === 'title') {
      const fill = opts.replace || row.title === '';
      if (fill && typeof value === 'string' && value !== row.title) patch.title = value;
      continue;
    }
    const current = row.values[id];
    if (!opts.replace && !isUnset(prop, current)) continue;
    if (JSON.stringify(current) !== JSON.stringify(value)) patch.values[id] = value;
  }
  return patch;
}

/**
 * The template New uses in a view: the view's default, otherwise the database's, otherwise none
 * (an empty row). A view set to an empty row (null) gets none; a view default that was deleted
 * falls back to the database's.
 */
export function defaultTemplate(
  view: Pick<View, 'defaultTemplateId'> | null | undefined,
  database: Pick<DatabaseMeta, 'templates' | 'defaultTemplateId'>,
): RowTemplate | null {
  const find = (id: Id | null | undefined) =>
    id ? (database.templates.find((t) => t.id === id) ?? null) : null;
  if (view && view.defaultTemplateId === null) return null;
  return find(view?.defaultTemplateId) ?? find(database.defaultTemplateId);
}

/** Checks one preset value; null when it's fine. */
type ValidatePreset = (
  prop: Property,
  value: unknown,
) => { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Checks a template before it's saved; the first problem, or null. With `others` (the database's
 * other templates), a new one is refused past 50. Presets must be on properties that store a
 * value; Today and Now only on dates; Me only in Person lists; This page only in Relation lists.
 * `validate` (validateValue) checks every other preset the way a cell is checked.
 */
export function validateTemplate(
  template: RowTemplate,
  properties: readonly Property[],
  opts: { others?: readonly RowTemplate[]; validate?: ValidatePreset } = {},
): string | null {
  const others = opts.others ?? [];
  const isNew = !others.some((t) => t.id === template.id);
  if (isNew && others.length >= LIMITS.templates) return TEMPLATE_MESSAGES.tooMany;
  if (template.name.length > LIMITS.title) return TEMPLATE_MESSAGES.nameTooLong;
  for (const [id, raw] of Object.entries(template.values)) {
    if (raw === null || raw === undefined) continue;
    const prop = findProperty(properties, id);
    if (!prop) return TEMPLATE_MESSAGES.noProperty;
    const c = prop.config;
    if (!isStoredType(c.type)) return TEMPLATE_MESSAGES.notPreset;
    if (isDynamicDate(raw)) {
      if (c.type !== 'date') return TEMPLATE_MESSAGES.dynamicDate;
      continue;
    }
    let value: unknown = raw;
    if (Array.isArray(raw)) {
      if (raw.includes(ME) && c.type !== 'person') return TEMPLATE_MESSAGES.me;
      if (raw.includes(THIS_PAGE) && c.type !== 'relation') return TEMPLATE_MESSAGES.thisPage;
      const rest = raw.filter((x: unknown) => x !== ME && x !== THIS_PAGE);
      if ((c.type === 'person' || c.type === 'relation') && rest.length < raw.length) {
        const one = c.type === 'person' ? TEMPLATE_MESSAGES.onePerson : TEMPLATE_MESSAGES.oneRow;
        if (c.single && rest.length > 0) return one;
        if (!rest.length) continue;
        value = rest;
      }
    }
    const result = opts.validate?.(prop, value);
    if (result && !result.ok) return result.error;
  }
  return null;
}
