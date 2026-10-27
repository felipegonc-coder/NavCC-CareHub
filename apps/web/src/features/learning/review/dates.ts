import { DEFAULT_TIME_ZONE } from '@carehub/shared';
import { useMemo } from 'react';
import { useProfileTimeZone } from '../data/timeZone';

/**
 * Shows a moment as its day, such as "Oct 27, 2026", in the person's profile time zone and never the browser's
 * (decision 0317).
 */
export function useDayFormat(): (isoDateTime: string) => string {
  const timeZone = useProfileTimeZone() ?? DEFAULT_TIME_ZONE;
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone });
    return (isoDateTime: string) => format.format(new Date(isoDateTime));
  }, [timeZone]);
}
