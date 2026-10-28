import { cn } from '@carehub/ui';
import { tickLabel } from './messages';
import {
  headerTicks,
  minutesToX,
  SCALE_SPECS,
  weekendDays,
  dayMinutes,
  type TimeWindow,
} from './model';

interface TimeHeaderProps {
  window: TimeWindow;
  weekStart: Parameters<typeof headerTicks>[1];
  hour12: boolean;
  /** px, both rows. */
  height: number;
}

/** The two rows of dates over the bars: months (or days, quarters, years) above, days below. */
export function TimeHeader({ window, weekStart, hour12, height }: TimeHeaderProps) {
  const ticks = headerTicks(window, weekStart);
  const half = height / 2;
  const row = (list: typeof ticks.top, unit: typeof ticks.topUnit | typeof ticks.bottomUnit) =>
    list.map((tick) => (
      <span
        key={tick.key}
        className={cn(
          'absolute top-0 flex items-center border-l border-border px-1 text-label',
          list === ticks.top ? 'font-medium text-fg' : 'text-muted',
        )}
        style={{ left: tick.x, width: tick.width, height: half }}
      >
        <span className="truncate">{tickLabel(tick, unit, window.scale, hour12)}</span>
      </span>
    ));
  return (
    <div className="relative border-b border-border bg-bg" style={{ height }}>
      <div className="absolute inset-x-0 top-0" style={{ height: half }}>
        {row(ticks.top, ticks.topUnit)}
      </div>
      <div className="absolute inset-x-0 bottom-0" style={{ height: half }}>
        {row(ticks.bottom, ticks.bottomUnit)}
      </div>
    </div>
  );
}

interface BackdropProps {
  window: TimeWindow;
  weekStart: Parameters<typeof headerTicks>[1];
  showWeekends: boolean;
  /** Now, in wall-clock minutes. */
  now: number;
}

/** Behind the bars: a line per day (or week, month), weekends shaded, and the Today line. */
export function Backdrop({ window, weekStart, showWeekends, now }: BackdropProps) {
  const { bottom } = headerTicks(window, weekStart);
  const dayWidth = SCALE_SPECS[window.scale].dayWidth;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {showWeekends &&
        weekendDays(window).map((date) => (
          <div
            key={date}
            className="absolute inset-y-0 bg-fill"
            style={{ left: minutesToX(window, dayMinutes(date)), width: dayWidth }}
          />
        ))}
      {bottom.map((tick) => (
        <div
          key={tick.key}
          className="absolute inset-y-0 border-l border-border"
          style={{ left: tick.x }}
        />
      ))}
      <div
        data-testid="timeline-today"
        className="absolute inset-y-0 w-px bg-primary"
        style={{ left: minutesToX(window, now) }}
      />
    </div>
  );
}
