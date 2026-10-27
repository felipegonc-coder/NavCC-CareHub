/** Reading a row's value for any property, with automatic properties (created, edited, ID) filled in. */
import { isCanonicalDecimal } from './decimal';
import { isValidDateValue } from './dates';
import { isSafeWebLink } from './richtext';
import { isVerificationValue } from './verification';
import type {
  ChecklistItem,
  ComputedValue,
  ConfigOf,
  DateValue,
  EvalContext,
  FileRef,
  Id,
  Property,
  PropertyType,
  RichText,
  Row,
  VerificationValue,
} from './types';

export interface ReadValueMap {
  title: string | null;
  text: RichText | null;
  number: string | null;
  select: Id | null;
  multi_select: Id[] | null;
  status: Id | null;
  date: DateValue | null;
  /** Never empty: unticked is false. */
  checkbox: boolean;
  url: string | null;
  email: string | null;
  phone: string | null;
  person: Id[] | null;
  files: FileRef[] | null;
  relation: Id[] | null;
  checklist: ChecklistItem[] | null;
  created_time: DateValue;
  edited_time: DateValue;
  /** null for anonymous form responses. */
  created_by: Id[] | null;
  edited_by: Id[] | null;
  formula: ComputedValue;
  rollup: ComputedValue;
  /** The number part as an exact decimal; the prefix is in the property config. */
  unique_id: string | null;
  button: null;
  /** null: Not verified. */
  verification: VerificationValue | null;
}
export type ReadValue = ReadValueMap[PropertyType];

const ids = (v: unknown): Id[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is Id => typeof x === 'string' && x !== '');
  return out.length ? out : null;
};
const objects = <T>(v: unknown, key: string): T[] | null =>
  Array.isArray(v) && v.length && v.every((x) => typeof x === 'object' && x !== null && key in x)
    ? (v as T[])
    : null;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The value of a property for a row. null (or a computed { kind: "empty" }) means empty. */
export function readValue<T extends PropertyType>(
  row: Row,
  prop: Property<ConfigOf<T>>,
  ctx?: Pick<EvalContext, 'computed'>,
): ReadValueMap[T];
export function readValue(
  row: Row,
  prop: Property,
  ctx?: Pick<EvalContext, 'computed'>,
): ReadValue {
  const raw = row.values[prop.id];
  switch (prop.config.type) {
    case 'title':
      return str(row.title);
    case 'text':
      return objects<RichText[number]>(raw, 'text');
    case 'number':
      return isCanonicalDecimal(raw) ? raw : null;
    case 'select':
    case 'status':
      return str(raw);
    case 'multi_select':
    case 'person':
    case 'relation':
      return ids(raw);
    case 'date':
      return isValidDateValue(raw) ? raw : null;
    case 'checkbox':
      return raw === true;
    case 'url': {
      // Stored values are checked on write too; reading checks again so an unsafe link never reaches an href (#12).
      const url = str(raw);
      return url !== null && isSafeWebLink(url) ? url : null;
    }
    case 'email':
    case 'phone':
      return str(raw);
    case 'files':
      return objects<FileRef>(raw, 'id');
    case 'checklist':
      return objects<ChecklistItem>(raw, 'id');
    case 'created_time':
      return { start: row.createdAt, end: null, hasTime: true };
    case 'edited_time':
      return { start: row.editedAt, end: null, hasTime: true };
    case 'created_by':
      return row.createdBy ? [row.createdBy] : null;
    case 'edited_by':
      return row.editedBy ? [row.editedBy] : null;
    case 'formula':
    case 'rollup':
      return ctx?.computed ? ctx.computed(row, prop.id) : { kind: 'empty' };
    case 'unique_id':
      return row.uniqueNumber === null ? null : String(row.uniqueNumber);
    case 'button':
      return null;
    case 'verification':
      return isVerificationValue(raw) ? raw : null;
  }
}

/** True for null, an unticked checkbox counts as a value (false), and empty computed values. */
export function isEmptyValue(v: ReadValue): boolean {
  if (v === null) return true;
  if (typeof v === 'object' && !Array.isArray(v) && 'kind' in v) {
    if (v.kind === 'empty') return true;
    if (v.kind === 'text') return v.value === '';
    if (v.kind === 'list') return v.value.length === 0;
  }
  return false;
}

export function findProperty(properties: readonly Property[], id: Id): Property | undefined {
  return properties.find((p) => p.id === id);
}

/** Every database has exactly one title property (Name). */
export function titleProperty(properties: readonly Property[]): Property<ConfigOf<'title'>> {
  const p = properties.find((x) => x.config.type === 'title');
  if (!p) throw new Error('Database has no title property');
  return p as Property<ConfigOf<'title'>>;
}

/** Matches a name ignoring case and spaces (CSV import, formulas). */
export function findPropertyByName(
  properties: readonly Property[],
  name: string,
): Property | undefined {
  const key = name.replace(/\s+/g, '').toLowerCase();
  return properties.find((p) => p.name.replace(/\s+/g, '').toLowerCase() === key);
}
