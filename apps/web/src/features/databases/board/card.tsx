import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
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
  IconButton,
} from '@carehub/ui';
import { CELL_TEXT, CellView, rowCell, type CellContext } from '../cells';
import type { QueryRow } from '../contract';
import { BOARD_TEXT } from './messages';
import { hasValue, type CardPicture } from './model';

export type CardSize = 's' | 'm' | 'l';

const PICTURE_HEIGHT: Record<CardSize, string> = { s: 'h-20', m: 'h-32', l: 'h-48' };
const PADDING: Record<CardSize, string> = { s: 'gap-1 p-2', m: 'gap-1.5 p-2.5', l: 'gap-2 p-3' };

/** A column the card's menu can move it to ("Move to…"). */
export interface MoveChoice {
  key: string;
  label: string;
  onSelect(): void;
}

/** What the card's menu does. Left out: not offered. */
export interface CardMenuActions {
  open(): void;
  /** Read when the menu opens. */
  moveTo(): readonly MoveChoice[];
  duplicate?: () => void;
  copyLink(): void;
  delete?: () => void;
}

export interface BoardCardProps {
  row: QueryRow;
  /** The properties the view shows on cards. */
  properties: readonly Property[];
  ctx: CellContext;
  picture: CardPicture | null;
  size: CardSize;
  fitImage: boolean;
  showIcon: boolean;
  wrap: boolean;
  hiddenByFilter: boolean;
  /** Picked up with Space. */
  lifted: boolean;
  /** Being dragged: its place is drawn faded. */
  dragging: boolean;
  /** The title box of a new card, in place of its title. */
  naming?: ReactNode;
  menuOpen: boolean;
  onMenuOpenChange(open: boolean): void;
  /** The menu closed by keyboard or a choice: focus goes back to the card. */
  onMenuClosed(): void;
  menu: CardMenuActions;
  onPointerDown(event: PointerEvent<HTMLElement>): void;
  onOpen(): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
  onBlur(): void;
}

/**
 * One card (spec: Board, Gallery): its picture, title and the view's properties. A press opens
 * the row; the title takes keyboard focus for Space, the arrows, Enter and Shift+F10.
 */
export function BoardCard({
  row,
  properties,
  ctx,
  picture,
  size,
  fitImage,
  showIcon,
  wrap,
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
}: BoardCardProps) {
  const title = row.title || CELL_TEXT.untitled;
  const tint = row.color.row;
  return (
    <article
      data-row-id={row.id}
      aria-label={title}
      onPointerDown={onPointerDown}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenuOpenChange(true);
      }}
      className={cn(
        'group/card relative flex shrink-0 flex-col overflow-hidden rounded border border-border text-body shadow-menu',
        tint ? colorClasses[tint].bg : 'bg-bg',
        lifted && 'ring-2 ring-primary',
        dragging && 'opacity-50',
      )}
    >
      {picture && (
        <img
          src={picture.src}
          alt=""
          draggable={false}
          loading="lazy"
          className={cn(
            'w-full shrink-0 bg-fill',
            PICTURE_HEIGHT[size],
            fitImage ? 'object-contain' : 'object-cover',
          )}
        />
      )}
      <div className={cn('flex min-w-0 flex-col', PADDING[size])}>
        <div className="flex min-w-0 items-start gap-1.5 pr-6">
          {showIcon && row.icon && (
            <span aria-hidden className="shrink-0">
              {row.icon}
            </span>
          )}
          {naming ?? (
            <div
              role="button"
              tabIndex={0}
              data-card-open=""
              onClick={onOpen}
              onKeyDown={onKeyDown}
              onBlur={onBlur}
              className="min-w-0 flex-1 cursor-pointer font-medium outline-none after:absolute after:inset-0 after:rounded focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              <span
                className={cn(wrap ? 'break-words' : 'block truncate', !row.title && 'text-muted')}
              >
                {title}
              </span>
            </div>
          )}
        </div>
        {hiddenByFilter && (
          <span className="text-label text-muted">{BOARD_TEXT.hiddenByFilter}</span>
        )}
        {properties.map((property) => {
          const cell = rowCell(row, property);
          if (!hasValue(property, cell)) return null;
          const cellTint = row.color.cells[property.id];
          return (
            <div
              key={property.id}
              data-property-id={property.id}
              className={cn(
                'min-w-0 text-small',
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
        title={title}
        open={menuOpen}
        onOpenChange={onMenuOpenChange}
        onClosed={onMenuClosed}
        menu={menu}
      />
    </article>
  );
}

/** The card's menu: Open, Move to…, Duplicate, Copy link and Delete. */
function CardMenu({
  title,
  open,
  onOpenChange,
  onClosed,
  menu,
}: {
  title: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onClosed(): void;
  menu: CardMenuActions;
}) {
  // "Move to…" turns the menu into the list of columns.
  const [moving, setMoving] = useState(false);
  const outside = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  // The list of columns takes the focus from "Move to…".
  useEffect(() => {
    if (moving) content.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [moving]);
  const choices = open ? menu.moveTo() : [];
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setMoving(false);
        onOpenChange(next);
      }}
    >
      <DropdownMenuTrigger asChild>
        <IconButton
          label={BOARD_TEXT.cardMenu(title)}
          size="sm"
          tabIndex={-1}
          data-no-drag=""
          onPointerDown={(event) => {
            // It opens on click, like the card's other presses.
            if (event.pointerType !== 'touch') event.preventDefault();
          }}
          onClick={() => onOpenChange(true)}
          className="absolute right-1 top-1 text-muted opacity-0 group-focus-within/card:opacity-100 group-hover/card:opacity-100 data-[state=open]:opacity-100 max-md:hidden"
        >
          <MoreHorizontal aria-hidden className="size-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={content}
        align="end"
        onInteractOutside={() => {
          outside.current = true;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!outside.current) onClosed();
          outside.current = false;
        }}
      >
        {moving ? (
          choices.map((choice) => (
            <DropdownMenuItem key={choice.key} onSelect={choice.onSelect}>
              {choice.label}
            </DropdownMenuItem>
          ))
        ) : (
          <>
            <DropdownMenuItem onSelect={menu.open}>{BOARD_TEXT.open}</DropdownMenuItem>
            {choices.length > 0 && (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setMoving(true);
                }}
              >
                {BOARD_TEXT.moveTo}
              </DropdownMenuItem>
            )}
            {menu.duplicate && (
              <DropdownMenuItem onSelect={menu.duplicate}>{BOARD_TEXT.duplicate}</DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={menu.copyLink}>{BOARD_TEXT.copyLink}</DropdownMenuItem>
            {menu.delete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="danger" onSelect={menu.delete}>
                  {BOARD_TEXT.delete}
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
