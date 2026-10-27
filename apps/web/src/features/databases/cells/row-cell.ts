import { readValue, type ComputedValue, type Property, type Row } from '@carehub/databases';
import type { QueryRow } from '../contract';

/** What CellView and CellEditor take for one property of one row. */
export interface CellData {
  value: unknown;
  computed?: ComputedValue;
  hiddenLinks?: number;
}

const EMPTY: ComputedValue = { kind: 'empty' };
const asRow = (row: QueryRow): Row => ({
  ...row,
  createdAt: row.createdAt ?? '',
  editedAt: row.editedAt ?? '',
});
const instant = (at: string | null) => (at ? { start: at, end: null, hasTime: true } : null);

/**
 * A row's value for a property from a view's answer: `<CellView property={p} {...rowCell(row, p)}
 * ctx={ctx} />`. Formulas and rollups give their result, relations the links left out.
 */
export function rowCell(row: QueryRow, property: Property): CellData {
  switch (property.config.type) {
    case 'formula':
    case 'rollup':
      return { value: null, computed: row.computed[property.id] ?? EMPTY };
    case 'created_time':
      return { value: instant(row.createdAt) };
    case 'edited_time':
      return { value: instant(row.editedAt) };
    case 'relation':
      return {
        value: readValue(asRow(row), property),
        hiddenLinks: row.hiddenLinks[property.id] ?? 0,
      };
    default:
      return { value: readValue(asRow(row), property) };
  }
}
