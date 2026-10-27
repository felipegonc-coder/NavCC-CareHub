import {
  dayOfWeek,
  formatTime,
  weekdayName,
  type CivilDate,
  type TimePrefs,
} from '@carehub/team-time';
import { cn, colorClasses } from '@carehub/ui';
import type { CSSProperties, ReactNode } from 'react';
import { longDate, type GridItem } from '../data/adapt';
import type { LaneRow } from '../layout';

/** A share of a row or column, for inline positions. */
export const percent = (fraction: number): string => `${fraction * 100}%`;

/** One drawn item: its whole label for screen readers, its layer's colours, faded when declined. */
export function ItemBlock({
  item,
  style,
  className,
  dot = false,
  children,
}: {
  item: GridItem;
  style: CSSProperties;
  className?: string;
  /** Month's timed items: a coloured dot instead of a filled block. */
  dot?: boolean;
  children: ReactNode;
}) {
  const colors = colorClasses[item.color];
  return (
    <button
      type="button"
      data-testid={`calendar-event-${item.id}`}
      aria-label={item.label}
      className={cn(
        'absolute overflow-hidden rounded-sm px-1.5 text-left text-label',
        item.declined && 'line-through',
        item.declined && !dot && 'border border-border bg-bg text-muted',
        !item.declined && !dot && cn(colors.bg, colors.text),
        dot && 'flex items-center gap-1 hover:bg-fill-hover',
        className,
      )}
      style={style}
    >
      {dot && (
        <span
          aria-hidden
          className={cn('size-1.5 shrink-0 rounded-full bg-current', colors.text)}
        />
      )}
      {children}
    </button>
  );
}

/** A day's weekday and number; opens that day in Day view. Today's number is filled. */
export function DayButton({
  date,
  today,
  weekday,
  muted = false,
  onOpenDay,
}: {
  date: CivilDate;
  today: CivilDate;
  weekday: boolean;
  /** Month: days of the months before and after. */
  muted?: boolean;
  onOpenDay: (date: CivilDate) => void;
}) {
  const isToday = date === today;
  return (
    <button
      type="button"
      aria-label={longDate(date)}
      aria-current={isToday ? 'date' : undefined}
      onClick={() => onOpenDay(date)}
      className="inline-flex items-center gap-1 rounded px-1 text-small hover:bg-fill-hover max-md:min-h-11"
    >
      {weekday && <span className="text-muted">{weekdayName(dayOfWeek(date), 'short')}</span>}
      <span
        className={cn(
          'inline-flex size-6 items-center justify-center rounded-full',
          isToday ? 'bg-primary text-primary-fg' : muted && 'text-muted',
        )}
      >
        {Number(date.slice(8))}
      </span>
    </button>
  );
}

/**
 * The items of one lane row (the all-day row, or a week of Month): bars for all-day and multi-day
 * items, a dot and the start time for timed ones, then "+N more", which opens that day.
 */
export function LaneItems({
  row,
  top,
  laneHeight,
  prefs,
  onOpenDay,
}: {
  row: LaneRow<GridItem>;
  /** Pixels above the first lane, and each lane's height. */
  top: number;
  laneHeight: number;
  prefs: Pick<TimePrefs, 'use24h'>;
  onOpenDay: (date: CivilDate) => void;
}) {
  const count = row.days.length;
  return (
    <>
      {row.segments
        .filter((segment) => segment.visible)
        .map(({ key, item, lane, startIndex, endIndex }) => (
          <ItemBlock
            key={key}
            item={item}
            dot={!item.allDay && startIndex === endIndex}
            className="h-5 leading-5"
            style={{
              top: top + lane * laneHeight,
              left: `calc(${percent(startIndex / count)} + 2px)`,
              width: `calc(${percent((endIndex - startIndex + 1) / count)} - 4px)`,
            }}
          >
            <span className="truncate">
              {!item.allDay && `${formatTime(item.start, prefs)} `}
              <span className="font-medium">{item.title}</span>
            </span>
          </ItemBlock>
        ))}
      {row.more.map((more, index) => {
        const date = row.days[index];
        if (!date || more === 0) return null;
        return (
          <button
            key={date}
            type="button"
            aria-label={`+${more} more on ${longDate(date)}`}
            onClick={() => onOpenDay(date)}
            className="absolute truncate rounded-sm px-1.5 text-left text-label text-muted hover:bg-fill-hover"
            style={{
              top: top + row.visibleLanes * laneHeight,
              left: percent(index / count),
              width: percent(1 / count),
            }}
          >
            +{more} more
          </button>
        );
      })}
    </>
  );
}
