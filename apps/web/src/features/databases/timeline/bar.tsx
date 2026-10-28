import type { KeyboardEvent, PointerEvent } from 'react';
import type { Property } from '@carehub/databases';
import { cn, colorClasses } from '@carehub/ui';
import { CellView, rowCell, type CellContext } from '../cells';
import type { QueryRow } from '../contract';
import { TIMELINE_TEXT } from './messages';
import type { BarEdit } from './model';

/** Narrower than this, a bar's title shows beside it instead of in it, px. */
const NARROW_BAR = 48;

export interface TimelineBarProps {
  row: QueryRow;
  title: string;
  /** px from the time line's left edge, and across. */
  left: number;
  width: number;
  /** px from the top of its line, and down. */
  top: number;
  height: number;
  /** What the view shows on bars, besides the title. */
  properties: readonly Property[];
  ctx: CellContext;
  /** Its dates can change here. */
  editable: boolean;
  /** Being dragged, or picked up with the keyboard. */
  changing: boolean;
  /** The id of the hint read after its name ("Space picks it up"). */
  hintId: string | undefined;
  onPressStart(event: PointerEvent<HTMLElement>, edit: BarEdit): void;
  onOpen(): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
  onBlur(): void;
}

/** One row's bar: click to open, drag to move, drag an end to change it; keys for the same. */
export function TimelineBar({
  row,
  title,
  left,
  width,
  top,
  height,
  properties,
  ctx,
  editable,
  changing,
  hintId,
  onPressStart,
  onOpen,
  onKeyDown,
  onBlur,
}: TimelineBarProps) {
  const color = row.color.row;
  const narrow = width < NARROW_BAR;
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="timeline-bar"
      data-row-id={row.id}
      data-line=""
      aria-label={title}
      aria-describedby={hintId}
      className={cn(
        'absolute flex items-center gap-2 rounded border border-border px-2 text-label text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring',
        color && color !== 'default' ? colorClasses[color].bg : 'bg-fill-hover',
        editable && 'cursor-grab',
        changing && 'z-10 shadow-menu ring-2 ring-ring',
      )}
      style={{ left, width, top, height }}
      onPointerDown={(event) => {
        const edge =
          event.target instanceof Element
            ? event.target.closest('[data-bar-edge]')?.getAttribute('data-bar-edge')
            : null;
        onPressStart(event, edge === 'start' || edge === 'end' ? edge : 'move');
      }}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      {narrow ? (
        <span className="absolute left-full top-0 ml-1 flex h-full items-center whitespace-nowrap">
          {title}
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
          <span className="truncate font-medium">{title}</span>
          {properties.map((property) => (
            <CellView
              key={property.id}
              property={property}
              {...rowCell(row, property)}
              ctx={ctx}
              wrap={false}
              className="min-w-0 shrink-0 text-label text-muted"
            />
          ))}
        </span>
      )}
      {editable && (
        <>
          <span
            aria-hidden
            data-bar-edge="start"
            title={TIMELINE_TEXT.moveStart(title)}
            className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l"
          />
          <span
            aria-hidden
            data-bar-edge="end"
            title={TIMELINE_TEXT.moveEnd(title)}
            className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r"
          />
        </>
      )}
    </div>
  );
}
