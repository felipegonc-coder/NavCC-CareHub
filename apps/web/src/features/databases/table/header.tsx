import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ArrowDown, ArrowUp, ListFilter, Settings2 } from 'lucide-react';
import {
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
  Input,
} from '@carehub/ui';
import { LIMITS, type Aggregate, type Id, type Property, type Sort } from '@carehub/databases';
import { filterOpsFor } from '@carehub/databases/filter';
import { canGroupBy } from '@carehub/databases/group';
import { canSortBy } from '@carehub/databases/sort';
import { clampWidth, type TableColumn } from './columns';
import { CalculationChoices } from './footer';
import { PROPERTY_ICONS } from './icons';
import { TABLE_TEXT } from './messages';

/** What the table's own items in a column's menu change in the view. */
export interface ColumnChanges {
  /** Opens the toolbar's Filter panel at a rule on this property. */
  filter(): void;
  width(width: number): void;
  wrap(wrap: boolean): void;
  freeze(frozen: boolean): void;
  sort(direction: Sort['direction']): void;
  group(grouped: boolean): void;
  calculate(aggregate: Aggregate): void;
}

export interface HeaderCellProps {
  column: TableColumn;
  style: CSSProperties;
  className?: string;
  /** The viewer can change the view (edit_views): resizing and moving are on. */
  editable: boolean;
  /** Puts the property's menu (W3-3's PropertyMenu) on the header's button. */
  menu(button: ReactElement): ReactNode;
  /** A press on the name: opens the menu unless it was the end of a drag. */
  onPress(): void;
  /** The header's button got focus (the menu gives it back when it closes). */
  onFocus?(button: HTMLButtonElement): void;
  /** The column is being dragged to a new place. */
  moving: boolean;
  onMoveStart(event: PointerEvent<HTMLButtonElement>): void;
  onResizeStart(event: PointerEvent<HTMLDivElement>): void;
}

/** A column's header: its type's icon and name, the property's menu and the edge that resizes it. */
export function HeaderCell({
  column,
  style,
  className,
  editable,
  menu,
  onPress,
  onFocus,
  moving,
  onMoveStart,
  onResizeStart,
}: HeaderCellProps) {
  const property = column.property;
  const Icon = PROPERTY_ICONS[property.config.type];
  return (
    <div
      role="columnheader"
      data-property-id={property.id}
      style={style}
      className={cn(
        'relative flex min-h-9 shrink-0 items-stretch text-muted max-md:min-h-11',
        moving && 'opacity-50',
        className,
      )}
    >
      {menu(
        <button
          type="button"
          onPointerDown={editable ? onMoveStart : undefined}
          onClick={onPress}
          onFocus={onFocus && ((event) => onFocus(event.currentTarget))}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left hover:bg-fill-hover',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-inset focus-visible:outline-ring',
          )}
        >
          <Icon aria-hidden className="size-4 shrink-0" />
          <span className="truncate">{property.name}</span>
        </button>,
      )}
      {editable && (
        <div
          aria-hidden
          data-resize-handle=""
          onPointerDown={onResizeStart}
          className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize hover:bg-primary max-md:hidden"
        />
      )}
    </div>
  );
}

export interface ColumnItemsOptions {
  column: TableColumn;
  /** Width, wrap and freeze are saved for everyone: only with edit_views. */
  editable: boolean;
  /** "Freeze up to here" is set on this column. */
  frozenHere: boolean;
  /** The view is grouped by this column's property. */
  grouped: boolean;
  /** The column's calculation in the view. */
  calculation: Aggregate | undefined;
  change: ColumnChanges;
}

/**
 * The table's own items in a column's menu (PropertyMenu's `viewItems`): Filter, Sort ascending
 * and descending and Group by for everyone (the shell keeps them "for you only" without
 * edit_views), then Calculate, Width, Wrap column and Freeze up to here. Hide in this view is
 * PropertyMenu's. Filter is left out for properties with nothing to filter by (buttons).
 */
export function columnItems({
  column,
  editable,
  frozenHere,
  grouped,
  calculation,
  change,
}: ColumnItemsOptions): ReactElement[] {
  const items: ReactElement[] = [];
  if (filterOpsFor(column.property).length > 0) {
    items.push(
      <DropdownMenuItem key="filter" onSelect={() => change.filter()}>
        <ListFilter aria-hidden />
        {TABLE_TEXT.filter}
      </DropdownMenuItem>,
    );
  }
  if (canSortBy(column.property)) {
    items.push(
      <DropdownMenuItem key="asc" onSelect={() => change.sort('asc')}>
        <ArrowUp aria-hidden />
        {TABLE_TEXT.sortAscending}
      </DropdownMenuItem>,
      <DropdownMenuItem key="desc" onSelect={() => change.sort('desc')}>
        <ArrowDown aria-hidden />
        {TABLE_TEXT.sortDescending}
      </DropdownMenuItem>,
    );
  }
  if (canGroupBy(column.property)) {
    items.push(
      <DropdownMenuCheckboxItem
        key="group"
        checked={grouped}
        onCheckedChange={(checked) => change.group(checked === true)}
      >
        {TABLE_TEXT.groupBy}
      </DropdownMenuCheckboxItem>,
    );
  }
  if (!editable) return items;
  items.push(
    <DropdownMenuSub key="calculate">
      <DropdownMenuSubTrigger>{TABLE_TEXT.calculate}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-96 overflow-y-auto">
        <CalculationChoices
          property={column.property}
          value={calculation}
          onCalculate={change.calculate}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>,
    <DropdownMenuSeparator key="line" />,
    <WidthField key="width" width={column.width} onWidth={change.width} />,
    <DropdownMenuCheckboxItem
      key="wrap"
      checked={column.wrap}
      onCheckedChange={(checked) => change.wrap(checked === true)}
    >
      {TABLE_TEXT.wrapColumn}
    </DropdownMenuCheckboxItem>,
    <DropdownMenuCheckboxItem
      key="freeze"
      checked={frozenHere}
      onCheckedChange={(checked) => change.freeze(checked === true)}
    >
      {TABLE_TEXT.freeze}
    </DropdownMenuCheckboxItem>,
  );
  return items;
}

/**
 * "Width" in the column menu: a number of px, saved with Enter or on leaving the field. The arrows
 * go on to the menu's items; Escape and Tab reach the menu.
 */
function WidthField({ width, onWidth }: { width: number; onWidth(width: number): void }) {
  const id = useId();
  const [text, setText] = useState(String(width));
  const field = useRef<HTMLInputElement>(null);
  const save = () => {
    const typed = Number(text);
    if (text.trim() === '' || !Number.isFinite(typed)) {
      setText(String(width));
      return;
    }
    const next = clampWidth(typed);
    setText(String(next));
    if (next !== width) onWidth(next);
  };
  const focusItem = (direction: 'next' | 'previous') => {
    const from = field.current;
    const items = Array.from(
      from?.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [],
    );
    const after = (item: HTMLElement) =>
      Boolean(from && from.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING);
    const target = direction === 'next' ? items.find(after) : items.filter((i) => !after(i)).pop();
    target?.focus();
  };
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1">
      <label htmlFor={id} className="text-small text-fg">
        {TABLE_TEXT.width}
      </label>
      <Input
        ref={field}
        id={id}
        type="number"
        inputMode="numeric"
        min={LIMITS.columnWidthMin}
        max={LIMITS.columnWidthMax}
        step={10}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || event.key === 'Tab') return;
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            save();
          } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.altKey) {
            // On to the menu's items (the arrows don't step the number here).
            event.preventDefault();
            focusItem(event.key === 'ArrowDown' ? 'next' : 'previous');
          }
        }}
        className="w-24"
      />
    </div>
  );
}

export interface PropertiesMenuProps {
  /** Every property the viewer can see, in the view's order. */
  properties: readonly Property[];
  shown: ReadonlySet<Id>;
  wrapCells: boolean;
  onShow(property: Property, shown: boolean): void;
  onWrapCells(wrap: boolean): void;
}

/** The menu at the end of the header: show or hide each column, and "Wrap cells". */
export function PropertiesMenu({
  properties,
  shown,
  wrapCells,
  onShow,
  onWrapCells,
}: PropertiesMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={TABLE_TEXT.properties} variant="ghost" size="sm">
          <Settings2 aria-hidden className="size-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto">
        <DropdownMenuLabel>{TABLE_TEXT.properties}</DropdownMenuLabel>
        {properties.map((property) => {
          const Icon = PROPERTY_ICONS[property.config.type];
          const isName = property.config.type === 'title';
          return (
            <DropdownMenuCheckboxItem
              key={property.id}
              checked={isName || shown.has(property.id)}
              disabled={isName}
              onCheckedChange={(checked) => onShow(property, checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              <Icon aria-hidden className="size-4 text-muted" />
              <span className="truncate">{property.name}</span>
            </DropdownMenuCheckboxItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={wrapCells}
          onCheckedChange={(checked) => onWrapCells(checked === true)}
          onSelect={(event) => event.preventDefault()}
        >
          {TABLE_TEXT.wrapCells}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
