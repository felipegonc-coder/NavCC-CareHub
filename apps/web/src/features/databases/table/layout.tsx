import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Button, Checkbox, cn, colorClasses } from '@carehub/ui';
import {
  isEmptyValue,
  type EvalContext,
  type Id,
  type Property,
  type ReadValue,
  type SelectOption,
  type View,
} from '@carehub/databases';
import { can, canChangeProperty } from '@carehub/databases/access';
import { pageUrl } from '@carehub/shared';
import {
  loadMoreKey,
  type LayoutProps,
  type NewRow,
  type QueryGroup,
  type RowPlace,
} from '../contract';
import {
  CELL_TEXT,
  CellEditor,
  CellView,
  rowCell,
  usePropertyActions,
  type CellContext,
  type CommitDetails,
  type PersonChoice,
  type PropertyMenuEvent,
} from './cell-adapter';
import { BulkBar } from './bulk-bar';
import {
  boxOf,
  copyText,
  fromTsv,
  inBox,
  pastedValues,
  personFinder,
  titleFinder,
  toTsv,
  type CellBox,
} from './clipboard';
import { collapsedStorageKey, useCollapsedGroups } from './collapsed';
import { dropTarget, propertyOrder, tableColumns, tableOptions, type TableColumn } from './columns';
import { missingOptions, sameStored, withSavedOptions } from './edits';
import { TotalsRow } from './footer';
import { TableHeader } from './header-row';
import { EditHistory, type AddedRow, type Step, type ValueChange, type Write } from './history';
import {
  asQueryRow,
  BULK_TYPES,
  buildSections,
  cellKey,
  inAnswer,
  lineKey,
  NO_TYPING,
  numberRows,
  OWN_PRESS,
  sameCell,
  SELECT_KEY,
  SELECT_WIDTH,
  withValues,
  type CellAt,
  type Created,
  type Editing,
  type Line,
  type Section,
} from './lines';
import { TABLE_TEXT } from './messages';
import { isOpen, isTopLevel, siblingIds } from './nesting';
import { longPress } from './long-press';
import { NestToggle } from './nest-toggle';
import { Notice } from './notice';
import { readPaste, withSavedIds, type PasteResult } from './paste';
import { WRITES_AT_ONCE, writeQueue } from './queue';
import { samePlace, stepPlace, type RowTarget } from './row-drop';
import { RowDropMark, RowHandle, type RowMenuItems } from './row-menu';
import {
  allTicked,
  extendTo,
  NO_SELECTION,
  selectAll,
  selectedNow,
  tick,
  type RowSelection,
} from './selection';
import { useColumnTools } from './use-column-tools';
import { useRowDrag } from './use-row-drag';
import {
  NO_SPAN,
  piecesOf,
  ROW_GUESS,
  useScreenSpans,
  VIRTUAL_FROM,
  type ListOnScreen,
  type ScreenLists,
} from './virtual';
import { withCalculation } from './view-settings';

/** The Table layout: rows and columns, grouped or not, with editing in the cells. */
export default function TableLayout({ meta, view, data, viewer, actions, readOnly }: LayoutProps) {
  const options = tableOptions(view);
  // Ticking rows is for people who can change them: Delete and Set property.
  const canSelect = !readOnly && can('edit_rows', meta.viewerAccess, { locked: meta.locked });
  const start = canSelect ? SELECT_WIDTH : 0;
  // The view with the changes made since it last came in, so quick changes build on each other.
  const viewNow = useRef(view);
  const changeView = (make: (current: View) => Partial<View>): Promise<void> => {
    const patch = make(viewNow.current);
    viewNow.current = { ...viewNow.current, ...patch };
    return actions.updateView(patch).catch(() => undefined);
  };
  const grid = useRef<HTMLDivElement>(null);
  const tools = useColumnTools(
    changeView,
    () => grid.current?.getBoundingClientRect().left ?? 0,
    actions,
  );
  const { resize, moving } = tools;
  const widths = useMemo(() => (resize ? { [resize.propertyId]: resize.width } : {}), [resize]);
  const columns = useMemo(
    () => tableColumns(meta.properties, view, data.propertyIds, widths, start),
    [meta.properties, view, data.propertyIds, widths, start],
  );
  const listed = useMemo(
    () => propertyOrder(meta.properties, view, data.propertyIds),
    [meta.properties, view, data.propertyIds],
  );
  const ctx = useMemo<CellContext>(
    () => ({
      viewer,
      properties: meta.properties,
      userName: () => undefined,
      rowTitle: (id: Id) => data.rowTitles[id],
    }),
    [viewer, meta.properties, data.rowTitles],
  );

  const [collapsed, toggleCollapsed] = useCollapsedGroups(
    collapsedStorageKey(meta.id, view.id, viewer.userId),
  );
  // Sub-items nested under their parents: the rows the person opened or closed here.
  const nested = Boolean(meta.subItems) && (view.subItems ?? 'nested') === 'nested';
  const [chosenOpen, setChosenOpen] = useState<ReadonlyMap<Id, boolean>>(() => new Map());
  const [created, setCreated] = useState<readonly Created[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [active, setActive] = useState<CellAt | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ key: string } | null>(null);
  const [selection, setSelection] = useState<RowSelection>(NO_SELECTION);
  // A block of cells runs from this cell to the active one (Shift+arrows, Shift-click).
  const [range, setRange] = useState<CellAt | null>(null);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  // Undo and redo: the person's changes in this database while it's open here.
  const [history] = useState(() => new EditHistory());
  // Rename, type change, insert, duplicate and delete in the columns' menus (W3-3's PropertyMenu).
  const propertyActions = usePropertyActions(meta.id);
  // Row writes go out a few at a time and in order (a paste can change 500 rows).
  const [queue] = useState(() => writeQueue(WRITES_AT_ONCE));
  // The workspace's people: Person editors list them, and pasted names are found among them.
  const [people, setPeople] = useState<readonly PersonChoice[]>();
  const loadPeople = () =>
    actions.searchPeople('').then(
      (list) => {
        setPeople(list);
        return list;
      },
      () => people ?? [],
    );
  const notices = useRef(0);
  // The row menu that's open (by line).
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  // On touch screens a long press on a row opens its menu (the handle is hidden on phones).
  const [press] = useState(longPress);
  // The cell that gets focus when the row menu closes.
  const afterMenu = useRef<CellAt | null>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const sectionEls = useRef(new Map<string, HTMLDivElement>());
  const cells = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    viewNow.current = view;
  }, [view]);

  useEffect(() => () => history.clear(), [history, meta.id]);

  useEffect(() => {
    if (focusRequest) cells.current.get(focusRequest.key)?.focus();
  }, [focusRequest]);

  // The browser's own menu stays shut while a long press opens the row's.
  useEffect(() => {
    const element = grid.current;
    if (!element) return undefined;
    const shut = (event: Event) => {
      if (press.busy()) event.preventDefault();
    };
    element.addEventListener('contextmenu', shut);
    return () => {
      element.removeEventListener('contextmenu', shut);
      press.end();
    };
  }, [press]);

  // Rows made here leave the local list once the answer has them.
  useEffect(() => {
    setCreated((list) => {
      const next = list.filter((c) => !inAnswer(data, c.row.id));
      return next.length === list.length ? list : next;
    });
  }, [data]);

  const sections = useMemo(
    () =>
      buildSections({
        data,
        created,
        collapsed,
        open: nested ? (row) => isOpen(row, chosenOpen) : null,
      }),
    [data, created, collapsed, nested, chosenOpen],
  );

  const lines = useMemo(() => sections.flatMap((s) => (s.collapsed ? [] : s.lines)), [sections]);
  // Every row the table has, once each: a column's menu counts the values a change would clear.
  const loadedRows = useMemo(
    () => [...new Map(sections.flatMap((s) => s.lines.map((l) => [l.row.id, l.row]))).values()],
    [sections],
  );
  const lineAt = useMemo(() => new Map(lines.map((line, index) => [line.key, index])), [lines]);
  // A row menu closes when its row goes (to Trash, or out of the view), so it can't come back open.
  useEffect(() => {
    if (rowMenu !== null && !lineAt.has(rowMenu)) setRowMenu(null);
  }, [rowMenu, lineAt]);
  // Every row in the answer by id (collapsed groups too): ticked rows that left drop out.
  const lineOf = useMemo(() => {
    const map = new Map<Id, Line>();
    for (const section of sections) {
      for (const line of section.lines) if (!map.has(line.row.id)) map.set(line.row.id, line);
    }
    return map;
  }, [sections]);
  const present = useMemo(() => new Set(lineOf.keys()), [lineOf]);
  const selected = canSelect ? selectedNow(selection, present) : NO_SELECTION.ids;
  const nameColumn = columns.find((c) => c.property.config.type === 'title');
  const canAdd =
    !readOnly &&
    can('add_rows', meta.viewerAccess, {
      locked: meta.locked,
      canAddRows: meta.viewerCanAddRows,
    });
  const canEdit = (property: Property) =>
    !readOnly && canChangeProperty(property, viewer, 'edit_content');
  // Column widths, order, wrapping, freezing and totals are saved for everyone (edit_views).
  const canEditViews = !readOnly && can('edit_views', meta.viewerAccess, { locked: meta.locked });
  // New options typed into a Select change the property (Can edit or Full access, not locked).
  const canEditStructure =
    !readOnly && can('edit_properties', meta.viewerAccess, { locked: meta.locked });
  // With no sort, rows keep a manual order; with one, dragging a row only changes its group.
  const manual = view.sorts.length === 0;
  const canMoveRows = canSelect && (manual || data.groups !== null);
  // Nested, only top-level rows are dragged (sub-items move with their parent, or from the menu).
  const canDrag = (line: Line) => canMoveRows && (!nested || isTopLevel(line.row));
  const rowDrag = useRowDrag({
    grid,
    sections,
    rowEls: rowEls.current,
    sectionEls: sectionEls.current,
    nested,
    manual,
    canDrag,
    move: (line, from, target, among) => moveLine(line, from, target, among),
  });

  // The one cell Tab stops on (roving tabindex): the active cell, or the first one.
  const first = lines[0];
  const firstColumn = columns[0];
  const activeShown =
    active !== null &&
    lines.some((l) => l.key === active.line) &&
    ((canSelect && active.propertyId === SELECT_KEY) ||
      columns.some((c) => c.property.id === active.propertyId));
  const tabStop = activeShown
    ? cellKey(active.line, active.propertyId)
    : first && firstColumn
      ? cellKey(first.key, firstColumn.property.id)
      : null;

  // Past 1,000 rows only the rows near the screen are drawn, with gaps as high as the others.
  const virtual = lines.length > VIRTUAL_FROM;
  const heights = useRef(new Map<string, number>());
  const heightStats = useRef({ sum: 0, count: 0 });
  const anchors = useRef(new Map<string, HTMLDivElement>());
  const rowGuess = () =>
    heightStats.current.count > 0 ? heightStats.current.sum / heightStats.current.count : ROW_GUESS;
  const heightOf = (line: Line | undefined) =>
    (line && heights.current.get(line.key)) ?? rowGuess();
  const readLists = (): ScreenLists => {
    const guess = rowGuess();
    let resized = false;
    for (const [key, element] of rowEls.current) {
      const height = element.getBoundingClientRect().height;
      if (height <= 0) continue;
      const before = heights.current.get(key);
      if (Math.abs((before ?? guess) - height) >= 1) resized = true;
      heightStats.current.sum += height - (before ?? 0);
      heightStats.current.count += before === undefined ? 1 : 0;
      heights.current.set(key, height);
    }
    if (Math.abs(rowGuess() - guess) >= 1) resized = true;
    const lists = new Map<string, ListOnScreen>();
    for (const section of sections) {
      const anchor = anchors.current.get(section.key);
      if (section.collapsed || !anchor) continue;
      const top = anchor.getBoundingClientRect().top;
      lists.set(section.key, { top, heights: section.lines.map(heightOf) });
    }
    return { lists, resized };
  };
  const spans = useScreenSpans(virtual, readLists);
  // Rows drawn wherever they are: the active and edited cells', an open menu's, a dragged one.
  const pinned = new Set<string>();
  for (const key of [
    activeShown ? active.line : first?.key,
    editing?.line,
    rowMenu,
    rowDrag.shown?.line,
  ]) {
    if (key) pinned.add(key);
  }

  // The block of cells from the range's first cell to the active one, while both are on screen.
  const columnAt = (propertyId: Id) => columns.findIndex((c) => c.property.id === propertyId);
  const rangeBox = (): CellBox | null => {
    if (!range || !active) return null;
    const from = lineAt.get(range.line);
    const to = lineAt.get(active.line);
    const left = columnAt(range.propertyId);
    const right = columnAt(active.propertyId);
    if (from === undefined || to === undefined || left < 0 || right < 0) return null;
    return boxOf({ row: from, column: left }, { row: to, column: right });
  };
  const box = rangeBox();
  // Two cells or more: drawn as a block, and Delete or Escape act on it.
  const block = box && (box.top !== box.bottom || box.left !== box.right) ? box : null;

  /** Moves the active cell; the block of cells goes unless `keepRange` (it grows). */
  const focusCell = (line: string, propertyId: Id, keepRange = false) => {
    if (!keepRange) setRange(null);
    setActive({ line, propertyId });
    setFocusRequest({ key: cellKey(line, propertyId) });
  };

  /** Column index -1 is the selection column (when rows can be ticked; not in a block of cells). */
  const focusAt = (rowIndex: number, columnIndex: number, extend = false) => {
    const line = lines[Math.max(0, Math.min(lines.length - 1, rowIndex))];
    const at = Math.max(canSelect && !extend ? -1 : 0, Math.min(columns.length - 1, columnIndex));
    const id = at === -1 ? SELECT_KEY : columns[at]?.property.id;
    if (line && id !== undefined) focusCell(line.key, id, extend);
  };

  /** Tab and Shift+Tab: the next or previous cell, on to the next or previous row. */
  const moveAlong = (line: string, propertyId: Id, step: 1 | -1): boolean => {
    let rowIndex = lines.findIndex((l) => l.key === line);
    let columnIndex = columns.findIndex((c) => c.property.id === propertyId) + step;
    if (columnIndex >= columns.length) {
      rowIndex += 1;
      columnIndex = 0;
    } else if (columnIndex < 0) {
      rowIndex -= 1;
      columnIndex = columns.length - 1;
    }
    const target = rowIndex >= 0 ? lines[rowIndex] : undefined;
    const column = columns[columnIndex];
    if (!target || !column) return false;
    focusCell(target.key, column.property.id);
    return true;
  };

  /**
   * One updateValues per row, through the queue, with the typed options the properties don't have
   * yet. Rows made here show the values until the answer has them.
   */
  const writeValues = (values: readonly ValueChange[], side: 'before' | 'after') => {
    const byRow = new Map<Id, Partial<Record<Id, unknown>>>();
    const typed = new Map<Id, Partial<Record<Id, readonly SelectOption[]>>>();
    for (const change of values) {
      const rowId = history.idOf(change.rowId);
      byRow.set(rowId, { ...byRow.get(rowId), [change.propertyId]: change[side] });
      if (side === 'after' && change.options) {
        const property = meta.properties.find((p) => p.id === change.propertyId);
        const missing = missingOptions(property, change.options);
        if (missing.length > 0) {
          typed.set(rowId, { ...typed.get(rowId), [change.propertyId]: missing });
        }
      }
    }
    for (const [rowId, patch] of byRow) {
      setCreated((list) =>
        list.some((c) => c.row.id === rowId)
          ? list.map((c) =>
              c.row.id === rowId ? { ...c, row: withValues(c.row, meta.properties, patch) } : c,
            )
          : list,
      );
      const newOptions = typed.get(rowId);
      queue(() =>
        newOptions
          ? actions.updateValues(rowId, patch, newOptions)
          : actions.updateValues(rowId, patch),
      ).catch(() => undefined);
    }
  };

  /** Every change to values goes through here: one call is one step for Ctrl+Z. */
  const change = (writes: readonly Write[], added: readonly AddedRow[] = []) => {
    const values: ValueChange[] = [];
    for (const { row, property, value, options } of writes) {
      const before = rowCell(row, property).value;
      if (!sameCell(property, before, value)) {
        const typed = options && options.length > 0 ? { options } : {};
        values.push({ rowId: row.id, propertyId: property.id, before, after: value, ...typed });
      }
    }
    history.record({ values, added });
    writeValues(values, 'after');
  };

  const save = (line: Line, property: Property, value: unknown, options?: SelectOption[]) =>
    change([{ row: line.row, property, value, options }]);

  /** Makes rows a step added, one after another so they keep their order. */
  const makeRows = async (added: readonly AddedRow[]) => {
    const before = data;
    for (const item of added) {
      if (item.undone) continue;
      const row = await queue(() => actions.createRow(item.input)).catch(() => null);
      if (!row) return;
      if (item.rowId !== null) history.rename(item.rowId, row.id);
      item.rowId = row.id;
      if (item.undone) {
        actions.trashRows([row.id]).catch(() => undefined);
        continue;
      }
      const made: Created = { row: asQueryRow(row), sectionKey: item.sectionKey, data: before };
      setCreated((list) => [...list, made]);
    }
  };

  /** After undo or redo: the first cell it changed, or a row that stays if the active one goes. */
  const focusStep = (step: Step, gone: ReadonlySet<Id>) => {
    for (const { rowId, propertyId } of step.values) {
      const id = history.idOf(rowId);
      const line = gone.has(id) ? undefined : lines.find((l) => l.row.id === id);
      if (line && columnAt(propertyId) >= 0) {
        focusCell(line.key, propertyId);
        return;
      }
    }
    const at = active ? (lineAt.get(active.line) ?? -1) : -1;
    const leaving = lines[at];
    if (!active || !leaving || !gone.has(leaving.row.id)) return;
    const stays = (l: Line) => !gone.has(l.row.id);
    const next = lines.slice(0, at).reverse().find(stays) ?? lines.find(stays);
    if (next) focusCell(next.key, active.propertyId);
  };

  const undo = () => {
    if (readOnly) return;
    const step = history.undo();
    if (!step) return;
    writeValues(step.values, 'before');
    const gone = new Set<Id>();
    for (const item of step.added) {
      item.undone = true;
      if (item.rowId !== null) gone.add(history.idOf(item.rowId));
    }
    if (gone.size > 0) {
      setCreated((list) => list.filter((c) => !gone.has(c.row.id)));
      actions.trashRows([...gone]).catch(() => undefined);
    }
    focusStep(step, gone);
  };

  const redo = () => {
    if (readOnly) return;
    const step = history.redo();
    if (!step) return;
    for (const item of step.added) item.undone = false;
    if (step.added.length > 0) void makeRows(step.added);
    writeValues(step.values, 'after');
    focusStep(step, new Set());
  };

  const toggle = (line: Line, property: Property) => {
    save(line, property, rowCell(line.row, property).value !== true);
  };

  /** Opens a cell's editor; a Person editor lists the workspace's people. */
  const openEditor = (line: Line, property: Property, initialText?: string) => {
    if (property.config.type === 'person') void loadPeople();
    setActive({ line: line.key, propertyId: property.id });
    setEditing({ line: line.key, propertyId: property.id, initialText });
  };

  const startEditing = (line: Line, property: Property, initialText?: string) => {
    setRange(null);
    if (property.config.type === 'checkbox') {
      if (canEdit(property) && initialText === undefined) toggle(line, property);
      return;
    }
    if (canEdit(property)) {
      openEditor(line, property, initialText);
    } else if (property.config.type === 'title' && initialText === undefined) {
      actions.openRow(line.row.id);
    }
  };

  /** Delete or Backspace: what clears a cell (nothing when it's empty already). */
  const clearing = (line: Line, property: Property): Write | null => {
    const { value } = rowCell(line.row, property);
    if (property.config.type === 'checkbox') {
      return value === true ? { row: line.row, property, value: false } : null;
    }
    return isEmptyValue(value as ReadValue) ? null : { row: line.row, property, value: null };
  };

  const clearCell = (line: Line, property: Property): boolean => {
    if (!canEdit(property)) return false;
    const write = clearing(line, property);
    if (write) change([write]);
    return true;
  };

  /** Clears the cells of a block the viewer can change, as one step. */
  const clearBlock = (cells: CellBox) => {
    const writes: Write[] = [];
    for (const line of lines.slice(cells.top, cells.bottom + 1)) {
      for (const { property } of columns.slice(cells.left, cells.right + 1)) {
        const write = canEdit(property) ? clearing(line, property) : null;
        if (write) writes.push(write);
      }
    }
    change(writes);
  };

  const finishEditing = (line: Line, property: Property, move?: CommitDetails['move']) => {
    setEditing(null);
    if (!move || !moveAlong(line.key, property.id, move === 'next' ? 1 : -1)) {
      focusCell(line.key, property.id);
    }
  };

  const pressCell = (event: MouseEvent<HTMLDivElement>, line: Line, column: TableColumn) => {
    const target = event.target;
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return;
    if (target !== event.currentTarget && target.closest(OWN_PRESS)) return;
    const property = column.property;
    if (editing && editing.line === line.key && editing.propertyId === property.id) return;
    // Shift-click makes a block of cells from the active one.
    if (event.shiftKey && active && activeShown && active.propertyId !== SELECT_KEY) {
      if (!box) setRange(active);
      focusCell(line.key, property.id, true);
      return;
    }
    setRange(null);
    if (canEdit(property) && property.config.type === 'checkbox') {
      focusCell(line.key, property.id);
      toggle(line, property);
    } else if (canEdit(property)) {
      openEditor(line, property);
    } else {
      focusCell(line.key, property.id);
    }
  };

  const tickLine = (line: Line, range: boolean) =>
    setSelection((current) => tick(current, lines, line.key, range));

  /** Keys on a value cell that aren't moves: edit, type over, clear, open or tick. */
  const keyOnValue = (event: KeyboardEvent<HTMLDivElement>, line: Line, property: Property) => {
    const mod = event.metaKey || event.ctrlKey;
    switch (event.key) {
      case 'Enter':
      case 'F2':
        startEditing(line, property);
        return true;
      case ' ':
        if (property.config.type === 'title') actions.openRow(line.row.id);
        else if (property.config.type === 'checkbox' && canEdit(property)) toggle(line, property);
        else return false;
        return true;
      case 'Delete':
      case 'Backspace':
        if (block) {
          clearBlock(block);
          return true;
        }
        return clearCell(line, property);
      default:
        if (event.key.length !== 1 || mod || event.altKey) return false;
        if (!canEdit(property) || NO_TYPING.has(property.config.type)) return false;
        startEditing(line, property, event.key);
        return true;
    }
  };

  /** The text Ctrl+C copies: the block of cells, the ticked rows, or the active cell. */
  const copiedText = (line: Line, columnIndex: number): string => {
    const evalCtx: EvalContext = { ...ctx, properties: meta.properties };
    const text = (l: Line, c: TableColumn) =>
      copyText(c.property, rowCell(l.row, c.property), evalCtx);
    if (box) {
      const shown = columns.slice(box.left, box.right + 1);
      return toTsv(lines.slice(box.top, box.bottom + 1).map((l) => shown.map((c) => text(l, c))));
    }
    // From the selection column or a ticked row: whole rows.
    const ticked = selected.size > 0 && (columnIndex < 0 || selected.has(line.row.id));
    if (ticked || columnIndex < 0) {
      const rows = ticked ? [...lineOf.values()].filter((l) => selected.has(l.row.id)) : [line];
      return toTsv(rows.map((l) => columns.map((c) => text(l, c))));
    }
    const column = columns[columnIndex];
    return column ? toTsv([[text(line, column)]]) : '';
  };

  /**
   * Ctrl+V: a block from a spreadsheet, from the active cell (or the block of cells' top left; a
   * single value fills the block), read as CSV import reads it (see readPaste). Rows are added
   * after the last one and options a Select needs are added first. One step for Ctrl+Z.
   */
  const paste = (text: string, line: Line, columnIndex: number) => {
    const clip = fromTsv(text);
    if (clip.length === 0) return;
    const top = box ? box.top : (lineAt.get(line.key) ?? 0);
    const values = pastedValues(clip, top, box ? box.left : Math.max(0, columnIndex), box);
    const read = (list: readonly PersonChoice[]) =>
      readPaste(values, {
        lines,
        properties: columns.map((c) => c.property),
        top,
        canEdit,
        canAdd,
        canAddOptions: canEditStructure,
        ctx: {
          viewer,
          // The workspace's people, and the names the answer has.
          findUser: personFinder([
            ...list,
            ...Object.entries(data.people ?? {}).map(([id, p]) => ({ id, name: p.name })),
          ]),
          findRows: titleFinder({
            databaseId: meta.id,
            properties: meta.properties,
            rows: [...lineOf.values()].map((l) => l.row),
            rowTitles: data.rowTitles,
          }),
        },
      });
    const forPeople = values.some((v) => columns[v.column]?.property.config.type === 'person');
    if (forPeople && people === undefined) void loadPeople().then((list) => fill(read(list)));
    else fill(read(people ?? []));
  };

  /** Writes what a paste read, once the options it needs are added. */
  const fill = (pasted: PasteResult) => {
    if (pasted.newOptions.size > 0) {
      const adding = [...pasted.newOptions].map(([propertyId, options]) =>
        queue(() => actions.addOptions(propertyId, options)).then(
          (saved) => [propertyId, saved] as const,
          () => [propertyId, null] as const,
        ),
      );
      void Promise.all(adding).then((saved) => fill(withSavedIds(pasted, new Map(saved))));
      return;
    }
    // New rows go to the last group shown, unless a pasted value says which group.
    const last = sections.filter((s) => !s.collapsed && s.lines.length > 0).at(-1);
    const grouping = view.grouping?.propertyId;
    const added = pasted.newRows.map((input): AddedRow => ({
      input: {
        ...input,
        // Pasted rows are plain rows, as imported ones are.
        templateId: null,
        ...(last?.group && !(grouping !== undefined && input.values && grouping in input.values)
          ? { groupKey: last.group.key }
          : {}),
      },
      sectionKey: last?.key ?? '',
      rowId: null,
      undone: false,
    }));
    change(pasted.writes, added);
    if (added.length > 0) void makeRows(added);
    if (pasted.skipped > 0) say(TABLE_TEXT.skipped(pasted.skipped));
  };

  const copyCells = (event: ClipboardEvent<HTMLDivElement>, line: Line, columnIndex: number) => {
    if (event.target !== event.currentTarget || editing) return;
    event.clipboardData.setData('text/plain', copiedText(line, columnIndex));
    event.preventDefault();
  };

  const pasteCells = (event: ClipboardEvent<HTMLDivElement>, line: Line, columnIndex: number) => {
    if (event.target !== event.currentTarget || editing || readOnly) return;
    event.preventDefault();
    paste(event.clipboardData.getData('text/plain'), line, columnIndex);
  };

  /** Keys on a cell; `columnIndex` -1 is the selection column. */
  const keyOnCell = (event: KeyboardEvent<HTMLDivElement>, line: Line, columnIndex: number) => {
    if (event.target !== event.currentTarget || editing) return;
    const rowIndex = lineAt.get(line.key) ?? -1;
    const column = columns[columnIndex];
    const id = column ? column.property.id : SELECT_KEY;
    const mod = event.metaKey || event.ctrlKey;
    const letter = mod && !event.altKey ? event.key.toLowerCase() : '';
    if (letter === 'c') {
      // Without selected text not every browser sends "copy", so the Clipboard API writes it too.
      navigator.clipboard?.writeText(copiedText(line, columnIndex)).catch(() => undefined);
      return;
    }
    if (letter === 'a' || letter === 'z' || letter === 'y') {
      if (letter === 'a') {
        if (!canSelect) return;
        setSelection(selectAll(lines));
      } else if (letter === 'z' && !event.shiftKey) {
        undo();
      } else {
        redo();
      }
      event.preventDefault();
      return;
    }
    if (canSelect && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
      openRowMenu(line, { line: line.key, propertyId: id });
      event.preventDefault();
      return;
    }
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        const down = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        const right = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        // On a Name with sub-items, → opens them and ← closes them.
        if (
          nested &&
          right !== 0 &&
          !event.shiftKey &&
          column?.property.config.type === 'title' &&
          (line.row.childCount ?? 0) > 0 &&
          isOpen(line.row, chosenOpen) === (right === -1)
        ) {
          toggleRow(line);
          break;
        }
        if (column && event.shiftKey) {
          // Shift+arrows on a value cell make a block of cells (the selection column stays out).
          if (!box) setRange({ line: line.key, propertyId: id });
          focusAt(rowIndex + down, columnIndex + right, true);
          break;
        }
        const target = lines[rowIndex + down];
        // Shift+Up and Shift+Down in the selection column tick the rows on the way.
        if (!column && event.shiftKey && down !== 0 && target) {
          setSelection((current) => extendTo(current, lines, line.key, target.key));
        }
        focusAt(rowIndex + down, columnIndex + right);
        break;
      }
      case 'Home':
        focusAt(mod ? 0 : rowIndex, 0);
        break;
      case 'End':
        focusAt(mod ? lines.length - 1 : rowIndex, columns.length - 1);
        break;
      case 'Tab':
        if (!moveAlong(line.key, id, event.shiftKey ? -1 : 1)) return;
        break;
      case 'Escape':
        if (block) setRange(null);
        else if (selected.size > 0) setSelection(NO_SELECTION);
        else return;
        break;
      default:
        if (column) {
          if (!keyOnValue(event, line, column.property)) return;
        } else if (event.key === ' ' || event.key === 'Enter') {
          tickLine(line, event.shiftKey);
        } else {
          return;
        }
    }
    event.preventDefault();
  };

  const addRow = (section: Section) => {
    const input: NewRow = section.group ? { groupKey: section.group.key } : {};
    const before = data;
    setAdding(section.key);
    actions
      .createRow(input)
      .then((row) => {
        setCreated((list) => [
          ...list,
          { row: asQueryRow(row), sectionKey: section.key, data: before },
        ]);
        history.record({
          values: [],
          added: [{ input, sectionKey: section.key, rowId: row.id, undone: false }],
        });
        if (nameColumn) {
          const line = lineKey(section.key, row.id);
          setActive({ line, propertyId: nameColumn.property.id });
          setEditing({ line, propertyId: nameColumn.property.id });
        }
      })
      .catch(() => undefined)
      .finally(() => setAdding(null));
  };

  // "Set property" lists what the viewer can change (Name, files, people and relations aside).
  const bulkProperties = listed.filter(
    (property) => BULK_TYPES.has(property.config.type) && canEdit(property),
  );

  const setForSelected = (property: Property, value: unknown, details: CommitDetails) => {
    const rows = [...selected].flatMap((id) => lineOf.get(id)?.row ?? []);
    const set = (next: unknown) => change(rows.map((row) => ({ row, property, value: next })));
    const typed = details.newOptions ?? [];
    if (typed.length === 0) {
      set(value);
      return;
    }
    // Options typed here are added once, then every row gets the value.
    void queue(() => actions.addOptions(property.id, typed)).then(
      (saved) => set(withSavedOptions(value, saved)),
      () => undefined,
    );
  };

  const trashSelected = () => {
    const ids = [...selected];
    // Focus goes to the first row that stays, as the bar goes away.
    const stays = lines.find((l) => !selected.has(l.row.id));
    setSelection(NO_SELECTION);
    setCreated((list) => list.filter((c) => !selected.has(c.row.id)));
    history.forget(selected);
    if (stays) focusCell(stays.key, SELECT_KEY);
    actions.trashRows(ids).catch(() => undefined);
  };

  /** Copies rows (the copies come back with the next answer); the ticked rows stay ticked. */
  const duplicate = (ids: Id[]) => {
    actions.duplicateRows(ids).catch(() => undefined);
  };

  /** The ticked rows, top to bottom as the table shows them. */
  const duplicateSelected = () => duplicate([...lineOf.keys()].filter((id) => selected.has(id)));

  /** A toast from the table (it needs the kit's ToastProvider, which the app has). */
  const say = (text: string) => {
    notices.current += 1;
    setNotice({ id: notices.current, text });
  };

  // A property that changed type or went: undo can't write its old values back.
  const propertyChanged = (event: PropertyMenuEvent) => {
    if (event.kind === 'type_changed' || event.kind === 'deleted') {
      history.forgetProperty(event.property.id);
    }
  };

  /** Moves a row to another place in manual order, or into another group. */
  const moveLine = (line: Line, from: Section, target: RowTarget, among: readonly Id[]) => {
    if (samePlace(target, from.key, among, line.row.id, manual)) return;
    const place: RowPlace = data.groups
      ? { beforeRowId: target.beforeRowId, fromGroupKey: from.key, toGroupKey: target.sectionKey }
      : { beforeRowId: target.beforeRowId };
    // In another group it's another line, and the active cell goes with it.
    const key = lineKey(target.sectionKey, line.row.id);
    const activeHere = active?.line === line.key && key !== line.key ? active.propertyId : null;
    if (activeHere !== null) setActive({ line: key, propertyId: activeHere });
    actions.moveRow(line.row.id, place).then(
      () => {
        if (activeHere !== null && document.activeElement === document.body) {
          setFocusRequest({ key: cellKey(key, activeHere) });
        }
      },
      () => undefined,
    );
  };

  const openRowMenu = (line: Line, focusAfter: CellAt) => {
    afterMenu.current = focusAfter;
    setRowMenu(line.key);
  };

  const pressHandle = (line: Line) => {
    if (rowDrag.dragged.current) {
      rowDrag.dragged.current = false;
      return;
    }
    openRowMenu(line, { line: line.key, propertyId: SELECT_KEY });
  };

  const closedRowMenu = () => {
    const at = afterMenu.current;
    afterMenu.current = null;
    if (at) focusCell(at.line, at.propertyId);
  };

  const copyLink = (rowId: Id) => {
    const link = new URL(pageUrl(rowId), window.location.origin).href;
    if (!navigator.clipboard) {
      say(TABLE_TEXT.linkNotCopied);
      return;
    }
    navigator.clipboard.writeText(link).then(
      () => say(TABLE_TEXT.linkCopied),
      () => say(TABLE_TEXT.linkNotCopied),
    );
  };

  const trashLine = (line: Line) => {
    const id = line.row.id;
    const at = lineAt.get(line.key) ?? 0;
    const stays = (l: Line) => l.row.id !== id;
    const next = lines.slice(at + 1).find(stays) ?? lines.slice(0, at).reverse().find(stays);
    afterMenu.current = next ? { line: next.key, propertyId: SELECT_KEY } : null;
    setCreated((list) => list.filter((c) => c.row.id !== id));
    history.forget(new Set([id]));
    actions.trashRows([id]).catch(() => undefined);
  };

  /** The row menu's actions (made only while it's open). */
  const rowItems = (line: Line, section: Section): RowMenuItems => {
    // Nested, a row moves among the rows under the same parent.
    const rows = section.lines.map((l) => l.row);
    const ids = nested ? siblingIds(rows, line.row) : rows.map((r) => r.id);
    const more = section.nextCursor !== null;
    const step = (direction: 1 | -1) => {
      const beforeRowId = stepPlace(ids, line.row.id, direction, more);
      if (beforeRowId === undefined) return undefined;
      return () => moveLine(line, section, { sectionKey: section.key, beforeRowId }, ids);
    };
    return {
      open: () => {
        // The page that opens takes the focus.
        afterMenu.current = null;
        actions.openRow(line.row.id);
      },
      copyLink: () => copyLink(line.row.id),
      duplicate: canAdd ? () => duplicate([line.row.id]) : undefined,
      moves: manual ? { up: step(-1), down: step(1) } : null,
      remove: () => trashLine(line),
    };
  };

  const toggleGroup = (group: QueryGroup) => toggleCollapsed(group.collapsedKey);

  /** Opens or closes a row's sub-items. */
  const toggleRow = (line: Line) => {
    const open = isOpen(line.row, chosenOpen);
    setChosenOpen((map) => new Map(map).set(line.row.id, !open));
  };

  // Frozen columns stay in place; so does Name on phones (`left` only counts once it's sticky).
  const placeOf = (column: TableColumn): CSSProperties =>
    column.frozen || column.property.config.type === 'title'
      ? { width: column.width, left: column.left }
      : { width: column.width };
  const lineClass = options.showVerticalLines ? 'border-r border-border' : undefined;
  // Frozen cells cover what scrolls under them: with the page's background, or (`filled` off) their
  // own color. On phones, Name stays at the left edge too.
  const frozenClass = (column: TableColumn, filled = true) => {
    const nameOnPhone = column.property.config.type === 'title' && !column.frozen;
    return cn(
      column.frozen && 'sticky z-10',
      column.frozen && filled && 'bg-bg',
      nameOnPhone && 'max-md:sticky max-md:z-10',
      nameOnPhone && filled && 'max-md:bg-bg',
    );
  };

  // The selection column stays at the left edge, over the cells scrolling under it.
  const selectClass =
    'sticky left-0 z-10 flex w-11 shrink-0 items-center justify-center gap-0.5 bg-bg';
  const selectedClass = 'bg-fill-hover max-md:bg-fill-hover';
  const cellRef = (key: string) => (element: HTMLDivElement | null) => {
    if (element) cells.current.set(key, element);
    else cells.current.delete(key);
  };
  const keep =
    (map: Map<string, HTMLDivElement>, key: string) => (element: HTMLDivElement | null) => {
      if (element) map.set(key, element);
      else map.delete(key);
    };

  const pressSelect = (event: MouseEvent<HTMLDivElement>, line: Line) => {
    // Clicks in the row menu (a portal) bubble here too; they aren't presses on the cell.
    const target = event.target;
    if (!(target instanceof Node) || !event.currentTarget.contains(target)) return;
    if (rowDrag.dragged.current) return;
    tickLine(line, event.shiftKey);
    focusCell(line.key, SELECT_KEY);
  };

  const renderSelect = (line: Line, section: Section) => {
    const key = cellKey(line.key, SELECT_KEY);
    const ticked = selected.has(line.row.id);
    return (
      <div
        key={SELECT_KEY}
        ref={cellRef(key)}
        role="gridcell"
        tabIndex={key === tabStop ? 0 : -1}
        data-select-cell=""
        onMouseDown={(event) => {
          // Shift-click ticks a range; it shouldn't select text on the way.
          if (event.shiftKey) event.preventDefault();
        }}
        onClick={(event) => pressSelect(event, line)}
        onKeyDown={(event) => keyOnCell(event, line, -1)}
        onCopy={(event) => copyCells(event, line, -1)}
        onPaste={(event) => pasteCells(event, line, -1)}
        className={cn(
          selectClass,
          'min-h-9 cursor-pointer outline-none max-md:min-h-11',
          'focus:outline focus:outline-2 focus:outline-offset-inset focus:outline-ring',
          'group-hover/row:bg-fill',
          ticked && selectedClass,
        )}
      >
        <RowHandle
          title={line.row.title || CELL_TEXT.untitled}
          open={rowMenu === line.key}
          onOpenChange={(open) => {
            if (open) openRowMenu(line, { line: line.key, propertyId: SELECT_KEY });
            else setRowMenu(null);
          }}
          draggable={canDrag(line)}
          onPressStart={(event) => rowDrag.start(event, line, section)}
          onPress={() => pressHandle(line)}
          items={rowMenu === line.key ? rowItems(line, section) : null}
          onClosed={closedRowMenu}
        />
        <Checkbox
          checked={ticked}
          tabIndex={-1}
          aria-label={TABLE_TEXT.selectRow(line.row.title || CELL_TEXT.untitled)}
          // The cell ticks it (with Shift for a range), so the box itself does nothing more.
          onClick={(event) => event.preventDefault()}
          className={cn(
            selected.size === 0 &&
              'opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 max-md:opacity-100',
          )}
        />
      </div>
    );
  };

  const renderCell = (line: Line, column: TableColumn, columnIndex: number) => {
    const property = column.property;
    const key = cellKey(line.key, property.id);
    const isName = property.config.type === 'title';
    const cell = rowCell(line.row, property);
    const isEditing = editing?.line === line.key && editing.propertyId === property.id;
    const inBlock = inBox(block, lineAt.get(line.key) ?? -1, columnIndex);
    // Conditional color (the view's color rules): a cell rule's color wins over the row's.
    const tint = line.row.color.cells[property.id] ?? line.row.color.row;
    return (
      <div
        key={property.id}
        ref={cellRef(key)}
        role={isName ? 'rowheader' : 'gridcell'}
        tabIndex={key === tabStop ? 0 : -1}
        data-property-id={property.id}
        aria-readonly={canEdit(property) ? undefined : true}
        aria-selected={inBlock || undefined}
        onMouseDown={(event) => {
          // Shift-click makes a block of cells; it shouldn't select text on the way.
          if (event.shiftKey) event.preventDefault();
        }}
        onClick={(event) => pressCell(event, line, column)}
        onKeyDown={(event) => keyOnCell(event, line, columnIndex)}
        onCopy={(event) => copyCells(event, line, columnIndex)}
        onPaste={(event) => pasteCells(event, line, columnIndex)}
        style={placeOf(column)}
        className={cn(
          'relative flex min-h-9 shrink-0 items-start gap-1 px-2 py-1.5 outline-none max-md:min-h-11',
          'focus:outline focus:outline-2 focus:outline-offset-inset focus:outline-ring',
          !tint && 'group-hover/row:bg-fill',
          lineClass,
          frozenClass(column, !tint),
          // It stays under the pointer; normal text reads on every one of the kit's colors.
          tint && colorClasses[tint].bg,
          selected.has(line.row.id) && selectedClass,
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {isName && nested && (
            <NestToggle
              row={line.row}
              open={isOpen(line.row, chosenOpen)}
              onToggle={() => {
                toggleRow(line);
                focusCell(line.key, property.id);
              }}
            />
          )}
          <CellView
            property={property}
            value={cell.value}
            computed={cell.computed}
            hiddenLinks={cell.hiddenLinks}
            ctx={ctx}
            wrap={column.wrap}
            onToggle={
              property.config.type === 'checkbox' && canEdit(property)
                ? (checked) => save(line, property, checked)
                : undefined
            }
            className="min-w-0"
          />
          {isName && line.hidden && (
            <span className="shrink-0 text-label text-muted">{TABLE_TEXT.hiddenByFilter}</span>
          )}
        </div>
        {isName && (
          <Button
            variant="secondary"
            size="sm"
            tabIndex={-1}
            onClick={() => actions.openRow(line.row.id)}
            className="shrink-0 opacity-0 focus:opacity-100 group-hover/row:opacity-100 max-md:min-h-11 max-md:opacity-100"
          >
            {TABLE_TEXT.open}
          </Button>
        )}
        {isEditing && (
          <CellEditor
            key={key}
            property={property}
            value={cell.value}
            hiddenLinks={cell.hiddenLinks}
            ctx={ctx}
            initialText={editing?.initialText}
            canCreateOptions={canEditStructure}
            people={people}
            onCommit={(value, details) => {
              if (details.changed && !sameStored(value, cell.value)) {
                save(line, property, value, details.newOptions);
              }
              finishEditing(line, property, details.move);
            }}
            onCancel={(details) => finishEditing(line, property, details?.move)}
          />
        )}
        {inBlock && (
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-ring/10" />
        )}
      </div>
    );
  };

  const cellClass = (column: TableColumn) => cn(lineClass, frozenClass(column));
  const colCount = columns.length + (canSelect ? 1 : 0);
  const renderWide = (content: ReactNode, rowIndex?: number) => (
    <div role="row" aria-rowindex={rowIndex || undefined} className="flex">
      <div role="gridcell" aria-colspan={colCount} className="sticky left-0 px-1 py-1">
        {content}
      </div>
    </div>
  );

  // With virtual rows, screen readers get each row's number and the count (header and footers too).
  const numbers = virtual ? numberRows(sections, canAdd) : null;
  const bottomTotals = canEditViews || Object.keys(data.totals).length > 0;

  /** A finger held on a row opens its menu (not in an editor, nor from the menu's own portal). */
  const pressRow = (event: PointerEvent<HTMLDivElement>, line: Line) => {
    const target = event.target;
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return;
    if (editing?.line === line.key || target.closest('input, textarea, [contenteditable]')) return;
    press.start(event, () => openRowMenu(line, { line: line.key, propertyId: SELECT_KEY }));
  };

  /** The click as the finger lifts after a long press isn't a tap on the cell under it. */
  const afterPress = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Node) || !event.currentTarget.contains(target)) return;
    if (!press.takeClick()) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const renderLine = (line: Line, section: Section, rowIndex?: number) => (
    <div
      key={line.key}
      ref={keep(rowEls.current, line.key)}
      role="row"
      aria-rowindex={rowIndex}
      data-row-id={line.row.id}
      aria-selected={canSelect ? selected.has(line.row.id) : undefined}
      onPointerDown={canSelect ? (event) => pressRow(event, line) : undefined}
      onPointerMove={canSelect ? (event) => press.move(event) : undefined}
      onPointerUp={canSelect ? () => press.end() : undefined}
      onPointerCancel={canSelect ? () => press.end() : undefined}
      onClickCapture={canSelect ? afterPress : undefined}
      className={cn(
        'group/row flex border-b border-border',
        canSelect && 'max-md:select-none',
        line.row.context && 'text-muted',
        rowDrag.shown?.line === line.key && 'opacity-50',
      )}
    >
      {canSelect && renderSelect(line, section)}
      {columns.map((column, index) => renderCell(line, column, index))}
    </div>
  );

  /** A section's rows: all of them, or with virtual rows those near the screen and gaps. */
  const renderLines = (section: Section, first: number) => {
    if (!virtual) return section.lines.map((line) => renderLine(line, section));
    const drawn = new Set<number>();
    section.lines.forEach((line, index) => {
      if (pinned.has(line.key)) drawn.add(index);
    });
    const pieces = piecesOf(
      section.lines.length,
      (index) => heightOf(section.lines[index]),
      spans.get(section.key) ?? NO_SPAN,
      drawn,
    );
    return [
      <div key="#top" ref={keep(anchors.current, section.key)} data-rows-top="" aria-hidden />,
      ...pieces.map((piece) => {
        if ('gap' in piece) {
          return <div key={`#gap-${piece.gap}`} aria-hidden style={{ height: piece.height }} />;
        }
        const line = section.lines[piece.line];
        return line ? renderLine(line, section, first + piece.line) : null;
      }),
    ];
  };

  const renderSection = (section: Section) => {
    const group = section.group;
    const groupKey = group?.key;
    const loading = data.loadingMore.includes(loadMoreKey(groupKey));
    const at = numbers?.of.get(section.key);
    const body = (
      <>
        {renderLines(section, at?.first ?? 0)}
        {section.nextCursor !== null &&
          renderWide(
            <Button
              variant="ghost"
              size="sm"
              loading={loading}
              onClick={() => {
                const more =
                  groupKey === undefined ? actions.loadMore() : actions.loadMore(groupKey);
                more.catch(() => undefined);
              }}
              className="max-md:min-h-11"
            >
              {TABLE_TEXT.loadMore}
            </Button>,
            at?.more,
          )}
        {canAdd &&
          renderWide(
            <Button
              variant="ghost"
              size="sm"
              loading={adding === section.key}
              onClick={() => addRow(section)}
              className="text-muted max-md:min-h-11"
            >
              <Plus aria-hidden className="size-4" />
              {TABLE_TEXT.newRow}
            </Button>,
            at?.add,
          )}
        {group && Object.keys(group.totals).length > 0 && (
          <TotalsRow
            columns={columns}
            totals={group.totals}
            placeOf={placeOf}
            cellClass={cellClass}
            leadClass={canSelect ? selectClass : undefined}
            rowIndex={at?.totals}
          />
        )}
      </>
    );
    if (!group)
      return (
        <div role="rowgroup" key="all" ref={keep(sectionEls.current, section.key)}>
          {body}
        </div>
      );
    const Chevron = section.collapsed ? ChevronRight : ChevronDown;
    const color = group.color ? colorClasses[group.color] : null;
    return (
      <div
        role="rowgroup"
        key={group.key}
        ref={keep(sectionEls.current, section.key)}
        aria-label={group.label}
      >
        <div role="row" aria-rowindex={at?.head || undefined} className="flex">
          <div role="gridcell" aria-colspan={colCount} className="sticky left-0 px-1 pt-4 pb-1">
            <button
              type="button"
              aria-expanded={!section.collapsed}
              onClick={() => toggleGroup(group)}
              className="flex min-h-8 items-center gap-2 rounded px-1 text-small hover:bg-fill-hover max-md:min-h-11"
            >
              <Chevron aria-hidden className="size-4 text-muted" />
              <span className={cn('rounded-sm px-1.5 font-medium', color?.bg, color?.text)}>
                {group.label}
              </span>
              <span className="text-muted">{group.count}</span>
            </button>
          </div>
        </div>
        {!section.collapsed && body}
      </div>
    );
  };

  const target = moving ? dropTarget(columns, moving.x) : undefined;
  const indicator =
    target === undefined
      ? null
      : target === null
        ? columns.reduce((sum, c) => sum + c.width, start)
        : (columns.find((c) => c.property.id === target)?.left ?? null);
  const allState = allTicked(lines, selected);

  return (
    <>
      <div className="overflow-x-auto">
        <div
          ref={grid}
          role="grid"
          aria-label={view.name}
          aria-colcount={colCount}
          aria-rowcount={numbers ? numbers.last + (bottomTotals ? 1 : 0) : undefined}
          aria-multiselectable
          aria-readonly={readOnly || undefined}
          className="relative w-max min-w-full text-small text-fg"
        >
          <TableHeader
            view={view}
            columns={columns}
            properties={listed}
            editable={canEditViews}
            selectAll={
              canSelect
                ? {
                    className: selectClass,
                    checked: allState,
                    onToggle: () =>
                      setSelection(allState === true ? NO_SELECTION : selectAll(lines)),
                  }
                : null
            }
            rowIndex={numbers ? 1 : undefined}
            placeOf={placeOf}
            cellClass={cellClass}
            tools={tools}
            menu={{
              meta,
              actions: propertyActions,
              view,
              updateView: (patch) => changeView(() => patch),
              rows: loadedRows,
              ctx,
              people,
              onChanged: propertyChanged,
            }}
            say={say}
          />
          {sections.map(renderSection)}
          {bottomTotals && (
            <div role="rowgroup">
              <TotalsRow
                columns={columns}
                totals={data.totals}
                placeOf={placeOf}
                cellClass={cellClass}
                leadClass={canSelect ? selectClass : undefined}
                calculations={canEditViews ? view.calculations : undefined}
                onCalculate={(property, aggregate) =>
                  void changeView((v) => ({
                    calculations: withCalculation(v.calculations, property.id, aggregate),
                  }))
                }
                testId="db-totals"
                rowIndex={numbers ? numbers.last + 1 : undefined}
              />
            </div>
          )}
          {indicator !== null && (
            <div
              aria-hidden
              style={{ left: indicator }}
              className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-primary"
            />
          )}
          {rowDrag.shown?.drop && <RowDropMark mark={rowDrag.shown.drop.mark} />}
        </div>
      </div>
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          properties={bulkProperties}
          ctx={ctx}
          canCreateOptions={canEditStructure}
          onSet={setForSelected}
          onDuplicate={canAdd ? duplicateSelected : undefined}
          onTrash={trashSelected}
          onClear={() => setSelection(NO_SELECTION)}
        />
      )}
      {notice && <Notice key={notice.id} text={notice.text} onShown={() => setNotice(null)} />}
    </>
  );
}
