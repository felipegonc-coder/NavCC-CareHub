import type { CalendarView } from '@carehub/team-time';
import { Button, IconButton, cn } from '@carehub/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PeriodStep } from '../layout';
import { VIEWS } from './address';

const LABELS: Record<CalendarView, string> = { day: 'Day', week: 'Week', month: 'Month' };

/** In the shell's top bar: Today, ‹ ›, the period, and (on computers) Day / Week / Month. */
export function TopBar({
  view,
  period,
  onStep,
  onView,
}: {
  view: CalendarView;
  period: string;
  onStep: (step: PeriodStep) => void;
  onView: (view: CalendarView) => void;
}) {
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => onStep('today')}>
        Today
      </Button>
      <IconButton label={`Previous ${view}`} size="sm" onClick={() => onStep('previous')}>
        <ChevronLeft aria-hidden className="size-4" />
      </IconButton>
      <IconButton label={`Next ${view}`} size="sm" onClick={() => onStep('next')}>
        <ChevronRight aria-hidden className="size-4" />
      </IconButton>
      <p aria-live="polite" className="min-w-0 flex-1 truncate text-h3 max-md:text-body">
        {period}
      </p>
      <ViewSwitch view={view} onView={onView} className="max-md:hidden" />
    </>
  );
}

/** Day / Week / Month as pressed buttons. Phones show it above the grid, full width. */
export function ViewSwitch({
  view,
  onView,
  className,
  wide = false,
}: {
  view: CalendarView;
  onView: (view: CalendarView) => void;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div role="group" aria-label="View" className={cn('flex gap-1', className)}>
      {VIEWS.map((name) => (
        <Button
          key={name}
          size="sm"
          variant={name === view ? 'secondary' : 'ghost'}
          aria-pressed={name === view}
          className={cn(wide && 'flex-1')}
          onClick={() => onView(name)}
        >
          {LABELS[name]}
        </Button>
      ))}
    </div>
  );
}
