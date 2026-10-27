import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Button, cn, colorClasses } from '@carehub/ui';
import { isEmptyValue, type Id, type Property, type ReadValue, type Row } from '@carehub/databases';
import { canChangeProperty } from '@carehub/databases/access';
import type { ViewTotal } from '@carehub/databases/aggregate';
import {
  loadMoreKey,
  type LayoutProps,
  type NewRow,
  type QueryGroup,
  type QueryRow,
  type ViewData,
} from '../contract';
import {
  CellEditor,
  CellView,
  rowCell,
  type CellContext,
  type CommitDetails,
} from './cell-adapter';
import { tableColumns, tableOptions, type TableColumn } from './columns';
import { PROPERTY_ICONS } from './icons';
import { TABLE_TEXT } from './messages';

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
  const columns = useMemo(
    () => tableColumns(meta.properties, view, data.propertyIds),
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

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [created, setCreated] = useState<readonly Created[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [active, setActive] = useState<CellAt | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ key: string } | null>(null);
  const cells = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (focusRequest) cells.current.get(focusRequest.key)?.focus();
  }, [focusRequest]);

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
  const nameColumn = columns.find((c) => c.property.config.type === 'title');
  const canAdd = !readOnly && (meta.viewerAccess !== 'rows_only' || meta.viewerCanAddRows === true);
  const canEdit = (property: Property) =>
    !readOnly && canChangeProperty(property, viewer, 'edit_content');

  // The one cell Tab stops on (roving tabindex): the active cell, or the first one.
  const first = lines[0];
  const firstColumn = columns[0];
  const activeShown =
    active !== null &&
    lines.some((l) => l.key === active.line) &&
    columns.some((c) => c.property.id === active.propertyId);
  const tabStop = activeShown
    ? cellKey(active.line, active.propertyId)
    : first && firstColumn
      ? cellKey(first.key, firstColumn.property.id)
      : null;

  const focusCell = (line: string, propertyId: Id) => {
    setActive({ line, propertyId });
    setFocusRequest({ key: cellKey(line, propertyId) });
  };

  const focusAt = (rowIndex: number, columnIndex: number) => {
    const line = lines[Math.max(0, Math.min(lines.length - 1, rowIndex))];
    const column = columns[Math.max(0, Math.min(columns.length - 1, columnIndex))];
    if (line && column) focusCell(line.key, column.property.id);
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

  const keyOnCell = (event: KeyboardEvent<HTMLDivElement>, line: Line, column: TableColumn) => {
    if (event.target !== event.currentTarget || editing) return;
    const rowIndex = lines.findIndex((l) => l.key === line.key);
    const columnIndex = columns.findIndex((c) => c.property.id === column.property.id);
    const property = column.property;
    const mod = event.metaKey || event.ctrlKey;
    switch (event.key) {
      case 'ArrowUp':
        focusAt(rowIndex - 1, columnIndex);
        break;
      case 'ArrowDown':
        focusAt(rowIndex + 1, columnIndex);
        break;
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
        if (!moveAlong(line.key, property.id, event.shiftKey ? -1 : 1)) return;
        break;
      case 'Enter':
      case 'F2':
        startEditing(line, property);
        break;
      case ' ':
        if (property.config.type === 'title') actions.openRow(line.row.id);
        else if (property.config.type === 'checkbox' && canEdit(property)) toggle(line, property);
        else return;
        break;
      case 'Delete':
      case 'Backspace':
        if (!clearCell(line, property)) return;
        break;
      default:
        if (event.key.length !== 1 || mod || event.altKey) return;
        if (!canEdit(property) || NO_TYPING.has(property.config.type)) return;
        startEditing(line, property, event.key);
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

  const toggleGroup = (group: QueryGroup) => {
    setCollapsed((set) => {
      const next = new Set(set);
      if (next.has(group.collapsedKey)) next.delete(group.collapsedKey);
      else next.add(group.collapsedKey);
      return next;
    });
  };

  const placeOf = (column: TableColumn): CSSProperties =>
    column.frozen ? { width: column.width, left: column.left } : { width: column.width };
  const lineClass = options.showVerticalLines ? 'border-r border-border' : undefined;
  const frozenClass = (column: TableColumn) =>
    cn(
      column.frozen && 'sticky z-10 bg-bg',
      column.property.config.type === 'title' &&
        !column.frozen &&
        'max-md:sticky max-md:left-0 max-md:z-10 max-md:bg-bg',
    );

  const renderCell = (line: Line, column: TableColumn) => {
    const property = column.property;
    const key = cellKey(line.key, property.id);
    const isName = property.config.type === 'title';
    const cell = rowCell(line.row, property);
    const isEditing = editing?.line === line.key && editing.propertyId === property.id;
    return (
      <div
        key={property.id}
        ref={(element) => {
          if (element) cells.current.set(key, element);
          else cells.current.delete(key);
        }}
        role={isName ? 'rowheader' : 'gridcell'}
        tabIndex={key === tabStop ? 0 : -1}
        data-property-id={property.id}
        aria-readonly={canEdit(property) ? undefined : true}
        onClick={(event) => pressCell(event, line, column)}
        onKeyDown={(event) => keyOnCell(event, line, column)}
        style={placeOf(column)}
        className={cn(
          'relative flex min-h-9 shrink-0 items-start gap-1 px-2 py-1.5 outline-none max-md:min-h-11',
          'focus:outline focus:outline-2 focus:outline-offset-inset focus:outline-ring',
          'group-hover/row:bg-fill',
          lineClass,
          frozenClass(column),
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
            onCommit={(value, details) => {
              if (details.changed) save(line, property, value);
              finishEditing(line, property, details.move);
            }}
            onCancel={(details) => finishEditing(line, property, details?.move)}
          />
        )}
      </div>
    );
  };

  const renderTotals = (totals: Partial<Record<Id, ViewTotal>>, testId?: string) => (
    <div role="row" data-testid={testId} className="flex border-b border-border">
      {columns.map((column) => (
        <div
          key={column.property.id}
          role="gridcell"
          data-property-id={column.property.id}
          style={placeOf(column)}
          className={cn(
            'flex min-h-9 shrink-0 items-center justify-end px-2 text-label text-muted',
            lineClass,
            frozenClass(column),
          )}
        >
          <span className="truncate">{totals[column.property.id]?.text}</span>
        </div>
      ))}
    </div>
  );

  const renderWide = (content: ReactNode) => (
    <div role="row" className="flex">
      <div role="gridcell" aria-colspan={columns.length} className="sticky left-0 px-1 py-1">
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
            className={cn(
              'group/row flex border-b border-border',
              line.row.context && 'text-muted',
            )}
          >
            {columns.map((column) => renderCell(line, column))}
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
        {group && Object.keys(group.totals).length > 0 && renderTotals(group.totals)}
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
          <div
            role="gridcell"
            aria-colspan={columns.length}
            className="sticky left-0 px-1 pt-4 pb-1"
          >
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

  return (
    <div className="overflow-x-auto">
      <div
        role="grid"
        aria-label={view.name}
        aria-colcount={columns.length}
        aria-readonly={readOnly || undefined}
        className="w-max min-w-full text-small text-fg"
      >
        <div role="rowgroup">
          <div role="row" className="flex border-b border-border">
            {columns.map((column) => {
              const Icon = PROPERTY_ICONS[column.property.config.type];
              return (
                <div
                  key={column.property.id}
                  role="columnheader"
                  data-property-id={column.property.id}
                  style={placeOf(column)}
                  className={cn(
                    'flex min-h-9 shrink-0 items-center gap-1.5 px-2 text-muted max-md:min-h-11',
                    lineClass,
                    frozenClass(column),
                  )}
                >
                  <Icon aria-hidden className="size-4 shrink-0" />
                  <span className="truncate">{column.property.name}</span>
                </div>
              );
            })}
          </div>
        </div>
        {sections.map(renderSection)}
        <div role="rowgroup">{renderTotals(data.totals, 'db-totals')}</div>
      </div>
    </div>
  );
}
