import { useRef, type PointerEvent } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Link, Maximize2, Trash2 } from 'lucide-react';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@carehub/ui';
import { TABLE_TEXT } from './messages';

/** What the row menu does. Absent moves can't happen (the first or last row); no moves: sorted. */
export interface RowMenuItems {
  open(): void;
  copyLink(): void;
  moves: { up?: () => void; down?: () => void } | null;
  remove(): void;
}

export interface RowHandleProps {
  /** The row's title, for the handle's name. */
  title: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The row can be dragged to another place (cursor only; the drag itself is the table's). */
  draggable: boolean;
  /** A press: the table starts following the pointer (the menu opens on click, not here). */
  onPressStart(event: PointerEvent<HTMLButtonElement>): void;
  onPress(): void;
  /** Only while the menu is open. */
  items: RowMenuItems | null;
  /** The menu closed without a press outside it: focus goes back to the table. */
  onClosed(): void;
}

/** The handle at the start of a row: drag it to move the row, press it for the row menu. */
export function RowHandle({
  title,
  open,
  onOpenChange,
  draggable,
  onPressStart,
  onPress,
  items,
  onClosed,
}: RowHandleProps) {
  const outside = useRef(false);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label={TABLE_TEXT.rowMenu(title)}
          data-row-handle=""
          onPointerDown={(event) => {
            // The menu opens on click, so a press can become a drag first.
            if (event.pointerType !== 'touch') event.preventDefault();
            onPressStart(event);
          }}
          onClick={(event) => {
            // The selection cell around it ticks the row on click; this one opens the menu.
            event.stopPropagation();
            onPress();
          }}
          className={cn(
            'flex h-6 w-4 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-fill-hover',
            draggable ? 'cursor-grab' : 'cursor-pointer',
            'opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100 max-md:hidden',
          )}
        >
          <GripVertical aria-hidden className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onInteractOutside={() => {
          outside.current = true;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!outside.current) onClosed();
          outside.current = false;
        }}
      >
        {items && (
          <>
            <DropdownMenuItem onSelect={items.open}>
              <Maximize2 aria-hidden className="size-4" />
              {TABLE_TEXT.open}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={items.copyLink}>
              <Link aria-hidden className="size-4" />
              {TABLE_TEXT.copyLink}
            </DropdownMenuItem>
            {items.moves && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!items.moves.up} onSelect={items.moves.up}>
                  <ArrowUp aria-hidden className="size-4" />
                  {TABLE_TEXT.moveUp}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!items.moves.down} onSelect={items.moves.down}>
                  <ArrowDown aria-hidden className="size-4" />
                  {TABLE_TEXT.moveDown}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="danger" onSelect={items.remove}>
              <Trash2 aria-hidden className="size-4" />
              {TABLE_TEXT.delete}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
