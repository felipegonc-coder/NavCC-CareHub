import type { Id, Property, SelectOption } from '@carehub/databases';
import { readCell, type ImportContext } from '@carehub/databases/csv';
import { REQUEST_LIMITS } from '@carehub/databases/schemas';
import type { NewRow, QueryRow } from '../contract';
import type { PastedValue } from './clipboard';
import { usesOptions, withOptions, withSavedOptions } from './edits';
import type { Write } from './history';

/** Most rows one paste changes, updated and added together (as for POST /rows/bulk). */
export const PASTE_ROWS = 500;

/** Types a pasted value can go into (read as CSV import reads them). */
export const PASTE_TYPES = new Set([
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
  'checklist',
]);

/** What reading a paste needs from the table. */
export interface PasteTarget {
  /** The rows on screen, top to bottom: values past the last one make rows. */
  lines: readonly { row: QueryRow }[];
  /** The columns' properties, left to right. */
  properties: readonly Property[];
  /** The line the block starts on. */
  top: number;
  canEdit(property: Property): boolean;
  canAdd: boolean;
  /** Names pasted into Select and Multi-select can add options (Can edit, Lock structure off). */
  canAddOptions: boolean;
  ctx: ImportContext;
}

/** What a paste writes. */
export interface PasteResult {
  writes: Write[];
  /** Rows to add, top to bottom. */
  newRows: NewRow[];
  /** Options to add before writing, by property. */
  newOptions: Map<Id, SelectOption[]>;
  /** Values that didn't fit. */
  skipped: number;
}

const optionCount = (property: Property) =>
  property.config.type === 'select' || property.config.type === 'multi_select'
    ? property.config.options.length
    : 0;

/**
 * Pasted values read as CSV import reads them. Names a Select or Multi-select doesn't have become
 * options to add (once each, up to the 1,000 a property holds); Status options aren't added.
 * Values that don't fit are skipped and counted, as are those past the first PASTE_ROWS rows.
 */
export function readPaste(values: readonly PastedValue[], target: PasteTarget): PasteResult {
  const { lines, properties, top, canEdit, canAdd, canAddOptions, ctx } = target;
  const writes: Write[] = [];
  const newRows = new Map<number, NewRow>();
  const newOptions = new Map<Id, SelectOption[]>();
  // The properties with the options added so far, so a name pasted twice makes one option.
  const grown = new Map<Id, Property>();
  let skipped = 0;
  for (const { row, column, text } of values) {
    const property = properties[column];
    const line = lines[row];
    if (
      row - top >= PASTE_ROWS ||
      !property ||
      !canEdit(property) ||
      !PASTE_TYPES.has(property.config.type) ||
      (!line && !canAdd)
    ) {
      if (text.trim() !== '') skipped += 1;
      continue;
    }
    const current = grown.get(property.id) ?? property;
    const read = readCell(current, text, ctx);
    const made = read.ok ? (read.newOptions ?? []) : [];
    const adds = canAddOptions && property.config.type !== 'status';
    if (
      !read.ok ||
      (made.length > 0 && (!adds || optionCount(current) + made.length > REQUEST_LIMITS.options))
    ) {
      skipped += 1;
      continue;
    }
    if (made.length > 0) {
      grown.set(property.id, withOptions(current, made));
      newOptions.set(property.id, [...(newOptions.get(property.id) ?? []), ...made]);
    }
    if (line) {
      writes.push({ row: line.row, property, value: read.value });
    } else if (read.value !== null) {
      const input = newRows.get(row) ?? {};
      newRows.set(
        row,
        property.config.type === 'title'
          ? { ...input, title: String(read.value) }
          : { ...input, values: { ...input.values, [property.id]: read.value } },
      );
    }
  }
  return { writes, newRows: [...newRows.values()], newOptions, skipped };
}

/**
 * The paste with the ids addOptions saved, by property (null: the options couldn't be added, so
 * the values that need them are skipped and counted).
 */
export function withSavedIds(
  pasted: PasteResult,
  saved: ReadonlyMap<Id, Readonly<Record<Id, Id>> | null>,
): PasteResult {
  let skipped = pasted.skipped;
  const typed = new Map(
    [...pasted.newOptions].map(([id, options]) => [id, new Set(options.map((o) => o.id))]),
  );
  /** The value to save, or undefined when it can't be. */
  const savedValue = (propertyId: Id, value: unknown): unknown => {
    const ids = saved.get(propertyId);
    if (ids) return withSavedOptions(value, ids);
    const missing = typed.get(propertyId);
    if (!missing || !usesOptions(value, missing)) return value;
    skipped += 1;
    return undefined;
  };
  const writes = pasted.writes.flatMap((write): Write[] => {
    const value = savedValue(write.property.id, write.value);
    return value === undefined ? [] : [{ ...write, value }];
  });
  // A row left with nothing to fill isn't added.
  const newRows = pasted.newRows.flatMap((input): NewRow[] => {
    if (!input.values) return [input];
    const values: Partial<Record<Id, unknown>> = {};
    for (const [id, value] of Object.entries(input.values)) {
      const next = savedValue(id, value);
      if (next !== undefined) values[id] = next;
    }
    const left = Object.keys(values).length > 0;
    if (!left && input.title === undefined) return [];
    return [left ? { ...input, values } : { title: input.title }];
  });
  return { writes, newRows, newOptions: new Map(), skipped };
}
