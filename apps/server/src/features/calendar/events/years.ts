import type { Civil } from '@carehub/team-repeat';
import type { Schedule } from './model';

/** The years event times may be in (both included), so a mistyped year can't be saved. */
export const FIRST_YEAR = 1900;
export const LAST_YEAR = 2100;
export const YEARS_MESSAGE = `Pick a date between ${FIRST_YEAR} and ${LAST_YEAR}.`;

const yearOf = (time: Civil) => Number(time.slice(0, 4));
const upTo = (last: number) => (time: Civil | undefined) =>
  time === undefined || (yearOf(time) >= FIRST_YEAR && yearOf(time) <= last);

/**
 * Whether a schedule's times are in those years: its start, when its repeat ends and where moved
 * occurrences start. Ends may reach into the year after, since they're exclusive.
 */
export function scheduleInYears(schedule: Schedule): boolean {
  const moved = Object.values(schedule.overrides);
  const starts = [schedule.start, schedule.rule?.until, ...moved.map((change) => change.start)];
  const ends = [schedule.end, ...moved.map((change) => change.end)];
  return starts.every(upTo(LAST_YEAR)) && ends.every(upTo(LAST_YEAR + 1));
}
