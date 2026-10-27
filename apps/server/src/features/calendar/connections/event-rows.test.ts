import { describe, expect, it } from 'vitest';
import { type SyncedEventInput, eventRows } from './event-rows';

const NOW = new Date('2026-11-10T12:00:00Z');
const visit = (remoteId: string, start: string, end: string): SyncedEventInput => ({
  remoteId,
  event: {
    uid: `${remoteId}@clinic.example.org`,
    status: 'confirmed',
    title: 'Home visit',
    busy: true,
    start: { kind: 'utc', instant: start },
    end: { kind: 'utc', instant: end },
  },
});

describe('event rows', () => {
  it('come nearest to now first, with events going on now at the top', () => {
    const weekly: SyncedEventInput = {
      remoteId: 'weekly',
      event: {
        ...visit('weekly', '2025-01-06T09:00:00Z', '2025-01-06T10:00:00Z').event,
        rrule: 'FREQ=WEEKLY',
      },
    };
    const rows = eventRows(
      'cal-1',
      [
        visit('last-year', '2025-11-10T09:00:00Z', '2025-11-10T10:00:00Z'),
        visit('next-week', '2026-11-17T09:00:00Z', '2026-11-17T10:00:00Z'),
        visit('yesterday', '2026-11-09T09:00:00Z', '2026-11-09T10:00:00Z'),
        visit('now', '2026-11-10T11:30:00Z', '2026-11-10T12:30:00Z'),
        weekly,
        visit('tomorrow', '2026-11-11T09:00:00Z', '2026-11-11T10:00:00Z'),
      ],
      NOW,
    );
    expect(rows.map((row) => row.remoteId)).toEqual([
      'now',
      'weekly',
      'tomorrow',
      'yesterday',
      'next-week',
      'last-year',
    ]);
  });

  it('keep one row per remote id: the last copy read', () => {
    const first = visit('visit-1', '2026-11-11T09:00:00Z', '2026-11-11T10:00:00Z');
    const moved = visit('visit-1', '2026-11-12T09:00:00Z', '2026-11-12T10:00:00Z');
    const rows = eventRows('cal-1', [first, moved], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.startsAt.toISOString()).toBe('2026-11-12T09:00:00.000Z');
  });

  it('use the etag as the version, else a hash of the event', () => {
    const input = visit('visit-1', '2026-11-11T09:00:00Z', '2026-11-11T10:00:00Z');
    const [tagged] = eventRows('cal-1', [{ ...input, version: '"3381234"' }], NOW);
    expect(tagged?.version).toBe('"3381234"');

    const [hashed] = eventRows('cal-1', [input], NOW);
    const [again] = eventRows('cal-1', [structuredClone(input)], NOW);
    const renamed = { ...input, event: { ...input.event, title: 'Home visit (moved)' } };
    const [changed] = eventRows('cal-1', [renamed], NOW);
    expect(hashed?.version).toMatch(/^[\w-]{27}$/);
    expect(again?.version).toBe(hashed?.version);
    expect(changed?.version).not.toBe(hashed?.version);
  });

  it('carry the calendar, uid, link, bounds and when it was read', () => {
    const input = visit('visit-1', '2026-11-11T09:00:00Z', '2026-11-11T10:00:00Z');
    const [plainRow] = eventRows('cal-1', [input], NOW);
    expect(plainRow).toMatchObject({
      calendarId: 'cal-1',
      remoteId: 'visit-1',
      uid: 'visit-1@clinic.example.org',
      htmlLink: null,
      readAt: NOW,
    });
    expect(plainRow?.startsAt.toISOString()).toBe('2026-11-11T09:00:00.000Z');
    expect(plainRow?.endsAt?.toISOString()).toBe('2026-11-11T10:00:00.000Z');

    const htmlLink = 'https://www.google.com/calendar/event?eid=dmlzaXQtMQ';
    const [linked] = eventRows('cal-1', [{ ...input, htmlLink }], NOW);
    expect(linked?.htmlLink).toBe(htmlLink);
  });
});
