import { describe, expect, it } from 'vitest';
import { cardOf, whenText, type CardEvent } from './cards';

const ada = '00000000-0000-4000-8000-00000000000a';
const ben = '00000000-0000-4000-8000-00000000000b';
const cy = '00000000-0000-4000-8000-00000000000c';
const denver = 'America/Denver';

/** Ben reads his chat in New York, two hours ahead of Denver. */
const reader = { userId: ben, timeZone: 'America/New_York', use24h: false };

/** Ada's weekly Tuesday check-in, 10:00 to 11:00 in Denver from Oct 20, 2026, with Ben invited. */
const weekly: CardEvent = {
  id: '00000000-0000-4000-8000-0000000000e1',
  organizerId: ada,
  allDay: false,
  timeZone: denver,
  start: '2026-10-20T10:00',
  end: '2026-10-20T11:00',
  rule: { freq: 'weekly', interval: 1, byDay: [{ day: 'TU' }] },
  exceptions: ['2026-11-03T10:00'],
  overrides: { '2026-10-27T10:00': { start: '2026-10-27T12:00', end: '2026-10-27T13:00' } },
  title: 'Weekly check-in',
  location: '',
  description: '',
  videoUrl: null,
  notesPageId: null,
  people: [{ userId: ben, reply: null, note: null, occurrenceReplies: {} }],
  createdAt: new Date('2026-10-19T12:00:00.000Z'),
  updatedAt: new Date('2026-10-19T12:00:00.000Z'),
  cancelledAt: null,
};

const single: CardEvent = { ...weekly, rule: null, exceptions: [], overrides: {} };
const ref = (occurrenceStart: string | null = null) => ({ eventId: weekly.id, occurrenceStart });

describe('event cards in notices', () => {
  it("words when it happens in the reader's zone and clock", () => {
    expect(whenText('2026-10-27T10:00', '2026-10-27T11:00', denver, reader)).toBe(
      'Tue, Oct 27 · 12:00 to 1:00 PM',
    );
    const late = whenText('2026-10-27T21:00', '2026-10-27T23:00', denver, {
      ...reader,
      use24h: true,
    });
    expect(late).toBe('Tue, Oct 27 · 23:00 to Wed, Oct 28 · 01:00');
    expect(whenText('2026-10-27', '2026-10-28', denver, reader)).toBe('Tue, Oct 27');
    expect(whenText('2026-10-27', '2026-10-30', denver, reader)).toBe('Tue, Oct 27 to Thu, Oct 29');
  });

  it('shows the event to its organizer and the people invited, and no one else', () => {
    expect(cardOf(single, ref(), reader)).toEqual({
      title: 'Weekly check-in',
      when: 'Tue, Oct 20 · 12:00 to 1:00 PM',
      href: `/calendar?event=${weekly.id}`,
    });
    expect(cardOf(single, ref(), { ...reader, userId: ada })).toHaveProperty('href');
    expect(cardOf(single, ref(), { ...reader, userId: cy })).toEqual({ locked: true });
    expect(cardOf({ ...single, title: ' ' }, ref(), reader)).toHaveProperty('title', '(No title)');
  });

  it('shows a series, or one occurrence of it as it is now', () => {
    expect(cardOf(weekly, ref(), reader)).toHaveProperty(
      'when',
      'Tue, Oct 20 · 12:00 to 1:00 PM · Every week on Tuesday',
    );
    expect(cardOf(weekly, ref('2026-10-27T10:00'), reader)).toEqual({
      title: 'Weekly check-in',
      when: 'Tue, Oct 27 · 2:00 to 3:00 PM',
      href: `/calendar?event=${weekly.id}&occurrence=2026-10-27T10%3A00`,
    });
  });

  it('says which meeting or occurrence was cancelled', () => {
    expect(cardOf({ ...single, cancelledAt: new Date() }, ref(), reader)).toEqual({
      title: 'Weekly check-in',
      when: 'Cancelled · Tue, Oct 20 · 12:00 to 1:00 PM',
      href: '/calendar?date=2026-10-20',
    });
    expect(cardOf(weekly, ref('2026-11-03T10:00'), reader)).toHaveProperty(
      'when',
      'Cancelled · Tue, Nov 3 · 12:00 to 1:00 PM',
    );
    expect(cardOf(weekly, ref('2026-10-28T10:00'), reader)).toEqual({ deleted: true });
    expect(cardOf(undefined, ref(), reader)).toEqual({ deleted: true });
  });
});
