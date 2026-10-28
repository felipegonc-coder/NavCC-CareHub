import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { Aggregate, Id, Property } from '@carehub/databases';
import { aggregateLabel, aggregatesFor } from '@carehub/databases/aggregate';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from '@carehub/ui';
import { BOARD_TEXT } from './messages';

/** The figure every column header shows (the board's headerCalculation). Absent: Count all. */
export interface HeaderCalculation {
  propertyId: Id | null;
  aggregate: Aggregate;
}

/** The calculations a property offers in a column header: all but None and Count all. */
export const headerAggregates = (property: Property): Aggregate[] =>
  aggregatesFor(property).filter((a) => a !== 'none' && a !== 'count_all');

export interface ColumnMenuProps {
  /** The column's label. */
  label: string;
  /** Left out: not offered. */
  onHide?: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  /** Left out when the viewer can't change the board for everyone. */
  calculation?: {
    current: HeaderCalculation | undefined;
    /** The properties the viewer can see. */
    properties: readonly Property[];
    onChange(next: HeaderCalculation): void;
  };
  className?: string;
}

const ITEMS = '[role="menuitem"], [role="menuitemradio"]';

/**
 * A column's menu: Hide, Move left, Move right, and Calculate (what every column header shows:
 * the count, or a calculation of a property).
 */
export function ColumnMenu({
  label,
  onHide,
  onMoveLeft,
  onMoveRight,
  calculation,
  className,
}: ColumnMenuProps) {
  const [open, setOpen] = useState(false);
  // "Calculate" turns the menu into the properties, and a property into its calculations.
  const [page, setPage] = useState<{ property: Property | null } | null>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (page) content.current?.querySelector<HTMLElement>(ITEMS)?.focus();
  }, [page]);
  if (!onHide && !onMoveLeft && !onMoveRight && !calculation) return null;

  const change = (next: boolean) => {
    setPage(null);
    setOpen(next);
  };
  const stay = (event: Event, next: { property: Property | null }) => {
    event.preventDefault();
    setPage(next);
  };
  const current = calculation?.current;
  const counting = !current || current.propertyId === null || current.aggregate === 'count_all';

  const pageItems = () => {
    if (!calculation || !page) return null;
    if (page.property) {
      const property = page.property;
      const value = current?.propertyId === property.id ? current.aggregate : '';
      return (
        <DropdownMenuRadioGroup value={value}>
          {headerAggregates(property).map((aggregate) => (
            <DropdownMenuRadioItem
              key={aggregate}
              value={aggregate}
              onSelect={() => calculation.onChange({ propertyId: property.id, aggregate })}
            >
              {aggregateLabel(aggregate)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      );
    }
    return (
      <>
        <DropdownMenuRadioGroup value={counting ? 'count_all' : ''}>
          <DropdownMenuRadioItem
            value="count_all"
            onSelect={() => calculation.onChange({ propertyId: null, aggregate: 'count_all' })}
          >
            {aggregateLabel('count_all')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {calculation.properties
          .filter((property) => headerAggregates(property).length > 0)
          .map((property) => (
            <DropdownMenuItem key={property.id} onSelect={(event) => stay(event, { property })}>
              <span className="min-w-0 flex-1 truncate">{property.name}</span>
              {!counting && current?.propertyId === property.id && (
                <span className="shrink-0 text-small text-muted">
                  {aggregateLabel(current.aggregate)}
                </span>
              )}
            </DropdownMenuItem>
          ))}
      </>
    );
  };

  return (
    <DropdownMenu open={open} onOpenChange={change}>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={BOARD_TEXT.columnMenu(label)}
          size="sm"
          onPointerDown={(event) => {
            // It opens on click, like the card menus.
            if (event.pointerType !== 'touch') event.preventDefault();
          }}
          onClick={() => change(true)}
          className={cn('shrink-0 text-muted', className)}
        >
          <MoreHorizontal aria-hidden className="size-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent ref={content} align="start">
        {page ? (
          pageItems()
        ) : (
          <>
            {onHide && <DropdownMenuItem onSelect={onHide}>{BOARD_TEXT.hide}</DropdownMenuItem>}
            {onMoveLeft && (
              <DropdownMenuItem onSelect={onMoveLeft}>{BOARD_TEXT.moveLeft}</DropdownMenuItem>
            )}
            {onMoveRight && (
              <DropdownMenuItem onSelect={onMoveRight}>{BOARD_TEXT.moveRight}</DropdownMenuItem>
            )}
            {calculation && (
              <DropdownMenuItem onSelect={(event) => stay(event, { property: null })}>
                {BOARD_TEXT.calculate}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
