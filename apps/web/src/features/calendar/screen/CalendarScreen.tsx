import {
  DEFAULT_TIME_PREFS,
  datePart,
  formatDateRange,
  formatPeriod,
  type CalendarView,
  type CivilDate,
} from '@carehub/team-time';
import { Button, useMediaQuery } from '@carehub/ui';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { usePageTitle } from '../../../lib/usePageTitle';
import { ShellHeader } from '../../shell';
import { gridItems } from '../data/adapt';
import { useCalendarItems, useCalendarLayers, useCalendarLive } from '../data/queries';
import { navigate, viewRange, visibleItems, type PeriodStep } from '../layout';
import { useCalendarAddress, useNow } from './address';
import { MonthGrid } from './MonthGrid';
import { useShortcuts } from './shortcuts';
import { TimeGrid } from './TimeGrid';
import { TopBar, ViewSwitch } from './TopBar';

/** The calendar settings that change the grid, until GET /api/calendar/settings lands. */
const SETTINGS = { hideWeekends: false, hideDeclined: false, shortcuts: true };

/** `/calendar`: Day, Week and Month with the person's items from every layer that's on. */
export function CalendarScreen() {
  usePageTitle('Calendar');
  const phone = useMediaQuery('(max-width: 767px)');
  // Week start and 24-hour time come from the person's profile once the web app has it.
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_PREFS.timeZone);
  const prefs = { ...DEFAULT_TIME_PREFS, timeZone };
  const now = useNow(timeZone);
  const today = datePart(now);
  const { view, anchor, show } = useCalendarAddress(today, phone);
  const options = useMemo(
    () => ({ weekStart: prefs.weekStart, hideWeekends: SETTINGS.hideWeekends, phone }),
    [prefs.weekStart, phone],
  );
  const range = useMemo(() => viewRange(view, anchor, options), [view, anchor, options]);
  const items = useCalendarItems(range.start, range.end);
  const layers = useCalendarLayers();
  useCalendarLive();

  // The server answers in the person's own time zone.
  const zone = items.data?.timeZone;
  useEffect(() => {
    if (zone) setTimeZone(zone);
  }, [zone]);

  const shown = useMemo(
    () =>
      items.data
        ? visibleItems(
            gridItems(items.data.items, layers.data?.layers, { timeZone, use24h: prefs.use24h }),
            SETTINGS,
          )
        : [],
    [items.data, layers.data, timeZone, prefs.use24h],
  );
  const step = (to: PeriodStep) =>
    show({ date: navigate(view, anchor, to, { ...options, today }) });
  const switchView = (next: CalendarView) => show({ view: next });
  const openDay = (date: CivilDate) => show({ view: 'day', date });
  useShortcuts(SETTINGS.shortcuts, (shortcut) =>
    'view' in shortcut ? switchView(shortcut.view) : step(shortcut.step),
  );

  const period =
    view === 'week' ? formatDateRange(range.start, range.end) : formatPeriod(view, anchor, prefs);
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <h1 className="sr-only">Calendar</h1>
      <ShellHeader>
        <TopBar view={view} period={period} onStep={step} onView={switchView} />
      </ShellHeader>
      <ViewSwitch
        view={view}
        onView={switchView}
        wide
        className="border-b border-border px-3 py-2 md:hidden"
      />
      {items.isError && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b border-border px-4 py-2 text-small"
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0 text-danger" />
          <p className="min-w-0 flex-1">Couldn't load the calendar. {items.error.message}</p>
          <Button variant="secondary" size="sm" onClick={() => void items.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {range.month ? (
        <MonthGrid
          month={range.month}
          items={shown}
          loading={items.isPending}
          today={today}
          prefs={prefs}
          onOpenDay={openDay}
        />
      ) : (
        <TimeGrid
          key={view}
          days={range.days}
          items={shown}
          loading={items.isPending}
          now={now}
          prefs={prefs}
          onOpenDay={openDay}
        />
      )}
    </main>
  );
}
