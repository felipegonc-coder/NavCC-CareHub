import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import {
  addColumn,
  addRow,
  cellAround,
  CellSelection,
  columnResizingPluginKey,
  moveTableColumn,
  moveTableRow,
  removeColumn,
  removeRow,
  TableMap,
  type TableRect,
} from '@tiptap/pm/tables';
import {
  NodeViewContent,
  NodeViewWrapper,
  useEditorState,
  type ReactNodeViewProps,
} from '@tiptap/react';
import { Ellipsis, GripHorizontal, GripVertical, Plus, Table as TableIcon } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { NodeViews, SlashItem } from '../types';
import {
  CELL_COLORS,
  cellColor,
  clearCells,
  colorCells,
  columnWidths,
  pinColumnWidths,
  TABLE_COLUMN_WIDTH,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  tableHeaders,
  toggleTableHeader,
  type CellColor,
  type CellRect,
} from './table';
import './table.css';

type Axis = 'row' | 'column';

/** A cell by its row and column. */
interface Spot {
  row: number;
  col: number;
}

/** A box, relative to another one. */
interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** How far a handle moves before a press becomes a drag, in CSS pixels. */
const DRAG_DISTANCE = 4;

/** The table at `pos`, the way prosemirror-tables' commands take it. */
function tableRect(editor: Editor, pos: number | undefined): TableRect | null {
  if (typeof pos !== 'number') return null;
  const table = editor.state.doc.nodeAt(pos);
  if (!table || table.type.spec.tableRole !== 'table') return null;
  const map = TableMap.get(table);
  return { left: 0, top: 0, right: map.width, bottom: map.height, tableStart: pos + 1, map, table };
}

/** Where the selection is in the table at `tablePos`, if it's in it. */
interface TableSelection extends Spot {
  /** The selected cells, for a cell selection (Shift+arrows, or a row or column handle). */
  cells: CellRect | null;
}

function selectionIn(state: EditorState, tablePos: number | undefined): TableSelection | null {
  if (typeof tablePos !== 'number') return null;
  const { selection } = state;
  const $cell =
    selection instanceof CellSelection ? selection.$headCell : cellAround(selection.$head);
  if (!$cell || $cell.start(-1) !== tablePos + 1) return null;
  const map = TableMap.get($cell.node(-1));
  const start = tablePos + 1;
  const { top, left } = map.findCell($cell.pos - start);
  if (!(selection instanceof CellSelection)) return { row: top, col: left, cells: null };
  const cells = map.rectBetween(selection.$anchorCell.pos - start, $cell.pos - start);
  return {
    row: top,
    col: left,
    cells: { left: cells.left, top: cells.top, right: cells.right, bottom: cells.bottom },
  };
}

/** The cell under a pointer, by its DOM element. */
function spotOf(editor: Editor, tablePos: number | undefined, cell: Element): Spot | null {
  if (typeof tablePos !== 'number') return null;
  try {
    const $cell = cellAround(editor.state.doc.resolve(editor.view.posAtDOM(cell, 0)));
    if (!$cell || $cell.start(-1) !== tablePos + 1) return null;
    const { top, left } = TableMap.get($cell.node(-1)).findCell($cell.pos - tablePos - 1);
    return { row: top, col: left };
  } catch {
    // The element is on its way out of the editor.
    return null;
  }
}

function cellElement(
  editor: Editor,
  rect: TableRect,
  row: number,
  col: number,
): HTMLElement | null {
  const offset = rect.map.map[row * rect.map.width + col];
  if (offset === undefined) return null;
  const dom = editor.view.nodeDOM(rect.tableStart + offset);
  return dom instanceof HTMLElement ? dom : null;
}

function boxOf(element: Element, origin: Element): Box {
  const box = element.getBoundingClientRect();
  const base = origin.getBoundingClientRect();
  return {
    top: box.top - base.top,
    left: box.left - base.left,
    width: box.width,
    height: box.height,
  };
}

/** Each column's width on screen before fitting: its own, or TABLE_COLUMN_WIDTH. */
const shownWidths = (table: ProseMirrorNode) =>
  columnWidths(table).map((width) => width ?? TABLE_COLUMN_WIDTH);

/**
 * Sizes the columns: as stored (the table may then scroll sideways), or, with Fit to page
 * width, in proportion across the page. prosemirror-tables redraws them while an edge is dragged.
 */
function drawColumns(
  table: ProseMirrorNode,
  colgroup: HTMLTableColElement,
  element: HTMLTableElement,
  fit: boolean,
) {
  const widths = shownWidths(table);
  const total = widths.reduce((sum, width) => sum + width, 0);
  while (colgroup.children.length > widths.length) colgroup.lastElementChild?.remove();
  while (colgroup.children.length < widths.length) {
    colgroup.append(colgroup.ownerDocument.createElement('col'));
  }
  widths.forEach((width, index) => {
    const col = colgroup.children[index];
    if (col instanceof HTMLElement) {
      col.style.width = fit ? `${(width / total) * 100}%` : `${width}px`;
    }
  });
  element.style.width = fit ? '100%' : `${total}px`;
  element.style.minWidth = '';
}

/** The column widths on screen now, in CSS pixels (fitted ones too). */
function widthsOnScreen(table: ProseMirrorNode, element: HTMLTableElement): number[] {
  const widths = shownWidths(table);
  const shown = element.getBoundingClientRect().width;
  if (table.attrs.fitWidth !== true || shown <= 0) return widths;
  const total = widths.reduce((sum, width) => sum + width, 0);
  return widths.map((width) => (width / total) * shown);
}

/** The color all cells in `rect` have, or '' (none, or not all the same). */
function colorOf(table: ProseMirrorNode, rect: CellRect): CellColor | '' {
  const colors = new Set(
    TableMap.get(table)
      .cellsInRect(rect)
      .map((offset) => cellColor(table.nodeAt(offset)?.attrs.background)),
  );
  const [only] = colors;
  return colors.size === 1 && only ? only : '';
}

const colorName = (color: CellColor) => color.charAt(0).toUpperCase() + color.slice(1);

function ColorSelect({
  value,
  onChange,
}: {
  value: CellColor | '';
  onChange(color: CellColor | null): void;
}) {
  return (
    <select
      className="ch-table-select"
      aria-label="Color"
      value={value}
      onChange={(event) => onChange(cellColor(event.target.value))}
    >
      <option value="">Default</option>
      {CELL_COLORS.map((color) => (
        <option key={color} value={color}>
          {colorName(color)}
        </option>
      ))}
    </select>
  );
}

function MenuButton({
  children,
  disabled,
  pressed,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  pressed?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className="ch-table-menu-item"
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * A small menu by the table. Esc or a press outside closes it; it opens with its first item
 * focused.
 */
function Menu({
  label,
  at,
  onClose,
  children,
}: {
  label: string;
  at: { top: number; left: number };
  /** `escape` for Esc, `outside` for a press outside the menu. */
  onClose(reason: 'escape' | 'outside'): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const element = ref.current;
    element?.querySelector<HTMLElement>('button:enabled, select')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current('escape');
    };
    const onPress = (event: PointerEvent) => {
      if (element && event.target instanceof Node && !element.contains(event.target)) {
        closeRef.current('outside');
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPress, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPress, true);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="ch-table-menu ch-table-ui"
      role="group"
      aria-label={label}
      contentEditable={false}
      style={{ top: at.top, left: at.left }}
    >
      {children}
    </div>
  );
}

type OpenMenu =
  | { kind: Axis; index: number; spot: Spot; at: { top: number; left: number } }
  | { kind: 'table'; spot: null; at: { top: number; left: number } };

interface Drag {
  axis: Axis;
  from: number;
  to: number;
  x: number;
  y: number;
  moved: boolean;
}

/**
 * Where a dragged row or column would land: before row or column `before`, with the line drawn
 * `offset` pixels into the table frame.
 */
function dropTarget(
  editor: Editor,
  rect: TableRect,
  axis: Axis,
  point: number,
  frame: Element,
): { before: number; offset: number } | null {
  const count = axis === 'row' ? rect.map.height : rect.map.width;
  const boxAt = (index: number) => {
    const cell =
      axis === 'row' ? cellElement(editor, rect, index, 0) : cellElement(editor, rect, 0, index);
    const element = axis === 'row' ? cell?.parentElement : cell;
    return element?.getBoundingClientRect() ?? null;
  };
  const first = boxAt(0);
  const last = boxAt(count - 1);
  if (!first || !last) return null;
  const start = (box: DOMRect) => (axis === 'row' ? box.top : box.left);
  const end = (box: DOMRect) => (axis === 'row' ? box.bottom : box.right);
  // Columns run right to left on a right-to-left page.
  const reversed = axis === 'column' && start(last) < start(first);
  const past = (box: DOMRect) => {
    const middle = (start(box) + end(box)) / 2;
    return reversed ? middle < point : middle > point;
  };
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const box = boxAt(middle);
    if (box && past(box)) high = middle;
    else low = middle + 1;
  }
  const edgeBox = low < count ? boxAt(low) : last;
  if (!edgeBox) return null;
  const atStart = low < count !== reversed;
  const frameBox = frame.getBoundingClientRect();
  const origin = axis === 'row' ? frameBox.top : frameBox.left;
  return { before: low, offset: (atStart ? start(edgeBox) : end(edgeBox)) - origin };
}

/** Selects a whole row or column, to show what its menu works on. */
function selectLine(editor: Editor, rect: TableRect, axis: Axis, index: number) {
  const { map, table, tableStart } = rect;
  const [from, to] =
    axis === 'row'
      ? [map.positionAt(index, 0, table), map.positionAt(index, map.width - 1, table)]
      : [map.positionAt(0, index, table), map.positionAt(map.height - 1, index, table)];
  const { doc, tr } = editor.state;
  const $from = doc.resolve(tableStart + from);
  const $to = doc.resolve(tableStart + to);
  const selection =
    axis === 'row'
      ? CellSelection.rowSelection($from, $to)
      : CellSelection.colSelection($from, $to);
  editor.view.dispatch(tr.setSelection(selection));
}

/**
 * A table (spec 3.4, PB-13). Hover a cell for the handles of its row and column: drag one to
 * move the row or column, or click it for Insert, Move, Color, Clear and Delete. The + bars add a
 * row or a column; drag a column's edge to resize it; Shift+arrows select cells to color or
 * clear. "…" holds Header row, Header column and Fit to page width.
 */
function TableView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const colgroupRef = useRef<HTMLTableColElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const afterDrag = useRef(false);
  const [hover, setHover] = useState<Spot | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [line, setLine] = useState<{ axis: Axis; offset: number } | null>(null);
  const [handles, setHandles] = useState<{ row: Box; col: Box } | null>(null);
  const [barAt, setBarAt] = useState<{ top: number; left: number } | null>(null);
  const fitWidth = node.attrs.fitWidth === true;

  const { editable, selection } = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      editable: current.isEditable,
      selection: selectionIn(current.state, getPos()),
    }),
  });

  useLayoutEffect(() => {
    const table = tableRef.current;
    const colgroup = colgroupRef.current;
    if (table && colgroup) drawColumns(node, colgroup, table, fitWidth);
  }, [node, fitWidth]);

  // Before an edge drag starts, every column gets the width it has on screen (see
  // pinColumnWidths), so the drag starts from what's shown.
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const pin = () => {
      const handle = columnResizingPluginKey.getState(editor.state)?.activeHandle ?? -1;
      const pos = getPos();
      const table = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
      const element = tableRef.current;
      if (handle < 0 || typeof pos !== 'number' || !table || !element) return;
      if (handle < pos || handle > pos + table.nodeSize) return;
      const tr = pinColumnWidths(editor.state.tr, pos, widthsOnScreen(table, element));
      if (tr.docChanged) editor.view.dispatch(tr);
    };
    inner.addEventListener('mousedown', pin, true);
    return () => inner.removeEventListener('mousedown', pin, true);
  }, [editor, getPos]);

  const active: Spot | null = menu?.spot ?? hover ?? selection;
  const activeRow = active?.row ?? -1;
  const activeCol = active?.col ?? -1;

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const rect = tableRect(editor, getPos());
    const cell =
      frame && rect && activeRow >= 0 && activeRow < rect.map.height && activeCol < rect.map.width
        ? cellElement(editor, rect, activeRow, activeCol)
        : null;
    setHandles(
      frame && cell
        ? { row: boxOf(cell.parentElement ?? cell, frame), col: boxOf(cell, frame) }
        : null,
    );
  }, [editor, getPos, node, activeRow, activeCol]);

  const cells = menu ? null : (selection?.cells ?? null);
  const cellsTop = cells?.top ?? -1;
  const cellsLeft = cells?.left ?? -1;

  useLayoutEffect(() => {
    const inner = innerRef.current;
    const rect = tableRect(editor, getPos());
    const cell =
      inner && rect && cellsTop >= 0 ? cellElement(editor, rect, cellsTop, cellsLeft) : null;
    setBarAt(inner && cell ? boxOf(cell, inner) : null);
  }, [editor, getPos, node, cellsTop, cellsLeft]);

  const map = tableRect(editor, getPos())?.map ?? TableMap.get(node);

  /** Applies `change` to the table in one transaction, then gives the editor its focus back. */
  const change = (apply: (tr: Transaction, table: TableRect) => void) => {
    const current = tableRect(editor, getPos());
    if (!current) return;
    const tr = editor.state.tr;
    apply(tr, current);
    if (tr.docChanged) editor.view.dispatch(tr);
    editor.view.focus();
  };

  const closeMenu = (reason: 'escape' | 'outside') => {
    setMenu(null);
    if (reason === 'escape') editor.view.focus();
  };

  const move = (axis: Axis, from: number, to: number) => {
    const current = tableRect(editor, getPos());
    if (!current || from === to) return;
    const options = { from, to, select: true, pos: current.tableStart };
    const command = axis === 'row' ? moveTableRow(options) : moveTableColumn(options);
    command(editor.state, (tr) => editor.view.dispatch(tr));
    editor.view.focus();
  };

  const insert = (axis: Axis, at: number) =>
    change((tr, table) => {
      if (axis === 'row') addRow(tr, table, at);
      else addColumn(tr, table, at);
    });

  const remove = (axis: Axis, index: number) =>
    change((tr, table) => {
      if (axis === 'row') removeRow(tr, table, index);
      else removeColumn(tr, table, index);
    });

  const paint = (area: CellRect, color: CellColor | null) =>
    change((tr, table) => {
      colorCells(tr, table.tableStart - 1, area, color);
    });

  const clear = (area: CellRect) =>
    change((tr, table) => {
      clearCells(tr, table.tableStart - 1, area);
    });

  const onMouseMove = (event: ReactMouseEvent) => {
    if (menu || dragRef.current || !(event.target instanceof Element)) return;
    const cell = event.target.closest('td, th');
    if (!cell || !tableRef.current?.contains(cell)) return;
    const spot = spotOf(editor, getPos(), cell);
    if (spot && (spot.row !== hover?.row || spot.col !== hover?.col)) setHover(spot);
  };

  const startDrag = (axis: Axis, index: number) => (event: ReactPointerEvent<HTMLElement>) => {
    afterDrag.current = false;
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      axis,
      from: index,
      to: index,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const frame = frameRef.current;
    const current = tableRect(editor, getPos());
    if (!drag || !frame || !current) return;
    const distance = Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y);
    if (!drag.moved && distance < DRAG_DISTANCE) return;
    drag.moved = true;
    const point = drag.axis === 'row' ? event.clientY : event.clientX;
    const drop = dropTarget(editor, current, drag.axis, point, frame);
    if (!drop) return;
    drag.to = drop.before > drag.from ? drop.before - 1 : drop.before;
    setLine({ axis: drag.axis, offset: drop.offset });
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setLine(null);
    if (!drag?.moved) return;
    afterDrag.current = true;
    if (event.type === 'pointerup') move(drag.axis, drag.from, drag.to);
  };

  const openLineMenu = (axis: Axis, spot: Spot, button: HTMLElement) => {
    if (afterDrag.current) {
      afterDrag.current = false;
      return;
    }
    const inner = innerRef.current;
    const current = tableRect(editor, getPos());
    if (!inner || !current) return;
    const index = axis === 'row' ? spot.row : spot.col;
    const box = boxOf(button, inner);
    selectLine(editor, current, axis, index);
    setMenu({ kind: axis, index, spot, at: { top: box.top + box.height, left: box.left } });
  };

  const openTableMenu = (button: HTMLElement) => {
    const inner = innerRef.current;
    if (!inner) return;
    const box = boxOf(button, inner);
    setMenu({ kind: 'table', spot: null, at: { top: box.top + box.height, left: box.left } });
  };

  const lineMenu = (axis: Axis, index: number) => {
    const rows = axis === 'row';
    const count = rows ? map.height : map.width;
    const full = rows ? map.height >= TABLE_MAX_ROWS : map.width >= TABLE_MAX_COLUMNS;
    const area: CellRect = rows
      ? { left: 0, top: index, right: map.width, bottom: index + 1 }
      : { left: index, top: 0, right: index + 1, bottom: map.height };
    const then = (action: () => void) => () => {
      setMenu(null);
      action();
    };
    return (
      <>
        <MenuButton disabled={full} onClick={then(() => insert(axis, index))}>
          {rows ? 'Insert above' : 'Insert left'}
        </MenuButton>
        <MenuButton disabled={full} onClick={then(() => insert(axis, index + 1))}>
          {rows ? 'Insert below' : 'Insert right'}
        </MenuButton>
        <MenuButton disabled={index === 0} onClick={then(() => move(axis, index, index - 1))}>
          {rows ? 'Move up' : 'Move left'}
        </MenuButton>
        <MenuButton
          disabled={index >= count - 1}
          onClick={then(() => move(axis, index, index + 1))}
        >
          {rows ? 'Move down' : 'Move right'}
        </MenuButton>
        <ColorSelect
          value={colorOf(node, area)}
          onChange={(color) => {
            setMenu(null);
            paint(area, color);
          }}
        />
        <MenuButton onClick={then(() => clear(area))}>Clear</MenuButton>
        <MenuButton disabled={count <= 1} onClick={then(() => remove(axis, index))}>
          {rows ? 'Delete row' : 'Delete column'}
        </MenuButton>
      </>
    );
  };

  const headers = tableHeaders(node);
  const toggleHeader = (kind: Axis) =>
    change((tr, table) => {
      toggleTableHeader(tr, table.tableStart - 1, kind);
    });

  return (
    <NodeViewWrapper
      className="ch-table"
      data-fit-width={fitWidth ? '' : undefined}
      onMouseLeave={() => setHover(null)}
    >
      <div ref={innerRef} className="ch-table-inner">
        <div className="ch-table-scroll" onMouseMove={onMouseMove} onScroll={() => setMenu(null)}>
          <div ref={frameRef} className="ch-table-frame">
            <table ref={tableRef}>
              <colgroup ref={colgroupRef} />
              <NodeViewContent<'tbody'> as="tbody" />
            </table>
            {editable && handles && active ? (
              <div className="ch-table-ui" contentEditable={false}>
                <button
                  type="button"
                  className="ch-table-handle"
                  data-axis="row"
                  aria-label="Row options"
                  aria-expanded={menu?.kind === 'row'}
                  style={{ top: handles.row.top, height: handles.row.height }}
                  onPointerDown={startDrag('row', active.row)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onClick={(event) => openLineMenu('row', active, event.currentTarget)}
                >
                  <GripVertical size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="ch-table-handle"
                  data-axis="column"
                  aria-label="Column options"
                  aria-expanded={menu?.kind === 'column'}
                  style={{ left: handles.col.left, width: handles.col.width }}
                  onPointerDown={startDrag('column', active.col)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onClick={(event) => openLineMenu('column', active, event.currentTarget)}
                >
                  <GripHorizontal size={14} aria-hidden="true" />
                </button>
              </div>
            ) : null}
            {line ? (
              <div
                className="ch-table-drop"
                data-axis={line.axis}
                style={line.axis === 'row' ? { top: line.offset } : { left: line.offset }}
              />
            ) : null}
            {editable ? (
              <>
                <button
                  type="button"
                  className="ch-table-add ch-table-ui"
                  data-axis="column"
                  aria-label="Add a column"
                  disabled={map.width >= TABLE_MAX_COLUMNS}
                  onClick={() => insert('column', map.width)}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="ch-table-add ch-table-ui"
                  data-axis="row"
                  aria-label="Add a row"
                  disabled={map.height >= TABLE_MAX_ROWS}
                  onClick={() => insert('row', map.height)}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>
        </div>
        {editable ? (
          <button
            type="button"
            className="ch-table-options ch-table-ui"
            aria-label="Table options"
            aria-expanded={menu?.kind === 'table'}
            onClick={(event) => openTableMenu(event.currentTarget)}
          >
            <Ellipsis size={16} aria-hidden="true" />
          </button>
        ) : null}
        {editable && menu?.kind === 'table' ? (
          <Menu label="Table options" at={menu.at} onClose={closeMenu}>
            <MenuButton pressed={headers.row} onClick={() => toggleHeader('row')}>
              Header row
            </MenuButton>
            <MenuButton pressed={headers.column} onClick={() => toggleHeader('column')}>
              Header column
            </MenuButton>
            <MenuButton
              pressed={fitWidth}
              onClick={() => updateAttributes({ fitWidth: !fitWidth })}
            >
              Fit to page width
            </MenuButton>
          </Menu>
        ) : null}
        {editable && menu && menu.kind !== 'table' ? (
          <Menu label={menu.kind === 'row' ? 'Row' : 'Column'} at={menu.at} onClose={closeMenu}>
            {lineMenu(menu.kind, menu.index)}
          </Menu>
        ) : null}
        {editable && cells && barAt ? (
          <div
            className="ch-table-cell-bar ch-table-ui"
            role="group"
            aria-label="Selected cells"
            contentEditable={false}
            style={{ top: barAt.top, left: barAt.left }}
          >
            <ColorSelect value={colorOf(node, cells)} onChange={(color) => paint(cells, color)} />
            <button type="button" className="ch-table-menu-item" onClick={() => clear(cells)}>
              Clear
            </button>
          </div>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}

/** Presses and keys in the table's own controls stay there; the editor gets the rest. */
const inControls = (event: Event) =>
  event.target instanceof Element && event.target.closest('.ch-table-ui') !== null;

export const slashItems: SlashItem[] = [
  {
    id: 'table',
    title: 'Table',
    description: 'A simple table of text',
    group: 'Basic blocks',
    keywords: ['grid', 'rows', 'columns', 'cells', 'spreadsheet'],
    icon: <TableIcon size={18} />,
    run: (editor) => {
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run();
    },
  },
];

export const nodeViews: NodeViews = { table: { component: TableView, stopEvent: inControls } };
