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
import type { MeetingEvent } from '../../meetings';
import {
  eventCardKey,
  sendNotice,
  type EventCardRef,
  type NoticeReader,
  type SendNoticeInput,
} from '../../notices';
import { learningItems } from '../courses';
import { listLayers } from '../layers/service';
import { getSettings } from '../settings/service';
import { cardOf } from './cards';
import { planDelete, planDuplicate, planEdit, planReply } from './edit';
import { eventItems, eventJson } from './items';
import { meetingOf } from './meetings';
import { checkAnswers, checkChanges } from './limits';
import { civilOf, seriesOf, windowOf, type Schedule, type Window } from './model';
import {
  MAX_EVENTS,
  cancelEvent,
  eventsById,
  eventsInWindow,
  findEvent,
  insertEvent,
  isUuid,
  membersAmong,
  profilesOf,
  saveReply,
  updateEvent,
  type EventRecord,
} from './store';
import { cancelNotices, editNotices, invites, replyNotice } from './notices';
import { addDefaultReminder, remindersAfterDelete, remindersAfterEdit } from './reminders';
import { upcomingOf } from './upcoming';
import { YEARS_MESSAGE, scheduleInYears } from './years';

/** The signed-in member, as Calendar needs them. */
export type Viewer = {
  id: string;
  workspaceId: string;
  name: string;
  timeZone: string;
  use24h: boolean;
};

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

/** Tells everyone who sees the event to refetch. */
const notify = (eventId: string, userIds: readonly string[]) =>
  publishToUsers([...new Set(userIds)], { type: CALENDAR_CHANGED, data: { eventId } });

let logNoticeError: (error: unknown) => void = () => undefined;

/** Where notices that couldn't be sent are logged: routes.ts passes the app's logger. */
export function onNoticeError(log: (error: unknown) => void): void {
  logNoticeError = log;
}

/** Sends notices after the commit. One that fails is logged and never fails the change. */
const tell = (notices: readonly SendNoticeInput[]) =>
  Promise.all(notices.map((notice) => sendNotice(notice).catch(logNoticeError)));

/** The viewer's range: events they organize or are invited to, and course due dates. */
export async function listItems(db: Db, viewer: Viewer, query: ItemsQuery): Promise<ItemsResponse> {
  const window: Window = inRange(() => windowOf(query.from, query.to, viewer.timeZone));
  const [events, courses] = await Promise.all([
    eventsInWindow(db, viewer.workspaceId, viewer.id, window),
    learningItems(viewer, query.from, query.to),
  ]);
  const profiles = await profilesOf(db, events.flatMap(peopleIds));
  let truncated = events.length >= MAX_EVENTS;
  const items: CalendarItem[] = [...courses];
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

/**
 * Times must be in Calendar's years, a series keeps only so many deleted and changed occurrences,
 * and a repeating schedule must make sense to team-repeat.
 */
export function checkSchedule(schedule: Schedule): void {
  if (!scheduleInYears(schedule)) throw httpError(400, 'invalid', YEARS_MESSAGE);
  checkChanges(schedule);
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
  const { defaultReminder } = await getSettings(db, viewer);
  const id = await db.transaction(async (tx) => {
    const id = await insertEvent(tx, {
      ...schedule,
      workspaceId: viewer.workspaceId,
      organizerId: viewer.id,
      title: input.title ?? '',
      location: input.location ?? '',
      description: input.description ?? '',
      videoUrl: input.videoUrl ?? null,
      people: people.map((userId) => ({ userId, reply: null, note: null, occurrenceReplies: {} })),
    });
    await addDefaultReminder(tx, viewer, id, schedule, defaultReminder);
    return id;
  });
  notify(id, [viewer.id, ...people]);
  await tell(invites(viewer, id, people));
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
  const { splitId, seen, notices } = await db.transaction(async (tx) => {
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
    await remindersAfterEdit(tx, event.people, plan, { eventId: event.id, splitId });
    const later = idsOf(plan.split?.people ?? []);
    const notices = editNotices(viewer, event, plan, { eventId: event.id, splitId }, input);
    return { splitId, seen: [...peopleIds(event), ...idsOf(plan.event.people), ...later], notices };
  });
  notify(eventId, seen);
  await tell(notices);
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
  const { seen, notices } = await db.transaction(async (tx) => {
    const event = await ownEvent(tx, viewer, eventId);
    const left = planDelete(event, query);
    if (left) checkChanges(left);
    await (left ? updateEvent(tx, event.id, left) : cancelEvent(tx, event.id));
    await remindersAfterDelete(tx, event.id, left);
    return { seen: peopleIds(event), notices: cancelNotices(viewer, event, left, query) };
  });
  notify(eventId, seen);
  await tell(notices);
}

/** An invited person's answer, for the series or one occurrence (CA-17, CA-22). */
export async function replyToEvent(
  db: Db,
  viewer: Viewer,
  eventId: string,
  body: ReplyBody,
): Promise<void> {
  const { seen, notice } = await db.transaction(async (tx) => {
    const event = await visibleEvent(tx, viewer, eventId, true);
    const person = event.people.find((invited) => invited.userId === viewer.id);
    if (!person) throw httpError(403, 'forbidden');
    const answered = planReply(event, person, body);
    checkAnswers(answered);
    await saveReply(tx, event.id, answered);
    return { seen: peopleIds(event), notice: replyNotice(viewer, event, body) };
  });
  notify(eventId, seen);
  await tell([notice]);
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
  const { defaultReminder } = await getSettings(db, viewer);
  const id = await db.transaction(async (tx) => {
    const id = await insertEvent(tx, { ...copy, people, workspaceId, organizerId: viewer.id });
    await addDefaultReminder(tx, viewer, id, copy, defaultReminder);
    return id;
  });
  notify(id, [viewer.id, ...idsOf(people)]);
  await tell(invites(viewer, id, idsOf(people)));
  return getEvent(db, viewer, id);
}

/**
 * Meeting notes (features/meetings) ask for the occurrence they're for (see `meetingOf`): only an
 * event in that workspace, and only the people invited who are still members, not guests.
 */
export async function lookupMeetingEvent(
  db: Db | Tx,
  target: { workspaceId: string; eventId: string; occurrence?: string | undefined },
  now: Date = new Date(),
): Promise<MeetingEvent | null> {
  const event = await findEvent(db, target.eventId);
  if (!event || event.workspaceId !== target.workspaceId) return null;
  const meeting = meetingOf(event, target.occurrence, now);
  if (!meeting) return null;
  const members = await membersAmong(db, event.workspaceId, meeting.memberIds);
  return { ...meeting, memberIds: meeting.memberIds.filter((id) => members.has(id)) };
}

/** Event cards under notices, for the person reading them (Calendar's ids only). */
export async function eventCards(db: Db, reader: NoticeReader, cards: EventCardRef[]) {
  const ours = cards.filter((card) => isUuid(card.eventId));
  const found = await eventsById(
    db,
    ours.map((card) => card.eventId),
  );
  const byId = new Map(found.map((event) => [event.id, event]));
  return new Map(
    ours.map((card) => [eventCardKey(card), cardOf(byId.get(card.eventId), card, reader)]),
  );
}
