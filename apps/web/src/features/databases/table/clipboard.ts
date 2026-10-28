import {
  LIMITS,
  type ComputedValue,
  type EvalContext,
  type Id,
  type Property,
  type ReadValue,
} from '@carehub/databases';
import { computedKind } from '@carehub/databases/computed';
import { parseCsv, protectCell } from '@carehub/databases/csv';
import { formatValue } from '@carehub/databases/values';

/** A block of cells by their places on screen: lines top to bottom, columns left to right. */
export interface CellBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface CellPlace {
  row: number;
  column: number;
}

/** The block with these two cells at its corners. */
export function boxOf(a: CellPlace, b: CellPlace): CellBox {
  return {
    top: Math.min(a.row, b.row),
    bottom: Math.max(a.row, b.row),
    left: Math.min(a.column, b.column),
    right: Math.max(a.column, b.column),
  };
}

export const inBox = (box: CellBox | null, row: number, column: number): boolean =>
  box !== null && row >= box.top && row <= box.bottom && column >= box.left && column <= box.right;

/** A value with a tab, a line break or a quote at the start is quoted, as spreadsheets read it. */
const NEEDS_QUOTES = /[\t\r\n]|^"/;

/** Cells as tab-separated text, the way spreadsheets copy them: one line per row. */
export function toTsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((cells) =>
      cells.map((v) => (NEEDS_QUOTES.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join('\t'),
    )
    .join('\n');
}

/** Pasted text (a block copied from a spreadsheet) as rows of values, within CSV import's limits. */
export function fromTsv(text: string): string[][] {
  return parseCsv(text, '\t', { maxRows: LIMITS.csvRows, maxColumns: LIMITS.csvColumns })
    .slice(0, LIMITS.csvRows)
    .map((cells) => cells.slice(0, LIMITS.csvColumns));
}

/**
 * A cell as Ctrl+C copies it: the text CSV export writes (formulas and rollups their results), with
 * an apostrophe before text a spreadsheet would run as a formula. Pasting it back removes it.
 */
export function copyText(
  property: Property,
  cell: { value: unknown; computed?: ComputedValue },
  ctx: EvalContext,
): string {
  const value = (cell.computed ?? cell.value ?? null) as ReadValue;
  const text = formatValue(property, value, ctx, { forExport: true });
  const numbers = property.config.type === 'number' || computedKind(property) === 'number';
  return protectCell(text, numbers);
}

/** One pasted value and the cell it goes to (past the last line: a row to add). */
export interface PastedValue extends CellPlace {
  text: string;
}

/**
 * Where a pasted block goes: its top left value on (top, left). A single value pasted on a block
 * of cells (`fill`) goes into every one of them.
 */
export function pastedValues(
  clip: readonly (readonly string[])[],
  top: number,
  left: number,
  fill: CellBox | null = null,
): PastedValue[] {
  const first = clip[0];
  const only = clip.length === 1 && first?.length === 1 ? first[0] : undefined;
  if (fill && only !== undefined) {
    const out: PastedValue[] = [];
    for (let row = fill.top; row <= fill.bottom; row++) {
      for (let column = fill.left; column <= fill.right; column++) {
        out.push({ row, column, text: only });
      }
    }
    return out;
  }
  return clip.flatMap((cells, r) =>
    cells.map((text, c) => ({ row: top + r, column: left + c, text })),
  );
}

/** What finding related rows by title needs from the table. */
export interface TitleSource {
  databaseId: Id;
  properties: readonly Property[];
  rows: readonly { id: Id; title: string; values: Partial<Record<Id, unknown>> }[];
  rowTitles: Readonly<Record<Id, string>>;
}

/**
 * Rows by exact title, for pasting into relations (as ImportContext.findRows): the rows the table
 * shows when a relation points at its own database, and the related rows they link to.
 */
export function titleFinder({
  databaseId,
  properties,
  rows,
  rowTitles,
}: TitleSource): (targetDatabaseId: Id, title: string) => readonly Id[] {
  const byDatabase = new Map<Id, Map<string, Id[]>>();
  const add = (database: Id, title: string | undefined, id: Id) => {
    if (title === undefined) return;
    let titles = byDatabase.get(database);
    if (!titles) {
      titles = new Map();
      byDatabase.set(database, titles);
    }
    const ids = titles.get(title) ?? [];
    if (!ids.includes(id)) titles.set(title, [...ids, id]);
  };
  for (const row of rows) add(databaseId, row.title, row.id);
  for (const property of properties) {
    if (property.config.type !== 'relation') continue;
    const target = property.config.targetDatabaseId;
    for (const row of rows) {
      const linked = row.values[property.id];
      if (!Array.isArray(linked)) continue;
      for (const id of linked) if (typeof id === 'string') add(target, rowTitles[id], id);
    }
  }
  return (targetDatabaseId, title) => byDatabase.get(targetDatabaseId)?.get(title) ?? [];
}

/** Someone a pasted Person value can name. */
export interface PersonEntry {
  id: Id;
  name: string;
  email?: string;
}

/**
 * People by exact name or email, both ignoring case, for pasting into Person cells (as
 * ImportContext.findUser). A name two people share finds no one.
 */
export function personFinder(people: readonly PersonEntry[]): (text: string) => Id | undefined {
  const byName = new Map<string, Id | null>();
  const byEmail = new Map<string, Id>();
  for (const person of people) {
    const name = person.name.trim().toLowerCase();
    const known = byName.get(name);
    if (name) byName.set(name, known === undefined || known === person.id ? person.id : null);
    const email = person.email?.trim().toLowerCase();
    if (email) byEmail.set(email, person.id);
  }
  return (text) => {
    const key = text.trim().toLowerCase();
    return byName.get(key) ?? byEmail.get(key);
  };
}
