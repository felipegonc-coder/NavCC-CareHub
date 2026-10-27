import {
  CALENDAR_CHANGED,
  type CalendarEvent,
  type CalendarItem,
  type CreateEvent,
  type ItemsQuery,
  type ItemsResponse,
  type UpcomingQuery,
  type UpcomingResponse,
} from '@carehub/team-calendar-api';
import { checkSeries } from '@carehub/team-repeat';
import { addDays, todayIn } from '@carehub/team-time';
import { httpError } from '../../../core/errors';
import type { Db } from '../../../db';
import { publishToUsers } from '../../live';
import { listLayers } from '../layers/service';
import { eventItems, eventJson } from './items';
import { civilOf, seriesOf, windowOf, type Schedule, type Window } from './model';
import {
  MAX_EVENTS,
  eventsInWindow,
  findEvent,
  insertEvent,
  membersAmong,
  profilesOf,
  type EventRecord,
} from './store';
import { upcomingOf } from './upcoming';
import { YEARS_MESSAGE, scheduleInYears } from './years';

/** The signed-in member, as Calendar needs them. */
export type Viewer = { id: string; workspaceId: string; timeZone: string };

/** Most items one range answer has. */
export const MAX_ITEMS = 2000;

/** Dates and times at the far edges of the calendar (years 1 and 9999) can't be shown. */
function inRange<T>(make: () => T): T {
  try {
    return make();
  } catch (error) {
    if (error instanceof RangeError) throw httpError(400, 'invalid', YEARS_MESSAGE);
    throw error;
  }
}

const peopleIds = (event: EventRecord) => [event.organizerId, ...event.people.map((p) => p.userId)];

const notify = (event: { id: string; organizerId: string }, people: readonly string[]) =>
  publishToUsers([event.organizerId, ...people], {
    type: CALENDAR_CHANGED,
    data: { eventId: event.id },
  });

/** Care Hub events in the viewer's range, from every event they organize or are invited to. */
export async function listItems(db: Db, viewer: Viewer, query: ItemsQuery): Promise<ItemsResponse> {
  const window: Window = inRange(() => windowOf(query.from, query.to, viewer.timeZone));
  const events = await eventsInWindow(db, viewer.workspaceId, viewer.id, window);
  const profiles = await profilesOf(db, events.flatMap(peopleIds));
  let truncated = events.length >= MAX_EVENTS;
  const items: CalendarItem[] = [];
  for (const event of events) {
    const shown = eventItems(event, viewer.id, window, profiles);
    truncated ||= shown.truncated;
    items.push(...shown.items);
  }
  items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1));
  if (items.length > MAX_ITEMS) {
    items.length = MAX_ITEMS;
    truncated = true;
  }
  return { from: query.from, to: query.to, timeZone: viewer.timeZone, items, truncated };
}

/** Upcoming: today and tomorrow in the viewer's zone, from the layers they have on. */
export async function listUpcoming(
  db: Db,
  viewer: Viewer,
  query: UpcomingQuery,
  now: Date = new Date(),
): Promise<UpcomingResponse> {
  const from = todayIn(viewer.timeZone, now);
  const [{ items }, { layers }] = await Promise.all([
    listItems(db, viewer, { from, to: addDays(from, 2) }),
    listLayers(db, viewer),
  ]);
  const on = new Set(layers.filter((layer) => layer.on).map((layer) => layer.id));
  return { items: upcomingOf(items, on, now, viewer.timeZone, query.limit) };
}

/** The event if the viewer may see it: 404 when there's none, 403 when it isn't theirs (CA-05). */
export async function visibleEvent(db: Db, viewer: Viewer, eventId: string): Promise<EventRecord> {
  const event = await findEvent(db, eventId);
  if (!event || event.workspaceId !== viewer.workspaceId) throw httpError(404, 'not_found');
  const invited = event.people.some((person) => person.userId === viewer.id);
  if (event.organizerId !== viewer.id && !invited) throw httpError(403, 'forbidden');
  return event;
}

export async function getEvent(db: Db, viewer: Viewer, eventId: string): Promise<CalendarEvent> {
  const event = await visibleEvent(db, viewer, eventId);
  return eventJson(event, viewer.id, await profilesOf(db, peopleIds(event)));
}

/** Times must be in Calendar's years, and a repeating schedule must make sense to team-repeat. */
export function checkSchedule(schedule: Schedule): void {
  if (!scheduleInYears(schedule)) throw httpError(400, 'invalid', YEARS_MESSAGE);
  const series = seriesOf(schedule);
  const problems = series ? checkSeries(series) : [];
  if (problems.length > 0) throw httpError(400, 'invalid', problems[0], problems);
}

/** Invited people: members of the workspace, without the organizer, each once. */
export async function checkPeople(db: Db, viewer: Viewer, ids: readonly string[]) {
  const people = [...new Set(ids)].filter((id) => id !== viewer.id);
  const members = await membersAmong(db, viewer.workspaceId, people);
  if (members.size !== people.length) {
    throw httpError(400, 'invalid', "Some of these people aren't members of this workspace.");
  }
  return people;
}

/** A new Care Hub event; the creator organizes it (CA-02, CA-06). */
export async function createEvent(
  db: Db,
  viewer: Viewer,
  input: CreateEvent,
): Promise<CalendarEvent> {
  const timeZone = input.timeZone ?? viewer.timeZone;
  const schedule: Schedule = inRange(() => ({
    allDay: input.allDay,
    timeZone,
    start: civilOf(input.start, timeZone),
    end: civilOf(input.end, timeZone),
    rule: input.repeat ?? null,
    exceptions: [],
    overrides: {},
  }));
  checkSchedule(schedule);
  const people = await checkPeople(db, viewer, input.people ?? []);
  const id = await db.transaction((tx) =>
    insertEvent(tx, {
      ...schedule,
      workspaceId: viewer.workspaceId,
      organizerId: viewer.id,
      title: input.title ?? '',
      location: input.location ?? '',
      description: input.description ?? '',
      videoUrl: input.videoUrl ?? null,
      people: people.map((userId) => ({ userId, reply: null, note: null, occurrenceReplies: {} })),
    }),
  );
  notify({ id, organizerId: viewer.id }, people);
  return getEvent(db, viewer, id);
}
