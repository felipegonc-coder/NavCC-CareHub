import { expand } from '@carehub/team-repeat';
import { describe, expect, it } from 'vitest';
import { planDelete, planDuplicate, planEdit, planReply, type EventState } from './edit';
import type { StoredEvent } from './items';
import { seriesOf } from './model';

const ada = '00000000-0000-4000-8000-00000000000a';
const ben = '00000000-0000-4000-8000-00000000000b';

/** Ada's weekly Tuesday 10:00 to 11:00 check-in in Denver from Oct 20, 2026, with Ben invited. */
const weekly: StoredEvent = {
  id: '00000000-0000-4000-8000-0000000000e1',
  organizerId: ada,
  allDay: false,
  timeZone: 'America/Denver',
  start: '2026-10-20T10:00',
  end: '2026-10-20T11:00',
  rule: { freq: 'weekly', interval: 1, byDay: [{ day: 'TU' }] },
  exceptions: [],
  overrides: {},
  title: 'Weekly check-in',
  location: 'Room 2',
  description: '',
  videoUrl: null,
  notesPageId: null,
  people: [
    {
      userId: ben,
      reply: 'going',
      note: null,
      occurrenceReplies: {
        '2026-10-27T10:00': { reply: 'not-going', note: 'Away that day' },
        '2026-11-10T10:00': { reply: 'maybe', note: null },
      },
    },
  ],
  createdAt: new Date('2026-10-19T12:00:00.000Z'),
  updatedAt: new Date('2026-10-19T12:00:00.000Z'),
};

const single: StoredEvent = {
  ...weekly,
  start: '2026-10-27T10:00',
  end: '2026-10-27T11:00',
  rule: null,
  people: [],
};

/** Keys of the occurrences from Oct 18 to Nov 22. */
function keysOf(state: EventState) {
  const series = seriesOf(state);
  if (!series) return [state.start];
  return expand(series, { from: '2026-10-18', to: '2026-11-22' }).occurrences.map((o) => o.key);
}

function failure(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('It should have failed.');
}

const repliesOf = (state: EventState) => state.people[0]?.occurrenceReplies;

describe('planEdit', () => {
  it('moves and renames an event that does not repeat', () => {
    const { event, split } = planEdit(single, {
      title: 'Check-in',
      allDay: false,
      start: '2026-10-28T15:00:00.000Z',
      end: '2026-10-28T15:30:00.000Z',
    });
    expect(split).toBeNull();
    expect(event).toMatchObject({ title: 'Check-in', start: '2026-10-28T09:00', rule: null });
    expect(event.end).toBe('2026-10-28T09:30');
  });

  it('makes an event repeat, or an all-day one in another zone', () => {
    const rule = { freq: 'daily' as const, interval: 1, count: 3 };
    expect(keysOf(planEdit(single, { repeat: rule }).event)).toHaveLength(3);
    const { event } = planEdit(single, {
      allDay: true,
      start: '2026-10-29',
      end: '2026-10-30',
      timeZone: 'America/New_York',
    });
    expect(event).toMatchObject({
      allDay: true,
      start: '2026-10-29',
      timeZone: 'America/New_York',
    });
  });

  it('asks which occurrences on a repeating event', () => {
    expect(failure(() => planEdit(weekly, { title: 'Renamed' }))).toMatchObject({
      statusCode: 400,
      message: 'Choose This event, This and following, or All events.',
    });
  });

  it('changes one occurrence on its own', () => {
    const { event } = planEdit(weekly, {
      scope: 'one',
      occurrence: '2026-10-27T10:00',
      title: 'Check-in (moved)',
      allDay: false,
      start: '2026-10-28T15:00:00.000Z',
      end: '2026-10-28T16:00:00.000Z',
    });
    expect(event.title).toBe('Weekly check-in');
    expect(event.overrides).toEqual({
      '2026-10-27T10:00': {
        start: '2026-10-28T09:00',
        end: '2026-10-28T10:00',
        changes: { title: 'Check-in (moved)' },
      },
    });
    expect(event.people).toEqual(weekly.people);
  });

  it('refuses a stale occurrence, and another time zone for one occurrence', () => {
    const stale = { scope: 'one' as const, occurrence: '2026-10-28T10:00', title: 'Moved' };
    expect(failure(() => planEdit(weekly, stale))).toMatchObject({ statusCode: 409 });
    const zoned = {
      scope: 'one' as const,
      occurrence: '2026-10-27T10:00',
      allDay: false,
      start: '2026-10-27T15:00:00.000Z',
      end: '2026-10-27T16:00:00.000Z',
      timeZone: 'America/New_York',
    };
    expect(failure(() => planEdit(weekly, zoned))).toMatchObject({ statusCode: 400 });
  });

  it('moves all events, and the answers for single occurrences with them', () => {
    const { event, split } = planEdit(weekly, {
      scope: 'all',
      occurrence: '2026-10-27T10:00',
      allDay: false,
      start: '2026-10-27T17:00:00.000Z',
      end: '2026-10-27T18:00:00.000Z',
    });
    expect(split).toBeNull();
    expect(event).toMatchObject({ start: '2026-10-20T11:00', end: '2026-10-20T12:00' });
    expect(Object.keys(repliesOf(event) ?? {})).toEqual(['2026-10-27T11:00', '2026-11-10T11:00']);
  });

  it('renames all events over the names of single occurrences', () => {
    const renamed: StoredEvent = {
      ...weekly,
      overrides: { '2026-11-03T10:00': { changes: { title: 'Special', location: 'Lobby' } } },
    };
    const { event } = planEdit(renamed, { scope: 'all', title: 'Check-in' });
    expect(event.title).toBe('Check-in');
    expect(event.overrides).toEqual({ '2026-11-03T10:00': { changes: { location: 'Lobby' } } });
  });

  it('splits the series for this and following', () => {
    const { event, split } = planEdit(weekly, {
      scope: 'following',
      occurrence: '2026-11-03T10:00',
      title: 'New check-in',
      people: [],
    });
    expect(keysOf(event)).toEqual(['2026-10-20T10:00', '2026-10-27T10:00']);
    expect(event).toMatchObject({ title: 'Weekly check-in' });
    expect(Object.keys(repliesOf(event) ?? {})).toEqual(['2026-10-27T10:00']);
    if (!split) throw new Error('There should be a new series.');
    expect(split).toMatchObject({ title: 'New check-in', start: '2026-11-03T10:00', people: [] });
    expect(keysOf(split).slice(0, 2)).toEqual(['2026-11-03T10:00', '2026-11-10T10:00']);
  });

  it('keeps the answers for later occurrences in the new series', () => {
    const { split } = planEdit(weekly, {
      scope: 'following',
      occurrence: '2026-11-03T10:00',
      title: 'New',
    });
    expect(repliesOf(split as EventState)).toEqual({
      '2026-11-10T10:00': { reply: 'maybe', note: null },
    });
  });

  it('edits the whole series for this and following from the first occurrence', () => {
    const { event, split } = planEdit(weekly, {
      scope: 'following',
      occurrence: '2026-10-20T10:00',
      title: 'Renamed',
    });
    expect(split).toBeNull();
    expect(event).toMatchObject({ title: 'Renamed', start: '2026-10-20T10:00' });
  });

  it('keeps the chosen occurrence alone when repeating stops', () => {
    const { event, split } = planEdit(weekly, {
      scope: 'all',
      occurrence: '2026-10-27T10:00',
      repeat: null,
    });
    expect(split).toBeNull();
    expect(event).toMatchObject({ start: '2026-10-27T10:00', end: '2026-10-27T11:00', rule: null });
    expect(event.people[0]).toEqual({
      userId: ben,
      reply: 'not-going',
      note: 'Away that day',
      occurrenceReplies: {},
    });
    const following = planEdit(weekly, {
      scope: 'following',
      occurrence: '2026-11-03T10:00',
      repeat: null,
    });
    expect(keysOf(following.event)).toEqual(['2026-10-20T10:00', '2026-10-27T10:00']);
    expect(following.split).toMatchObject({ start: '2026-11-03T10:00', rule: null });
  });
});

describe('where occurrences go after an edit (for reminders)', () => {
  const tue = (day: string) => `2026-${day}T10:00`;

  it('keeps the whole event in place, on its first occurrence once it repeats', () => {
    const renamed = planEdit(single, { title: 'Renamed' });
    expect(renamed.placeOf(null)).toEqual({ in: 'event', key: null });
    expect(renamed.placeOf(tue('10-27'))).toBeNull();
    const daily = planEdit(single, { repeat: { freq: 'daily', interval: 1, count: 3 } });
    expect(daily.placeOf(null)).toEqual({ in: 'event', key: tue('10-27') });
  });

  it('keeps every key after This event', () => {
    const moved = planEdit(weekly, {
      scope: 'one',
      occurrence: tue('10-27'),
      allDay: false,
      start: '2026-10-28T15:00:00.000Z',
      end: '2026-10-28T16:00:00.000Z',
    });
    expect(moved.placeOf(tue('10-27'))).toEqual({ in: 'event', key: tue('10-27') });
    expect(moved.placeOf(null)).toEqual({ in: 'event', key: tue('10-20') });
  });

  it('follows All events to their new keys', () => {
    const later = planEdit(weekly, {
      scope: 'all',
      occurrence: tue('10-27'),
      allDay: false,
      start: '2026-10-27T17:00:00.000Z',
      end: '2026-10-27T18:00:00.000Z',
    });
    expect(later.placeOf(tue('11-03'))).toEqual({ in: 'event', key: '2026-11-03T11:00' });
    expect(later.placeOf('2026-10-21T10:00')).toBeNull();
  });

  it('moves the chosen occurrence and later ones into the new series', () => {
    const renamed = planEdit(weekly, {
      scope: 'following',
      occurrence: tue('11-03'),
      title: 'New',
    });
    expect(renamed.placeOf(tue('10-27'))).toEqual({ in: 'event', key: tue('10-27') });
    expect(renamed.placeOf(tue('11-03'))).toEqual({ in: 'split', key: tue('11-03') });
    expect(renamed.placeOf(tue('11-10'))).toEqual({ in: 'split', key: tue('11-10') });
    const fromFirst = planEdit(weekly, {
      scope: 'following',
      occurrence: tue('10-20'),
      title: 'All',
    });
    expect(fromFirst.placeOf(tue('11-10'))).toEqual({ in: 'event', key: tue('11-10') });
  });

  it('keeps only the chosen occurrence, alone, when repeating stops', () => {
    const all = planEdit(weekly, { scope: 'all', occurrence: tue('10-27'), repeat: null });
    expect(all.placeOf(tue('10-27'))).toEqual({ in: 'event', key: null });
    expect(all.placeOf(tue('11-03'))).toBeNull();
    const following = planEdit(weekly, {
      scope: 'following',
      occurrence: tue('11-03'),
      repeat: null,
    });
    expect(following.placeOf(tue('10-27'))).toEqual({ in: 'event', key: tue('10-27') });
    expect(following.placeOf(tue('11-03'))).toEqual({ in: 'split', key: null });
    expect(following.placeOf(tue('11-10'))).toBeNull();
  });
});

describe('planDelete', () => {
  it('removes one occurrence and its answers', () => {
    const left = planDelete(weekly, { scope: 'one', occurrence: '2026-10-27T10:00' });
    expect(left?.exceptions).toEqual(['2026-10-27T10:00']);
    expect(Object.keys(left ? (repliesOf(left) ?? {}) : {})).toEqual(['2026-11-10T10:00']);
  });

  it('ends the series before this and following', () => {
    const left = planDelete(weekly, { scope: 'following', occurrence: '2026-11-03T10:00' });
    expect(left && keysOf(left)).toEqual(['2026-10-20T10:00', '2026-10-27T10:00']);
    expect(left && Object.keys(repliesOf(left) ?? {})).toEqual(['2026-10-27T10:00']);
  });

  it('deletes the whole event when nothing is left', () => {
    expect(planDelete(weekly, { scope: 'all' })).toBeNull();
    expect(planDelete(single, {})).toBeNull();
    expect(planDelete(weekly, { scope: 'following', occurrence: '2026-10-20T10:00' })).toBeNull();
    const once: StoredEvent = { ...weekly, rule: { freq: 'weekly', interval: 1, count: 1 } };
    expect(planDelete(once, { scope: 'one', occurrence: '2026-10-20T10:00' })).toBeNull();
    expect(failure(() => planDelete(weekly, {}))).toMatchObject({ statusCode: 400 });
  });
});

describe('planReply', () => {
  const [person] = weekly.people;
  if (!person) throw new Error('Ben is missing.');

  it('answers for the whole series, replacing answers for single occurrences', () => {
    expect(planReply(weekly, person, { reply: 'maybe', note: 'Running late' })).toEqual({
      userId: ben,
      reply: 'maybe',
      note: 'Running late',
      occurrenceReplies: {},
    });
  });

  it('answers for one occurrence', () => {
    const answer = planReply(weekly, person, { reply: 'going', occurrence: '2026-11-03T10:00' });
    expect(answer.reply).toBe('going');
    expect(answer.occurrenceReplies['2026-11-03T10:00']).toEqual({ reply: 'going', note: null });
    expect(Object.keys(answer.occurrenceReplies)).toHaveLength(3);
  });

  it('refuses an occurrence that is not there', () => {
    const body = { reply: 'going' as const, occurrence: '2026-11-04T10:00' };
    expect(failure(() => planReply(weekly, person, body))).toMatchObject({ statusCode: 409 });
  });
});

describe('planDuplicate', () => {
  it('copies the series from the chosen occurrence, inviting everyone else again', () => {
    const copy = planDuplicate(weekly, ben, '2026-11-03T10:00');
    expect(copy).toMatchObject({ title: 'Weekly check-in', start: '2026-11-03T10:00' });
    expect(copy.people).toEqual([{ userId: ada, reply: null, note: null, occurrenceReplies: {} }]);
    expect(planDuplicate(weekly, ada, undefined)).toMatchObject({
      start: '2026-10-20T10:00',
      people: [{ userId: ben, reply: null }],
    });
  });
});
