import { dayOfWeek, weekdayName, type CivilDate, type TimePrefs } from '@carehub/team-time';
import { Skeleton } from '@carehub/ui';
import { useMemo } from 'react';
import type { GridItem } from '../data/adapt';
import { VISIBLE_ITEMS, layoutMonth, type MonthMatrix } from '../layout';
import { DayButton, LaneItems, percent } from './blocks';

/** Where the first item sits under the day's number, and each lane's height. */
const TOP_PX = 32;
const LANE_PX = 22;

export interface MonthGridProps {
  month: MonthMatrix;
  items: GridItem[];
  loading: boolean;
  today: CivilDate;
  prefs: Pick<TimePrefs, 'use24h'>;
  onOpenDay: (date: CivilDate) => void;
}

/** Month: up to 3 items a day, then "+N more"; all-day items as bars, timed ones with a dot. */
export function MonthGrid({ month, items, loading, today, prefs, onOpenDay }: MonthGridProps) {
  const layout = useMemo(
    () => layoutMonth(items, month, { maxVisible: VISIBLE_ITEMS }),
    [items, month],
  );
  const firstWeek = month.weeks[0] ?? [];
  const count = firstWeek.length;
  const columns = { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid border-b border-border" style={columns} aria-hidden>
        {firstWeek.map((cell) => (
          <div key={cell.date} className="px-2 py-1 text-label text-muted">
            {weekdayName(dayOfWeek(cell.date), 'short')}
          </div>
        ))}
      </div>
      <div className="flex flex-1 flex-col">
        {layout.weeks.map((week, weekIndex) => (
          <div
            key={week.days[0]}
            className="relative grid min-h-28 flex-1 border-b border-border"
            style={columns}
          >
            {week.cells.map((cell) => (
              <div
                key={cell.date}
                data-testid={`calendar-day-${cell.date}`}
                className="border-l border-border p-1"
              >
                <DayButton
                  date={cell.date}
                  today={today}
                  weekday={false}
                  muted={!cell.inMonth}
                  onOpenDay={onOpenDay}
                />
              </div>
            ))}
            {loading &&
              [weekIndex % count, (weekIndex + 3) % count].map((index) => (
                <Skeleton
                  key={index}
                  className="absolute h-4"
                  style={{
                    top: TOP_PX,
                    left: `calc(${percent(index / count)} + var(--ch-space-1))`,
                    width: `calc(${percent(1 / count)} - var(--ch-space-2))`,
                  }}
                />
              ))}
            {!loading && (
              <LaneItems
                row={week}
                top={TOP_PX}
                laneHeight={LANE_PX}
                prefs={prefs}
                onOpenDay={onOpenDay}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
