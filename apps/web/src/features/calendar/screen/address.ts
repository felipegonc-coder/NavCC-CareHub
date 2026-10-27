import { isCivilDate, toCivil, type CalendarView, type CivilDate } from '@carehub/team-time';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

export const VIEWS = ['day', 'week', 'month'] as const satisfies readonly CalendarView[];

/**
 * The view and date in the address (`/calendar?view=month&date=2026-11-05`), so reloads and links
 * keep them. Without a view, Week shows (Day on phones); without a date, today.
 */
export function useCalendarAddress(today: CivilDate, phone: boolean) {
  const [params, setParams] = useSearchParams();
  const asked = params.get('view');
  const date = params.get('date');
  const view = VIEWS.find((name) => name === asked) ?? (phone ? 'day' : 'week');
  const anchor = date !== null && isCivilDate(date) ? date : today;

  const show = (next: { view?: CalendarView; date?: CivilDate }) =>
    setParams(
      (current) => {
        const nextParams = new URLSearchParams(current);
        if (next.view) nextParams.set('view', next.view);
        if (next.date === today) nextParams.delete('date');
        else if (next.date) nextParams.set('date', next.date);
        return nextParams;
      },
      { replace: true },
    );
  return { view, anchor, show };
}

/** The wall-clock time in `timeZone`, to the minute, checked every 30 seconds. */
export function useNow(timeZone: string) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return toCivil(now, timeZone);
}
