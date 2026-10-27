import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import {
  LOOP_MESSAGE,
  SHIFT_LIMIT_MESSAGE,
  checkDependencyEdits,
  dependencyArrows,
  planDependencyShift,
} from './dependencies';
import type { DateMove, DependencyDates, DependencySettings } from './dependencies';
import { LOOP_MESSAGE as SUB_ITEM_LOOP_MESSAGE } from './hierarchy';
import { LIMITS } from './types';
import type { DateValue, Row } from './types';

const settings: DependencySettings = {
  blockedByPropertyId: 'blockedBy',
  blockingPropertyId: 'blocking',
  shift: 'shift',
};
const dontShift: DependencySettings = { ...settings, shift: 'none' };
const dates: DependencyDates = {
  startPropertyId: 'when',
  endPropertyId: null,
  timeZone: 'America/Denver',
};
const range: DependencyDates = { ...dates, startPropertyId: 'start', endPropertyId: 'due' };

/** A date without a time, from `start` to `end` (one day when there's no end). */
function days(start: string, end: string | null = null): DateValue {
  return { start, end, hasTime: false };
}

/** A date with a time. */
function at(start: string, end: string | null = null): DateValue {
  return { start, end, hasTime: true };
}

function task(id: string, values: Row['values'] = {}): Row {
  return {
    id,
    title: id,
    values,
    createdAt: '2026-10-01T15:00:00.000Z',
    createdBy: 'u-jordan',
    editedAt: '2026-10-01T15:00:00.000Z',
    editedBy: 'u-jordan',
    uniqueNumber: null,
  };
}

const none = { changes: [], message: null };
const change = (rowId: string, value: DateValue, propertyId = 'when') => ({
  rowId,
  propertyId,
  value,
});
const moveA = (when: DateValue | null): DateMove => ({ rowId: 'a', values: { when } });

describe('messages', () => {
  it('uses the same loop message as sub-items', () => {
    expect(LOOP_MESSAGE).toBe('This would make a loop.');
    expect(LOOP_MESSAGE).toBe(SUB_ITEM_LOOP_MESSAGE);
  });
  it('says how many rows can shift at once', () => {
    expect(LIMITS.dependencyShiftRows).toBe(500);
    expect(SHIFT_LIMIT_MESSAGE).toBe(
      "Only 500 rows can shift at once, so some blocked rows didn't move.",
    );
  });
});

describe('dependencyArrows', () => {
  it('reads both relations and draws one arrow per pair, in row order', () => {
    const rows = [
      task('a', { blocking: ['b'] }),
      task('b', { blockedBy: ['a'] }),
      task('c', { blockedBy: ['a', 'b'] }),
      task('a', { blocking: ['c'] }),
    ];
    expect(dependencyArrows(rows, settings, dates)).toEqual([
      { fromId: 'a', toId: 'b', conflict: false },
      { fromId: 'a', toId: 'c', conflict: false },
      { fromId: 'b', toId: 'c', conflict: false },
    ]);
  });
  it('leaves out links to the row itself, to rows not given, and blank ids', () => {
    const rows = [
      task('a', { blocking: ['a', 'gone', ''] }),
      task('b', { blockedBy: ['b', 'gone'] }),
    ];
    expect(dependencyArrows(rows, settings, dates)).toEqual([]);
  });
  it('turns an arrow red when the blocked row starts before the blocking row ends', () => {
    const conflict = (blocked: DateValue) =>
      dependencyArrows(
        [
          task('a', { when: days('2026-10-01', '2026-10-03'), blocking: ['b'] }),
          task('b', { when: blocked }),
        ],
        settings,
        dates,
      )[0]?.conflict;
    expect(conflict(days('2026-10-03', '2026-10-05'))).toBe(true);
    expect(conflict(days('2026-10-02'))).toBe(true);
    expect(conflict(days('2026-09-28'))).toBe(true);
    expect(conflict(days('2026-10-04', '2026-10-06'))).toBe(false);
    expect(conflict(days('2026-10-09'))).toBe(false);
  });
  it('compares dates with a time to the minute', () => {
    const conflict = (blocking: DateValue, blocked: DateValue) =>
      dependencyArrows(
        [task('a', { when: blocking, blocking: ['b'] }), task('b', { when: blocked })],
        settings,
        dates,
      )[0]?.conflict;
    const meeting = at('2026-10-01T15:00:00.000Z', '2026-10-01T17:00:00.000Z');
    expect(conflict(meeting, at('2026-10-01T16:59:00.000Z'))).toBe(true);
    expect(conflict(meeting, at('2026-10-01T17:00:00.000Z', '2026-10-01T18:00:00.000Z'))).toBe(
      false,
    );
    expect(conflict(at('2026-10-01T15:00:00.000Z'), at('2026-10-01T15:00:00.000Z'))).toBe(false);
    expect(conflict(at('2026-10-01T15:00:00.000Z'), at('2026-10-01T14:59:00.000Z'))).toBe(true);
  });
  it("places dates without a time in the viewer's time zone", () => {
    const rows = [
      task('a', {
        when: at('2026-10-02T20:00:00.000Z', '2026-10-03T05:00:00.000Z'),
        blocking: ['b'],
      }),
      task('b', { when: days('2026-10-03') }),
    ];
    // In Denver (UTC-6 in October) Oct 3 starts at 06:00 UTC, after A ends at 05:00 UTC.
    expect(dependencyArrows(rows, settings, dates)[0]?.conflict).toBe(false);
    expect(dependencyArrows(rows, settings, { ...dates, timeZone: 'UTC' })[0]?.conflict).toBe(true);
    expect(
      dependencyArrows(rows, settings, { ...dates, timeZone: 'Not/A_Zone' })[0]?.conflict,
    ).toBe(false);
    const dayFirst = [
      task('a', { when: days('2026-10-01', '2026-10-03'), blocking: ['b', 'c'] }),
      task('b', { when: at('2026-10-04T05:59:00.000Z') }),
      task('c', { when: at('2026-10-04T06:00:00.000Z') }),
    ];
    expect(dependencyArrows(dayFirst, settings, dates).map((x) => x.conflict)).toEqual([
      true,
      false,
    ]);
  });
  it('reads the end from a separate end property when the timeline has one', () => {
    const conflict = (blocking: Row['values']) =>
      dependencyArrows(
        [task('a', { ...blocking, blocking: ['b'] }), task('b', { start: days('2026-10-04') })],
        settings,
        range,
      )[0]?.conflict;
    expect(conflict({ start: days('2026-10-01'), due: days('2026-10-05') })).toBe(true);
    expect(conflict({ start: days('2026-10-01'), due: days('2026-10-03') })).toBe(false);
    expect(conflict({ start: days('2026-10-01', '2026-10-04') })).toBe(true);
    expect(conflict({ start: days('2026-10-01'), due: days('2026-10-02', '2026-10-06') })).toBe(
      true,
    );
  });
  it('never turns an arrow red when a row has no date', () => {
    const rows = [
      task('a', { when: days('2026-10-05'), blocking: ['b', 'c'] }),
      task('b', { when: 'soon' }),
      task('c'),
      task('d', { blocking: ['a'] }),
    ];
    expect(dependencyArrows(rows, settings, dates).map((x) => x.conflict)).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('checkDependencyEdits', () => {
  // a blocks b (kept on a's Blocking side); b blocks c (kept on c's Blocked by side); d is free.
  const rows = [
    task('a', { blocking: ['b'] }),
    task('b'),
    task('c', { blockedBy: ['b'] }),
    task('d'),
  ];
  const blocking = (rowId: string, value: string[] | null) => ({
    rowId,
    propertyId: 'blocking',
    value,
  });
  const blockedBy = (rowId: string, value: string[] | null) => ({
    rowId,
    propertyId: 'blockedBy',
    value,
  });

  it('refuses a row blocking itself', () => {
    expect(checkDependencyEdits(rows, settings, [blocking('d', ['d'])])).toBe(LOOP_MESSAGE);
    expect(checkDependencyEdits(rows, settings, [blockedBy('d', ['d'])])).toBe(LOOP_MESSAGE);
  });
  it('refuses loops through other rows, read from either side', () => {
    expect(checkDependencyEdits(rows, settings, [blocking('b', ['a'])])).toBe(LOOP_MESSAGE);
    expect(checkDependencyEdits(rows, settings, [blockedBy('a', ['b'])])).toBe(LOOP_MESSAGE);
    expect(checkDependencyEdits(rows, settings, [blocking('c', ['a'])])).toBe(LOOP_MESSAGE);
    expect(checkDependencyEdits(rows, settings, [blockedBy('a', ['d', 'c'])])).toBe(LOOP_MESSAGE);
    expect(checkDependencyEdits(rows, dontShift, [blocking('c', ['a'])])).toBe(LOOP_MESSAGE);
  });
  it('allows links that keep an order', () => {
    expect(checkDependencyEdits(rows, settings, [blocking('a', ['b', 'c', 'd'])])).toBeNull();
    expect(checkDependencyEdits(rows, settings, [blockedBy('d', ['a', 'c'])])).toBeNull();
    expect(checkDependencyEdits(rows, settings, [blocking('d', ['a'])])).toBeNull();
    expect(checkDependencyEdits(rows, settings, [blocking('a', null)])).toBeNull();
    expect(checkDependencyEdits(rows, settings, [])).toBeNull();
  });
  it('replaces the links on the side that is edited', () => {
    expect(
      checkDependencyEdits(rows, settings, [blockedBy('b', ['d']), blocking('c', ['a'])]),
    ).toBeNull();
    expect(
      checkDependencyEdits(rows, settings, [blocking('b', ['d']), blocking('c', ['a'])]),
    ).toBeNull();
    expect(checkDependencyEdits(rows, settings, [blocking('b', ['d']), blocking('d', ['a'])])).toBe(
      LOOP_MESSAGE,
    );
  });
  it('checks edits saved together as one change', () => {
    expect(checkDependencyEdits(rows, settings, [blocking('d', ['a'])])).toBeNull();
    expect(checkDependencyEdits(rows, settings, [blocking('c', ['d'])])).toBeNull();
    expect(checkDependencyEdits(rows, settings, [blocking('d', ['a']), blocking('c', ['d'])])).toBe(
      LOOP_MESSAGE,
    );
    expect(
      checkDependencyEdits(rows, settings, [blocking('a', []), blocking('b', ['a'])]),
    ).toBeNull();
    expect(
      checkDependencyEdits(rows, settings, [blocking('b', ['a']), blocking('b', [])]),
    ).toBeNull();
    expect(checkDependencyEdits(rows, settings, [blocking('b', []), blocking('b', ['a'])])).toBe(
      LOOP_MESSAGE,
    );
  });
  it('ignores edits to other properties and blank ids', () => {
    expect(
      checkDependencyEdits(rows, settings, [{ rowId: 'b', propertyId: 'notes', value: ['a'] }]),
    ).toBeNull();
    expect(checkDependencyEdits(rows, settings, [blocking('b', ['', 'd'])])).toBeNull();
  });
});

describe('planDependencyShift', () => {
  const pair = (blocked: DateValue): Row[] => [
    task('a', { when: days('2026-10-01', '2026-10-03'), blocking: ['b'] }),
    task('b', { when: blocked }),
  ];

  it('moves a blocked row 2 days when the blocking row moves 2 days later (DB-37)', () => {
    const rows = pair(days('2026-10-04', '2026-10-06'));
    expect(
      planDependencyShift(rows, settings, dates, moveA(days('2026-10-03', '2026-10-05'))),
    ).toEqual({
      changes: [change('b', days('2026-10-06', '2026-10-08'))],
      message: null,
    });
  });
  it("leaves blocked rows where they are with Don't shift, and the arrow turns red (DB-37)", () => {
    const rows = pair(days('2026-10-04', '2026-10-06'));
    expect(
      planDependencyShift(rows, dontShift, dates, moveA(days('2026-10-03', '2026-10-05'))),
    ).toEqual(none);
    const after = [
      task('a', { when: days('2026-10-03', '2026-10-05'), blocking: ['b'] }),
      ...rows.slice(1),
    ];
    expect(dependencyArrows(after, dontShift, dates)).toEqual([
      { fromId: 'a', toId: 'b', conflict: true },
    ]);
  });
  it('keeps the gap before a blocked row it now overlaps', () => {
    const rows = pair(days('2026-10-05', '2026-10-06'));
    expect(
      planDependencyShift(rows, settings, dates, moveA(days('2026-10-01', '2026-10-06'))),
    ).toEqual({
      changes: [change('b', days('2026-10-08', '2026-10-09'))],
      message: null,
    });
  });
  it("leaves rows that still start after the blocking row's new end", () => {
    const later = moveA(days('2026-10-03', '2026-10-05'));
    expect(
      planDependencyShift(pair(days('2026-10-10', '2026-10-12')), settings, dates, later),
    ).toEqual(none);
    expect(planDependencyShift(pair(days('2026-10-06')), settings, dates, later)).toEqual(none);
  });
  it('shifts nothing when the blocking row ends at the same time or earlier', () => {
    const rows = pair(days('2026-10-03', '2026-10-05'));
    expect(
      planDependencyShift(rows, settings, dates, moveA(days('2026-10-01', '2026-10-03'))),
    ).toEqual(none);
    expect(
      planDependencyShift(rows, settings, dates, moveA(days('2026-10-02', '2026-10-03'))),
    ).toEqual(none);
    expect(
      planDependencyShift(rows, settings, dates, moveA(days('2026-09-29', '2026-10-01'))),
    ).toEqual(none);
  });
  it('moves a row whose end moves later even when its start stays', () => {
    const rows = pair(days('2026-10-04', '2026-10-06'));
    expect(
      planDependencyShift(rows, settings, dates, moveA(days('2026-10-01', '2026-10-04'))),
    ).toEqual({
      changes: [change('b', days('2026-10-05', '2026-10-07'))],
      message: null,
    });
  });
  it('shifts down the chain, each row once, after every row blocking it', () => {
    const rows = [
      task('a', { when: days('2026-10-01', '2026-10-03'), blocking: ['b', 'c'] }),
      task('b', { when: days('2026-10-04', '2026-10-05') }),
      task('c', { when: days('2026-10-04') }),
      task('d', { when: days('2026-10-06', '2026-10-07'), blockedBy: ['b', 'c'] }),
    ];
    expect(
      planDependencyShift(rows, settings, dates, moveA(days('2026-10-03', '2026-10-05'))),
    ).toEqual({
      changes: [
        change('b', days('2026-10-06', '2026-10-07')),
        change('c', days('2026-10-06')),
        change('d', days('2026-10-08', '2026-10-09')),
      ],
      message: null,
    });
  });
  it('stops down the chain where a gap takes up the move', () => {
    const rows = [
      task('a', { when: days('2026-10-01', '2026-10-03'), blocking: ['b'] }),
      task('b', { when: days('2026-10-04', '2026-10-06'), blocking: ['c'] }),
      task('c', { when: days('2026-10-20') }),
    ];
    expect(
      planDependencyShift(rows, settings, dates, moveA(days('2026-10-03', '2026-10-05'))),
    ).toEqual({
      changes: [change('b', days('2026-10-06', '2026-10-08'))],
      message: null,
    });
  });
  it('moves dates with a time by exact minutes', () => {
    const rows = [
      task('a', {
        when: at('2026-10-01T15:00:00.000Z', '2026-10-01T17:00:00.000Z'),
        blocking: ['b', 'c'],
      }),
      task('b', { when: at('2026-10-01T17:00:00.000Z', '2026-10-01T18:00:00.000Z') }),
      task('c', { when: at('2026-10-01T17:10:00.000Z') }),
    ];
    const move = moveA(at('2026-10-01T15:30:00.000Z', '2026-10-01T17:30:00.000Z'));
    expect(planDependencyShift(rows, settings, dates, move)).toEqual({
      changes: [
        change('b', at('2026-10-01T17:30:00.000Z', '2026-10-01T18:30:00.000Z')),
        change('c', at('2026-10-01T17:40:00.000Z')),
      ],
      message: null,
    });
  });
  it('rounds up to whole days for dates without a time, and takes the largest amount', () => {
    // A moves 90 minutes. B (no time) moves a whole day. C overlaps both, so it moves a day too.
    const rows = [
      task('a', {
        when: at('2026-10-02T02:00:00.000Z', '2026-10-02T05:00:00.000Z'),
        blocking: ['b', 'c'],
      }),
      task('b', { when: days('2026-10-02'), blocking: ['c'] }),
      task('c', { when: at('2026-10-02T06:15:00.000Z', '2026-10-02T06:45:00.000Z') }),
    ];
    const move = moveA(at('2026-10-02T03:30:00.000Z', '2026-10-02T06:30:00.000Z'));
    expect(planDependencyShift(rows, settings, dates, move)).toEqual({
      changes: [
        change('b', days('2026-10-03')),
        change('c', at('2026-10-03T06:15:00.000Z', '2026-10-03T06:45:00.000Z')),
      ],
      message: null,
    });
  });
  it('moves a row by whole days in minutes when its blocking row has no time', () => {
    const rows = pair(at('2026-10-04T05:00:00.000Z', '2026-10-04T07:00:00.000Z'));
    expect(
      planDependencyShift(rows, settings, dates, moveA(days('2026-10-01', '2026-10-04'))),
    ).toEqual({
      changes: [change('b', at('2026-10-05T05:00:00.000Z', '2026-10-05T07:00:00.000Z'))],
      message: null,
    });
  });
  it('moves both the start and the end property of a row', () => {
    const rows = [
      task('a', { start: days('2026-10-01'), due: days('2026-10-03'), blocking: ['b'] }),
      task('b', { start: days('2026-10-04'), due: days('2026-10-06') }),
      task('c', { start: days('2026-10-05'), blockedBy: ['a'] }),
    ];
    const move: DateMove = { rowId: 'a', values: { due: days('2026-10-05'), start: undefined } };
    expect(planDependencyShift(rows, settings, range, move)).toEqual({
      changes: [
        change('b', days('2026-10-06'), 'start'),
        change('b', days('2026-10-08'), 'due'),
        change('c', days('2026-10-07'), 'start'),
      ],
      message: null,
    });
  });
  it("doesn't shift rows that aren't given or have no date, or pass through them", () => {
    const rows = [
      task('a', { when: days('2026-10-01', '2026-10-03'), blocking: ['gone', 'b', 'd'] }),
      task('b', { blocking: ['c'] }),
      task('c', { when: days('2026-10-04'), blockedBy: ['gone'] }),
      task('d', { when: days('2026-10-04') }),
    ];
    expect(
      planDependencyShift(rows, settings, dates, moveA(days('2026-10-03', '2026-10-05'))),
    ).toEqual({
      changes: [change('d', days('2026-10-06'))],
      message: null,
    });
  });
  it('keeps the rest of a shifted date, like its time zone and reminder', () => {
    const timed: DateValue = {
      start: '2026-10-01T17:00:00.000Z',
      end: null,
      hasTime: true,
      timeZone: 'America/Chicago',
      reminder: { minutesBefore: 15 },
    };
    const rows = [
      task('a', {
        when: at('2026-10-01T15:00:00.000Z', '2026-10-01T17:00:00.000Z'),
        blocking: ['b', 'c'],
      }),
      task('b', { when: timed }),
      task('c', { when: { ...days('2026-10-01'), reminder: { daysBefore: 1 } } }),
    ];
    const move = moveA(at('2026-10-01T15:30:00.000Z', '2026-10-01T17:30:00.000Z'));
    expect(planDependencyShift(rows, settings, dates, move).changes).toEqual([
      change('b', { ...timed, start: '2026-10-01T17:30:00.000Z' }),
      change('c', { ...days('2026-10-02'), reminder: { daysBefore: 1 } }),
    ]);
  });
  it('stops after 500 rows and says so', () => {
    const chain = (count: number): Row[] => [
      task('a', { when: days('2026-01-01'), blocking: ['t0'] }),
      ...Array.from({ length: count }, (_, i) =>
        task(`t${i}`, { when: days(addDays('2026-01-02', i)), blocking: [`t${i + 1}`] }),
      ),
    ];
    const move = moveA(days('2026-01-02'));
    const over = planDependencyShift(chain(501), settings, dates, move);
    expect(over.message).toBe(SHIFT_LIMIT_MESSAGE);
    expect(over.changes).toHaveLength(500);
    expect(over.changes[499]).toEqual(change('t499', days(addDays('2026-01-02', 500))));
    const exact = planDependencyShift(chain(500), settings, dates, move);
    expect(exact.message).toBeNull();
    expect(exact.changes).toHaveLength(500);
  });
  it('gets through a loop that was saved anyway, without moving the moved row', () => {
    const rows = [
      task('a', { when: days('2026-10-01', '2026-10-03'), blocking: ['b'] }),
      task('b', { when: days('2026-10-04', '2026-10-06'), blocking: ['a'] }),
    ];
    expect(
      planDependencyShift(rows, settings, dates, moveA(days('2026-10-03', '2026-10-05'))),
    ).toEqual({
      changes: [change('b', days('2026-10-06', '2026-10-08'))],
      message: null,
    });
  });
  it('shifts nothing when the moved row is missing or has no date before or after', () => {
    const rows = pair(days('2026-10-04', '2026-10-06'));
    const later = days('2026-10-03', '2026-10-05');
    expect(
      planDependencyShift(rows, settings, dates, { rowId: 'gone', values: { when: later } }),
    ).toEqual(none);
    expect(planDependencyShift(rows, settings, dates, moveA(null))).toEqual(none);
    const undated = [task('a', { blocking: ['b'] }), ...rows.slice(1)];
    expect(planDependencyShift(undated, settings, dates, moveA(later))).toEqual(none);
  });
});
