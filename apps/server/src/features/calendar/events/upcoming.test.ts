import { eventItemSchema, upcomingItemSchema, type EventItem } from '@carehub/team-calendar-api';
import { describe, expect, it } from 'vitest';
import { upcomingOf } from './upcoming';

const denver = 'America/Denver';
const now = new Date('2026-10-28T16:30:00.000Z'); // 10:30 AM in Denver
const on = new Set(['my-events', 'meetings']);
const ada = { id: 'u-ada', name: 'Ada Example', avatarUrl: null };

function item(id: string, changes: Partial<EventItem>): EventItem {
  return eventItemSchema.parse({
    id,
    source: 'event',
    layerId: 'my-events',
    title: `Event ${id}`,
    allDay: false,
    start: '2026-10-28T18:00:00.000Z',
    end: '2026-10-28T19:00:00.000Z',
    timeZone: denver,
    canEdit: true,
    eventId: id,
    occurrence: null,
    repeat: null,
    location: '',
    description: '',
    videoLink: null,
    organizer: ada,
    people: [],
    myReply: null,
    canReply: false,
    notesPageId: null,
    ...changes,
  });
}

const ids = (items: readonly { id: string }[]) => items.map((each) => each.id);

describe('upcomingOf', () => {
  it('keeps what is under way or still to come, soonest first, all-day first on its day', () => {
    const items = [
      item('later', { start: '2026-10-29T15:00:00.000Z', end: '2026-10-29T16:00:00.000Z' }),
      item('over', { start: '2026-10-28T14:00:00.000Z', end: '2026-10-28T15:00:00.000Z' }),
      item('now', { start: '2026-10-28T16:00:00.000Z', end: '2026-10-28T17:00:00.000Z' }),
      item('today', { allDay: true, timeZone: null, start: '2026-10-28', end: '2026-10-29' }),
      item('tomorrow', { allDay: true, timeZone: null, start: '2026-10-29', end: '2026-10-30' }),
      item('soon', {}),
    ];
    const upcoming = upcomingOf(items, on, now, denver, 6);
    expect(ids(upcoming)).toEqual(['today', 'now', 'soon', 'tomorrow', 'later']);
    for (const each of upcoming) expect(upcomingItemSchema.parse(each)).toEqual(each);
  });

  it('leaves out layers that are off and events the viewer declined', () => {
    const items = [
      item('meeting', { layerId: 'meetings', myReply: 'going' }),
      item('declined', { layerId: 'meetings', myReply: 'not-going' }),
      item('maybe', { layerId: 'meetings', myReply: 'maybe' }),
      item('mine', {}),
    ];
    expect(ids(upcomingOf(items, on, now, denver, 6))).toEqual(['maybe', 'meeting', 'mine']);
    expect(ids(upcomingOf(items, new Set(['my-events']), now, denver, 6))).toEqual(['mine']);
  });

  it('stops at the limit and links each to Calendar', () => {
    const items = ['a', 'b', 'c'].map((id) => item(id, {}));
    const repeating = item('r|2026-10-28T12:00', {
      eventId: 'r',
      occurrence: { key: '2026-10-28T12:00' },
      start: '2026-10-28T17:00:00.000Z',
      end: '2026-10-28T17:30:00.000Z',
    });
    const upcoming = upcomingOf([...items, repeating], on, now, denver, 2);
    expect(upcoming.map((each) => each.href)).toEqual([
      '/calendar?event=r&occurrence=2026-10-28T12%3A00',
      '/calendar?event=a',
    ]);
  });
});
