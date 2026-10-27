/**
 * The import preview (spec 3.7): which property each CSV column fills, and the type guessed for
 * columns that become new properties. Every match and type can be changed before importing.
 */
import { parseDateText, parseNumberText } from '../parse-text';
import { findPropertyByName } from '../row';
import { isStoredType } from '../schema';
import { LIMITS, type Id, type Property } from '../types';
import { checkboxWord, readEmailText, readUrlText } from './read';

/** Types guessed for new properties. */
export type GuessedType = 'number' | 'date' | 'checkbox' | 'url' | 'email' | 'select' | 'text';
/** Types a new property made by an import can have (a relation needs a target, so it's picked as an existing property). */
export type NewPropertyType =
  GuessedType | 'multi_select' | 'status' | 'phone' | 'person' | 'checklist';
export const NEW_PROPERTY_TYPES: readonly NewPropertyType[] = [
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
  'checklist',
];

export type ColumnTarget =
  | { kind: 'existing'; propertyId: Id }
  | { kind: 'new'; name: string; type: NewPropertyType }
  | { kind: 'skip' };

export interface ColumnPlan {
  /** Position of the column in the file (0-based). */
  index: number;
  /** The column's name as shown: its header, or "Column 3" when it has none. */
  header: string;
  target: ColumnTarget;
}

/** Column names and data rows of a file table. */
export interface CsvSheet {
  /** Header cells trimmed ("" when missing), one per column of the widest row. All "" without a header row. */
  headers: string[];
  rows: string[][];
  /** File row number of rows[0]: 2 below a header row, else 1. */
  firstRowNumber: number;
}

/** Splits a parsed file into column names and data rows ("First row is headers" is on by default). */
export function splitTable(table: readonly string[][], firstRowIsHeaders = true): CsvSheet {
  const width = table.reduce((w, r) => Math.max(w, r.length), 0);
  const head = firstRowIsHeaders ? (table[0] ?? []) : [];
  return {
    headers: Array.from({ length: width }, (_, i) => (head[i] ?? '').trim()),
    rows: table.slice(firstRowIsHeaders ? 1 : 0),
    firstRowNumber: firstRowIsHeaders ? 2 : 1,
  };
}

/** The values of one column ("" where a row is short). */
export function columnValues(rows: readonly (readonly string[])[], index: number): string[] {
  return rows.map((r) => r[index] ?? '');
}

/** Whether an import can fill this property: stored types except Files (the rest fill themselves). */
export function canImportInto(prop: Property): boolean {
  return isStoredType(prop.config.type) && prop.config.type !== 'files';
}

/** Any time zone reads the same way; only "today" words use it. */
const GUESS_VIEWER = { timeZone: 'UTC', now: new Date(0) };

/** Whether every value is a date read month first (10/26/2026), or else day first (26/10/2026); null if neither. */
export function dateOrder(values: readonly string[]): 'month_first' | 'day_first' | null {
  const all = (dayFirst: boolean) =>
    values.every((v) => parseDateText(v, { viewer: GUESS_VIEWER, dayFirst }) !== null);
  return all(false) ? 'month_first' : all(true) ? 'day_first' : null;
}

/**
 * The type for a new property from its values: Number, Date, Checkbox, Link or Email if every
 * non-empty value fits (in that order); Select if there are 50 or fewer different values, some
 * repeat, and each could be an option name; otherwise Text. No values at all gives Text.
 */
export function guessType(values: readonly string[]): GuessedType {
  const vals = values.map((v) => v.trim()).filter((v) => v !== '');
  if (!vals.length) return 'text';
  if (vals.every((v) => parseNumberText(v) !== null)) return 'number';
  if (dateOrder(vals) !== null) return 'date';
  if (vals.every((v) => checkboxWord(v) !== null)) return 'checkbox';
  if (vals.every((v) => /^(?:https?:\/\/|www\.)/i.test(v) && readUrlText(v) !== null)) return 'url';
  if (vals.every((v) => readEmailText(v) !== null)) return 'email';
  const distinct = new Set(vals.map((v) => v.replace(/\s+/g, ' ').toLowerCase()));
  const optionLike = vals.every((v) => v.length <= LIMITS.optionName && !/[,\r\n]/.test(v));
  if (optionLike && distinct.size <= 50 && distinct.size < vals.length) return 'select';
  return 'text';
}

/** Property names compared as CSV matching does: ignoring case and spaces. */
const nameKey = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

/** Cuts to `max` UTF-16 units without splitting a surrogate pair. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** The header as a property name, made unique ("Notes 2") among `taken` (which it joins). */
function uniqueName(header: string, taken: Set<string>): string {
  const base = clip(header, LIMITS.propertyName).trim();
  let name = base;
  for (let n = 2; taken.has(nameKey(name)); n++) {
    const suffix = ` ${n}`;
    name = `${clip(base, LIMITS.propertyName - suffix.length).trimEnd()}${suffix}`;
  }
  taken.add(nameKey(name));
  return name;
}

/**
 * The first plan for a file's columns. A column fills the property with the same name (ignoring
 * case and spaces); Name gets the first column unless another one is named like it. Columns
 * matching Files, created or edited properties, ID, formulas or rollups are skipped (they can only
 * be imported as a new Text property). Other columns become new properties with a unique name and
 * the type guessed from `rows` (the data rows), unless `canAddProperties` is false (Lock structure)
 * or the column has neither a header nor values, which are skipped.
 */
export function matchColumns(
  headers: readonly string[],
  properties: readonly Property[],
  rows: readonly (readonly string[])[] = [],
  opts: { canAddProperties?: boolean } = {},
): ColumnPlan[] {
  const title = properties.find((p) => p.config.type === 'title');
  const named = headers.map((h) => (h.trim() ? findPropertyByName(properties, h) : undefined));
  let titleColumn = title ? named.indexOf(title) : -1;
  if (title && titleColumn === -1 && headers.length) titleColumn = 0;
  const used = new Set<Id>();
  const taken = new Set(properties.map((p) => nameKey(p.name)));
  return headers.map((raw, index): ColumnPlan => {
    const header = raw.replace(/\s+/g, ' ').trim() || `Column ${index + 1}`;
    const p = index === titleColumn ? title : named[index];
    if (p && !used.has(p.id) && (index === titleColumn || p !== title)) {
      used.add(p.id);
      const target: ColumnTarget = canImportInto(p)
        ? { kind: 'existing', propertyId: p.id }
        : { kind: 'skip' };
      return { index, header, target };
    }
    const values = columnValues(rows, index);
    if (opts.canAddProperties === false || (!raw.trim() && values.every((v) => !v.trim()))) {
      return { index, header, target: { kind: 'skip' } };
    }
    return {
      index,
      header,
      target: { kind: 'new', name: uniqueName(header, taken), type: guessType(values) },
    };
  });
}

/**
 * Checks a plan sent by the import dialog: every existing target can be filled and gets one
 * column, and new properties have valid, unique names and importable types. Returns the problem, or null.
 */
export function validatePlan(
  plan: readonly ColumnPlan[],
  properties: readonly Property[],
): string | null {
  const used = new Set<Id>();
  const taken = new Set(properties.map((p) => nameKey(p.name)));
  let added = 0;
  for (const column of plan) {
    const t = column.target;
    if (t.kind === 'existing') {
      const p = properties.find((x) => x.id === t.propertyId);
      if (!p) return `The property chosen for "${column.header}" was deleted.`;
      if (!canImportInto(p)) return `"${p.name}" can't be filled from a CSV file.`;
      if (used.has(p.id)) return `Only one column can fill "${p.name}".`;
      used.add(p.id);
    } else if (t.kind === 'new') {
      const name = t.name.trim();
      if (!name) return 'Enter a name for each new property.';
      if (name.length > LIMITS.propertyName) return 'Property names can be up to 100 characters.';
      if (taken.has(nameKey(name))) return `A property named "${name}" already exists.`;
      if (!NEW_PROPERTY_TYPES.includes(t.type)) return `"${name}" can't be made from a CSV file.`;
      taken.add(nameKey(name));
      added++;
    }
  }
  if (properties.length + added > LIMITS.properties) {
    return `A database can have up to ${LIMITS.properties} properties.`;
  }
  return null;
}
