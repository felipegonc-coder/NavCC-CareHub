// Upcoming's data: what's under way or starts by the end of tomorrow, from Calendar's
// `GET /api/calendar/upcoming` (only the layers the person has switched on).
// Stand-in: UpcomingItem and isJoinable mirror what @carehub/team-calendar-api is adding, and
// useUpcoming what features/calendar will export. Switch to theirs once they're on main.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useLiveEvent } from '../live';

/** A link that Join opens. */
export interface VideoLink {
  url: string;
  provider: 'zoom' | 'google-meet' | 'teams' | 'webex';
}

/** One event or meeting, soonest first. */
export interface UpcomingItem {
  id: string;
  /** '' shows "(No title)". */
  title: string;
  allDay: boolean;
  /** Timed items: UTC instants. All-day items: dates, with `end` exclusive. */
  start: string;
  end: string;
  videoLink: VideoLink | null;
  /** Opens it in Calendar: `/calendar?event=<id>&occurrence=<key>`. */
  href: string;
}

/** Join shows from this many minutes before the start until the end. */
export const JOIN_EARLY_MINUTES = 10;

/** Timed, with a video link, and starting within 10 minutes or under way (HR-02, HR-17). */
export function isJoinable(item: UpcomingItem, now: Date): boolean {
  if (item.allDay || !item.videoLink) return false;
  const time = now.getTime();
  return (
    Date.parse(item.start) - JOIN_EARLY_MINUTES * 60_000 <= time && time < Date.parse(item.end)
  );
}

/** What the server sends after an event or layer changes. */
const CALENDAR_CHANGED = 'calendar.changed';
const upcomingKeys = {
  all: ['calendar', 'upcoming'] as const,
  limit: (limit: number) => ['calendar', 'upcoming', limit] as const,
};

/** Up to `limit` (1 to 10) upcoming items, refetched whenever the person's calendar changes. */
export function useUpcoming(limit: number) {
  const queryClient = useQueryClient();
  useLiveEvent(CALENDAR_CHANGED, () => {
    void queryClient.invalidateQueries({ queryKey: upcomingKeys.all });
  });
  return useQuery({
    queryKey: upcomingKeys.limit(limit),
    queryFn: async ({ signal }) => {
      const body = await api.get<{ items: UpcomingItem[] }>(
        `/api/calendar/upcoming?limit=${limit}`,
        { signal },
      );
      return body.items;
    },
  });
}
