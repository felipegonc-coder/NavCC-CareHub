import { useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { EyeOff, Settings2 } from 'lucide-react';
import {
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
} from '@carehub/ui';
import { LIMITS, type Id, type Property } from '@carehub/databases';
import { clampWidth, type TableColumn } from './columns';
import { PROPERTY_ICONS } from './icons';
import { TABLE_TEXT } from './messages';

/** What the column menu changes in the view. */
export interface ColumnChanges {
  width(width: number): void;
  wrap(wrap: boolean): void;
  freeze(frozen: boolean): void;
  hide(): void;
}

export interface HeaderCellProps {
  column: TableColumn;
  style: CSSProperties;
  className?: string;
  /** The viewer can change the view (edit_views): the column menu, resizing and moving are on. */
  editable: boolean;
  /** "Freeze up to here" is set on this column. */
  frozenHere: boolean;
  menuOpen: boolean;
  onMenuOpenChange(open: boolean): void;
  /** A press on the name: opens the menu unless it was the end of a drag. */
  onPress(): void;
  /** The column is being dragged to a new place. */
  moving: boolean;
  onMoveStart(event: PointerEvent<HTMLButtonElement>): void;
  onResizeStart(event: PointerEvent<HTMLDivElement>): void;
  change: ColumnChanges;
}

/** A column's header: its type's icon and name, the column menu and the edge that resizes it. */
export function HeaderCell({
  column,
  style,
  className,
  editable,
  frozenHere,
  menuOpen,
  onMenuOpenChange,
  onPress,
  moving,
  onMoveStart,
  onResizeStart,
  change,
}: HeaderCellProps) {
  const property = column.property;
  const Icon = PROPERTY_ICONS[property.config.type];
  const label = (
    <>
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{property.name}</span>
    </>
  );
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
      {editable ? (
        <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onPointerDown={onMoveStart}
              onClick={onPress}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left hover:bg-fill-hover',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-inset focus-visible:outline-ring',
              )}
            >
              {label}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <WidthField
              width={column.width}
              onWidth={change.width}
              onDone={() => onMenuOpenChange(false)}
            />
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={column.wrap}
              onCheckedChange={(checked) => change.wrap(checked === true)}
            >
              {TABLE_TEXT.wrapColumn}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={frozenHere}
              onCheckedChange={(checked) => change.freeze(checked === true)}
            >
              {TABLE_TEXT.freeze}
            </DropdownMenuCheckboxItem>
            {property.config.type !== 'title' && (
              <DropdownMenuItem onSelect={() => change.hide()}>
                <EyeOff aria-hidden className="size-4" />
                {TABLE_TEXT.hide}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 px-2">{label}</span>
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

/** "Width" in the column menu: a number of px, saved with Enter or on leaving the field. */
function WidthField({
  width,
  onWidth,
  onDone,
}: {
  width: number;
  onWidth(width: number): void;
  onDone(): void;
}) {
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
          if (event.key === 'Escape') return;
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            save();
            onDone();
          } else if (event.key === 'ArrowDown' && !event.altKey) {
            // On to the menu's items (the arrows don't step the number here).
            event.preventDefault();
            const menu = field.current?.closest('[role="menu"]');
            menu?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
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
