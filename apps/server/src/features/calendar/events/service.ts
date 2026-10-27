import {
  CALENDAR_CHANGED,
  type CalendarEvent,
  type CalendarItem,
  type CreateEvent,
  type DeleteEventQuery,
  type Duplicate,
  type EditEvent,
  type EditResponse,
  type ItemsQuery,
  type ItemsResponse,
  type ReplyBody,
  type UpcomingQuery,
  type UpcomingResponse,
} from '@carehub/team-calendar-api';
import { checkSeries } from '@carehub/team-repeat';
import { addDays, todayIn } from '@carehub/team-time';
import { httpError } from '../../../core/errors';
import type { Db, Tx } from '../../../db';
import { publishToUsers } from '../../live';
import { listLayers } from '../layers/service';
import { planDelete, planDuplicate, planEdit, planReply } from './edit';
import { eventItems, eventJson } from './items';
import { civilOf, seriesOf, windowOf, type Schedule, type Window } from './model';
import {
  MAX_EVENTS,
  cancelEvent,
  eventsInWindow,
  findEvent,
  insertEvent,
  membersAmong,
  profilesOf,
  saveReply,
  updateEvent,
  type EventRecord,
} from './store';
import { upcomingOf } from './upcoming';

/** The signed-in member, as Calendar needs them. */
export type Viewer = { id: string; workspaceId: string; timeZone: string };

/** Most items one range answer has. */
export const MAX_ITEMS = 2000;

/** Dates and times at the far edges of the calendar (years 1 and 9999) can't be shown. */
function inRange<T>(make: () => T): T {
  try {
    return make();
  } catch (error) {
    if (error instanceof RangeError)
      throw httpError(400, 'invalid', 'Pick a date between years 1 and 9999.');
    throw error;
  }
}

const peopleIds = (event: EventRecord) => [event.organizerId, ...event.people.map((p) => p.userId)];

/** Tells everyone who sees the event to refetch. */
const notify = (eventId: string, userIds: readonly string[]) =>
  publishToUsers([...new Set(userIds)], { type: CALENDAR_CHANGED, data: { eventId } });

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
export async function visibleEvent(
  db: Db | Tx,
  viewer: Viewer,
  eventId: string,
  lock = false,
): Promise<EventRecord> {
  const event = await findEvent(db, eventId, lock);
  if (!event || event.workspaceId !== viewer.workspaceId) throw httpError(404, 'not_found');
  const invited = event.people.some((person) => person.userId === viewer.id);
  if (event.organizerId !== viewer.id && !invited) throw httpError(403, 'forbidden');
  return event;
}

export async function getEvent(db: Db, viewer: Viewer, eventId: string): Promise<CalendarEvent> {
  const event = await visibleEvent(db, viewer, eventId);
  return eventJson(event, viewer.id, await profilesOf(db, peopleIds(event)));
}

/** A repeating schedule must make sense to team-repeat. */
export function checkSchedule(schedule: Schedule): void {
  const series = seriesOf(schedule);
  const problems = series ? checkSeries(series) : [];
  if (problems.length > 0) throw httpError(400, 'invalid', problems[0], problems);
}

/** Invited people: members of the workspace (or invited already), without the organizer, once. */
export async function checkPeople(
  db: Db | Tx,
  viewer: Viewer,
  ids: readonly string[],
  invited: readonly string[] = [],
) {
  const people = [...new Set(ids)].filter((id) => id !== viewer.id);
  const added = people.filter((id) => !invited.includes(id));
  const members = await membersAmong(db, viewer.workspaceId, added);
  if (members.size !== added.length) {
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
  notify(id, [viewer.id, ...people]);
  return getEvent(db, viewer, id);
}

/** The event, locked for a change, when the viewer organizes it (only they change it). */
async function ownEvent(tx: Tx, viewer: Viewer, eventId: string): Promise<EventRecord> {
  const event = await visibleEvent(tx, viewer, eventId, true);
  if (event.organizerId !== viewer.id) throw httpError(403, 'forbidden');
  return event;
}

const idsOf = (people: readonly { userId: string }[]) => people.map((person) => person.userId);

/** An edit or move; This and following saves the new series as its own event. */
export async function editEvent(
  db: Db,
  viewer: Viewer,
  eventId: string,
  input: EditEvent,
): Promise<EditResponse> {
  const { splitId, seen } = await db.transaction(async (tx) => {
    const event = await ownEvent(tx, viewer, eventId);
    const invited = idsOf(event.people);
    const people = input.people && (await checkPeople(tx, viewer, input.people, invited));
    const plan = inRange(() => planEdit(event, people ? { ...input, people } : input));
    checkSchedule(plan.event);
    if (plan.split) checkSchedule(plan.split);
    await updateEvent(tx, event.id, plan.event);
    const { workspaceId } = viewer;
    const splitId = plan.split
      ? await insertEvent(tx, { ...plan.split, workspaceId, organizerId: viewer.id })
      : null;
    const later = idsOf(plan.split?.people ?? []);
    return { splitId, seen: [...peopleIds(event), ...idsOf(plan.event.people), ...later] };
  });
  notify(eventId, seen);
  const split = splitId ? await getEvent(db, viewer, splitId) : null;
  return { event: await getEvent(db, viewer, eventId), split };
}

/** Deletes one occurrence, this and following, or the whole event. */
export async function deleteEvent(
  db: Db,
  viewer: Viewer,
  eventId: string,
  query: DeleteEventQuery,
): Promise<void> {
  const seen = await db.transaction(async (tx) => {
    const event = await ownEvent(tx, viewer, eventId);
    const left = planDelete(event, query);
    await (left ? updateEvent(tx, event.id, left) : cancelEvent(tx, event.id));
    return peopleIds(event);
  });
  notify(eventId, seen);
}

/** An invited person's answer, for the series or one occurrence (CA-17, CA-22). */
export async function replyToEvent(
  db: Db,
  viewer: Viewer,
  eventId: string,
  body: ReplyBody,
): Promise<void> {
  const seen = await db.transaction(async (tx) => {
    const event = await visibleEvent(tx, viewer, eventId, true);
    const person = event.people.find((invited) => invited.userId === viewer.id);
    if (!person) throw httpError(403, 'forbidden');
    await saveReply(tx, event.id, planReply(event, person, body));
    return peopleIds(event);
  });
  notify(eventId, seen);
}

/** A copy for the viewer to organize, inviting the others again (CA-20). */
export async function duplicateEvent(
  db: Db,
  viewer: Viewer,
  input: Duplicate,
): Promise<CalendarEvent> {
  // Synced events come with connected calendars.
  if (!('eventId' in input)) throw httpError(404, 'not_found');
  const event = await visibleEvent(db, viewer, input.eventId);
  const copy = planDuplicate(event, viewer.id, input.occurrence);
  const members = await membersAmong(db, viewer.workspaceId, idsOf(copy.people));
  const people = copy.people.filter((person) => members.has(person.userId));
  const { workspaceId } = viewer;
  const id = await db.transaction((tx) =>
    insertEvent(tx, { ...copy, people, workspaceId, organizerId: viewer.id }),
  );
  notify(id, [viewer.id, ...idsOf(people)]);
  return getEvent(db, viewer, id);
}
