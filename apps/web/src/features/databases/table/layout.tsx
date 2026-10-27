import {
  useEffect,
  useMemo,
  useRef,
  useState,
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
  type Id,
  type Property,
  type ReadValue,
  type Row,
  type View,
  type ViewPropertySetting,
} from '@carehub/databases';
import { can, canChangeProperty } from '@carehub/databases/access';
import {
  loadMoreKey,
  type LayoutProps,
  type NewRow,
  type QueryGroup,
  type QueryRow,
  type ViewData,
} from '../contract';
import {
  CELL_TEXT,
  CellEditor,
  CellView,
  rowCell,
  type CellContext,
  type CommitDetails,
} from './cell-adapter';
import { BulkBar } from './bulk-bar';
import { collapsedStorageKey, useCollapsedGroups } from './collapsed';
import {
  clampWidth,
  dropTarget,
  propertyOrder,
  tableColumns,
  tableOptions,
  type TableColumn,
} from './columns';
import { DRAG_START, followDrag } from './drag';
import { sameStored, withoutNewOptions } from './edits';
import { TotalsRow } from './footer';
import { HeaderCell, PropertiesMenu, type ColumnChanges } from './header';
import { TABLE_TEXT } from './messages';
import {
  allTicked,
  extendTo,
  NO_SELECTION,
  selectAll,
  selectedNow,
  tick,
  type RowSelection,
} from './selection';
import { moveSetting, withCalculation, withSetting, withTableOptions } from './view-settings';

/** One row on screen. A row can sit in several groups (multi-select), so lines have their own key. */
interface Line {
  key: string;
  row: QueryRow;
  /** A row made here that the newer answer leaves out: "Hidden by filter". */
  hidden: boolean;
}

/** The whole list (key '') or one group. */
interface Section {
  key: string;
  group: QueryGroup | null;
  lines: Line[];
  collapsed: boolean;
  nextCursor: string | null;
}

interface CellAt {
  line: string;
  propertyId: Id;
}

interface Editing extends CellAt {
  initialText?: string;
}

/** A row made with New, kept on screen until the answer has it. */
interface Created {
  row: QueryRow;
  sectionKey: string;
  /** The answer when it was made: a newer answer without it means a filter hides it. */
  data: ViewData;
}

const lineKey = (sectionKey: string, rowId: Id) => JSON.stringify([sectionKey, rowId]);
const cellKey = (line: string, propertyId: Id) => JSON.stringify([line, propertyId]);

/** Types that can't be typed into a cell to start editing it. */
const NO_TYPING = new Set(['checkbox', 'files', 'button']);

/** Elements inside a cell that handle their own presses. */
const OWN_PRESS = 'button, a, input, textarea, select, [data-cell-editor]';

/** The selection column in the active-cell state, and its width (px, as `w-11`). */
const SELECT_KEY = '#select';
const SELECT_WIDTH = 44;

/** Types "Set property" can give every ticked row at once. */
const BULK_TYPES = new Set([
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

function asQueryRow(row: Row): QueryRow {
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

function withValue(row: QueryRow, property: Property, value: unknown): QueryRow {
  if (property.config.type === 'title') {
    return { ...row, title: typeof value === 'string' ? value : '' };
  }
  return { ...row, values: { ...row.values, [property.id]: value } };
}

function inAnswer(data: ViewData, rowId: Id): boolean {
  if (data.groups) return data.groups.some((g) => g.rows.some((r) => r.id === rowId));
  return data.rows.some((r) => r.id === rowId);
}

/** The Table layout: rows and columns, grouped or not, with editing in the cells. */
export default function TableLayout({ meta, view, data, viewer, actions, readOnly }: LayoutProps) {
  const options = tableOptions(view);
  // Ticking rows is for people who can change them: Delete and Set property.
  const canSelect = !readOnly && can('edit_rows', meta.viewerAccess, { locked: meta.locked });
  const start = canSelect ? SELECT_WIDTH : 0;
  // A column's width while its edge is dragged, and until saving it is done.
  const [resize, setResize] = useState<{ propertyId: Id; width: number } | null>(null);
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
  const [created, setCreated] = useState<readonly Created[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [active, setActive] = useState<CellAt | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ key: string } | null>(null);
  const [menuFor, setMenuFor] = useState<Id | null>(null);
  const [selection, setSelection] = useState<RowSelection>(NO_SELECTION);
  // A header being dragged to a new place: where the pointer is, px from the table's left edge.
  const [moving, setMoving] = useState<{ propertyId: Id; x: number } | null>(null);
  const cells = useRef(new Map<string, HTMLDivElement>());
  const grid = useRef<HTMLDivElement>(null);
  const dragStop = useRef<(() => void) | null>(null);
  const dragged = useRef(false);
  // The view with the changes made since it last came in, so quick changes build on each other.
  const viewNow = useRef(view);

  useEffect(() => {
    viewNow.current = view;
  }, [view]);

  useEffect(() => {
    if (focusRequest) cells.current.get(focusRequest.key)?.focus();
  }, [focusRequest]);

  useEffect(
    () => () => {
      dragStop.current?.();
      dragStop.current = null;
    },
    [],
  );

  // Rows made here leave the local list once the answer has them.
  useEffect(() => {
    setCreated((list) => {
      const next = list.filter((c) => !inAnswer(data, c.row.id));
      return next.length === list.length ? list : next;
    });
  }, [data]);

  const sections = useMemo<Section[]>(() => {
    const section = (
      key: string,
      group: QueryGroup | null,
      rows: readonly QueryRow[],
      nextCursor: string | null,
    ): Section => {
      const shown = new Set(rows.map((r) => r.id));
      const lines: Line[] = rows.map((row) => ({ key: lineKey(key, row.id), row, hidden: false }));
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
      return data.groups
        .filter((g) => !g.hidden)
        .map((g) => section(g.key, g, g.rows, g.nextCursor));
    }
    return [section('', null, data.rows, data.nextCursor)];
  }, [data, created, collapsed]);

  const lines = useMemo(() => sections.flatMap((s) => (s.collapsed ? [] : s.lines)), [sections]);
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

  const focusCell = (line: string, propertyId: Id) => {
    setActive({ line, propertyId });
    setFocusRequest({ key: cellKey(line, propertyId) });
  };

  /** Column index -1 is the selection column (when rows can be ticked). */
  const focusAt = (rowIndex: number, columnIndex: number) => {
    const line = lines[Math.max(0, Math.min(lines.length - 1, rowIndex))];
    const at = Math.max(canSelect ? -1 : 0, Math.min(columns.length - 1, columnIndex));
    const id = at === -1 ? SELECT_KEY : columns[at]?.property.id;
    if (line && id !== undefined) focusCell(line.key, id);
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

  const save = (line: Line, property: Property, value: unknown) => {
    if (created.some((c) => c.row.id === line.row.id)) {
      setCreated((list) =>
        list.map((c) =>
          c.row.id === line.row.id ? { ...c, row: withValue(c.row, property, value) } : c,
        ),
      );
    }
    actions.updateValues(line.row.id, { [property.id]: value }).catch(() => undefined);
  };

  const toggle = (line: Line, property: Property) => {
    save(line, property, rowCell(line.row, property).value !== true);
  };

  const startEditing = (line: Line, property: Property, initialText?: string) => {
    if (property.config.type === 'checkbox') {
      if (canEdit(property) && initialText === undefined) toggle(line, property);
      return;
    }
    if (canEdit(property)) {
      setActive({ line: line.key, propertyId: property.id });
      setEditing({ line: line.key, propertyId: property.id, initialText });
    } else if (property.config.type === 'title' && initialText === undefined) {
      actions.openRow(line.row.id);
    }
  };

  const clearCell = (line: Line, property: Property): boolean => {
    if (!canEdit(property)) return false;
    const { value } = rowCell(line.row, property);
    if (property.config.type === 'checkbox') {
      if (value === true) save(line, property, false);
      return true;
    }
    if (!isEmptyValue(value as ReadValue)) save(line, property, null);
    return true;
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
    if (canEdit(property) && property.config.type === 'checkbox') {
      focusCell(line.key, property.id);
      toggle(line, property);
    } else if (canEdit(property)) {
      setActive({ line: line.key, propertyId: property.id });
      setEditing({ line: line.key, propertyId: property.id });
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
        return clearCell(line, property);
      default:
        if (event.key.length !== 1 || mod || event.altKey) return false;
        if (!canEdit(property) || NO_TYPING.has(property.config.type)) return false;
        startEditing(line, property, event.key);
        return true;
    }
  };

  /** Keys on a cell; `columnIndex` -1 is the selection column. */
  const keyOnCell = (event: KeyboardEvent<HTMLDivElement>, line: Line, columnIndex: number) => {
    if (event.target !== event.currentTarget || editing) return;
    const rowIndex = lines.findIndex((l) => l.key === line.key);
    const column = columns[columnIndex];
    const id = column ? column.property.id : SELECT_KEY;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey && event.key.toLowerCase() === 'a') {
      if (!canSelect) return;
      setSelection(selectAll(lines));
      event.preventDefault();
      return;
    }
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        const to = rowIndex + (event.key === 'ArrowUp' ? -1 : 1);
        const target = lines[to];
        // Shift+arrows in the selection column tick the rows on the way.
        if (!column && event.shiftKey && target) {
          setSelection((current) => extendTo(current, lines, line.key, target.key));
        }
        focusAt(to, columnIndex);
        break;
      }
      case 'ArrowLeft':
        focusAt(rowIndex, columnIndex - 1);
        break;
      case 'ArrowRight':
        focusAt(rowIndex, columnIndex + 1);
        break;
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
        if (selected.size === 0) return;
        setSelection(NO_SELECTION);
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
        if (nameColumn) {
          const line = lineKey(section.key, row.id);
          setActive({ line, propertyId: nameColumn.property.id });
          setEditing({ line, propertyId: nameColumn.property.id });
        }
      })
      .catch(() => undefined)
      .finally(() => setAdding(null));
  };

  const changeView = (make: (current: View) => Partial<View>): Promise<void> => {
    const patch = make(viewNow.current);
    viewNow.current = { ...viewNow.current, ...patch };
    return actions.updateView(patch).catch(() => undefined);
  };

  /** The view's property settings with one changed (Name, always shown, gets a visible one). */
  const settingsWith = (
    current: View,
    property: Property,
    patch: Partial<Omit<ViewPropertySetting, 'propertyId'>>,
  ) => {
    const listedHere = current.properties.some((s) => s.propertyId === property.id);
    const full =
      !listedHere && property.config.type === 'title' ? { visible: true, ...patch } : patch;
    return withSetting(current.properties, property.id, full);
  };

  const columnChanges = (column: TableColumn): ColumnChanges => ({
    width: (width) =>
      void changeView((v) => ({
        properties: settingsWith(v, column.property, { width: clampWidth(width) }),
      })),
    wrap: (wrap) =>
      void changeView((v) => ({ properties: settingsWith(v, column.property, { wrap }) })),
    freeze: (frozen) =>
      void changeView((v) => ({
        table: withTableOptions(v, { frozenUpTo: frozen ? column.property.id : null }),
      })),
    hide: () =>
      void changeView((v) => ({
        properties: settingsWith(v, column.property, { visible: false }),
      })),
  });

  const showColumn = (property: Property, shown: boolean) =>
    void changeView((v) => ({ properties: settingsWith(v, property, { visible: shown }) }));

  // "Wrap cells" is for every column: the columns' own wrap settings go.
  const wrapCells = (wrap: boolean) =>
    void changeView((v) => ({
      table: withTableOptions(v, { wrapCells: wrap }),
      properties: v.properties.map((setting) => {
        const next = { ...setting };
        delete next.wrap;
        return next;
      }),
    }));

  // "Set property" lists what the viewer can change (Name, files, people and relations aside).
  const bulkProperties = listed.filter(
    (property) => BULK_TYPES.has(property.config.type) && canEdit(property),
  );

  const setForSelected = (property: Property, value: unknown, details: CommitDetails) => {
    // Until the view can add options, a new one isn't set (a Select keeps each row's value).
    const next = withoutNewOptions(value, undefined, details.newOptions);
    if (
      next === undefined ||
      (!isEmptyValue(value as ReadValue) && isEmptyValue(next as ReadValue))
    )
      return;
    for (const id of selected) {
      const line = lineOf.get(id);
      if (line && !sameStored(rowCell(line.row, property).value, next)) save(line, property, next);
    }
  };

  const trashSelected = () => {
    const ids = [...selected];
    // Focus goes to the first row that stays, as the bar goes away.
    const stays = lines.find((l) => !selected.has(l.row.id));
    setSelection(NO_SELECTION);
    setCreated((list) => list.filter((c) => !selected.has(c.row.id)));
    if (stays) focusCell(stays.key, SELECT_KEY);
    actions.trashRows(ids).catch(() => undefined);
  };

  const gridX = (clientX: number) => clientX - (grid.current?.getBoundingClientRect().left ?? 0);

  const startResize = (event: PointerEvent<HTMLDivElement>, column: TableColumn) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragStop.current?.();
    const { property, width: start } = column;
    dragStop.current = followDrag(event.clientX, {
      move: (dx) => setResize({ propertyId: property.id, width: clampWidth(start + dx) }),
      end: (dx, _x, cancelled) => {
        dragStop.current = null;
        const width = clampWidth(start + dx);
        if (cancelled || width === start) {
          setResize(null);
          return;
        }
        setResize({ propertyId: property.id, width });
        void changeView((v) => ({ properties: settingsWith(v, property, { width }) })).then(() =>
          setResize((r) => (r?.propertyId === property.id ? null : r)),
        );
      },
    });
  };

  // Dragging a header moves the column; a press without a drag opens its menu (on click).
  const startMove = (event: PointerEvent<HTMLButtonElement>, column: TableColumn) => {
    dragged.current = false;
    if (event.button !== 0 || event.pointerType === 'touch') return;
    event.preventDefault();
    if (column.property.config.type === 'title') return;
    dragStop.current?.();
    const propertyId = column.property.id;
    const startColumns = columns;
    dragStop.current = followDrag(event.clientX, {
      move: (dx, clientX) => {
        if (!dragged.current && Math.abs(dx) < DRAG_START) return;
        dragged.current = true;
        setMoving({ propertyId, x: gridX(clientX) });
      },
      end: (_dx, clientX, cancelled) => {
        dragStop.current = null;
        setMoving(null);
        if (!dragged.current || cancelled) return;
        const beforeId = dropTarget(startColumns, gridX(clientX));
        const order = startColumns.map((c) => c.property.id);
        const at = order.indexOf(propertyId);
        if (beforeId === propertyId || (beforeId !== null && order[at + 1] === beforeId)) return;
        if (beforeId === null && at === order.length - 1) return;
        void changeView((v) => ({ properties: moveSetting(v.properties, propertyId, beforeId) }));
      },
    });
  };

  const pressHeader = (column: TableColumn) => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    setMenuFor(column.property.id);
  };

  const toggleGroup = (group: QueryGroup) => toggleCollapsed(group.collapsedKey);

  // Frozen columns stay in place; so does Name on phones (`left` only counts once it's sticky).
  const placeOf = (column: TableColumn): CSSProperties =>
    column.frozen || column.property.config.type === 'title'
      ? { width: column.width, left: column.left }
      : { width: column.width };
  const lineClass = options.showVerticalLines ? 'border-r border-border' : undefined;
  const frozenClass = (column: TableColumn) =>
    cn(
      column.frozen && 'sticky z-10 bg-bg',
      column.property.config.type === 'title' &&
        !column.frozen &&
        'max-md:sticky max-md:z-10 max-md:bg-bg',
    );

  // The selection column stays at the left edge, over the cells scrolling under it.
  const selectClass = 'sticky left-0 z-10 flex w-11 shrink-0 items-center justify-center bg-bg';
  const selectedClass = 'bg-fill-hover max-md:bg-fill-hover';
  const cellRef = (key: string) => (element: HTMLDivElement | null) => {
    if (element) cells.current.set(key, element);
    else cells.current.delete(key);
  };

  const pressSelect = (event: MouseEvent<HTMLDivElement>, line: Line) => {
    tickLine(line, event.shiftKey);
    focusCell(line.key, SELECT_KEY);
  };

  const renderSelect = (line: Line) => {
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
        className={cn(
          selectClass,
          'min-h-9 cursor-pointer outline-none max-md:min-h-11',
          'focus:outline focus:outline-2 focus:outline-offset-inset focus:outline-ring',
          'group-hover/row:bg-fill',
          ticked && selectedClass,
        )}
      >
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
    return (
      <div
        key={property.id}
        ref={cellRef(key)}
        role={isName ? 'rowheader' : 'gridcell'}
        tabIndex={key === tabStop ? 0 : -1}
        data-property-id={property.id}
        aria-readonly={canEdit(property) ? undefined : true}
        onClick={(event) => pressCell(event, line, column)}
        onKeyDown={(event) => keyOnCell(event, line, columnIndex)}
        style={placeOf(column)}
        className={cn(
          'relative flex min-h-9 shrink-0 items-start gap-1 px-2 py-1.5 outline-none max-md:min-h-11',
          'focus:outline focus:outline-2 focus:outline-offset-inset focus:outline-ring',
          'group-hover/row:bg-fill',
          lineClass,
          frozenClass(column),
          selected.has(line.row.id) && selectedClass,
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
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
            onCommit={(value, details) => {
              // Until the view can add options to the property, new ones are left out.
              const next = withoutNewOptions(value, cell.value, details.newOptions);
              if (details.changed && !sameStored(next, cell.value)) save(line, property, next);
              finishEditing(line, property, details.move);
            }}
            onCancel={(details) => finishEditing(line, property, details?.move)}
          />
        )}
      </div>
    );
  };

  const cellClass = (column: TableColumn) => cn(lineClass, frozenClass(column));
  const colCount = columns.length + (canSelect ? 1 : 0);
  const renderWide = (content: ReactNode) => (
    <div role="row" className="flex">
      <div role="gridcell" aria-colspan={colCount} className="sticky left-0 px-1 py-1">
        {content}
      </div>
    </div>
  );

  const renderSection = (section: Section) => {
    const group = section.group;
    const groupKey = group?.key;
    const loading = data.loadingMore.includes(loadMoreKey(groupKey));
    const body = (
      <>
        {section.lines.map((line) => (
          <div
            key={line.key}
            role="row"
            data-row-id={line.row.id}
            aria-selected={canSelect ? selected.has(line.row.id) : undefined}
            className={cn(
              'group/row flex border-b border-border',
              line.row.context && 'text-muted',
            )}
          >
            {canSelect && renderSelect(line)}
            {columns.map((column, index) => renderCell(line, column, index))}
          </div>
        ))}
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
          )}
        {group && Object.keys(group.totals).length > 0 && (
          <TotalsRow
            columns={columns}
            totals={group.totals}
            placeOf={placeOf}
            cellClass={cellClass}
            leadClass={canSelect ? selectClass : undefined}
          />
        )}
      </>
    );
    if (!group)
      return (
        <div role="rowgroup" key="all">
          {body}
        </div>
      );
    const Chevron = section.collapsed ? ChevronRight : ChevronDown;
    const color = group.color ? colorClasses[group.color] : null;
    return (
      <div role="rowgroup" key={group.key} aria-label={group.label}>
        <div role="row" className="flex">
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

  const shown = new Set(columns.map((c) => c.property.id));
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
          aria-multiselectable={canSelect || undefined}
          aria-readonly={readOnly || undefined}
          className="relative w-max min-w-full text-small text-fg"
        >
          <div role="rowgroup">
            <div role="row" className="flex border-b border-border">
              {canSelect && (
                <div role="columnheader" className={cn(selectClass, 'min-h-9 max-md:min-h-11')}>
                  <Checkbox
                    checked={allState}
                    aria-label={TABLE_TEXT.selectAll}
                    onCheckedChange={() =>
                      setSelection(allState === true ? NO_SELECTION : selectAll(lines))
                    }
                  />
                </div>
              )}
              {columns.map((column) => (
                <HeaderCell
                  key={column.property.id}
                  column={column}
                  style={placeOf(column)}
                  className={cellClass(column)}
                  editable={canEditViews}
                  frozenHere={options.frozenUpTo === column.property.id}
                  menuOpen={menuFor === column.property.id}
                  onMenuOpenChange={(open) => setMenuFor(open ? column.property.id : null)}
                  onPress={() => pressHeader(column)}
                  moving={moving?.propertyId === column.property.id}
                  onMoveStart={(event) => startMove(event, column)}
                  onResizeStart={(event) => startResize(event, column)}
                  change={columnChanges(column)}
                />
              ))}
              {canEditViews && (
                <div role="columnheader" className="flex shrink-0 items-center px-1">
                  <PropertiesMenu
                    properties={listed}
                    shown={shown}
                    wrapCells={options.wrapCells}
                    onShow={showColumn}
                    onWrapCells={wrapCells}
                  />
                </div>
              )}
            </div>
          </div>
          {sections.map(renderSection)}
          {(canEditViews || Object.keys(data.totals).length > 0) && (
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
        </div>
      </div>
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          properties={bulkProperties}
          ctx={ctx}
          canCreateOptions={canEditStructure}
          onSet={setForSelected}
          onTrash={trashSelected}
          onClear={() => setSelection(NO_SELECTION)}
        />
      )}
    </>
  );
}
