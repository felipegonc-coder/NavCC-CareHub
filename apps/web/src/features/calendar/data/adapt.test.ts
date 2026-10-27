import type { SyncedItem } from '@carehub/team-calendar-api';
import { describe, expect, it } from 'vitest';
import { describeTimes, gridItems, longDate, NO_TITLE, toGridItem } from './adapt';
import { testEvent as event, testLayer as layer, testRow } from './testItems';

// Fictional data only. America/Denver is UTC-6 until Nov 1 2026, then UTC-7.
const prefs = { timeZone: 'America/Denver', use24h: false };

describe('toGridItem', () => {
  it('turns instants into wall-clock times in the viewer zone, with the spoken label', () => {
    const item = toGridItem(event(), layer('meetings'), prefs);
    expect(item).toMatchObject({
      id: 'ev-1',
      allDay: false,
      start: '2026-10-27T10:00',
      end: '2026-10-27T11:00',
      declined: false,
      title: 'QA calibration',
      color: 'purple',
    });
    expect(item.label).toBe('QA calibration, Tuesday, October 27, 10:00 to 11:00 AM, Meetings');
  });

  it('follows the clock change and the 24-hour setting', () => {
    const after = event({ start: '2026-11-03T17:00:00.000Z', end: '2026-11-03T18:30:00.000Z' });
    const item = toGridItem(after, layer('meetings'), { ...prefs, use24h: true });
    expect([item.start, item.end]).toEqual(['2026-11-03T10:00', '2026-11-03T11:30']);
    expect(item.label).toBe('QA calibration, Tuesday, November 3, 10:00 to 11:30, Meetings');
  });

  it('makes the exclusive all-day end the last day', () => {
    const item = toGridItem(testRow(), layer('db-1', { name: 'Policies', color: 'green' }), prefs);
    expect(item).toMatchObject({ allDay: true, start: '2026-11-05', end: '2026-11-07' });
    expect(item.label).toBe(
      'Fictional policy review, Thursday, November 5 to Saturday, November 7, All day, Policies',
    );
    const oneDay = toGridItem(testRow({ end: '2026-11-06' }), undefined, prefs);
    expect(oneDay).toMatchObject({ start: '2026-11-05', end: null, color: 'default' });
    expect(oneDay.label).toBe('Fictional policy review, Thursday, November 5, All day');
  });

  it('shows "(No title)" and marks declined events', () => {
    const item = toGridItem(event({ title: '  ', myReply: 'not-going' }), layer('meetings'), prefs);
    expect(item.title).toBe(NO_TITLE);
    expect(item.declined).toBe(true);
    expect(item.label).toBe(
      '(No title), Tuesday, October 27, 10:00 to 11:00 AM, Meetings, Not going',
    );
  });

  it('reads declined synced events too, and falls back to the default colour', () => {
    const synced: SyncedItem = {
      ...event(),
      source: 'synced',
      layerId: 'connected:cal-1',
      canEdit: false,
      syncedEventId: 'g-1',
      occurrence: null,
      provider: 'google',
      calendarName: 'Fictional team',
      organizer: null,
      people: [],
      myReply: 'not-going',
      externalUrl: null,
      iOrganize: false,
    };
    const item = toGridItem(
      synced,
      layer('connected:cal-1', { color: 'teal', name: 'Team' }),
      prefs,
    );
    expect(item).toMatchObject({ declined: true, color: 'default' });
  });
});

describe('gridItems', () => {
  it('leaves out layers that are off, and keeps items of layers it does not know', () => {
    const items = [
      event({ id: 'a', layerId: 'meetings' }),
      event({ id: 'b', layerId: 'my-events' }),
      event({ id: 'c', layerId: 'new-layer' }),
    ];
    const layers = [layer('meetings'), layer('my-events', { on: false })];
    expect(gridItems(items, layers, prefs).map((item) => item.id)).toEqual(['a', 'c']);
    expect(gridItems(items, undefined, prefs).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('describeTimes', () => {
  it('names one day, a point in time, midnight ends and later days', () => {
    expect(longDate('2026-10-27')).toBe('Tuesday, October 27');
    expect(describeTimes('2026-10-27T09:30', '2026-10-27T09:30', prefs)).toBe(
      'Tuesday, October 27, 9:30 AM',
    );
    expect(describeTimes('2026-10-27T23:00', '2026-10-28T00:00', prefs)).toBe(
      'Tuesday, October 27, 11:00 PM to 12:00 AM',
    );
    expect(describeTimes('2026-10-27T22:00', '2026-10-28T06:00', prefs)).toBe(
      'Tuesday, October 27, 10:00 PM to Wednesday, October 28, 6:00 AM',
    );
  });
});
