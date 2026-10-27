import { and, eq, gte, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { getProfiles } from '../../auth';
import { getMembership } from '../../workspaces';
import { calEventPeople, calEvents } from '../schema';
import type { EventState } from './edit';
import type { Profiles, StoredEvent, StoredPerson } from './items';
import { boundsOf, type EventFields, type Schedule, type Window } from './model';

type Database = Db | Tx;

/** An event as stored, with the workspace it belongs to. */
export type EventRecord = StoredEvent & { workspaceId: string };

/** Most events one range request reads. */
export const MAX_EVENTS = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids are uuids; anything else can't be one of ours (and would be a database error). */
export const isUuid = (value: string) => UUID.test(value);

async function withPeople<Row extends typeof calEvents.$inferSelect>(
  db: Database,
  rows: Row[],
): Promise<(Row & EventRecord)[]> {
  if (rows.length === 0) return [];
  const people = await db
    .select()
    .from(calEventPeople)
    .where(
      inArray(
        calEventPeople.eventId,
        rows.map((row) => row.id),
      ),
    );
  const byEvent = new Map<string, StoredEvent['people']>();
  for (const { eventId, userId, reply, note, occurrenceReplies } of people) {
    const list = byEvent.get(eventId) ?? [];
    list.push({ userId, reply, note, occurrenceReplies });
    byEvent.set(eventId, list);
  }
  return rows.map((row) => ({ ...row, people: byEvent.get(row.id) ?? [] }));
}

/** An event that isn't cancelled, or null. `lock` holds it until the transaction ends. */
export async function findEvent(
  db: Database,
  id: string,
  lock = false,
): Promise<EventRecord | null> {
  if (!isUuid(id)) return null;
  const query = db
    .select()
    .from(calEvents)
    .where(and(eq(calEvents.id, id), isNull(calEvents.cancelledAt)));
  const [event] = await withPeople(db, lock ? await query.for('update') : await query);
  return event ?? null;
}

/** Events by id for notice cards, cancelled ones too. */
export async function eventsById(db: Database, ids: readonly string[]) {
  const wanted = [...new Set(ids)].filter(isUuid);
  if (wanted.length === 0) return [];
  return withPeople(db, await db.select().from(calEvents).where(inArray(calEvents.id, wanted)));
}

/** Events the person organizes or is invited to that may show in the window. */
export async function eventsInWindow(
  db: Database,
  workspaceId: string,
  userId: string,
  window: Window,
): Promise<EventRecord[]> {
  const invited = db
    .select({ id: calEventPeople.eventId })
    .from(calEventPeople)
    .where(eq(calEventPeople.userId, userId));
  const rows = await db
    .select()
    .from(calEvents)
    .where(
      and(
        eq(calEvents.workspaceId, workspaceId),
        isNull(calEvents.cancelledAt),
        or(eq(calEvents.organizerId, userId), inArray(calEvents.id, invited)),
        lt(calEvents.rangeStart, window.end),
        or(isNull(calEvents.rangeEnd), gte(calEvents.rangeEnd, window.start)),
      ),
    )
    .orderBy(calEvents.rangeStart)
    .limit(MAX_EVENTS);
  return withPeople(db, rows);
}

export type NewEvent = Schedule &
  EventFields & { workspaceId: string; organizerId: string; people: readonly StoredPerson[] };

const rangeOf = (schedule: Schedule) => {
  const { startAt, endAt } = boundsOf(schedule);
  return { rangeStart: startAt, rangeEnd: endAt };
};

export async function insertEvent(db: Database, event: NewEvent): Promise<string> {
  const { people, ...fields } = event;
  const [row] = await db
    .insert(calEvents)
    .values({ ...fields, ...rangeOf(fields) })
    .returning({ id: calEvents.id });
  if (!row) throw new Error('The event was not saved.');
  if (people.length > 0) {
    await db
      .insert(calEventPeople)
      .values(people.map((person) => ({ ...person, eventId: row.id })));
  }
  return row.id;
}

/** Names and pictures of these people. */
export const profilesOf = (db: Database, ids: Iterable<string>): Promise<Profiles> =>
  getProfiles(db, ids);

/** Which of these people are members (not guests) of the workspace. */
export async function membersAmong(
  db: Database,
  workspaceId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  const valid = [...new Set(ids)].filter(isUuid);
  const found = await Promise.all(valid.map((id) => getMembership(db, workspaceId, id)));
  return new Set(valid.filter((_, index) => found[index]?.kind === 'member'));
}

/** Saves an edited event. People no longer invited go; the others keep their invite time. */
export async function updateEvent(db: Database, id: string, state: EventState): Promise<void> {
  const { people, ...fields } = state;
  await db
    .update(calEvents)
    .set({ ...fields, ...rangeOf(fields), updatedAt: new Date() })
    .where(eq(calEvents.id, id));
  const ids = people.map((person) => person.userId);
  const gone = ids.length > 0 ? notInArray(calEventPeople.userId, ids) : undefined;
  await db.delete(calEventPeople).where(and(eq(calEventPeople.eventId, id), gone));
  if (people.length === 0) return;
  await db
    .insert(calEventPeople)
    .values(people.map((person) => ({ ...person, eventId: id })))
    .onConflictDoUpdate({
      target: [calEventPeople.eventId, calEventPeople.userId],
      set: {
        reply: sql`excluded.reply`,
        note: sql`excluded.note`,
        occurrenceReplies: sql`excluded.occurrence_replies`,
      },
    });
}

export async function cancelEvent(db: Database, id: string): Promise<void> {
  const now = new Date();
  await db.update(calEvents).set({ cancelledAt: now, updatedAt: now }).where(eq(calEvents.id, id));
}

export async function saveReply(db: Database, eventId: string, person: StoredPerson) {
  const { userId, reply, note, occurrenceReplies } = person;
  await db
    .update(calEventPeople)
    .set({ reply, note, occurrenceReplies, repliedAt: new Date() })
    .where(and(eq(calEventPeople.eventId, eventId), eq(calEventPeople.userId, userId)));
}
