// Analytics requests: GET /api/analytics/overview and GET /api/analytics/filters, for Admins only
// (AN-D1). Anyone else gets 403 (AN-06).
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ApiError, api } from '../../lib/api';

/** A day as YYYY-MM-DD, in the viewer's time zone. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().nonnegative();
const numbers = { activePeople: count, views: count, edits: count, created: count };

export const overviewSchema = z.object({
  range: z.object({ from: day, to: day }),
  /** The first day still kept, for "Activity older than 1 year is deleted." */
  keptFrom: day,
  /** The viewer's time zone, which the days follow (AN-04). */
  timeZone: z.string(),
  totals: z.object(numbers),
  /** One per day of the range, oldest first. */
  days: z.array(z.object({ day, ...numbers })).min(1),
  topPages: z.array(
    z.object({
      pageId: z.string(),
      /** '' for an untitled page. */
      title: z.string(),
      state: z.enum(['live', 'trash', 'deleted']).nullable(),
      views: count,
      /** How many people viewed it. */
      viewers: count,
    }),
  ),
  topEditors: z.array(z.object({ userId: z.string(), name: z.string(), edits: count })),
});
export type Overview = z.infer<typeof overviewSchema>;
export type DayNumbers = Overview['days'][number];
export type TopPage = Overview['topPages'][number];
export type TopEditor = Overview['topEditors'][number];

const option = z.object({ id: z.string(), name: z.string() });

/** The people and team spaces Overview can be filtered by. */
export const filtersSchema = z.object({ people: z.array(option), spaces: z.array(option) });
export type Filters = z.infer<typeof filtersSchema>;

/** What Overview shows: a preset (the last 7, 30 or 90 days) or custom days, and the filters. */
export interface OverviewQuery {
  days?: '7' | '30' | '90';
  from?: string;
  to?: string;
  person?: string;
  space?: string;
}

export function overviewPath(query: OverviewQuery): string {
  const params = new URLSearchParams();
  for (const key of ['days', 'from', 'to', 'person', 'space'] as const) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  const search = params.toString();
  return search ? `/api/analytics/overview?${search}` : '/api/analytics/overview';
}

/** Refusals and bad requests don't get better by asking again. */
const retry = (failures: number, error: Error) =>
  failures < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500);

export function useOverview(query: OverviewQuery) {
  return useQuery({
    queryKey: ['analytics', 'overview', query],
    queryFn: ({ signal }) => api.get(overviewPath(query), { schema: overviewSchema, signal }),
    // The old numbers stay on screen while a new range loads.
    placeholderData: keepPreviousData,
    retry,
  });
}

export function useFilters() {
  return useQuery({
    queryKey: ['analytics', 'filters'],
    queryFn: ({ signal }) => api.get('/api/analytics/filters', { schema: filtersSchema, signal }),
    staleTime: 5 * 60_000,
    retry,
  });
}
