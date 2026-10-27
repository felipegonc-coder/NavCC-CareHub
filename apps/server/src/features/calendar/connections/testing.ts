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

/** Saves one copied event straight into the table. */
export async function insertTestEvent(db: Db | Tx, calendarId: string, remoteId = 'evt-1') {
  const event: ExternalEvent = {
    uid: `${remoteId}@example.com`,
    remoteId,
    status: 'confirmed',
    title: 'Check-in with Jordan Lee',
    start: { kind: 'utc', instant: '2026-11-02T16:00:00.000Z' },
    end: { kind: 'utc', instant: '2026-11-02T16:30:00.000Z' },
    busy: true,
  };
  await db.insert(syncedEvents).values({
    calendarId,
    remoteId,
    uid: event.uid,
    event,
    startsAt: new Date('2026-11-02T02:00:00.000Z'),
    endsAt: new Date('2026-11-03T06:30:00.000Z'),
  });
}
