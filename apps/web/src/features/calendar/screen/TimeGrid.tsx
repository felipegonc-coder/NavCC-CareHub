import {
  datePart,
  formatHourLabel,
  formatTime,
  formatTimeRange,
  type CivilDate,
  type CivilDateTime,
  type TimePrefs,
} from '@carehub/team-time';
import { Skeleton } from '@carehub/ui';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GridItem } from '../data/adapt';
import {
  MINUTES_PER_DAY,
  VISIBLE_ITEMS,
  hourAxis,
  initialScrollMinutes,
  layoutAllDayRow,
  layoutTimeGrid,
  nowPosition,
} from '../layout';
import { DayButton, ItemBlock, LaneItems, percent } from './blocks';

const HOUR_PX = 48;
const LANE_PX = 24;
/** Blocks are at least 20 px tall, so one line of text fits. */
const MIN_BLOCK_MINUTES = (20 * 60) / HOUR_PX;
const GUTTER = '3.5rem';
/** Shorter blocks show their title and start time on one line. */
const SHORT_MINUTES = 45;

export interface TimeGridProps {
  days: CivilDate[];
  items: GridItem[];
  loading: boolean;
  now: CivilDateTime;
  prefs: Pick<TimePrefs, 'use24h'>;
  onOpenDay: (date: CivilDate) => void;
}

/** Day and Week: day headings, the all-day row, and 24 hours that open at 7:00 AM or now. */
export function TimeGrid({ days, items, loading, now, prefs, onOpenDay }: TimeGridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  const blocks = useMemo(
    () => layoutTimeGrid(items, days, { minHeight: MIN_BLOCK_MINUTES }),
    [items, days],
  );
  // Day view has room for every all-day item; Week shows 3 a day, then "+N more".
  const allDay = useMemo(
    () =>
      layoutAllDayRow(items, days, { maxVisible: days.length === 1 ? Infinity : VISIBLE_ITEMS }),
    [items, days],
  );
  const hours = hourAxis((time) => formatHourLabel(time, prefs));
  const nowAt = nowPosition(now, days);
  const columns = { gridTemplateColumns: `${GUTTER} repeat(${days.length}, minmax(0, 1fr))` };
  const lanes = allDay.visibleLanes + (allDay.more.some((count) => count > 0) ? 1 : 0);

  // The hours scroll inside the screen, so the headings and the all-day row stay in view.
  useLayoutEffect(() => {
    const fit = () => {
      const top = scroller.current?.getBoundingClientRect().top ?? 0;
      setHeight(Math.max(window.innerHeight - top, 6 * HOUR_PX));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [lanes]);
  // Then open at 7:00 AM, or an hour before now when that's later: once, when it can scroll.
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (opened.current || height === undefined || !scroller.current) return;
    opened.current = true;
    // A little less, so the hour's label shows above its line.
    scroller.current.scrollTop = (initialScrollMinutes(now, days) * HOUR_PX) / 60 - 8;
  }, [height, now, days]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid border-b border-border" style={columns}>
        <div />
        {days.map((date) => (
          <div key={date} className="flex justify-center py-1">
            <DayButton date={date} today={datePart(now)} weekday onOpenDay={onOpenDay} />
          </div>
        ))}
      </div>
      <div className="relative grid border-b border-border" style={columns}>
        <div className="px-1 py-1 text-right text-label text-muted">All day</div>
        {days.map((date) => (
          <div
            key={date}
            className="border-l border-border"
            style={{ height: Math.max(lanes, 1) * LANE_PX + 4 }}
          />
        ))}
        <div className="absolute inset-y-0 right-0" style={{ left: GUTTER }}>
          <LaneItems
            row={allDay}
            top={2}
            laneHeight={LANE_PX}
            prefs={prefs}
            onOpenDay={onOpenDay}
          />
        </div>
      </div>
      <div ref={scroller} className="overflow-y-auto" style={{ height }}>
        <div className="grid" style={{ ...columns, height: 24 * HOUR_PX }}>
          <div className="relative" aria-hidden>
            {hours.slice(1).map((mark) => (
              <span
                key={mark.hour}
                className="absolute right-2 -translate-y-1/2 text-label text-muted"
                style={{ top: mark.hour * HOUR_PX }}
              >
                {mark.label}
              </span>
            ))}
          </div>
          {days.map((date, index) => (
            <div key={date} className="relative border-l border-border">
              {hours.map((mark) => (
                <div
                  key={mark.hour}
                  data-testid={`calendar-slot-${date}T${mark.time}`}
                  className="border-b border-border"
                  style={{ height: HOUR_PX }}
                />
              ))}
              {loading
                ? [9 + (index % 3), 13 + (index % 2)].map((hour) => (
                    <Skeleton
                      key={hour}
                      className="absolute inset-x-1"
                      style={{ top: hour * HOUR_PX, height: HOUR_PX }}
                    />
                  ))
                : blocks[index]?.map((block) => (
                    <ItemBlock
                      key={block.key}
                      item={block.item}
                      className="flex flex-col py-0.5"
                      style={{
                        top: percent(block.top / MINUTES_PER_DAY),
                        height: percent(block.height / MINUTES_PER_DAY),
                        left: `calc(${percent(block.left)} + 2px)`,
                        width: `calc(${percent(block.width)} - 4px)`,
                      }}
                    >
                      {block.height < SHORT_MINUTES ? (
                        <span className="truncate">
                          <span className="font-medium">{block.item.title}</span>{' '}
                          {formatTime(block.start, prefs)}
                        </span>
                      ) : (
                        <>
                          <span className="truncate font-medium">{block.item.title}</span>
                          <span className="truncate">
                            {formatTimeRange(block.start, block.end, prefs)}
                          </span>
                        </>
                      )}
                    </ItemBlock>
                  ))}
              {nowAt?.dayIndex === index && (
                <div
                  aria-hidden
                  data-testid="calendar-now"
                  className="pointer-events-none absolute inset-x-0 h-0.5 bg-danger"
                  style={{ top: percent(nowAt.minute / MINUTES_PER_DAY) }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
