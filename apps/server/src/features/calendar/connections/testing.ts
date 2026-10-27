// Test helpers for calendar connections (test support). Fictional data only.
import type { Db, Tx } from '../../../db';
import type { ExternalEvent } from '../sync/types';
import { calendarSyncedEvents as syncedEvents } from './schema';
import { type NewConnection, newConnectionId } from './store';

/** Stands in for a sealed secret: the store only checks the format. */
export const TEST_SEALED_SECRET = 'v1.sealed-for-tests';

/** A Google connection with two calendars: the person's own (shown) and Family (hidden). */
export function testGoogleConnection(
  ownerId: string,
  overrides: Partial<NewConnection> = {},
): NewConnection {
  return {
    id: newConnectionId(),
    ownerId,
    kind: 'google',
    label: 'Google',
    account: 'avery.lin@example.com',
    secret: TEST_SEALED_SECRET,
    calendars: [
      { remoteId: 'avery.lin@example.com', name: 'Avery Lin', shown: true },
      { remoteId: 'family@group.calendar.example.com', name: 'Family', shown: false },
    ],
    ...overrides,
  };
}

/** A private calendar link: one calendar, named as the person named the link. */
export function testLinkConnection(ownerId: string, label = 'School'): NewConnection {
  return {
    id: newConnectionId(),
    ownerId,
    kind: 'link',
    label,
    secret: TEST_SEALED_SECRET,
    calendars: [{ remoteId: '', name: label, shown: true }],
  };
}

/** Saves one copied event straight into the table, by default on Nov 2, 2026 at 16:00 UTC. */
export async function insertTestEvent(
  db: Db | Tx,
  calendarId: string,
  remoteId = 'evt-1',
  bounds: { startsAt: string; endsAt: string | null } = {
    startsAt: '2026-11-02T16:00:00.000Z',
    endsAt: '2026-11-02T16:30:00.000Z',
  },
) {
  const event: ExternalEvent = {
    uid: `${remoteId}@example.com`,
    remoteId,
    status: 'confirmed',
    title: 'Check-in with Jordan Lee',
    start: { kind: 'utc', instant: bounds.startsAt },
    ...(bounds.endsAt ? { end: { kind: 'utc', instant: bounds.endsAt } } : {}),
    ...(bounds.endsAt ? {} : { rrule: 'FREQ=WEEKLY' }),
    busy: true,
  };
  await db.insert(syncedEvents).values({
    calendarId,
    remoteId,
    uid: event.uid,
    event,
    startsAt: new Date(bounds.startsAt),
    endsAt: bounds.endsAt ? new Date(bounds.endsAt) : null,
  });
  return event;
}
