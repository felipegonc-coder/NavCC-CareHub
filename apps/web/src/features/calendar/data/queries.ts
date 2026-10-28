import {
  CALENDAR_CHANGED,
  itemsResponseSchema,
  layersResponseSchema,
  upcomingResponseSchema,
} from '@carehub/team-calendar-api';
import { addDays, type CivilDate } from '@carehub/team-time';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { useLiveEvent } from '../../live';

export const calendarKeys = {
  all: ['calendar'] as const,
  /** `to` is exclusive, as in the request. */
  items: (from: CivilDate, to: CivilDate) => ['calendar', 'items', from, to] as const,
  layers: ['calendar', 'layers'] as const,
  upcoming: (limit: number) => ['calendar', 'upcoming', limit] as const,
};

/** How often Upcoming asks again, so items that have ended drop off and the next day's come in. */
const UPCOMING_REFRESH_MS = 60_000;

/** Items from every layer, on or off, for the dates `first` to `last` in the viewer's zone. */
export function useCalendarItems(first: CivilDate, last: CivilDate) {
  const to = addDays(last, 1);
  return useQuery({
    queryKey: calendarKeys.items(first, to),
    queryFn: ({ signal }) =>
      api.get(`/api/calendar/items?from=${first}&to=${to}`, {
        schema: itemsResponseSchema,
        signal,
      }),
  });
}

/** The person's layers, with their colours and on/off switches. */
export function useCalendarLayers() {
  return useQuery({
    queryKey: calendarKeys.layers,
    queryFn: ({ signal }) =>
      api.get('/api/calendar/layers', { schema: layersResponseSchema, signal }),
  });
}

/** Loads the calendar again after a change elsewhere, and after a missed live connection. */
export function useCalendarLive(): void {
  const queryClient = useQueryClient();
  useLiveEvent(CALENDAR_CHANGED, () => {
    void queryClient.invalidateQueries({ queryKey: calendarKeys.all });
  });
}

/**
 * What's next, for Home and the sidebar: events under way or starting by the end of tomorrow, from
 * layers that are on, soonest first (`limit` from 1 to 10). It loads again when the calendar changes
 * elsewhere, after a missed live connection, and every minute.
 */
export function useUpcoming(limit = 6) {
  const queryClient = useQueryClient();
  useLiveEvent(CALENDAR_CHANGED, () => {
    void queryClient.invalidateQueries({ queryKey: calendarKeys.upcoming(limit) });
  });
  return useQuery({
    queryKey: calendarKeys.upcoming(limit),
    queryFn: ({ signal }) =>
      api.get(`/api/calendar/upcoming?limit=${limit}`, { schema: upcomingResponseSchema, signal }),
    refetchInterval: UPCOMING_REFRESH_MS,
  });
}
