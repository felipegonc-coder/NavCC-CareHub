// The values an Add a row or Edit rows step sets, kept as the Databases lane stores them
// (decision 0200): text as rich text, options by ID, a date as Today or Now with an offset, a
// person as Me and a relation as This page. Also the simple filter Edit rows offers.
import {
  ME,
  newId,
  normalizeDecimal,
  THIS_PAGE,
  type DatabaseMeta,
  type FilterGroup,
  type Property,
} from '@carehub/databases';
import type { ButtonAction, StepNames } from '@carehub/extras/templates/buttons';
import { variableLabel } from '@carehub/extras/templates/content';

/** The property types a button can set. */
export const SETTABLE_TYPES = [
  'title',
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'checkbox',
  'url',
  'email',
  'phone',
  'person',
  'relation',
] as const;
export type SettableType = (typeof SETTABLE_TYPES)[number];

export type Values = Record<string, unknown>;

const isSettable = (type: string): type is SettableType =>
  (SETTABLE_TYPES as readonly string[]).includes(type);

export function settableProperties(meta: DatabaseMeta | undefined): Property[] {
  return (meta?.properties ?? []).filter((property) => isSettable(property.config.type));
}

type Option = { id: string; name: string };

export function optionsOf(property: Property): Option[] {
  const { config } = property;
  return config.type === 'select' || config.type === 'multi_select' || config.type === 'status'
    ? config.options
    : [];
}

/** What a property starts with when it's added to the step. */
export function firstValue(property: Property): unknown {
  switch (property.config.type) {
    case 'select':
    case 'status':
      return optionsOf(property)[0]?.id ?? null;
    case 'multi_select':
      return [];
    case 'date':
      return { dynamic: 'today' };
    case 'checkbox':
      return true;
    case 'person':
      return [ME];
    case 'relation':
      return [THIS_PAGE];
    case 'text':
      return [{ text: '' }];
    default:
      return '';
  }
}

/** The text of a title, text, number, link, email or phone value. */
export function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((span: unknown) =>
        typeof span === 'object' && span !== null && 'text' in span ? String(span.text) : '',
      )
      .join('');
  }
  return '';
}

/** The stored value for typed text. */
export function fromText(property: Property, text: string): unknown {
  return property.config.type === 'text' ? [{ text }] : text;
}

export interface DayValue {
  dynamic: 'today' | 'now';
  offsetDays: number;
}

export function dayOf(value: unknown): DayValue {
  const given = (typeof value === 'object' && value !== null ? value : {}) as {
    dynamic?: unknown;
    offsetDays?: unknown;
  };
  const days = Number(given.offsetDays ?? 0);
  return {
    dynamic: given.dynamic === 'now' ? 'now' : 'today',
    offsetDays: Number.isSafeInteger(days) ? days : 0,
  };
}

export function fromDay(day: DayValue): unknown {
  return day.offsetDays
    ? { dynamic: day.dynamic, offsetDays: day.offsetDays }
    : { dynamic: day.dynamic };
}

export const idsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

const listed = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** For the plain sentence: "Status New", "Due Today + 3 days", "Owner as the person who pressed it". */
export function valueName(property: Property, value: unknown): string {
  const { name } = property;
  switch (property.config.type) {
    case 'select':
    case 'status': {
      const option = optionsOf(property).find((item) => item.id === value);
      return `${name} ${option?.name ?? 'empty'}`;
    }
    case 'multi_select': {
      const ids = idsOf(value);
      const names = optionsOf(property)
        .filter((option) => ids.includes(option.id))
        .map((option) => option.name);
      return names.length ? `${name} ${listed(names)}` : `${name} empty`;
    }
    case 'date': {
      const day = dayOf(value);
      return `${name} ${variableLabel(day.dynamic, day.offsetDays)}`;
    }
    case 'checkbox':
      return `${name} ${value === true ? 'checked' : 'unchecked'}`;
    case 'person':
      return `${name} as the person who pressed it`;
    case 'relation':
      return `${name} as this page`;
    case 'number': {
      const text = textOf(value).trim();
      return text ? `${name} ${text}` : `${name} empty`;
    }
    default: {
      const text = textOf(value).trim();
      return text
        ? `${name} “${text.length > 40 ? `${text.slice(0, 39)}…` : text}”`
        : `${name} empty`;
    }
  }
}

/** The names for the sentence, in the database's property order. */
export function valueNames(meta: DatabaseMeta | undefined, values: Values): string[] {
  return settableProperties(meta)
    .filter((property) => property.id in values)
    .map((property) => valueName(property, values[property.id]));
}

/** The names an Add a row or Edit rows step keeps for the sentence: database, template, values. */
export function namesFor(
  action: Extract<ButtonAction, { kind: 'add_row' | 'edit_rows' }>,
  meta: DatabaseMeta,
): StepNames {
  const names: StepNames = { target: meta.title || 'Untitled' };
  if (action.kind === 'add_row' && action.templateId) {
    const template = meta.templates.find((item) => item.id === action.templateId);
    if (template) names.template = template.name;
  }
  const values = valueNames(meta, action.values);
  if (values.length > 0) names.values = values;
  return names;
}

/**
 * The values ready to save, or what's wrong: numbers become exact decimals, and choices that
 * need something chosen must have it.
 */
export function finishValues(
  meta: DatabaseMeta | undefined,
  values: Values,
): { values: Values; problem: string | null } {
  const out: Values = {};
  for (const [propertyId, value] of Object.entries(values)) {
    const property = meta?.properties.find((item) => item.id === propertyId);
    if (!property) {
      // Kept as it was when the database isn't loaded (or the property is hidden from them).
      out[propertyId] = value;
      continue;
    }
    switch (property.config.type) {
      case 'number': {
        const text = textOf(value).trim();
        const number = text ? normalizeDecimal(text) : null;
        if (number === null) return { values, problem: `${property.name} needs a number.` };
        out[propertyId] = number;
        break;
      }
      case 'select':
      case 'status':
        if (typeof value !== 'string')
          return { values, problem: `Choose a value for ${property.name}.` };
        out[propertyId] = value;
        break;
      default:
        out[propertyId] = value;
    }
  }
  return { values: out, problem: null };
}

// ---------------------------------------------------------------- Edit rows: which rows

/** The properties Edit rows can pick rows by. */
export function filterProperties(meta: DatabaseMeta | undefined): Property[] {
  return (meta?.properties ?? []).filter((property) =>
    ['select', 'status', 'checkbox', 'person'].includes(property.config.type),
  );
}

/** "Rows where Status is Open": one property and, for options, one option. */
export interface SimpleFilter {
  propertyId: string;
  /** An option ID; for a checkbox 'checked' or 'unchecked'; for a person 'me'. */
  value: string;
}

export function toFilter(property: Property, value: string): FilterGroup {
  const condition = (() => {
    switch (property.config.type) {
      case 'checkbox':
        return {
          op: value === 'unchecked' ? ('is_not_checked' as const) : ('is_checked' as const),
        };
      case 'person':
        return { op: 'contains_any' as const, value: [ME] };
      default:
        return { op: 'is' as const, value: [value] };
    }
  })();
  return {
    kind: 'group',
    id: newId(),
    combinator: 'and',
    children: [{ kind: 'condition', id: newId(), propertyId: property.id, ...condition }],
  };
}

/** The simple filter back from a stored one; null for every row, undefined for one set up elsewhere. */
export function fromFilter(filter: unknown): SimpleFilter | null | undefined {
  if (filter === null || filter === undefined) return null;
  const group = filter as Partial<FilterGroup>;
  const only = group.kind === 'group' && group.children?.length === 1 ? group.children[0] : null;
  if (!only || only.kind !== 'condition') return undefined;
  switch (only.op) {
    case 'is_checked':
      return { propertyId: only.propertyId, value: 'checked' };
    case 'is_not_checked':
      return { propertyId: only.propertyId, value: 'unchecked' };
    case 'contains_any':
      return { propertyId: only.propertyId, value: ME };
    case 'is': {
      const ids = Array.isArray(only.value) ? only.value : [];
      return typeof ids[0] === 'string'
        ? { propertyId: only.propertyId, value: ids[0] }
        : undefined;
    }
    default:
      return undefined;
  }
}

/** "that match a filter" is said by the sentence; this names it in the settings. */
export function filterName(meta: DatabaseMeta | undefined, simple: SimpleFilter): string {
  const property = meta?.properties.find((item) => item.id === simple.propertyId);
  if (!property) return 'Rows that match a filter';
  if (property.config.type === 'checkbox') return `${property.name} is ${simple.value}`;
  if (property.config.type === 'person') return `${property.name} is the person who pressed it`;
  const option = optionsOf(property).find((item) => item.id === simple.value);
  return `${property.name} is ${option?.name ?? 'an option that was removed'}`;
}
