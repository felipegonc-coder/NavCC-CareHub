import {
  eventHref,
  type CalendarItem,
  type EventItem,
  type UpcomingItem,
} from '@carehub/team-calendar-api';
import { toInstant, todayIn } from '@carehub/team-time';

const isEvent = (item: CalendarItem): item is EventItem => item.source === 'event';

/** Where an item starts on the time line: an all-day item at 00:00 of its first day there. */
const startsAt = (item: EventItem, timeZone: string) =>
  item.allDay ? toInstant(`${item.start}T00:00`, timeZone).getTime() : Date.parse(item.start);

/**
 * Upcoming for Home and the sidebar: Care Hub events from layers that are on, under way at `now`
 * or still to come in `items`, soonest first and all-day ones first on their day. Events the
 * viewer said Not going to are left out.
 */
export function upcomingOf(
  items: readonly CalendarItem[],
  layersOn: ReadonlySet<string>,
  now: Date,
  timeZone: string,
  limit: number,
): UpcomingItem[] {
  const today = todayIn(timeZone, now);
  const notOver = (item: EventItem) =>
    item.allDay ? item.end > today : Date.parse(item.end) > now.getTime();
  return items
    .filter(isEvent)
    .filter((item) => layersOn.has(item.layerId) && item.myReply !== 'not-going' && notOver(item))
    .map((item) => ({ item, at: startsAt(item, timeZone) }))
    .sort(
      (a, b) =>
        a.at - b.at ||
        Number(b.item.allDay) - Number(a.item.allDay) ||
        (a.item.id < b.item.id ? -1 : 1),
    )
    .slice(0, limit)
    .map(({ item }) => ({
      id: item.id,
      title: item.title,
      allDay: item.allDay,
      start: item.start,
      end: item.end,
      videoLink: item.videoLink,
      href: eventHref(item.eventId, item.occurrence?.key),
    }));
}
