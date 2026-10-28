import { describe, expect, it } from 'vitest';
import {
  attendeesOf,
  MAX_INVITED,
  meetingDate,
  NOTES_MARKDOWN,
  notesTitle,
  takeNotesSchema,
  withinNotesWindow,
} from './notes';

const huddle = {
  title: 'Team huddle',
  allDay: false,
  start: '2026-10-27T16:00:00.000Z',
  timeZone: 'America/Denver',
};

describe('notesTitle', () => {
  it('is the event title and the date (MT-01)', () => {
    expect(notesTitle(huddle)).toBe('Team huddle · Oct 27, 2026');
  });

  it("takes the date in the event's own time zone, whoever clicks", () => {
    // 9:30 PM on Oct 27 in Denver is already Oct 28 in London.
    const late = { ...huddle, start: '2026-10-28T03:30:00.000Z' };
    expect(notesTitle(late)).toBe('Team huddle · Oct 27, 2026');
    expect(notesTitle({ ...late, timeZone: 'Europe/London' })).toBe('Team huddle · Oct 28, 2026');
  });

  it('uses the date of an all-day event as it is', () => {
    const day = {
      title: 'Rota planning',
      allDay: true,
      start: '2026-11-02',
      timeZone: 'Asia/Tokyo',
    };
    expect(meetingDate(day)).toBe('2026-11-02');
    expect(notesTitle(day)).toBe('Rota planning · Nov 2, 2026');
  });

  it('says (No title) for an event without one', () => {
    expect(notesTitle({ ...huddle, title: '  ' })).toBe('(No title) · Oct 27, 2026');
  });
});

describe('attendeesOf', () => {
  it('is the organizer, then the invited members, each once', () => {
    const event = { organizerId: 'avery', memberIds: ['sam', 'avery', 'riley', 'sam'] };
    expect(attendeesOf(event)).toEqual(['avery', 'sam', 'riley']);
  });

  it("takes no more invited members than Calendar's invitee cap", () => {
    const memberIds = Array.from({ length: MAX_INVITED + 50 }, (_, i) => `member-${i}`);
    const attendees = attendeesOf({ organizerId: 'avery', memberIds });
    expect(attendees).toHaveLength(MAX_INVITED + 1);
    expect(attendees.at(-1)).toBe(`member-${MAX_INVITED - 1}`);
  });
});

describe('withinNotesWindow', () => {
  const now = new Date('2026-10-27T12:00:00.000Z');
  it('is a year either side of today, for timed and all-day occurrences', () => {
    expect(withinNotesWindow({ start: '2027-10-27T12:00:00.000Z' }, now)).toBe(true);
    expect(withinNotesWindow({ start: '2025-10-27' }, now)).toBe(true);
    expect(withinNotesWindow({ start: '2027-12-01T12:00:00.000Z' }, now)).toBe(false);
    expect(withinNotesWindow({ start: '2025-09-01' }, now)).toBe(false);
  });
});

describe('takeNotesSchema', () => {
  it('takes an event, with or without an occurrence key', () => {
    expect(takeNotesSchema.parse({ eventId: 'event-1' })).toEqual({ eventId: 'event-1' });
    for (const occurrence of ['2026-10-26T10:00', '2026-10-26']) {
      expect(takeNotesSchema.parse({ eventId: 'event-1', occurrence })).toEqual({
        eventId: 'event-1',
        occurrence,
      });
    }
  });

  it('refuses anything else', () => {
    for (const body of [
      {},
      { eventId: '' },
      { eventId: 'x'.repeat(101) },
      { eventId: 'event-1', occurrence: 'next week' },
      { eventId: 'event-1', occurrence: '2026-10-26T10:00:00.000Z' },
      { eventId: 'event-1', title: 'Team huddle' },
    ]) {
      expect(takeNotesSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('NOTES_MARKDOWN', () => {
  it('has the text sections, with a to-do under Action items', () => {
    const headings = NOTES_MARKDOWN.split('\n').filter((line) => line.startsWith('## '));
    expect(headings).toEqual(['## Agenda', '## Notes', '## Action items', '## Summary']);
    expect(NOTES_MARKDOWN).toContain('## Action items\n\n- [ ] \n');
  });
});
