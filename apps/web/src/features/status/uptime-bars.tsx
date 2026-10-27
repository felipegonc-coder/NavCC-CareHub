import { cn } from '@carehub/ui';
import { useRef, useState, type KeyboardEvent } from 'react';
import type { DayUptime } from './api';
import { dayLabel, dayTone, type DayTone } from './format';

const TONES: Record<DayTone, string> = {
  good: 'bg-success',
  fair: 'bg-warning',
  poor: 'bg-danger',
  none: 'bg-fill',
};

const KEY_STEPS: Record<string, (index: number, last: number) => number> = {
  ArrowLeft: (index) => index - 1,
  ArrowRight: (index) => index + 1,
  Home: () => 0,
  End: (_index, last) => last,
};

/**
 * One bar per day, oldest first. Each bar is a button named "October 12: 99.2%", so the number
 * shows on hover and focus and screen readers read it; arrow keys, Home and End move between days.
 */
export function UptimeBars({ days }: { days: readonly DayUptime[] }) {
  const last = days.length - 1;
  const [focusable, setFocusable] = useState(last);
  const [shown, setShown] = useState<number | null>(null);
  const bars = useRef<(HTMLButtonElement | null)[]>([]);
  const tabStop = Math.min(focusable, last);
  const readout = days[shown ?? last];

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = KEY_STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(last, step(index, last)));
    setFocusable(next);
    bars.current[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label="Uptime by day"
        className="flex h-11 items-stretch gap-0.5"
        onMouseLeave={() => setShown(null)}
        onBlur={() => setShown(null)}
      >
        {days.map((day, index) => (
          <button
            key={day.date}
            ref={(node) => {
              bars.current[index] = node;
            }}
            type="button"
            tabIndex={index === tabStop ? 0 : -1}
            aria-label={dayLabel(day)}
            className={cn(
              'min-w-0 flex-1 rounded-sm transition-opacity',
              TONES[dayTone(day.percent)],
              shown !== null && shown !== index && 'opacity-60',
            )}
            onMouseEnter={() => setShown(index)}
            onFocus={() => {
              setFocusable(index);
              setShown(index);
            }}
            onClick={() => setShown(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          />
        ))}
      </div>
      <div aria-hidden className="flex justify-between text-label text-muted">
        <span>30 days ago</span>
        <span>Today</span>
      </div>
      {readout && (
        <p aria-hidden className="text-small">
          {dayLabel(readout)}
        </p>
      )}
    </div>
  );
}
