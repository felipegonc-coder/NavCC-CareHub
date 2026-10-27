import { describe, expect, it } from 'vitest';
import { deleteFollowing, deleteOne, editAll, editFollowing, editOne, splitSeries } from './edit';
import { expand, occurrenceAt } from './expand';
import { RepeatError } from './types';
import type { Occurrence, Series } from './types';

type Event = { title: string; location: string };

const base: Series<Event> = {
  start: '2026-10-26T10:00',
  end: '2026-10-26T10:30',
  rule: { freq: 'weekly', interval: 1, byDay: [{ day: 'MO' }] },
};

/** Mondays Oct 26 to Nov 30: two removed, one moved past the middle, one renamed. */
const busy: Series<Event> = {
  ...base,
  exceptions: ['2026-11-02T10:00', '2026-11-23T10:00'],
  overrides: {
    '2026-11-09T10:00': { start: '2026-11-17T09:00', end: '2026-11-17T09:30' },
    '2026-11-30T10:00': { changes: { title: 'Planning with Morgan Lee' } },
  },
};

const WINDOW = { from: '2024-01-01', to: '2033-01-01' };
const shown = (series: Series<Event> | null) => (series ? expand(series, WINDOW).occurrences : []);
const starts = (series: Series<Event> | null) => shown(series).map((o) => o.start);
const byStart = (a: Occurrence<Event>, b: Occurrence<Event>) =>
  a.start < b.start ? -1 : a.start > b.start ? 1 : a.key < b.key ? -1 : 1;

const errorCode = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof RepeatError ? error.code : 'other';
  }
  return 'none';
};

describe('editOne (This event)', () => {
  const key = '2026-11-02T10:00';

  it('moves one occurrence and keeps its length', () => {
    const next = editOne(base, key, { start: '2026-11-03T11:00' });
    expect(next.overrides).toEqual({
      [key]: { start: '2026-11-03T11:00', end: '2026-11-03T11:30' },
    });
    expect(expand(next, { from: '2026-11-01', to: '2026-11-08' }).occurrences).toEqual([
      { key, start: '2026-11-03T11:00', end: '2026-11-03T11:30' },
    ]);
  });

  it('changes fields for one occurrence, and puts them back', () => {
    const renamed = editOne(base, key, { changes: { title: 'Check-in with Jordan Patel' } });
    expect(renamed.overrides).toEqual({
      [key]: { changes: { title: 'Check-in with Jordan Patel' } },
    });
    expect(editOne(renamed, key, { changes: { title: undefined } }).overrides).toEqual({});
  });

  it('drops the move when the occurrence goes back to its own slot', () => {
    const moved = editOne(base, key, {
      start: '2026-11-03T11:00',
      changes: { location: 'Room 2' },
    });
    expect(editOne(moved, key, { start: key }).overrides).toEqual({
      [key]: { changes: { location: 'Room 2' } },
    });
  });

  it('needs an end to switch between all-day and timed', () => {
    expect(errorCode(() => editOne(base, key, { start: '2026-11-02' }))).toBe('invalid-input');
    const allDay = editOne(base, key, { start: '2026-11-02', end: '2026-11-03' });
    expect(occurrenceAt(allDay, key)).toEqual({ key, start: '2026-11-02', end: '2026-11-03' });
  });

  it('refuses stale keys and backwards times', () => {
    const removed = deleteOne(base, key);
    expect(errorCode(() => editOne(removed, key, { changes: { title: 'x' } }))).toBe(
      'not-an-occurrence',
    );
    expect(errorCode(() => editOne(base, '2026-11-03T10:00', {}))).toBe('not-an-occurrence');
    expect(errorCode(() => editOne(base, key, { end: '2026-11-02T09:00' }))).toBe('invalid-input');
  });
});

describe('deleteOne (This event)', () => {
  it('removes the occurrence and its changes', () => {
    const key = '2026-11-09T10:00';
    const gone = deleteOne(busy, key);
    expect(gone.exceptions).toEqual(['2026-11-02T10:00', key, '2026-11-23T10:00']);
    expect(Object.keys(gone.overrides ?? {})).toEqual(['2026-11-30T10:00']);
    expect(starts(gone).slice(0, 2)).toEqual(['2026-10-26T10:00', '2026-11-16T10:00']);
    expect(errorCode(() => deleteOne(gone, key))).toBe('not-an-occurrence');
  });
});

describe('splitSeries (This and following)', () => {
  it('at the first occurrence: nothing before', () => {
    const { before, after } = splitSeries(busy, '2026-10-26T10:00');
    expect(before).toBeNull();
    expect(after).toEqual(busy);
  });

  it('in the middle: ends the old series the day before, carrying exceptions and overrides', () => {
    const { before, after } = splitSeries(busy, '2026-11-16T10:00');
    expect(before).toEqual({
      start: '2026-10-26T10:00',
      end: '2026-10-26T10:30',
      rule: { freq: 'weekly', interval: 1, byDay: [{ day: 'MO' }], until: '2026-11-15' },
      exceptions: ['2026-11-02T10:00'],
      overrides: { '2026-11-09T10:00': { start: '2026-11-17T09:00', end: '2026-11-17T09:30' } },
    });
    expect(after).toEqual({
      start: '2026-11-16T10:00',
      end: '2026-11-16T10:30',
      rule: { freq: 'weekly', interval: 1, byDay: [{ day: 'MO' }] },
      exceptions: ['2026-11-23T10:00'],
      overrides: { '2026-11-30T10:00': { changes: { title: 'Planning with Morgan Lee' } } },
    });
  });

  it('shares out a count, removed occurrences included', () => {
    const counted = { ...busy, rule: { ...busy.rule, count: 6 } };
    const middle = splitSeries(counted, '2026-11-16T10:00');
    expect(middle.before?.rule.count).toBe(3);
    expect(middle.after.rule.count).toBe(3);
    const last = splitSeries(counted, '2026-11-30T10:00');
    expect(last.before?.rule.count).toBe(5);
    expect(last.after.rule.count).toBe(1);
    expect(starts(last.after)).toEqual(['2026-11-30T10:00']);
  });

  it('at the last occurrence of an until rule', () => {
    const ending = { ...busy, rule: { ...busy.rule, until: '2026-11-30' } };
    const { before, after } = splitSeries(ending, '2026-11-30T10:00');
    expect(before?.rule.until).toBe('2026-11-29');
    expect(after.rule.until).toBe('2026-11-30');
    expect(starts(after)).toEqual(['2026-11-30T10:00']);
  });

  it('keeps every occurrence exactly once, wherever it splits', () => {
    const cases: Series<Event>[] = [
      busy,
      { ...busy, rule: { ...busy.rule, count: 8 } },
      { ...busy, rule: { ...busy.rule, until: '2026-12-21T10:00' } },
      {
        start: '2026-10-30',
        end: '2026-10-31',
        rule: { freq: 'monthly', interval: 1, byDay: [{ day: 'FR', nth: -1 }], count: 6 },
        exceptions: ['2026-12-25'],
        overrides: { '2027-01-29': { start: '2027-01-28', end: '2027-01-29' } },
      },
      {
        start: '2026-10-26T07:30',
        end: '2026-10-26T08:00',
        rule: { freq: 'daily', interval: 2, until: '2026-11-20' },
        overrides: { '2026-10-30T07:30': { changes: { location: 'Lobby' } } },
      },
      {
        start: '2024-02-29',
        end: '2024-03-01',
        rule: { freq: 'yearly', interval: 1, count: 3 },
      },
      {
        start: '2026-10-26T09:00',
        end: '2026-10-26T09:45',
        rule: {
          freq: 'weekly',
          interval: 2,
          byDay: [{ day: 'MO' }, { day: 'WE' }],
          weekStart: 'SU',
          count: 10,
        },
      },
      { ...base, rule: { freq: 'weekly', interval: 1, byDay: [{ day: 'TU' }], count: 5 } },
    ];
    for (const series of cases) {
      const all = shown(series);
      const keys = all.map((o) => o.key);
      for (const key of [...keys.slice(0, 12), ...keys.slice(-2)]) {
        const { before, after } = splitSeries(series, key);
        expect({ key, occurrences: [...shown(before), ...shown(after)].sort(byStart) }).toEqual({
          key,
          occurrences: all,
        });
      }
    }
  });
});

describe('editFollowing (This and following)', () => {
  it('moves this and the following occurrences, and maps their keys', () => {
    const edit = editFollowing(busy, '2026-11-16T10:00', { start: '2026-11-16T11:00' });
    expect(edit.before?.rule.until).toBe('2026-11-15');
    expect(edit.after).toEqual({
      start: '2026-11-16T11:00',
      end: '2026-11-16T11:30',
      rule: { freq: 'weekly', interval: 1, byDay: [{ day: 'MO' }] },
      exceptions: ['2026-11-23T11:00'],
      overrides: { '2026-11-30T11:00': { changes: { title: 'Planning with Morgan Lee' } } },
    });
    const keys = ['2026-11-09T10:00', '2026-11-16T10:00', '2026-11-23T10:00', '2026-12-07T10:00'];
    expect([...edit.mapKeys(keys)]).toEqual([
      ['2026-11-09T10:00', { series: 'before', key: '2026-11-09T10:00' }],
      ['2026-11-16T10:00', { series: 'after', key: '2026-11-16T11:00' }],
      ['2026-11-23T10:00', null],
      ['2026-12-07T10:00', { series: 'after', key: '2026-12-07T11:00' }],
    ]);
  });

  it('from the first occurrence: the whole series changes', () => {
    const edit = editFollowing(base, '2026-10-26T10:00', { end: '2026-10-26T11:00' });
    expect(edit.before).toBeNull();
    expect(edit.after.end).toBe('2026-10-26T11:00');
  });
});

describe('deleteFollowing (This and following)', () => {
  it('keeps what came before, or nothing', () => {
    expect(deleteFollowing(busy, '2026-11-16T10:00')).toEqual(
      splitSeries(busy, '2026-11-16T10:00').before,
    );
    expect(deleteFollowing(busy, '2026-10-26T10:00')).toBeNull();
  });
});

describe('editAll (All events) and existing overrides', () => {
  it('a changed field replaces one-off values for it; other one-off changes stay', () => {
    const series: Series<Event> = {
      ...base,
      overrides: {
        '2026-11-02T10:00': { changes: { title: 'Old title', location: 'Room 2' } },
        '2026-11-09T10:00': {
          start: '2026-11-10T10:00',
          end: '2026-11-10T10:30',
          changes: { title: 'Moved' },
        },
      },
    };
    const edit = editAll(series, '2026-11-16T10:00', { fields: ['title'] });
    expect(edit.series).toEqual({
      ...base,
      exceptions: [],
      overrides: {
        '2026-11-02T10:00': { changes: { location: 'Room 2' } },
        '2026-11-09T10:00': { start: '2026-11-10T10:00', end: '2026-11-10T10:30' },
      },
    });
  });

  it('a new time moves every occurrence and puts moved ones back in line', () => {
    const edit = editAll(busy, '2026-11-16T10:00', { start: '2026-11-16T11:00' });
    expect(edit.series).toEqual({
      start: '2026-10-26T11:00',
      end: '2026-10-26T11:30',
      rule: base.rule,
      exceptions: ['2026-11-02T11:00', '2026-11-23T11:00'],
      overrides: { '2026-11-30T11:00': { changes: { title: 'Planning with Morgan Lee' } } },
    });
    const keys = ['2026-11-09T10:00', '2026-11-23T10:00', '2026-12-07T10:00'];
    expect([...edit.mapKeys(keys)]).toEqual([
      ['2026-11-09T10:00', '2026-11-09T11:00'],
      ['2026-11-23T10:00', null],
      ['2026-12-07T10:00', '2026-12-07T11:00'],
    ]);
  });

  it('a new length changes every occurrence; moved ones keep their start', () => {
    const series: Series<Event> = {
      ...base,
      overrides: { '2026-11-09T10:00': { start: '2026-11-10T14:00', end: '2026-11-10T14:30' } },
    };
    const { series: next } = editAll(series, '2026-11-02T10:00', { end: '2026-11-02T11:00' });
    expect(next.end).toBe('2026-10-26T11:00');
    expect(next.overrides).toEqual({
      '2026-11-09T10:00': { start: '2026-11-10T14:00', end: '2026-11-10T15:00' },
    });
  });

  it('ignores a start and end that match what shows', () => {
    const series: Series<Event> = {
      ...base,
      overrides: {
        '2026-11-02T10:00': {
          start: '2026-11-02T10:00',
          end: '2026-11-02T11:30',
          changes: { title: 'Long one' },
        },
      },
    };
    const edit = editAll(series, '2026-11-02T10:00', {
      start: '2026-11-02T10:00',
      end: '2026-11-02T11:30',
      fields: ['title'],
    });
    expect(edit.series.end).toBe('2026-10-26T10:30');
    expect(edit.series.overrides).toEqual({
      '2026-11-02T10:00': { start: '2026-11-02T10:00', end: '2026-11-02T11:30' },
    });
  });

  it('moving days moves the weekly days; the dragged occurrence lands where dropped', () => {
    const series: Series<Event> = {
      ...base,
      overrides: { '2026-11-02T10:00': { start: '2026-11-04T10:00', end: '2026-11-04T10:30' } },
    };
    const edit = editAll(series, '2026-11-02T10:00', { start: '2026-11-04T15:00' });
    expect(edit.series.start).toBe('2026-10-28T15:00');
    expect(edit.series.rule.byDay).toEqual([{ day: 'WE' }]);
    expect(edit.series.overrides).toEqual({});
    expect(starts(edit.series).slice(0, 2)).toEqual(['2026-10-28T15:00', '2026-11-04T15:00']);
  });

  it('monthly days follow a move across the month end', () => {
    const lastDay: Series<Event> = {
      start: '2026-01-31',
      end: '2026-02-01',
      rule: { freq: 'monthly', interval: 1, byMonthDay: [31] },
    };
    const day = editAll(lastDay, '2026-10-31', { start: '2026-11-01', end: '2026-11-02' });
    expect(day.series.start).toBe('2026-02-01');
    expect(day.series.rule.byMonthDay).toEqual([1]);
    const lastFriday: Series<Event> = {
      start: '2026-10-30T15:00',
      end: '2026-10-30T16:00',
      rule: { freq: 'monthly', interval: 1, byDay: [{ day: 'FR', nth: -1 }] },
    };
    const thursday = editAll(lastFriday, '2026-11-27T15:00', { start: '2026-11-26T15:00' });
    expect(thursday.series.start).toBe('2026-10-29T15:00');
    expect(thursday.series.rule.byDay).toEqual([{ day: 'TH', nth: -1 }]);
  });

  it('asks for new repeat days when the rule can’t follow a move', () => {
    const twiceMonthly: Series<Event> = {
      start: '2026-11-01T09:00',
      end: '2026-11-01T09:30',
      rule: { freq: 'monthly', interval: 1, byMonthDay: [1, 15] },
    };
    const move = { start: '2026-11-16T09:00' };
    expect(errorCode(() => editAll(twiceMonthly, '2026-11-15T09:00', move))).toBe('invalid-input');
    const rule = { freq: 'monthly' as const, interval: 1, byMonthDay: [2, 16] };
    const edit = editAll(twiceMonthly, '2026-11-15T09:00', { ...move, rule });
    expect(starts(edit.series).slice(0, 3)).toEqual([
      '2026-11-02T09:00',
      '2026-11-16T09:00',
      '2026-12-02T09:00',
    ]);
  });

  it('keeps the last occurrence when the time moves past an until time', () => {
    const daily = (until: string): Series<Event> => ({
      start: '2026-10-26T10:00',
      end: '2026-10-26T10:30',
      rule: { freq: 'daily', interval: 1, until },
    });
    const later = editAll(daily('2026-10-30T10:00'), '2026-10-28T10:00', {
      start: '2026-10-28T11:00',
    });
    expect(later.series.rule.until).toBe('2026-10-30');
    expect(starts(later.series).at(-1)).toBe('2026-10-30T11:00');
    const earlier = editAll(daily('2026-10-30T09:00'), '2026-10-28T10:00', {
      start: '2026-10-29T08:00',
    });
    expect(earlier.series.rule.until).toBe('2026-10-30');
    expect(starts(earlier.series)).toHaveLength(4);
  });

  it('a new rule drops exceptions and overrides it no longer makes', () => {
    const rule = { freq: 'weekly' as const, interval: 2, byDay: [{ day: 'MO' as const }] };
    const edit = editAll(busy, '2026-11-16T10:00', { rule });
    expect(edit.series.exceptions).toEqual(['2026-11-23T10:00']);
    expect(Object.keys(edit.series.overrides ?? {})).toEqual(['2026-11-09T10:00']);
    expect([...edit.mapKeys(['2026-11-16T10:00', '2026-12-07T10:00'])]).toEqual([
      ['2026-11-16T10:00', null],
      ['2026-12-07T10:00', '2026-12-07T10:00'],
    ]);
    expect(
      errorCode(() => editAll(busy, '2026-11-16T10:00', { rule: { ...rule, interval: 0 } })),
    ).toBe('invalid-input');
  });

  it('switches every occurrence to all-day', () => {
    const edit = editAll(busy, '2026-11-16T10:00', { start: '2026-11-16', end: '2026-11-17' });
    expect(edit.series.start).toBe('2026-10-26');
    expect(edit.series.end).toBe('2026-10-27');
    expect(edit.series.exceptions).toEqual(['2026-11-02', '2026-11-23']);
    expect(edit.mapKeys(['2026-12-07T10:00']).get('2026-12-07T10:00')).toBe('2026-12-07');
  });

  it('stays inside years 1 to 9999', () => {
    const forever: Series = { ...base, rule: { ...base.rule, until: '9999-12-31' } };
    const later = editAll(forever, '2026-11-02T10:00', { start: '2026-11-03T10:00' });
    expect(later.series.rule).toEqual({
      freq: 'weekly',
      interval: 1,
      byDay: [{ day: 'TU' }],
      until: '9999-12-31',
    });
    const early: Series = {
      start: '0001-01-01',
      end: '0001-01-02',
      rule: { freq: 'daily', interval: 1 },
    };
    expect(errorCode(() => editAll(early, '0001-01-02', { start: '0001-01-01' }))).toBe(
      'invalid-input',
    );
    expect(errorCode(() => editOne(base, '2026-11-02T10:00', { start: '9999-12-31T23:45' }))).toBe(
      'invalid-input',
    );
  });

  it('changes nothing without a change', () => {
    const edit = editAll(base, '2026-11-02T10:00', {});
    expect(edit.series).toEqual({ ...base, exceptions: [], overrides: {} });
    expect(edit.mapKeys(['2026-11-09T10:00']).get('2026-11-09T10:00')).toBe('2026-11-09T10:00');
  });
});
