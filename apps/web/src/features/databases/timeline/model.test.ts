import { describe, expect, it } from 'vitest';
import { epochDays, type DateValue } from '@carehub/databases';
import type { QueryGroup, QueryRow } from '@carehub/databases/engine';
import {
  arrowPath,
  changedBar,
  changedValues,
  DAY_MINUTES,
  dayAtX,
  dayMinutes,
  dragMinutes,
  editedValues,
  extendWindow,
  headerTicks,
  minutesToX,
  NO_CHANGE,
  rowBar,
  shiftValue,
  timelineLines,
  timeWindow,
  weekendDays,
  windowWidth,
  type Bar,
} from './model';
import { pointLabel, SCALE_LABELS, tickLabel, TIMELINE_TEXT, whenLabel } from './messages';

const DENVER = 'America/Denver';
const days = (start: string, end: string | null = null): DateValue => ({
  start,
  end,
  hasTime: false,
});
const timed = (start: string, end: string | null = null): DateValue => ({
  start,
  end,
  hasTime: true,
});

describe('rowBar', () => {
  it('spans a range from its first day to the end of its last', () => {
    expect(rowBar('r', days('2026-10-27', '2026-10-29'), null, false, DENVER)).toEqual({
      id: 'r',
      start: dayMinutes('2026-10-27'),
      end: dayMinutes('2026-10-30'),
    });
  });

  it('makes a start with no end a one-day bar, and has none without a start', () => {
    const bar = rowBar('r', days('2026-10-27'), null, false, DENVER);
    expect(bar?.end).toBe(dayMinutes('2026-10-28'));
    expect(rowBar('r', null, days('2026-10-29'), true, DENVER)).toBeNull();
  });

  it('reads separate start and end properties', () => {
    const bar = rowBar('r', days('2026-10-27'), days('2026-10-31'), true, DENVER);
    expect(bar?.end).toBe(dayMinutes('2026-11-01'));
    expect(rowBar('r', days('2026-10-27'), null, true, DENVER)?.end).toBe(dayMinutes('2026-10-28'));
  });

  it('puts a late evening in Denver on that evening', () => {
    const bar = rowBar('r', timed('2026-10-29T03:30:00.000Z'), null, false, DENVER);
    expect(bar?.start).toBe(dayMinutes('2026-10-28') + 21 * 60 + 30);
    expect(bar?.end).toBe(dayMinutes('2026-10-28') + 22 * 60 + 30);
  });
});

describe('the window', () => {
  const bar = rowBar('r', days('2026-10-27', '2026-10-29'), null, false, DENVER);
  const bars = bar ? [bar] : [];

  it('pads around the bars and today, from a week start', () => {
    const window = timeWindow(bars, '2026-10-27', 'week', 0);
    expect(window.start).toBe('2026-10-11');
    expect(window.days).toBe(epochDays('2026-11-12') - epochDays('2026-10-11') + 1);
    expect(windowWidth(window)).toBe(window.days * 60);
    expect(minutesToX(window, dayMinutes('2026-10-12'))).toBe(60);
    expect(dayAtX(window, 61)).toBe('2026-10-12');
    expect(timeWindow(bars, '2026-10-27', 'week', 1).start).toBe('2026-10-12');
  });

  it('starts month, quarter and year scales on the 1st', () => {
    expect(timeWindow(bars, '2026-10-27', 'month', 0).start).toBe('2026-08-01');
    expect(timeWindow(bars, '2026-10-27', 'year', 0).start).toBe('2025-10-01');
  });

  it('keeps long stretches around today', () => {
    const far = rowBar('far', days('2020-01-01'), null, false, DENVER);
    const window = timeWindow(far ? [far] : [], '2026-10-27', 'hours', 0);
    expect(window.start).toBe('2026-10-20');
    expect(window.days).toBe(14);
  });

  it('labels the header for each scale', () => {
    const window = timeWindow(bars, '2026-10-27', 'week', 0);
    const ticks = headerTicks(window, 0);
    expect(ticks.top.map((t) => tickLabel(t, ticks.topUnit, 'week', true))).toEqual([
      'October 2026',
      'November 2026',
    ]);
    expect(ticks.bottom[0]).toMatchObject({ x: 0, width: 60, date: '2026-10-11' });
    expect(tickLabel(ticks.bottom[1]!, ticks.bottomUnit, 'week', true)).toBe('12');
    const quarter = timeWindow(bars, '2026-10-27', 'quarter', 0);
    const q = headerTicks(quarter, 0);
    expect(tickLabel(q.top[0]!, q.topUnit, 'quarter', true)).toBe('Q2 2026');
    expect(tickLabel(q.bottom[0]!, q.bottomUnit, 'quarter', true)).toBe('Jun');
    const hours = headerTicks(timeWindow(bars, '2026-10-27', 'hours', 0), 0);
    expect(hours.bottom).toHaveLength(24 * 5);
    expect(tickLabel(hours.bottom[15]!, 'hour', 'hours', true)).toBe('3 PM');
    expect(tickLabel(hours.bottom[0]!, 'hour', 'hours', true)).toBe('12 AM');
    expect(tickLabel(hours.bottom[15]!, 'hour', 'hours', false)).toBe('15:00');
    expect(tickLabel(hours.top[0]!, 'day', 'hours', true)).toBe('Mon, Oct 26');
    expect(tickLabel(hours.top[0]!, 'day', 'day', true)).toBe('Mon 26');
    expect(weekendDays(window)).toContain('2026-10-31');
    expect(weekendDays(timeWindow(bars, '2026-10-27', 'month', 0))).toEqual([]);
  });
});

describe('dragging', () => {
  it('turns px into whole steps of the scale', () => {
    expect(dragMinutes(120, 'week')).toBe(2 * DAY_MINUTES);
    expect(dragMinutes(-29, 'week')).toBe(0);
    expect(dragMinutes(-31, 'week')).toBe(-DAY_MINUTES);
    expect(dragMinutes(20, 'hours')).toBe(30);
    expect(dragMinutes(7, 'hours')).toBe(15);
    expect(dragMinutes(24, 'month')).toBe(2 * DAY_MINUTES);
    expect(dragMinutes(300, 'hours', false)).toBe(0);
    expect(dragMinutes(600, 'hours', false)).toBe(DAY_MINUTES);
  });

  it('moves a 3-day range and keeps its length', () => {
    expect(
      editedValues(
        'move',
        2 * DAY_MINUTES,
        days('2026-10-27', '2026-10-29'),
        null,
        'due',
        null,
        DENVER,
      ),
    ).toEqual({ due: days('2026-10-29', '2026-10-31') });
  });

  it('changes only the start or only the end, never past the other', () => {
    const range = days('2026-10-27', '2026-10-29');
    expect(editedValues('start', -DAY_MINUTES, range, null, 'due', null, DENVER)).toEqual({
      due: days('2026-10-26', '2026-10-29'),
    });
    expect(editedValues('end', DAY_MINUTES, range, null, 'due', null, DENVER)).toEqual({
      due: days('2026-10-27', '2026-10-30'),
    });
    expect(editedValues('start', 5 * DAY_MINUTES, range, null, 'due', null, DENVER)).toEqual({
      due: days('2026-10-29', '2026-10-29'),
    });
    expect(editedValues('end', -5 * DAY_MINUTES, range, null, 'due', null, DENVER)).toEqual({
      due: days('2026-10-27', '2026-10-27'),
    });
    expect(editedValues('end', DAY_MINUTES, days('2026-10-27'), null, 'due', null, DENVER)).toEqual(
      {
        due: days('2026-10-27', '2026-10-28'),
      },
    );
  });

  it('moves separate start and end properties together, and their ends alone', () => {
    const start = days('2026-10-27');
    const end = days('2026-10-29');
    expect(editedValues('move', DAY_MINUTES, start, end, 'begins', 'ends', DENVER)).toEqual({
      begins: days('2026-10-28'),
      ends: days('2026-10-30'),
    });
    expect(editedValues('end', DAY_MINUTES, start, end, 'begins', 'ends', DENVER)).toEqual({
      ends: days('2026-10-30'),
    });
    expect(editedValues('start', -DAY_MINUTES, start, end, 'begins', 'ends', DENVER)).toEqual({
      begins: days('2026-10-26'),
    });
    expect(editedValues('end', DAY_MINUTES, start, null, 'begins', 'ends', DENVER)).toEqual({
      ends: days('2026-10-28'),
    });
    expect(editedValues('move', 0, start, end, 'begins', 'ends', DENVER)).toEqual({});
  });

  it('moves times by minutes on the clock, across the end of daylight saving', () => {
    const visit = timed('2026-10-30T21:30:00.000Z', '2026-10-30T22:30:00.000Z');
    expect(editedValues('move', 15, visit, null, 'due', null, DENVER)).toEqual({
      due: timed('2026-10-30T21:45:00.000Z', '2026-10-30T22:45:00.000Z'),
    });
    expect(shiftValue(visit, 3 * DAY_MINUTES, DENVER)).toEqual(
      timed('2026-11-02T22:30:00.000Z', '2026-11-02T23:30:00.000Z'),
    );
    expect(shiftValue(days('2026-10-27'), 15, DENVER)).toEqual(days('2026-10-27'));
  });
});

describe('text', () => {
  it('names the scales and says what happened', () => {
    expect(Object.values(SCALE_LABELS)).toEqual([
      'Hours',
      'Day',
      'Week',
      'Bi-week',
      'Month',
      'Quarter',
      'Year',
    ]);
    expect(TIMELINE_TEXT.moved('Repipe the house', whenLabel('2026-10-29', null, true))).toBe(
      "Moved 'Repipe the house' to Oct 29, 2026",
    );
    expect(whenLabel('2026-10-29', { hour: 15, minute: 30 }, true)).toBe('Oct 29, 2026 3:30 PM');
    expect(TIMELINE_TEXT.place('Unclog bathroom drain')).toBe(
      'Place Unclog bathroom drain on the timeline',
    );
  });
});

describe('more time and changes', () => {
  it('adds days before and after, still from a week start', () => {
    const window = timeWindow([], '2026-10-28', 'week', 0);
    const more = extendWindow(window, 10, 5, 0);
    expect(window.start).toBe('2026-10-11');
    expect(more.start).toBe('2026-09-27');
    expect(more.days).toBe(window.days + 14 + 5);
    expect(extendWindow(window, 0, 0, 0)).toBe(window);
  });

  it('shows a change as it will be saved: the move, then the end', () => {
    const bar: Bar = { id: 'r', start: dayMinutes('2026-10-27'), end: dayMinutes('2026-10-30') };
    const change = { ...NO_CHANGE, move: DAY_MINUTES, end: DAY_MINUTES };
    expect(changedBar(bar, change, DAY_MINUTES)).toEqual({
      id: 'r',
      start: dayMinutes('2026-10-28'),
      end: dayMinutes('2026-11-01'),
    });
    expect(
      changedValues(change, days('2026-10-27', '2026-10-29'), null, 'due', null, DENVER),
    ).toEqual({ due: days('2026-10-28', '2026-10-31') });
    // An end pulled past the start stops a day after it.
    expect(changedBar(bar, { ...NO_CHANGE, end: -5 * DAY_MINUTES }, DAY_MINUTES).end).toBe(
      dayMinutes('2026-10-28'),
    );
    expect(changedValues(NO_CHANGE, days('2026-10-27'), null, 'due', null, DENVER)).toEqual({});
  });
});

const row = (id: string): QueryRow => ({
  id,
  title: id,
  icon: null,
  formId: null,
  values: {},
  computed: {},
  hiddenLinks: {},
  color: { row: null, cells: {} },
  createdAt: null,
  createdBy: null,
  editedAt: null,
  editedBy: null,
  uniqueNumber: null,
});
const group = (key: string, rows: QueryRow[], extra: Partial<QueryGroup> = {}): QueryGroup => ({
  key,
  label: key,
  hidden: false,
  collapsedKey: `status:${key}`,
  count: rows.length,
  totals: {},
  rows,
  nextCursor: null,
  ...extra,
});

describe('timelineLines', () => {
  const bars = new Map<string, Bar>([['a', { id: 'a', start: 0, end: DAY_MINUTES }]]);

  it('lists dated rows, then "No date" and the rows without, then Load more', () => {
    const lines = timelineLines([row('b'), row('a')], null, bars, new Set(), true);
    expect(lines.map((l) => l.key)).toEqual(['row:a', 'no-date', 'row:b', 'more']);
  });

  it('lists each shown group with its rows, none while collapsed', () => {
    const groups = [
      group('todo', [row('a'), row('b')], { nextCursor: 'next' }),
      group('done', [row('c')]),
      group('hidden', [row('d')], { hidden: true }),
    ];
    const lines = timelineLines([], groups, bars, new Set(['status:done']), false);
    expect(lines.map((l) => l.key)).toEqual([
      'group:todo',
      'row:a',
      'row:b',
      'more:todo',
      'group:done',
    ]);
    expect(lines[4]).toMatchObject({ kind: 'group', collapsed: true });
  });
});

describe('arrowPath', () => {
  it('turns in front of a bar that starts later', () => {
    expect(arrowPath({ left: 0, right: 100, y: 18 }, { left: 160, right: 200, y: 54 }, 18)).toEqual(
      {
        line: 'M 100 18 H 108 V 54 H 160',
        head: 'M 160 54 L 156 50 L 156 58 Z',
      },
    );
  });

  it('goes round between the lines when the blocked bar starts too soon', () => {
    expect(
      arrowPath({ left: 0, right: 100, y: 18 }, { left: 90, right: 200, y: 54 }, 18).line,
    ).toBe('M 100 18 H 108 V 36 H 82 V 54 H 90');
  });
});

describe('pointLabel', () => {
  it('reads a day, or a time in its zone', () => {
    expect(pointLabel('2026-10-30', false, DENVER, true)).toBe('Oct 30, 2026');
    expect(pointLabel('2026-10-28T03:30:00.000Z', true, DENVER, true)).toBe('Oct 27, 2026 9:30 PM');
  });
});
