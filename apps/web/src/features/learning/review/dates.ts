import { useMemo } from 'react';
import { LEARNING_DAY_ZONE, useProfileTimeZone } from '../data/timeZone';

/**
 * Shows a moment as its day, such as "Oct 27, 2026", in the person's profile time zone and never the browser's
 * (decision 0317).
 */
export function useDayFormat(): (isoDateTime: string) => string {
  const timeZone = useProfileTimeZone() ?? LEARNING_DAY_ZONE;
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone });
    return (isoDateTime: string) => format.format(new Date(isoDateTime));
  }, [timeZone]);
}
