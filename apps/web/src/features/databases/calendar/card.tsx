import { useState, type PointerEvent } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { Property } from '@carehub/databases';
import {
  cn,
  colorClasses,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@carehub/ui';
import { CellView, rowCell, type CellContext } from '../cells';
import type { QueryRow } from '../contract';
import { CALENDAR_TEXT } from './messages';
import type { DayPart } from './model';

/** What a press on a card starts: moving the whole row, or changing its end. */
export type DragKind = 'move' | 'end';

export interface CalendarCardProps {
  row: QueryRow;
  /** "3:30 PM" on the day a row with a time starts. */
  time: string | null;
  part: DayPart;
  /** The view's shown properties, besides the title. */
  properties: readonly Property[];
  ctx: CellContext;
  showTitle: boolean;
  wrap: boolean;
  /** The row's date can change here (a Date property, and the viewer can edit rows). */
  editable: boolean;
  dragging: boolean;
  onOpen(): void;
  onPressStart(event: PointerEvent<HTMLElement>, kind: DragKind): void;
  onMoveToDate(): void;
  /** Absent when the viewer can't delete rows. */
  onDelete?: () => void;
}

export const cardTitle = (row: Pick<QueryRow, 'title'>): string =>
  row.title.trim() || CALENDAR_TEXT.untitled;

/** One row on a day (or in "No date"): press to open, drag to move, the menu for the rest. */
export function CalendarCard({
  row,
  time,
  part,
  properties,
  ctx,
  showTitle,
  wrap,
  editable,
  dragging,
  onOpen,
  onPressStart,
  onMoveToDate,
  onDelete,
}: CalendarCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const title = cardTitle(row);
  const color = row.color.row;
  const continues = part === 'middle' || part === 'end';
  return (
    <div
      data-row-id={row.id}
      className={cn(
        'group/card relative flex min-w-0 flex-col gap-0.5 rounded border border-border px-1.5 py-0.5 text-label',
        color && color !== 'default' ? colorClasses[color].bg : 'bg-bg',
        continues && '-ml-1 rounded-l-none border-l-0',
        (part === 'start' || part === 'middle') && '-mr-1 rounded-r-none border-r-0',
        editable && 'cursor-grab',
        dragging && 'opacity-50',
      )}
      onPointerDown={(event) => {
        if (event.target instanceof Element && event.target.closest('[data-card-menu]')) return;
        onPressStart(event, 'move');
      }}
      onContextMenu={(event) => {
        // A long press on a phone, or a right click: the card's menu.
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'min-w-0 pr-5 text-left text-label text-fg',
          wrap ? 'break-words' : 'truncate',
        )}
      >
        {time && <span className="text-muted">{`${time} `}</span>}
        <span className={cn(!showTitle && 'sr-only', continues && 'text-muted')}>{title}</span>
      </button>
      {properties.map((property) => (
        <CellView
          key={property.id}
          property={property}
          {...rowCell(row, property)}
          ctx={ctx}
          wrap={wrap}
          className="min-w-0 text-label"
        />
      ))}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-card-menu=""
            aria-label={CALENDAR_TEXT.cardMenu(title)}
            className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-sm text-muted opacity-0 hover:bg-fill-hover focus-visible:opacity-100 group-hover/card:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100"
          >
            <MoreHorizontal aria-hidden className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onOpen}>{CALENDAR_TEXT.open}</DropdownMenuItem>
          {editable && (
            <DropdownMenuItem onSelect={onMoveToDate}>{CALENDAR_TEXT.moveToDate}</DropdownMenuItem>
          )}
          {onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="danger" onSelect={onDelete}>
                {CALENDAR_TEXT.delete}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {editable && (part === 'single' || part === 'end') && (
        <span
          aria-hidden
          data-card-end=""
          title={CALENDAR_TEXT.changeEnd(title)}
          className="absolute inset-y-0 right-0 w-1 cursor-ew-resize"
          onPointerDown={(event) => {
            event.stopPropagation();
            onPressStart(event, 'end');
          }}
        />
      )}
    </div>
  );
}
