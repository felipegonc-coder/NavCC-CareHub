import type { KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import type { Property } from '@carehub/databases';
import { cn, colorClasses, IconButton } from '@carehub/ui';
import { CELL_TEXT, CellView, rowCell, type CellContext } from '../cells';
import type { QueryRow } from '../contract';
import { CardMenu } from '../board/card';
import type { CardHandlers } from '../board/cards';
import { BOARD_TEXT } from '../board/messages';
import { hasValue } from '../board/model';
import { LIST_TEXT } from './messages';

export interface ListRowProps extends CardHandlers {
  row: QueryRow;
  /** The properties the view shows, on the right. */
  properties: readonly Property[];
  ctx: CellContext;
  showIcon: boolean;
  showTitle: boolean;
  wrap: boolean;
  /** Sub-items: its sub-items show (true) or not (false); absent when it has none. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

/** How far each level of sub-items stands in, in px. */
const INDENT = 24;

/**
 * One line of the list (spec: List): the page icon, the title, then the view's properties on the
 * right. A press opens the row; the title takes keyboard focus for Space, the arrows, Enter and
 * Shift+F10.
 */
export function ListRow({
  row,
  properties,
  ctx,
  showIcon,
  showTitle,
  wrap,
  expanded,
  onExpandedChange,
  hiddenByFilter,
  lifted,
  dragging,
  naming,
  menuOpen,
  onMenuOpenChange,
  onMenuClosed,
  menu,
  onPointerDown,
  onOpen,
  onKeyDown,
  onBlur,
}: ListRowProps) {
  const title = row.title || CELL_TEXT.untitled;
  const tint = row.color.row;
  const depth = row.depth ?? 0;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  // Sub-items: → shows them and ← hides them, as on a table's Name cell.
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    const sideways = event.key === 'ArrowRight' || event.key === 'ArrowLeft';
    if (sideways && !lifted && expanded !== undefined) {
      event.preventDefault();
      onExpandedChange?.(event.key === 'ArrowRight');
      return;
    }
    onKeyDown(event);
  };
  return (
    <li
      data-row-id={row.id}
      aria-label={title}
      aria-level={row.depth === undefined ? undefined : depth + 1}
      style={depth > 0 ? { marginLeft: `${depth * INDENT}px` } : undefined}
      onPointerDown={onPointerDown}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenuOpenChange(true);
      }}
      className={cn(
        'group/row relative flex min-h-9 min-w-0 gap-2 rounded px-2 py-1 text-body hover:bg-fill-hover max-md:min-h-11',
        wrap ? 'items-start' : 'items-center',
        tint && colorClasses[tint].bg,
        // Shown only because a sub-item matches the filter.
        row.context && 'text-muted',
        lifted && 'ring-2 ring-primary',
        dragging && 'opacity-50',
      )}
    >
      {expanded !== undefined && (
        <IconButton
          size="sm"
          label={expanded ? BOARD_TEXT.collapse(title) : BOARD_TEXT.expand(title)}
          aria-expanded={expanded}
          tabIndex={-1}
          data-no-drag=""
          onClick={() => onExpandedChange?.(!expanded)}
          className="relative z-10 shrink-0 text-muted"
        >
          <Chevron aria-hidden className="size-4" />
        </IconButton>
      )}
      {showIcon &&
        (row.icon ? (
          <span aria-hidden className="shrink-0">
            {row.icon}
          </span>
        ) : (
          <FileText aria-hidden className="size-4 shrink-0 text-muted" />
        ))}
      {naming ?? (
        <div
          role="button"
          tabIndex={0}
          data-card-open=""
          onClick={onOpen}
          onKeyDown={keyDown}
          onBlur={onBlur}
          className={cn(
            'min-w-0 cursor-pointer font-medium outline-none after:absolute after:inset-0 after:rounded focus-visible:after:ring-2 focus-visible:after:ring-ring',
            showTitle ? 'flex-1' : 'w-0',
          )}
        >
          <span
            className={cn(
              !showTitle ? 'sr-only' : wrap ? 'break-words' : 'block truncate',
              !row.title && 'text-muted',
            )}
          >
            {title}
          </span>
        </div>
      )}
      {hiddenByFilter && (
        <span className="shrink-0 text-label text-muted">{BOARD_TEXT.hiddenByFilter}</span>
      )}
      <div
        className={cn(
          'ml-auto flex min-w-0 shrink items-center justify-end gap-x-3 gap-y-1 text-small',
          wrap ? 'flex-wrap' : 'overflow-hidden',
        )}
      >
        {properties.map((property) => {
          const cell = rowCell(row, property);
          if (!hasValue(property, cell)) return null;
          const cellTint = row.color.cells[property.id];
          return (
            <div
              key={property.id}
              data-property-id={property.id}
              className={cn(
                'flex min-w-0 max-w-48 shrink-0 items-center',
                cellTint && cn('rounded-sm px-1', colorClasses[cellTint].bg),
              )}
            >
              <span className="sr-only">{property.name}: </span>
              <CellView
                property={property}
                value={cell.value}
                computed={cell.computed}
                hiddenLinks={cell.hiddenLinks}
                ctx={ctx}
                wrap={wrap}
                className="min-w-0"
              />
            </div>
          );
        })}
      </div>
      <CardMenu
        label={LIST_TEXT.rowMenu(title)}
        open={menuOpen}
        onOpenChange={onMenuOpenChange}
        onClosed={onMenuClosed}
        menu={menu}
        className="relative shrink-0 opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100"
      />
    </li>
  );
}
