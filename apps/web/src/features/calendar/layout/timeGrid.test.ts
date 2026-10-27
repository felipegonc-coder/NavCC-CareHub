import { describe, expect, it } from 'vitest';
import { viewRange } from './period';
import { hourAxis, initialScrollMinutes, layoutTimeGrid, nowPosition } from './timeGrid';
import type { TimedPlacement } from './timeGrid';
import type { CalendarItem } from './types';

const timed = (id: string, start: string, end?: string): CalendarItem => ({
  id,
  allDay: false,
  start,
  end,
});
const oneDay = ['2026-10-27'];
const at = (time: string) => `2026-10-27T${time}`;
const layoutDay = (items: CalendarItem[], minHeight?: number) =>
  layoutTimeGrid(items, oneDay, { minHeight })[0] ?? [];
const byId = (placements: TimedPlacement[]) =>
  Object.fromEntries(placements.map((p) => [p.item.id, p]));

/** Viewer's wall clock for an instant, the way the screens convert before calling the layout. */
function civil(instant: string, timeZone = 'America/Denver'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** A small seeded random generator, so the dense test is the same every run. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe('layoutTimeGrid: overlapping events', () => {
  it('gives a lone event the whole column', () => {
    expect(layoutDay([timed('standup', at('09:00'), at('09:30'))])).toMatchObject([
      { key: 'standup@2026-10-27', top: 540, height: 30, left: 0, width: 1, columns: 1 },
    ]);
  });

  it('keeps back-to-back events full width', () => {
    const placed = layoutDay([
      timed('a', at('09:00'), at('10:00')),
      timed('b', at('10:00'), at('11:00')),
    ]);
    expect(placed.map((p) => [p.item.id, p.width, p.columns])).toEqual([
      ['a', 1, 1],
      ['b', 1, 1],
    ]);
  });

  it('puts eight events at the same time side by side, in order', () => {
    const items = Array.from({ length: 8 }, (_, i) => timed(`qa-${i}`, at('09:00'), at('10:00')));
    const placed = layoutDay(items);
    expect(placed.map((p) => p.item.id)).toEqual(items.map((item) => item.id));
    placed.forEach((p, i) => {
      expect(p.columns).toBe(8);
      expect(p.left).toBeCloseTo(i / 8, 6);
      expect(p.width).toBeCloseTo(1 / 8, 6);
    });
  });

  it('puts the longer event first and reuses freed columns', () => {
    const placed = byId(
      layoutDay([
        timed('short', at('09:00'), at('10:00')),
        timed('long', at('09:00'), at('12:00')),
        timed('later', at('10:00'), at('11:00')),
      ]),
    );
    expect(placed.long).toMatchObject({ column: 0, columns: 2, left: 0, width: 0.5 });
    expect(placed.short).toMatchObject({ column: 1, left: 0.5, width: 0.5 });
    expect(placed.later).toMatchObject({ column: 1, left: 0.5, width: 0.5 });
  });

  it('widens an event into free columns to its right', () => {
    const placed = byId(
      layoutDay([
        timed('coaching', at('09:00'), at('12:00')),
        timed('call-1', at('09:00'), at('10:00')),
        timed('call-2', at('09:00'), at('10:00')),
        timed('review', at('10:30'), at('11:00')),
      ]),
    );
    expect(placed.review?.column).toBe(1);
    expect(placed.review?.left).toBeCloseTo(1 / 3, 6);
    expect(placed.review?.width).toBeCloseTo(2 / 3, 6);
    expect(placed.coaching?.width).toBeCloseTo(1 / 3, 6);
  });

  it('does not widen past a column that is busy at the same time', () => {
    const placed = byId(
      layoutDay([
        timed('a', at('09:00'), at('10:00')),
        timed('b', at('09:30'), at('10:30')),
        timed('c', at('10:00'), at('11:00')),
      ]),
    );
    expect(placed.c).toMatchObject({ column: 0, columns: 2, width: 0.5 });
  });

  it('treats separate groups separately', () => {
    const placed = byId(
      layoutDay([
        timed('a', at('09:00'), at('10:00')),
        timed('b', at('09:00'), at('10:00')),
        timed('lunch', at('12:00'), at('13:00')),
      ]),
    );
    expect(placed.a?.columns).toBe(2);
    expect(placed.lunch).toMatchObject({ columns: 1, width: 1 });
  });

  it('never overlaps two blocks, and widens each as far as it can (dense random days)', () => {
    const next = random(42);
    const items = Array.from({ length: 160 }, (_, i) => {
      const start = Math.floor(next() * 96) * 15;
      const length = [0, 5, 15, 30, 45, 60, 90, 180][Math.floor(next() * 8)] ?? 30;
      const end = Math.min(start + length, 1440);
      const clock = (m: number) =>
        `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      return timed(`e${i}`, at(clock(start)), end >= 1440 ? '2026-10-28T00:00' : at(clock(end)));
    });
    const placed = layoutDay(items);
    expect(placed).toHaveLength(160);
    const overlaps = (a: TimedPlacement, b: TimedPlacement) =>
      a.top < b.top + b.height && b.top < a.top + a.height;
    for (const a of placed) {
      expect(a.left).toBeGreaterThanOrEqual(0);
      expect(a.left + a.width).toBeLessThanOrEqual(1 + 1e-9);
      expect(a.top + a.height).toBeLessThanOrEqual(1440);
      for (const b of placed) {
        if (a === b || !overlaps(a, b)) continue;
        expect(a.left + a.width <= b.left + 1e-9 || b.left + b.width <= a.left + 1e-9).toBe(true);
      }
      const nextColumn = Math.round((a.left + a.width) * a.columns);
      if (nextColumn < a.columns) {
        const blocker = placed.some(
          (b) => b.column === nextColumn && b.columns === a.columns && overlaps(a, b),
        );
        expect(blocker).toBe(true);
      }
    }
  });
});

describe('layoutTimeGrid: short events', () => {
  it('draws short and open-ended events at least 15 minutes tall', () => {
    const placed = byId(
      layoutDay([timed('reminder', at('08:00')), timed('ping', at('11:00'), at('11:05'))]),
    );
    expect(placed.reminder).toMatchObject({ top: 480, height: 15 });
    expect(placed.ping).toMatchObject({ top: 660, height: 15 });
  });

  it('puts short events side by side when their drawn blocks would touch', () => {
    const placed = byId(
      layoutDay([timed('a', at('10:00'), at('10:05')), timed('b', at('10:10'), at('10:15'))]),
    );
    expect(placed.a).toMatchObject({ column: 0, width: 0.5 });
    expect(placed.b).toMatchObject({ column: 1, width: 0.5 });
  });

  it('keeps a short event at the end of the day inside the column', () => {
    expect(layoutDay([timed('late', at('23:55'), '2026-10-28T00:00')])).toMatchObject([
      { top: 1425, height: 15, end: '2026-10-28T00:00', continuesAfter: false },
    ]);
  });

  it('takes a custom minimum height', () => {
    expect(layoutDay([timed('ping', at('11:00'), at('11:05'))], 30)[0]?.height).toBe(30);
  });
});

describe('layoutTimeGrid: midnight and multi-day', () => {
  const days = ['2026-10-26', '2026-10-27', '2026-10-28'];

  it('splits an event crossing midnight into one block per day', () => {
    const [mon, tue] = layoutTimeGrid(
      [timed('night', '2026-10-26T22:00', '2026-10-27T02:00')],
      days,
    );
    expect(mon).toMatchObject([
      {
        key: 'night@2026-10-26',
        start: '2026-10-26T22:00',
        end: '2026-10-27T00:00',
        top: 1320,
        height: 120,
        continuesBefore: false,
        continuesAfter: true,
      },
    ]);
    expect(tue).toMatchObject([
      {
        key: 'night@2026-10-27',
        start: '2026-10-27T00:00',
        end: '2026-10-27T02:00',
        top: 0,
        height: 120,
        continuesBefore: true,
        continuesAfter: false,
      },
    ]);
  });

  it('fills whole days in the middle of a long event', () => {
    const grid = layoutTimeGrid([timed('offsite', '2026-10-26T10:00', '2026-10-28T14:00')], days);
    expect(grid.map((day) => day.map((p) => [p.top, p.height]))).toEqual([
      [[600, 840]],
      [[0, 1440]],
      [[0, 840]],
    ]);
  });

  it('stops an event that ends at midnight on its own day', () => {
    const grid = layoutTimeGrid([timed('close', '2026-10-26T23:00', '2026-10-27T00:00')], days);
    expect(grid.map((day) => day.length)).toEqual([1, 0, 0]);
  });

  it('ignores all-day items and items outside the days shown', () => {
    const grid = layoutTimeGrid(
      [
        { id: 'holiday', allDay: true, start: '2026-10-27' },
        timed('before', '2026-10-25T09:00', '2026-10-25T10:00'),
        timed('after', '2026-10-29T09:00', '2026-10-29T10:00'),
      ],
      days,
    );
    expect(grid.flat()).toEqual([]);
  });
});

describe('layoutTimeGrid: clock changes (America/Denver)', () => {
  it('draws the 23-hour day on the wall clock', () => {
    // 1:30 AM MST to 3:30 AM MDT is one real hour but two hours on the wall clock.
    const start = civil('2026-03-08T08:30:00Z');
    const end = civil('2026-03-08T09:30:00Z');
    expect([start, end]).toEqual(['2026-03-08T01:30', '2026-03-08T03:30']);
    const [day] = layoutTimeGrid(
      [timed('shift', start, end), timed('whole', '2026-03-08T00:00', '2026-03-09T00:00')],
      ['2026-03-08'],
    );
    expect(byId(day ?? []).shift).toMatchObject({ top: 90, height: 120 });
    expect(byId(day ?? []).whole).toMatchObject({ top: 0, height: 1440 });
  });

  it('draws the 25-hour day on the wall clock', () => {
    // 1:15 AM happens twice; both events land on the same wall-clock slot, side by side.
    const first = timed('mdt', civil('2026-11-01T07:15:00Z'), civil('2026-11-01T07:45:00Z'));
    const second = timed('mst', civil('2026-11-01T08:15:00Z'), civil('2026-11-01T08:45:00Z'));
    expect([first.start, second.start]).toEqual(['2026-11-01T01:15', '2026-11-01T01:15']);
    // 1:45 AM MDT to 1:15 AM MST: 30 real minutes, backwards on the wall clock.
    const backwards = timed(
      'backwards',
      civil('2026-11-01T07:45:00Z'),
      civil('2026-11-01T08:15:00Z'),
    );
    // 1:30 AM MDT to 1:30 AM MST: an hour that is zero minutes on the wall clock.
    const zero = timed('zero', civil('2026-11-01T07:30:00Z'), civil('2026-11-01T08:30:00Z'));
    const whole = timed('whole', '2026-11-01T00:00', '2026-11-02T00:00');
    const placed = byId(
      layoutTimeGrid([first, second, backwards, zero, whole], ['2026-11-01'])[0] ?? [],
    );
    expect(placed.whole).toMatchObject({ top: 0, height: 1440 });
    expect(placed.mdt).toMatchObject({ top: 75, height: 30 });
    expect(placed.mst).toMatchObject({ top: 75, height: 30 });
    expect(placed.mdt?.column).not.toBe(placed.mst?.column);
    expect(placed.backwards).toMatchObject({ top: 105, height: 15, end: '2026-11-01T01:45' });
    expect(placed.zero).toMatchObject({ top: 90, height: 15 });
  });

  it('lays out the whole clock-change week', () => {
    const { days } = viewRange('week', '2026-11-04', { weekStart: 0, hideWeekends: false });
    expect(days).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
    ]);
    const lastWeek = timed('qa-calibration', '2026-10-31T10:00', '2026-10-31T11:00');
    const weekly = days.map((date, i) => timed(`standup-${i}`, `${date}T09:00`, `${date}T09:15`));
    const grid = layoutTimeGrid([lastWeek, ...weekly], days);
    expect(grid.map((day) => day.map((p) => [p.top, p.height]))).toEqual(
      days.map(() => [[540, 15]]),
    );
  });
});

describe('layoutTimeGrid: hidden weekends and phone days', () => {
  it('drops weekend days and keeps the weekday parts of events that cross into them', () => {
    const { days } = viewRange('week', '2026-10-28', { weekStart: 0, hideWeekends: true });
    expect(days).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    const grid = layoutTimeGrid(
      [
        timed('saturday', '2026-10-31T10:00', '2026-10-31T11:00'),
        timed('sunday-night', '2026-10-25T23:00', '2026-10-26T01:00'),
        timed('friday-night', '2026-10-30T22:00', '2026-10-31T02:00'),
      ],
      days,
    );
    expect(grid.map((day) => day.map((p) => p.key))).toEqual([
      ['sunday-night@2026-10-26'],
      [],
      [],
      [],
      ['friday-night@2026-10-30'],
    ]);
    expect(grid[0]?.[0]).toMatchObject({ top: 0, height: 60, continuesBefore: true });
    expect(grid[4]?.[0]).toMatchObject({ top: 1320, height: 120, continuesAfter: true });
  });

  it('lays out the 3 phone days', () => {
    const { days } = viewRange('week', '2026-10-30', {
      weekStart: 0,
      hideWeekends: true,
      phone: true,
    });
    const grid = layoutTimeGrid([timed('standup', '2026-11-02T09:00', '2026-11-02T09:15')], days);
    expect(days).toEqual(['2026-10-30', '2026-11-02', '2026-11-03']);
    expect(grid.map((day) => day.length)).toEqual([0, 1, 0]);
    expect(grid[1]?.[0]?.dayIndex).toBe(1);
  });
});

describe('hour axis, now line and opening scroll', () => {
  it('labels 24 hours with the injected formatter', () => {
    const marks = hourAxis((time, hour) => (hour === 0 ? '' : `${time}!`));
    expect(marks).toHaveLength(24);
    expect(marks[0]).toEqual({ hour: 0, minute: 0, time: '00:00', label: '' });
    expect(marks[13]).toEqual({ hour: 13, minute: 780, time: '13:00', label: '13:00!' });
  });

  it('places the now line on today only', () => {
    const days = ['2026-10-26', '2026-10-27'];
    expect(nowPosition('2026-10-27T16:40', days)).toEqual({ dayIndex: 1, minute: 1000 });
    expect(nowPosition('2026-10-28T16:40', days)).toBeNull();
  });

  it('opens at 7:00 AM, or an hour above the now line when later and today is shown', () => {
    const days = ['2026-10-26', '2026-10-27'];
    expect(initialScrollMinutes('2026-10-27T06:10', days)).toBe(420);
    expect(initialScrollMinutes('2026-10-27T07:00', days)).toBe(420);
    expect(initialScrollMinutes('2026-10-27T07:30', days)).toBe(390);
    expect(initialScrollMinutes('2026-10-27T16:40', days)).toBe(940);
    expect(initialScrollMinutes('2026-10-27T23:59', days)).toBe(1379);
    expect(initialScrollMinutes('2026-11-03T16:40', days)).toBe(420);
  });
});
