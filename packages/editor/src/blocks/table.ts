import type { AnyExtension, Editor } from '@tiptap/core';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import {
  Fragment,
  Slice,
  type Node as ProseMirrorNode,
  type NodeType,
  type Schema,
} from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { isInTable, moveTableRow, selectedRect, TableMap } from '@tiptap/pm/tables';

/** The most rows and columns a table has (spec 3.4). */
export const TABLE_MAX_ROWS = 1000;
export const TABLE_MAX_COLUMNS = 50;

/** The width of a column nobody has resized, in CSS pixels. */
export const TABLE_COLUMN_WIDTH = 120;

/** The narrowest a column can be made by dragging its edge. */
export const TABLE_CELL_MIN_WIDTH = 40;

/** The background colors a cell can have: the kit's color names ("Default" is none). */
export const CELL_COLORS = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;

export type CellColor = (typeof CELL_COLORS)[number];

/** `value` if it's a cell color, else null. */
export function cellColor(value: unknown): CellColor | null {
  return CELL_COLORS.find((color) => color === value) ?? null;
}

/** A range of whole rows and columns: `left` and `top` are in it, `right` and `bottom` aren't. */
export interface CellRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What attribute parsers read from an element: typed so, the server needs no DOM types. */
interface Attributed {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

/**
 * The width of each column in CSS pixels, from the first row, or null for a column nobody has
 * resized. A cell spanning columns holds one width per column (`colwidth`).
 */
export function columnWidths(table: ProseMirrorNode): (number | null)[] {
  const widths: (number | null)[] = [];
  table.firstChild?.forEach((cell) => {
    const span = typeof cell.attrs.colspan === 'number' ? cell.attrs.colspan : 1;
    const colwidth: unknown = cell.attrs.colwidth;
    for (let index = 0; index < span; index += 1) {
      const width = Array.isArray(colwidth) ? colwidth[index] : null;
      widths.push(typeof width === 'number' && width > 0 ? width : null);
    }
  });
  return widths;
}

/** Each cell in `rect`, with its position in the document. */
function cellsIn(table: ProseMirrorNode, tablePos: number, rect: CellRect) {
  return TableMap.get(table)
    .cellsInRect(rect)
    .flatMap((offset) => {
      const cell = table.nodeAt(offset);
      return cell ? [{ cell, pos: tablePos + 1 + offset }] : [];
    });
}

/** Sets the background of the cells in `rect` of the table at `tablePos` (null clears it). */
export function colorCells(
  tr: Transaction,
  tablePos: number,
  rect: CellRect,
  color: CellColor | null,
): Transaction {
  const table = tr.doc.nodeAt(tablePos);
  if (!table) return tr;
  for (const { cell, pos } of cellsIn(table, tablePos, rect)) {
    if (cell.attrs.background !== color) {
      tr.setNodeMarkup(pos, null, { ...cell.attrs, background: color });
    }
  }
  return tr;
}

/** Empties the cells in `rect` of the table at `tablePos`; their colors stay. */
export function clearCells(tr: Transaction, tablePos: number, rect: CellRect): Transaction {
  const table = tr.doc.nodeAt(tablePos);
  if (!table) return tr;
  // Steps already in `tr` came before `tablePos` was read: positions map through the new ones.
  const firstStep = tr.mapping.maps.length;
  for (const { cell, pos } of cellsIn(table, tablePos, rect)) {
    if (cell.childCount === 1 && cell.firstChild?.content.size === 0) continue;
    const empty = cell.type.createAndFill();
    if (!empty) continue;
    const mapping = tr.mapping.slice(firstStep);
    tr.replaceWith(mapping.map(pos + 1), mapping.map(pos + cell.nodeSize - 1), empty.content);
  }
  return tr;
}

/**
 * Stores `widths` (one per column) in every cell of the table at `tablePos`, so that dragging a
 * column's edge starts from the widths on screen. Not an undo step of its own.
 */
export function pinColumnWidths(tr: Transaction, tablePos: number, widths: number[]): Transaction {
  const table = tr.doc.nodeAt(tablePos);
  if (!table) return tr;
  const map = TableMap.get(table);
  table.forEach((row, rowOffset) => {
    row.forEach((cell, cellOffset) => {
      const offset = rowOffset + 1 + cellOffset;
      const { left, right } = map.findCell(offset);
      const colwidth = widths.slice(left, right).map(Math.round);
      const current: unknown = cell.attrs.colwidth;
      const same =
        Array.isArray(current) &&
        current.length === colwidth.length &&
        current.every((width, index) => width === colwidth[index]);
      if (!same) tr.setNodeMarkup(tablePos + 1 + offset, null, { ...cell.attrs, colwidth });
    });
  });
  return tr.setMeta('addToHistory', false);
}

/** Whether the first row and the first column are header cells (Header row, Header column). */
export function tableHeaders(table: ProseMirrorNode): { row: boolean; column: boolean } {
  const map = TableMap.get(table);
  const isHeader = (rect: CellRect) =>
    map
      .cellsInRect(rect)
      .every((offset) => table.nodeAt(offset)?.type.spec.tableRole === 'header_cell');
  return {
    row: isHeader({ left: 0, top: 0, right: map.width, bottom: 1 }),
    column: isHeader({ left: 0, top: 0, right: 1, bottom: map.height }),
  };
}

/**
 * Turns the header row or header column of the table at `tablePos` on or off. The corner cell
 * stays a header while the other one is on.
 */
export function toggleTableHeader(
  tr: Transaction,
  tablePos: number,
  kind: 'row' | 'column',
): Transaction {
  const table = tr.doc.nodeAt(tablePos);
  if (!table) return tr;
  const types = Object.values(table.type.schema.nodes);
  const cell = types.find((type) => type.spec.tableRole === 'cell');
  const header = types.find((type) => type.spec.tableRole === 'header_cell');
  if (!cell || !header) return tr;
  const map = TableMap.get(table);
  const on = tableHeaders(table);
  const skip = (kind === 'row' ? on.column : on.row) ? 1 : 0;
  const rect =
    kind === 'row'
      ? { left: skip, top: 0, right: map.width, bottom: 1 }
      : { left: 0, top: skip, right: 1, bottom: map.height };
  const type = on[kind] ? cell : header;
  for (const { cell: node, pos } of cellsIn(table, tablePos, rect)) {
    if (node.type !== type) tr.setNodeMarkup(pos, type, node.attrs);
  }
  return tr;
}

function tableType(schema: Schema): NodeType | undefined {
  return Object.values(schema.nodes).find((type) => type.spec.tableRole === 'table');
}

/** `table` with no more than `maxRows` rows and `maxColumns` columns. */
function trimTable(table: ProseMirrorNode, maxRows: number, maxColumns: number): ProseMirrorNode {
  const map = TableMap.get(table);
  if (map.height <= maxRows && map.width <= maxColumns) return table;
  const rows: ProseMirrorNode[] = [];
  table.forEach((row, rowOffset, index) => {
    if (index >= maxRows) return;
    const cells: ProseMirrorNode[] = [];
    row.forEach((cell, cellOffset) => {
      if (map.findCell(rowOffset + 1 + cellOffset).right <= maxColumns) cells.push(cell);
    });
    rows.push(row.copy(Fragment.from(cells)));
  });
  return table.copy(Fragment.from(rows));
}

/** The first cells of one row, up to `maxColumns` columns. */
function trimCells(cells: Fragment, maxColumns: number): Fragment {
  const kept: ProseMirrorNode[] = [];
  let width = 0;
  cells.forEach((cell) => {
    width += typeof cell.attrs.colspan === 'number' ? cell.attrs.colspan : 1;
    if (width <= maxColumns) kept.push(cell);
  });
  return kept.length === cells.childCount ? cells : Fragment.from(kept);
}

function trimFragment(fragment: Fragment, maxRows: number, maxColumns: number): Fragment {
  const role: unknown = fragment.firstChild?.type.spec.tableRole;
  if (role === 'row') {
    const type = fragment.firstChild && tableType(fragment.firstChild.type.schema);
    if (!type) return fragment;
    const table = type.create(null, fragment);
    const trimmed = trimTable(table, maxRows, maxColumns);
    return trimmed === table ? fragment : trimmed.content;
  }
  if (role === 'cell' || role === 'header_cell') return trimCells(fragment, maxColumns);
  let changed = false;
  const children: ProseMirrorNode[] = [];
  fragment.forEach((child) => {
    let next = child;
    if (child.type.spec.tableRole === 'table') {
      next = trimTable(child, maxRows, maxColumns);
    } else if (child.childCount > 0 && !child.isTextblock) {
      const content = trimFragment(child.content, maxRows, maxColumns);
      if (content !== child.content) next = child.copy(content);
    }
    if (next !== child) changed = true;
    children.push(next);
  });
  return changed ? Fragment.from(children) : fragment;
}

/**
 * `slice` with each table in it cut to `maxRows` rows and `maxColumns` columns, so a paste
 * never grows a table past the limits. Rows and cells pasted into a table count from the cell
 * they land in.
 */
export function limitPastedTables(slice: Slice, maxRows: number, maxColumns: number): Slice {
  const content = trimFragment(slice.content, Math.max(1, maxRows), Math.max(1, maxColumns));
  if (content === slice.content) return slice;
  const open = Slice.maxOpen(content);
  return new Slice(
    content,
    Math.min(slice.openStart, open.openStart),
    Math.min(slice.openEnd, open.openEnd),
  );
}

/** Where a paste would put its first cell: the top-left selected cell, or 0, 0 outside tables. */
function pasteCorner(state: EditorState): { top: number; left: number } {
  if (!isInTable(state)) return { top: 0, left: 0 };
  const { top, left } = selectedRect(state);
  return { top, left };
}

const limitsKey = new PluginKey('tableLimits');

const tableLimits = () =>
  new Plugin({
    key: limitsKey,
    props: {
      transformPasted: (slice, view) => {
        const { top, left } = pasteCorner(view.state);
        return limitPastedTables(slice, TABLE_MAX_ROWS - top, TABLE_MAX_COLUMNS - left);
      },
    },
  });

function hasMergedCells(table: ProseMirrorNode, map: TableMap): boolean {
  let cells = 0;
  table.forEach((row) => {
    cells += row.childCount;
  });
  return cells !== map.width * map.height;
}

/**
 * Moves the selected rows one row up or down (Ctrl+Shift+Up and Down in a table, the keyboard
 * way to drag a row). The row next to them moves to their other side, so the cursor or the cell
 * selection stays where it was in them. True whenever the selection is in a table.
 */
export function moveRowsBy(editor: Editor, step: -1 | 1): boolean {
  const { state, view } = editor;
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  const { table, tableStart, map } = rect;
  const from = step < 0 ? rect.top - 1 : rect.bottom;
  if (from < 0 || from >= map.height) return true;
  if (hasMergedCells(table, map)) {
    // Merged cells move with their rows; prosemirror-tables works out which rows go together.
    if (rect.bottom - rect.top !== 1) return true;
    moveTableRow({ from: rect.top, to: rect.top + step, pos: tableStart })(state, (tr) =>
      view.dispatch(tr),
    );
    return true;
  }
  const rowStart = (index: number) => {
    let pos = tableStart;
    for (let row = 0; row < index; row += 1) pos += table.child(row).nodeSize;
    return pos;
  };
  const row = table.child(from);
  const start = rowStart(from);
  const tr = state.tr.delete(start, start + row.nodeSize);
  tr.insert(tr.mapping.map(rowStart(step < 0 ? rect.bottom : rect.top)), row);
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** What Tab does in the last cell: a new row, unless the table has the most rows it can. */
function nextCellOrRow(editor: Editor): boolean {
  if (editor.commands.goToNextCell()) return true;
  if (!isInTable(editor.state)) return false;
  if (selectedRect(editor.state).map.height >= TABLE_MAX_ROWS) return true;
  return editor.chain().addRowAfter().goToNextCell().run();
}

/**
 * Simple tables (spec 3.4, PB-13): rows of cells that hold formatted text, with a header row
 * and a header column (header cells), resizable columns (`colwidth` in each cell) and
 * `fitWidth` (Fit to page width). Up to 1,000 rows and 50 columns.
 */
const BlockTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fitWidth: {
        default: false,
        parseHTML: (element: Attributed) => element.hasAttribute('data-fit-width'),
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.fitWidth === true ? { 'data-fit-width': '' } : {},
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Tab: () => nextCellOrRow(this.editor),
      'Mod-Shift-ArrowUp': () => moveRowsBy(this.editor, -1),
      'Mod-Shift-ArrowDown': () => moveRowsBy(this.editor, 1),
    };
  },

  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), tableLimits()];
  },
}).configure({
  resizable: true,
  // The React view in table.ui.tsx draws the table; prosemirror-tables only resizes it.
  View: null,
  cellMinWidth: TABLE_CELL_MIN_WIDTH,
  lastColumnResizable: true,
});

/** A cell's background color, one of CELL_COLORS. */
const background = {
  default: null,
  parseHTML: (element: Attributed) => cellColor(element.getAttribute('data-background')),
  renderHTML: (attributes: Record<string, unknown>) => {
    const color = cellColor(attributes.background);
    return color ? { 'data-background': color } : {};
  },
};

/** A cell holds text only: one or more paragraphs. */
const Cell = TableCell.extend({
  content: 'paragraph+',
  addAttributes() {
    return { ...this.parent?.(), background };
  },
});

const Header = TableHeader.extend({
  content: 'paragraph+',
  addAttributes() {
    return { ...this.parent?.(), background };
  },
});

// The table group. Schema only: rules in ./index.ts.
export const nodes: AnyExtension[] = [BlockTable, TableRow, Cell, Header];
