// What an edit, delete, reply or duplicate does to a stored event, as pure functions over
// team-repeat's series edits. The service checks access and saves the result.
import type { DeleteEventQuery, EditEvent, ReplyBody } from '@carehub/team-calendar-api';
import {
  RepeatError,
  deleteFollowing,
  deleteOne,
  editAll,
  editFollowing,
  editOne,
  expand,
  occurrenceAt,
  splitSeries,
  type OccurrenceKey,
  type Series,
  type SeriesChange,
} from '@carehub/team-repeat';
import { isCivilDate } from '@carehub/team-time';
import { httpError } from '../../../core/errors';
import { replyFor, type StoredEvent, type StoredPerson, type StoredReply } from './items';
import { civilOf, seriesOf, type EventFields, type Schedule } from './model';

/** Everything an edit can change on one event. */
export type EventState = Schedule & EventFields & { people: StoredPerson[] };

/** The edited event and, after This and following, the new series from the chosen occurrence. */
export type EditPlan = { event: EventState; split: EventState | null };

const FIRST_DATE = '0001-01-01';
const LAST_DATE = '9999-12-31';

export const stateOf = (event: EventState): EventState => ({
  allDay: event.allDay,
  timeZone: event.timeZone,
  start: event.start,
  end: event.end,
  rule: event.rule,
  exceptions: event.exceptions,
  overrides: event.overrides,
  title: event.title,
  location: event.location,
  description: event.description,
  videoUrl: event.videoUrl,
  people: event.people,
});

const scheduleOf = (series: Series<EventFields>) => ({
  start: series.start,
  end: series.end,
  rule: series.rule,
  exceptions: [...(series.exceptions ?? [])],
  overrides: { ...series.overrides },
});

/** team-repeat errors as answers: a stale occurrence key is a 409 ("Reload and try again"). */
function checked<T>(make: () => T): T {
  try {
    return make();
  } catch (error) {
    if (!(error instanceof RepeatError)) throw error;
    const status = error.code === 'not-an-occurrence' ? 409 : 400;
    throw httpError(status, status === 409 ? 'conflict' : 'invalid', error.message);
  }
}

const needsScope = () =>
  httpError(400, 'invalid', 'Choose This event, This and following, or All events.');

function changedFields(edit: EditEvent): Partial<EventFields> {
  const { title, location, description, videoUrl } = edit;
  const all = { title, location, description, videoUrl };
  return Object.fromEntries(
    Object.entries(all).filter(([, value]) => value !== undefined),
  ) as Partial<EventFields>;
}

/**
 * The edit's new start and end as civil values in `timeZone`, if it moves the event. `allDay`
 * follows the new start (a date or not), so it can't disagree with the times; on its own it
 * changes nothing.
 */
const timesOf = (edit: EditEvent, timeZone: string) =>
  edit.start === undefined || edit.end === undefined
    ? undefined
    : { start: civilOf(edit.start, timeZone), end: civilOf(edit.end, timeZone) };

/**
 * The people invited after an edit, each once and never the organizer. Those who stay keep their
 * answers.
 */
function peopleAfter(
  people: StoredPerson[],
  ids: readonly string[] | undefined,
  organizerId: string,
): StoredPerson[] {
  if (!ids) return people;
  const byId = new Map(people.map((person) => [person.userId, person]));
  const added = (userId: string) => ({ userId, reply: null, note: null, occurrenceReplies: {} });
  const invited = new Set(ids);
  invited.delete(organizerId);
  return [...invited].map((userId) => byId.get(userId) ?? added(userId));
}

/** Moves (or drops, for null) each person's answers for single occurrences. */
function moveReplies(
  people: StoredPerson[],
  move: (key: OccurrenceKey) => OccurrenceKey | null,
): StoredPerson[] {
  return people.map((person) => {
    const moved: Record<OccurrenceKey, StoredReply> = {};
    for (const [key, answer] of Object.entries(person.occurrenceReplies)) {
      const next = move(key);
      if (next !== null) moved[next] = answer;
    }
    return { ...person, occurrenceReplies: moved };
  });
}

const repliedKeys = (people: StoredPerson[]) =>
  new Set(people.flatMap((person) => Object.keys(person.occurrenceReplies)));

/** An event that doesn't repeat: the edit applies as it is. */
function editSingle(event: StoredEvent, edit: EditEvent): EventState {
  const timeZone = edit.timeZone ?? event.timeZone;
  const times = timesOf(edit, timeZone) ?? { start: event.start, end: event.end };
  return {
    ...stateOf(event),
    ...changedFields(edit),
    ...times,
    allDay: isCivilDate(times.start),
    timeZone,
    rule: edit.repeat === undefined ? event.rule : edit.repeat,
    people: peopleAfter(event.people, edit.people, event.organizerId),
  };
}

/** "This event": one occurrence moves or changes; it stays in the event's time zone. */
function editOccurrence(
  event: StoredEvent,
  series: Series<EventFields>,
  key: string,
  edit: EditEvent,
) {
  if (edit.timeZone !== undefined && edit.timeZone !== event.timeZone) {
    const message = 'Change the time zone for all events, or for this and following.';
    throw httpError(400, 'invalid', message);
  }
  const next = editOne(series, key, {
    ...timesOf(edit, event.timeZone),
    changes: changedFields(edit),
  });
  return { ...stateOf(event), ...scheduleOf(next) };
}

/** "All events" or "This and following" with `repeat: null`: the chosen occurrence stays, alone. */
function stopRepeating(
  event: StoredEvent,
  series: Series<EventFields>,
  key: string,
  edit: EditEvent,
): EditPlan {
  const shown = occurrenceAt(series, key);
  if (!shown)
    throw new RepeatError('not-an-occurrence', 'This occurrence is gone. Reload and try again.');
  const timeZone = edit.timeZone ?? event.timeZone;
  const times = timesOf(edit, timeZone) ?? { start: shown.start, end: shown.end };
  const people = peopleAfter(event.people, edit.people, event.organizerId).map((person) => ({
    ...person,
    ...(replyFor(person, key) ?? { reply: null, note: null }),
    occurrenceReplies: {},
  }));
  const single: EventState = {
    ...stateOf(event),
    ...shown.changes,
    ...changedFields(edit),
    ...times,
    allDay: isCivilDate(times.start),
    timeZone,
    rule: null,
    exceptions: [],
    overrides: {},
    people,
  };
  const before = edit.scope === 'following' ? splitSeries(series, key).before : null;
  if (!before) return { event: single, split: null };
  const kept = moveReplies(event.people, (k) => (k < key ? k : null));
  return { event: { ...stateOf(event), ...scheduleOf(before), people: kept }, split: single };
}

/** "All events" or "This and following": team-repeat moves the occurrences and their keys. */
function editSeries(event: StoredEvent, series: Series<EventFields>, key: string, edit: EditEvent) {
  const timeZone = edit.timeZone ?? event.timeZone;
  const fields = changedFields(edit);
  const times = timesOf(edit, timeZone);
  const change: SeriesChange<EventFields> = {
    ...times,
    ...(edit.repeat ? { rule: edit.repeat } : {}),
    fields: Object.keys(fields) as (keyof EventFields)[],
  };
  const allDay = times ? isCivilDate(times.start) : event.allDay;
  const edited = { ...stateOf(event), ...fields, allDay, timeZone };
  const people = peopleAfter(event.people, edit.people, event.organizerId);
  if (edit.scope === 'all') {
    const next = editAll(series, key, change);
    const keys = next.mapKeys(repliedKeys(people));
    const moved = moveReplies(people, (k) => keys.get(k) ?? null);
    return { event: { ...edited, ...scheduleOf(next.series), people: moved }, split: null };
  }
  const next = editFollowing(series, key, change);
  const keys = next.mapKeys(repliedKeys(event.people));
  const to = (part: 'before' | 'after') => (k: OccurrenceKey) => {
    const move = keys.get(k);
    return move?.series === part ? move.key : null;
  };
  const after = { ...edited, ...scheduleOf(next.after), people: moveReplies(people, to('after')) };
  if (!next.before) return { event: after, split: null };
  const kept = moveReplies(event.people, to('before'));
  return { event: { ...stateOf(event), ...scheduleOf(next.before), people: kept }, split: after };
}

/** The first occurrence's key, or the first one still there. */
function firstKey(series: Series<EventFields>): OccurrenceKey {
  if (occurrenceAt(series, series.start)) return series.start;
  const [first] = expand(series, { from: FIRST_DATE, to: LAST_DATE, limit: 1 }).occurrences;
  return first?.key ?? series.start;
}

/** What an edit does. Repeating events need a scope; All events with no occurrence: the first. */
export function planEdit(event: StoredEvent, edit: EditEvent): EditPlan {
  const series = seriesOf(event);
  if (!series) return { event: editSingle(event, edit), split: null };
  if (!edit.scope) throw needsScope();
  const key = edit.occurrence ?? firstKey(series);
  return checked(() => {
    if (edit.scope === 'one')
      return { event: editOccurrence(event, series, key, edit), split: null };
    if (edit.repeat === null) return stopRepeating(event, series, key, edit);
    return editSeries(event, series, key, edit);
  });
}

/** What's left after a delete, or null when the whole event goes. */
export function planDelete(event: StoredEvent, query: DeleteEventQuery): EventState | null {
  const series = seriesOf(event);
  if (!series || query.scope === 'all') return null;
  if (!query.scope) throw needsScope();
  const key = query.occurrence ?? event.start;
  const one = query.scope === 'one';
  const next = checked(() => (one ? deleteOne(series, key) : deleteFollowing(series, key)));
  if (!next) return null;
  const left = expand(next, { from: FIRST_DATE, to: LAST_DATE, limit: 1 });
  if (left.occurrences.length === 0 && !left.truncated) return null;
  const people = moveReplies(event.people, (k) => ((one ? k !== key : k < key) ? k : null));
  return { ...stateOf(event), ...scheduleOf(next), people };
}

/** A person's answer: for the whole series (answers for single ones go), or one occurrence. */
export function planReply(event: StoredEvent, person: StoredPerson, body: ReplyBody): StoredPerson {
  const answer = { reply: body.reply, note: body.note || null };
  const series = seriesOf(event);
  if (!series || body.occurrence === undefined) {
    return { ...person, ...answer, occurrenceReplies: {} };
  }
  const key = body.occurrence;
  if (!checked(() => occurrenceAt(series, key))) {
    throw httpError(409, 'conflict', 'This occurrence is gone. Reload and try again.');
  }
  return { ...person, occurrenceReplies: { ...person.occurrenceReplies, [key]: answer } };
}

/**
 * A copy for `viewerId` to organize, at the same time, without answers or notes. From a series and
 * an occurrence: the series from that occurrence on. Everyone else in it is invited.
 */
export function planDuplicate(
  event: StoredEvent,
  viewerId: string,
  occurrence: OccurrenceKey | undefined,
): EventState {
  const series = seriesOf(event);
  const from =
    series && occurrence !== undefined ? checked(() => splitSeries(series, occurrence)) : null;
  const ids = [event.organizerId, ...event.people.map((person) => person.userId)];
  return {
    ...stateOf(event),
    ...(from ? scheduleOf(from.after) : {}),
    people: peopleAfter([], ids, viewerId),
  };
}
