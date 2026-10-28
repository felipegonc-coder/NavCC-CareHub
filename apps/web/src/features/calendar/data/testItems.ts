// Test helper: fictional layers and items in the API's shapes, for the calendar's tests.
import type { EventItem, Layer, RowItem } from '@carehub/team-calendar-api';

export const TEST_ZONE = 'America/Denver';

export function testLayer(id: string, overrides: Partial<Layer> = {}): Layer {
  return {
    id,
    kind: 'meetings',
    name: 'Meetings',
    color: 'purple',
    on: true,
    order: 1,
    status: 'ok',
    error: null,
    database: null,
    connectionId: null,
    ...overrides,
  };
}

/** A one-hour meeting on Tuesday, October 27, 2026 at 10:00 AM in Denver. */
export function testEvent(overrides: Partial<EventItem> = {}): EventItem {
  return {
    id: 'ev-1',
    source: 'event',
    layerId: 'meetings',
    title: 'QA calibration',
    allDay: false,
    start: '2026-10-27T16:00:00.000Z',
    end: '2026-10-27T17:00:00.000Z',
    timeZone: TEST_ZONE,
    canEdit: true,
    eventId: 'ev-1',
    occurrence: null,
    repeat: null,
    location: '',
    description: '',
    videoLink: null,
    organizer: { id: 'u-1', name: 'Eli Editor', avatarUrl: null },
    people: [],
    myReply: null,
    canReply: false,
    notesPageId: null,
    ...overrides,
  };
}

/** A database row's date, Thursday, November 5 to Saturday, November 7 (the end is exclusive). */
export function testRow(overrides: Partial<RowItem> = {}): RowItem {
  return {
    id: 'row-1:due',
    source: 'row',
    layerId: 'db-1',
    title: 'Fictional policy review',
    allDay: true,
    start: '2026-11-05',
    end: '2026-11-08',
    timeZone: null,
    canEdit: true,
    rowId: 'row-1',
    databaseId: 'db-1',
    propertyId: 'due',
    ...overrides,
  };
}
