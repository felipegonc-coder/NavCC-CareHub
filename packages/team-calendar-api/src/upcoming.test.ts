import { describe, expect, it } from 'vitest';
import { eventHref, isJoinable, upcomingQuerySchema, upcomingResponseSchema } from './upcoming';

const zoom = { url: 'https://example.zoom.us/j/123456789', provider: 'zoom' as const };
const call = {
  id: 'e1|2026-10-28T10:00',
  title: 'Family meeting',
  allDay: false,
  start: '2026-10-28T16:00:00.000Z',
  end: '2026-10-28T17:00:00.000Z',
  videoLink: zoom,
  href: '/calendar?event=e1&occurrence=2026-10-28T10%3A00',
};

describe('upcoming', () => {
  it('reads the limit from the query, 6 by default and at most 10', () => {
    expect(upcomingQuerySchema.parse({})).toEqual({ limit: 6 });
    expect(upcomingQuerySchema.parse({ limit: '3' })).toEqual({ limit: 3 });
    for (const limit of ['0', '11', '2.5', 'many']) {
      expect(upcomingQuerySchema.safeParse({ limit }).success, limit).toBe(false);
    }
  });

  it('accepts timed and all-day items with Calendar links', () => {
    const allDay = { ...call, id: 'e2', allDay: true, start: '2026-10-28', end: '2026-10-29' };
    expect(upcomingResponseSchema.parse({ items: [call, allDay] }).items).toHaveLength(2);
    const elsewhere = { ...call, href: 'https://example.test/calendar' };
    expect(upcomingResponseSchema.safeParse({ items: [elsewhere] }).success).toBe(false);
  });

  it('shows Join from 10 minutes before the start until the end', () => {
    expect(isJoinable(call, new Date('2026-10-28T15:49:59.000Z'))).toBe(false);
    expect(isJoinable(call, new Date('2026-10-28T15:50:00.000Z'))).toBe(true);
    expect(isJoinable(call, new Date('2026-10-28T16:59:59.000Z'))).toBe(true);
    expect(isJoinable(call, new Date('2026-10-28T17:00:00.000Z'))).toBe(false);
    const now = new Date('2026-10-28T16:30:00.000Z');
    expect(isJoinable({ ...call, videoLink: null }, now)).toBe(false);
    expect(isJoinable({ ...call, allDay: true, start: '2026-10-28', end: '2026-10-29' }, now)).toBe(
      false,
    );
  });

  it('links to an event, or to one occurrence of a repeating one', () => {
    expect(eventHref('e1')).toBe('/calendar?event=e1');
    expect(eventHref('e1', null)).toBe('/calendar?event=e1');
    expect(eventHref('e1', '2026-10-28T10:00')).toBe(
      '/calendar?event=e1&occurrence=2026-10-28T10%3A00',
    );
    expect(eventHref('synced:r1', '2026-10-28T16:00:00.000Z')).toBe(
      '/calendar?event=synced%3Ar1&occurrence=2026-10-28T16%3A00%3A00.000Z',
    );
  });
});
