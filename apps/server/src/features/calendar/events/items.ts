import {
  BUILT_IN_LAYERS,
  type CalendarEvent,
  type EventItem,
  type Member,
  type Person,
  type Reply,
} from '@carehub/team-calendar-api';
import { isCivilDate } from '@carehub/team-time';
import { findVideoLink } from '../sync/video-link';
import { occurrencesIn, whenOf, type EventFields, type Schedule, type Window } from './model';

export type StoredReply = { reply: Reply; note: string | null };

/** An invited member: their answer for the whole series, and answers for single occurrences. */
export type StoredPerson = {
  userId: string;
  reply: Reply | null;
  note: string | null;
  occurrenceReplies: Record<string, StoredReply>;
};

/** A Care Hub event as stored, with its people (never the organizer). */
export type StoredEvent = Schedule &
  EventFields & {
    id: string;
    organizerId: string;
    notesPageId: string | null;
    people: StoredPerson[];
    createdAt: Date;
    updatedAt: Date;
  };

/** Names and pictures by user id. */
export type Profiles = ReadonlyMap<string, Member>;

const profileOf = (profiles: Profiles, id: string): Member =>
  profiles.get(id) ?? { id, name: 'Former member', avatarUrl: null };

/** Meetings have someone else in them; My events don't. */
export const layerOf = (event: { people: readonly unknown[] }) =>
  event.people.length > 0 ? BUILT_IN_LAYERS.meetings : BUILT_IN_LAYERS.myEvents;

/** A person's answer for one occurrence (their own for it, else the series one), or the series'. */
export function replyFor(person: StoredPerson, key: string | null): StoredReply | null {
  const own = key === null ? undefined : person.occurrenceReplies[key];
  if (own) return own;
  return person.reply ? { reply: person.reply, note: person.note } : null;
}

function peopleFor(event: StoredEvent, key: string | null, profiles: Profiles): Person[] {
  return event.people.map((person) => {
    const answer = replyFor(person, key);
    return {
      ...profileOf(profiles, person.userId),
      reply: answer?.reply ?? null,
      note: answer?.note ?? null,
    };
  });
}

const videoLinkOf = (fields: EventFields) =>
  findVideoLink({
    url: fields.videoUrl ?? undefined,
    location: fields.location,
    description: fields.description,
  }) ?? null;

/** The event's occurrences in the window, as the viewer sees them. */
export function eventItems(
  event: StoredEvent,
  viewerId: string,
  window: Window,
  profiles: Profiles,
): { items: EventItem[]; truncated: boolean } {
  const { occurrences, truncated } = occurrencesIn(event, window);
  const me = event.people.find((person) => person.userId === viewerId);
  const items = occurrences.map((occurrence): EventItem => {
    const key = event.rule ? occurrence.key : null;
    const fields: EventFields = { ...pickFields(event), ...occurrence.changes };
    const allDay = isCivilDate(occurrence.start);
    return {
      id: key === null ? event.id : `${event.id}:${key}`,
      source: 'event',
      layerId: layerOf(event),
      title: fields.title,
      allDay,
      start: whenOf(occurrence.start, event.timeZone),
      end: whenOf(occurrence.end, event.timeZone),
      timeZone: allDay ? null : event.timeZone,
      canEdit: event.organizerId === viewerId,
      eventId: event.id,
      occurrence: key === null ? null : { key },
      repeat: event.rule,
      location: fields.location,
      description: fields.description,
      videoLink: videoLinkOf(fields),
      organizer: profileOf(profiles, event.organizerId),
      people: peopleFor(event, key, profiles),
      myReply: me ? (replyFor(me, key)?.reply ?? null) : null,
      canReply: me !== undefined,
      notesPageId: event.notesPageId,
    };
  });
  return { items, truncated };
}

export const pickFields = ({ title, location, description, videoUrl }: EventFields) => ({
  title,
  location,
  description,
  videoUrl,
});

/** The whole series, for the edit dialog. */
export function eventJson(event: StoredEvent, viewerId: string, profiles: Profiles): CalendarEvent {
  const me = event.people.find((person) => person.userId === viewerId);
  return {
    id: event.id,
    layerId: layerOf(event),
    title: event.title,
    allDay: event.allDay,
    start: whenOf(event.start, event.timeZone),
    end: whenOf(event.end, event.timeZone),
    timeZone: event.timeZone,
    repeat: event.rule,
    location: event.location,
    description: event.description,
    videoUrl: event.videoUrl,
    videoLink: videoLinkOf(event),
    organizer: profileOf(profiles, event.organizerId),
    people: peopleFor(event, null, profiles),
    myReply: me?.reply ?? null,
    canEdit: event.organizerId === viewerId,
    canReply: me !== undefined,
    notesPageId: event.notesPageId,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}
