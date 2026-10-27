import {
  daysBetween,
  isoDateInTimeZone,
  PersonTranscriptResponseSchema,
  type CourseStatus,
  type Id,
  type IsoDate,
  type IsoDateTime,
} from '@carehub/learning';
import { useQuery } from '@tanstack/react-query';
import { api, apiPath, LEARNING_API, LearningApiError, withQuery } from '../../data';
import { LEARNING_DAY_ZONE } from '../../data/timeZone';
import { retryOnce } from '../../player/data';

// The person, team and path reports (docs/learning/api.md): a person's learning record, GET
// /reports/people/:personId, and what the team view and the path report share with it: their
// links, CSV downloads, and how statuses, days, minutes and failures read.

/** The cache key of the person, team and path report calls. */
export const reportsKey = ['learning', 'reports'] as const;

/** A person's learning record: "/learning/reports/people/<personId>". */
export const personReportHref = (personId: Id): string =>
  `/learning/reports/people/${encodeURIComponent(personId)}`;

/** The team view, over every course or one: "/learning/reports/team?courseId=<courseId>". */
export const teamReportHref = (courseId?: Id): string =>
  withQuery('/learning/reports/team', { courseId });

/** A person's name as the reports show it: "Unknown person" when the report has none. */
export const personName = (name: string): string => name.trim() || 'Unknown person';

/** A learning path's report: "/learning/reports/paths/<pathId>". */
export const pathReportHref = (pathId: Id): string =>
  `/learning/reports/paths/${encodeURIComponent(pathId)}`;

/** A certificate's page, for the code in a learning record. */
export const certificatePageHref = (certificateId: Id): string =>
  `/learning/certificates/${encodeURIComponent(certificateId)}`;

/** Where a report downloads as CSV: its API address (`apiPath`) with `format=csv`. */
export const csvHref = (path: string, query: Record<string, string | undefined> = {}): string =>
  withQuery(`${LEARNING_API}${path}`, { ...query, format: 'csv' });

/** One person's learning record: their own, or anyone's for people who may read reports. */
export function usePersonTranscript(personId: Id) {
  return useQuery({
    queryKey: [...reportsKey, 'people', personId],
    queryFn: ({ signal }) =>
      api('GET', apiPath('reports', 'people', personId), PersonTranscriptResponseSchema, {
        signal,
      }),
    retry: retryOnce,
  });
}

/** Each course status in words. */
export const STATUS_LABELS: Record<CourseStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  passed: 'Passed',
  failed: 'Failed',
};

const DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
const calendarDay = new Intl.DateTimeFormat(undefined, { ...DAY, timeZone: 'UTC' });
const dayFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * The day something happened, in the viewer's profile time zone (decision 0317): "12 Oct 2026".
 */
export function formatDay(at: IsoDateTime | null | undefined, timeZone: string): string | null {
  if (!at) return null;
  let format = dayFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat(undefined, { ...DAY, timeZone });
    dayFormats.set(timeZone, format);
  }
  return format.format(new Date(at));
}

/** A calendar day such as a due date, the same everywhere: "12 Oct 2026". */
export const formatCalendarDay = (day: IsoDate | null | undefined): string | null =>
  day ? calendarDay.format(new Date(`${day}T00:00:00Z`)) : null;

/** Time spent in whole minutes: "25 min", "2 h", "1 h 5 min". */
export function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest === 0 ? '' : ` ${rest} min`}`;
}

/** A whole percentage, "92%", or null without one. */
export const formatPercent = (value: number | null): string | null =>
  value === null ? null : `${Math.round(value)}%`;

/** Today in `LEARNING_DAY_ZONE` (decision 0317), for days overdue: the same day for everyone. */
export const learningToday = (now = new Date()): IsoDate =>
  isoDateInTimeZone(now.toISOString(), LEARNING_DAY_ZONE);

/** Days past the due date of an unfinished course on `today`, or 0. */
export function daysLate(
  row: { status: CourseStatus; dueDate?: IsoDate | undefined },
  today: IsoDate,
): number {
  if (row.dueDate === undefined || row.status === 'completed' || row.status === 'passed') return 0;
  return Math.max(0, daysBetween(row.dueDate, today));
}

/** What a report link that leads nowhere says. */
export const NOT_FOUND = 'This report was deleted, or the link is wrong.';

/** Why a report didn't load, in plain words, and whether trying again can help. */
export function reportProblem(error: unknown): { text: string; retry: boolean } {
  if (!(error instanceof LearningApiError)) {
    return { text: 'Reload the page, then try again.', retry: true };
  }
  if (error.status === 403) {
    return {
      text: "You don't have access to this report. Ask an admin if you need it.",
      retry: false,
    };
  }
  if (error.status === 404) {
    return { text: NOT_FOUND, retry: false };
  }
  return { text: error.message, retry: error.offline || error.status >= 500 };
}
