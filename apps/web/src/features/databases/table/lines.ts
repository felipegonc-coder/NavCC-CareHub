import type { Id, Property, Row } from '@carehub/databases';
import type { QueryGroup, QueryRow, ViewData } from '../contract';
import { sameStored } from './edits';
import { visibleRows } from './nesting';

/** One row on screen. A row can sit in several groups (multi-select), so lines have their own key. */
export interface Line {
  key: string;
  row: QueryRow;
  /** A row made here that the newer answer leaves out: "Hidden by filter". */
  hidden: boolean;
}

/** The whole list (key '') or one group. */
export interface Section {
  key: string;
  group: QueryGroup | null;
  lines: Line[];
  collapsed: boolean;
  nextCursor: string | null;
}

export interface CellAt {
  line: string;
  propertyId: Id;
}

export interface Editing extends CellAt {
  initialText?: string;
}

/** A row made with New, kept on screen until the answer has it. */
export interface Created {
  row: QueryRow;
  sectionKey: string;
  /** The answer when it was made: a newer answer without it means a filter hides it. */
  data: ViewData;
}

export const lineKey = (sectionKey: string, rowId: Id) => JSON.stringify([sectionKey, rowId]);
export const cellKey = (line: string, propertyId: Id) => JSON.stringify([line, propertyId]);

/** Types that can't be typed into a cell to start editing it. */
export const NO_TYPING = new Set(['checkbox', 'files', 'button']);

/** Elements inside a cell that handle their own presses. */
export const OWN_PRESS = 'button, a, input, textarea, select, [data-cell-editor]';

/** The selection column in the active-cell state, and its width (px, as `w-11`). */
export const SELECT_KEY = '#select';
export const SELECT_WIDTH = 44;

/** Types "Set property" can give every ticked row at once. */
export const BULK_TYPES = new Set([
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
]);

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

/** One value to write: the history keeps what it replaces. */
export interface Write {
  row: QueryRow;
  property: Property;
  value: unknown;
}

export function asQueryRow(row: Row): QueryRow {
  return {
    id: row.id,
    title: row.title,
    icon: row.icon ?? null,
    formId: row.formId ?? null,
    values: row.values,
    computed: {},
    hiddenLinks: {},
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    editedAt: row.editedAt,
    editedBy: row.editedBy,
    uniqueNumber: row.uniqueNumber,
  };
}

export function withValues(
  row: QueryRow,
  properties: readonly Property[],
  values: Partial<Record<Id, unknown>>,
): QueryRow {
  let next = row;
  for (const [id, value] of Object.entries(values)) {
    next =
      properties.find((p) => p.id === id)?.config.type === 'title'
        ? { ...next, title: typeof value === 'string' ? value : '' }
        : { ...next, values: { ...next.values, [id]: value } };
  }
  return next;
}

/** Same stored value; an empty Name is '' or null. */
export function sameCell(property: Property, a: unknown, b: unknown): boolean {
  const plain = (v: unknown) => (property.config.type === 'title' && v === '' ? null : v);
  return sameStored(plain(a), plain(b));
}

export function inAnswer(data: ViewData, rowId: Id): boolean {
  if (data.groups) return data.groups.some((g) => g.rows.some((r) => r.id === rowId));
  return data.rows.some((r) => r.id === rowId);
}

export interface SectionsInput {
  data: ViewData;
  /** Rows made here that the answer may not have yet. */
  created: readonly Created[];
  /** The collapsed groups' keys. */
  collapsed: ReadonlySet<string>;
  /** With sub-items nested: whether a row's sub-items show (null: rows aren't nested). */
  open: ((row: QueryRow) => boolean) | null;
}

/** The whole list, or each group the view shows, with its lines (rows made here at the end). */
export function buildSections({ data, created, collapsed, open }: SectionsInput): Section[] {
  const section = (
    key: string,
    group: QueryGroup | null,
    rows: readonly QueryRow[],
    nextCursor: string | null,
  ): Section => {
    const shown = new Set(rows.map((r) => r.id));
    const showing = open ? visibleRows(rows, open) : rows;
    const lines: Line[] = showing.map((row) => ({ key: lineKey(key, row.id), row, hidden: false }));
    for (const c of created) {
      if (c.sectionKey !== key || shown.has(c.row.id)) continue;
      shown.add(c.row.id);
      lines.push({
        key: lineKey(key, c.row.id),
        row: c.row,
        hidden: c.data !== data && !data.refreshing,
      });
    }
    return {
      key,
      group,
      lines,
      collapsed: group !== null && collapsed.has(group.collapsedKey),
      nextCursor,
    };
  };
  if (data.groups) {
    return data.groups.filter((g) => !g.hidden).map((g) => section(g.key, g, g.rows, g.nextCursor));
  }
  return [section('', null, data.rows, data.nextCursor)];
}

/** A section's row numbers for screen readers (`aria-rowindex`; 0: no such row). */
export interface SectionNumbers {
  /** The group's heading row. */
  head: number;
  first: number;
  /** "Load more". */
  more: number;
  /** "New". */
  add: number;
  /** The group's totals. */
  totals: number;
}

/**
 * Row numbers counting the header row as 1, for when rows are left out (virtual rows): each
 * section's heading, first line, "Load more", "New" and totals, and the last number used.
 */
export function numberRows(
  sections: readonly Section[],
  canAdd: boolean,
): { of: Map<string, SectionNumbers>; last: number } {
  let last = 1;
  const next = () => (last += 1);
  const of = new Map<string, SectionNumbers>();
  for (const section of sections) {
    const head = section.group ? next() : 0;
    if (section.collapsed) {
      of.set(section.key, { head, first: 0, more: 0, add: 0, totals: 0 });
      continue;
    }
    const first = last + 1;
    last += section.lines.length;
    const more = section.nextCursor !== null ? next() : 0;
    const add = canAdd ? next() : 0;
    const totals = section.group && Object.keys(section.group.totals).length > 0 ? next() : 0;
    of.set(section.key, { head, first, more, add, totals });
  }
  return { of, last };
}
