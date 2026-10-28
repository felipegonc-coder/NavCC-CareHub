import { syncedOccurrenceKeySchema } from '@carehub/team-calendar-api';
import { describe, expect, it } from 'vitest';
import { MAX_OCCURRENCES } from '@carehub/team-repeat';
import {
  MAX_EXPAND_MS,
  MAX_RDATES,
  expandSeries,
  expandSyncedEvents,
  withoutSetPos,
} from './expand-series';
import type { ExpandRange, SyncedExpansion, SyncedRow } from './expand-series';
import type { ExternalEvent, ExternalTime } from './types';

const DENVER = 'America/Denver';
const NEW_YORK = 'America/New_York';

const zoned = (dateTime: string, timeZone = DENVER): ExternalTime => ({
  kind: 'zoned',
  dateTime,
  timeZone,
});
const utc = (instant: string): ExternalTime => ({ kind: 'utc', instant });
const day = (date: string): ExternalTime => ({ kind: 'date', date });
const floating = (dateTime: string): ExternalTime => ({ kind: 'floating', dateTime });

const event = (fields: Partial<ExternalEvent> & Pick<ExternalEvent, 'start'>): ExternalEvent => ({
  uid: 'weekly-1-1@example.com',
  status: 'confirmed',
  title: 'Weekly 1:1',
  busy: true,
  ...fields,
});

let rows = 0;
const row = (e: ExternalEvent, seriesId: string | null = null): SyncedRow => ({
  id: `row-${(rows += 1)}`,
  seriesId,
  event: e,
});

/** Two weeks around the US clock change on Sunday, November 1, 2026, seen from New York. */
const WEEKS: ExpandRange = { from: '2026-10-25', to: '2026-11-08', timeZone: NEW_YORK };

/** Tuesdays at 9:00 in Denver, from October 20. */
const weekly = (fields: Partial<ExternalEvent> = {}) =>
  row(
    event({
      start: zoned('2026-10-20T09:00'),
      end: zoned('2026-10-20T10:00'),
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      ...fields,
    }),
  );

const starts = ({ occurrences }: SyncedExpansion<unknown>) => occurrences.map((o) => o.start);
const keys = ({ occurrences }: SyncedExpansion<unknown>) => occurrences.map((o) => o.key);

describe('expandSeries', () => {
  it('keeps a Denver meeting at 9:00 in Denver when the clocks change (CA-13)', () => {
    const series = weekly();
    const result = expandSeries(series, [], WEEKS);
    expect(result).toEqual({
      occurrences: [
        {
          row: series,
          series,
          key: '2026-10-27T15:00:00.000Z',
          allDay: false,
          start: '2026-10-27T15:00:00.000Z',
          end: '2026-10-27T16:00:00.000Z',
          timeZone: DENVER,
        },
        {
          row: series,
          series,
          key: '2026-11-03T16:00:00.000Z',
          allDay: false,
          start: '2026-11-03T16:00:00.000Z',
          end: '2026-11-03T17:00:00.000Z',
          timeZone: DENVER,
        },
      ],
      truncated: false,
    });
  });

  it('keeps all-day occurrences on their dates for every viewer (CA-13)', () => {
    const series = row(
      event({ start: day('2026-10-26'), end: day('2026-10-27'), rrule: 'FREQ=WEEKLY' }),
    );
    for (const timeZone of ['Pacific/Auckland', DENVER, 'UTC']) {
      const result = expandSeries(series, [], { ...WEEKS, timeZone });
      expect(
        result.occurrences.map(({ key, start, end, allDay, timeZone: zone }) => ({
          key,
          start,
          end,
          allDay,
          zone,
        })),
      ).toEqual([
        { key: '2026-10-26', start: '2026-10-26', end: '2026-10-27', allDay: true, zone: null },
        { key: '2026-11-02', start: '2026-11-02', end: '2026-11-03', allDay: true, zone: null },
      ]);
    }
  });

  it('shows an occurrence that starts before the range and runs into it', () => {
    // Friday to Sunday, every week: the one from October 23 ends on the 26th (exclusive).
    const series = row(
      event({ start: day('2026-10-23'), end: day('2026-10-26'), rrule: 'FREQ=WEEKLY' }),
    );
    const fridays = ['2026-10-23', '2026-10-30', '2026-11-06'];
    expect(starts(expandSeries(series, [], WEEKS))).toEqual(fridays);
    const late = { ...WEEKS, from: '2026-10-26' };
    expect(starts(expandSeries(series, [], late))).toEqual(fridays.slice(1));
    const removed = { ...series, event: { ...series.event, exdates: [day('2026-10-23')] } };
    expect(starts(expandSeries(removed, [], WEEKS))).toEqual(fridays.slice(1));
    // Timed: Thursday 9:00 to Monday 9:00 in Denver, so the first one starts days before.
    const timed = row(
      event({
        start: zoned('2026-10-22T09:00'),
        end: zoned('2026-10-26T09:00'),
        rrule: 'FREQ=WEEKLY',
      }),
    );
    expect(starts(expandSeries(timed, [], WEEKS))).toEqual([
      '2026-10-22T15:00:00.000Z',
      '2026-10-29T15:00:00.000Z',
      '2026-11-05T16:00:00.000Z',
    ]);
  });

  it('reads a UTC UNTIL on the series wall clock, and COUNT from the first occurrence', () => {
    const start = zoned('2026-10-26T09:00');
    const end = zoned('2026-10-26T09:30');
    // 9:00 in Denver is 15:00 UTC until November 1, and UNTIL includes the time it names.
    const until = (time: string) =>
      row(event({ start, end, rrule: `FREQ=DAILY;UNTIL=20261028T${time}Z` }));
    expect(starts(expandSeries(until('150000'), [], WEEKS))).toEqual([
      '2026-10-26T15:00:00.000Z',
      '2026-10-27T15:00:00.000Z',
      '2026-10-28T15:00:00.000Z',
    ]);
    expect(starts(expandSeries(until('145959'), [], WEEKS))).toHaveLength(2);
    const count = row(event({ start, end, rrule: 'RRULE:FREQ=DAILY;COUNT=2' }));
    expect(starts(expandSeries(count, [], WEEKS))).toEqual([
      '2026-10-26T15:00:00.000Z',
      '2026-10-27T15:00:00.000Z',
    ]);
    const allDay = row(
      event({
        start: day('2026-10-26'),
        end: day('2026-10-27'),
        rrule: 'FREQ=DAILY;UNTIL=20261028T000000Z',
      }),
    );
    expect(starts(expandSeries(allDay, [], WEEKS))).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
    ]);
  });

  it('leaves out EXDATEs in every form calendars write them', () => {
    const series = row(
      event({
        start: zoned('2026-10-26T09:00'),
        end: zoned('2026-10-26T10:00'),
        rrule: 'FREQ=DAILY;COUNT=6',
        exdates: [
          zoned('2026-10-27T09:00'),
          utc('2026-10-28T15:00:00.000Z'),
          zoned('2026-10-29T11:00', NEW_YORK),
          day('2026-10-30'),
          zoned('2026-10-31T10:00'), // not an occurrence: nothing changes
        ],
      }),
    );
    expect(starts(expandSeries(series, [], WEEKS))).toEqual([
      '2026-10-26T15:00:00.000Z',
      '2026-10-31T15:00:00.000Z',
    ]);
    const allDay = row(
      event({
        start: day('2026-10-26'),
        end: day('2026-10-27'),
        rrule: 'FREQ=DAILY;COUNT=4',
        exdates: [day('2026-10-27'), zoned('2026-10-28T00:00')],
      }),
    );
    expect(starts(expandSeries(allDay, [], WEEKS))).toEqual(['2026-10-26', '2026-10-29']);
  });

  it('shows a changed occurrence at its new time, with the key of the one it replaces', () => {
    const series = weekly();
    const moved = row(
      event({
        recurrenceId: zoned('2026-10-27T09:00'),
        title: 'Weekly 1:1 (moved)',
        start: zoned('2026-10-28T13:00'),
        end: zoned('2026-10-28T14:00'),
      }),
      series.id,
    );
    const result = expandSeries(series, [moved], WEEKS);
    expect(result.occurrences[0]).toEqual({
      row: moved,
      series,
      key: '2026-10-27T15:00:00.000Z',
      allDay: false,
      start: '2026-10-28T19:00:00.000Z',
      end: '2026-10-28T20:00:00.000Z',
      timeZone: DENVER,
    });
    expect(keys(result)).toEqual(['2026-10-27T15:00:00.000Z', '2026-11-03T16:00:00.000Z']);
    // The same occurrence, named in UTC or another zone.
    for (const recurrenceId of [
      utc('2026-10-27T15:00:00.000Z'),
      zoned('2026-10-27T11:00', NEW_YORK),
    ]) {
      const again = { ...moved, event: { ...moved.event, recurrenceId } };
      expect(expandSeries(series, [again], WEEKS).occurrences.map((o) => o.row)).toEqual([
        again,
        series,
      ]);
    }
  });

  it('shows a changed occurrence that moved into the range, and one the rule never made', () => {
    const series = weekly();
    const fromBefore = row(
      event({
        recurrenceId: zoned('2026-10-20T09:00'),
        start: zoned('2026-10-26T09:00'),
        end: zoned('2026-10-26T10:00'),
      }),
      series.id,
    );
    const stray = row(
      event({
        recurrenceId: zoned('2026-10-29T09:00'),
        start: zoned('2026-10-29T09:00'),
        end: zoned('2026-10-29T10:00'),
      }),
      series.id,
    );
    const result = expandSeries(series, [fromBefore, stray], WEEKS);
    expect(result.occurrences.map((o) => [o.key, o.start])).toEqual([
      ['2026-10-20T15:00:00.000Z', '2026-10-26T15:00:00.000Z'],
      ['2026-10-27T15:00:00.000Z', '2026-10-27T15:00:00.000Z'],
      ['2026-10-29T15:00:00.000Z', '2026-10-29T15:00:00.000Z'],
      ['2026-11-03T16:00:00.000Z', '2026-11-03T16:00:00.000Z'],
    ]);
    // Moved out of the range: neither the occurrence nor its change shows.
    const movedOut = row(
      event({ recurrenceId: zoned('2026-11-03T09:00'), start: zoned('2026-11-10T09:00') }),
      series.id,
    );
    expect(keys(expandSeries(series, [movedOut], WEEKS))).toEqual(['2026-10-27T15:00:00.000Z']);
    // Moved onto the time of another occurrence: the two show by key.
    const onto = row({ ...fromBefore.event, start: zoned('2026-10-27T09:00') }, series.id);
    expect(keys(expandSeries(series, [onto], WEEKS))).toEqual([
      '2026-10-20T15:00:00.000Z',
      '2026-10-27T15:00:00.000Z',
      '2026-11-03T16:00:00.000Z',
    ]);
  });

  it('leaves out cancelled occurrences and keeps the latest copy of a change', () => {
    const series = weekly();
    const cancelled = row(
      event({
        recurrenceId: zoned('2026-10-27T09:00'),
        status: 'cancelled',
        start: zoned('2026-10-27T09:00'),
      }),
      series.id,
    );
    expect(starts(expandSeries(series, [cancelled], WEEKS))).toEqual(['2026-11-03T16:00:00.000Z']);

    const at = (time: string, fields: Partial<ExternalEvent>) =>
      row(
        event({ recurrenceId: zoned('2026-11-03T09:00'), start: zoned(time), ...fields }),
        series.id,
      );
    const first = at('2026-11-03T10:00', { sequence: 2, updatedAt: '2026-10-20T08:00:00.000Z' });
    const older = at('2026-11-03T11:00', { sequence: 1, updatedAt: '2026-10-21T08:00:00.000Z' });
    const later = at('2026-11-03T12:00', { sequence: 2, updatedAt: '2026-10-22T08:00:00.000Z' });
    for (const changes of [
      [first, older, later],
      [later, older, first],
    ]) {
      const shown = expandSeries(series, changes, WEEKS).occurrences.at(-1);
      expect(shown?.row).toBe(later);
    }
    const cancelledLater = at('2026-11-03T09:00', { sequence: 3, status: 'cancelled' });
    expect(starts(expandSeries(series, [first, cancelledLater], WEEKS))).toEqual([
      '2026-10-27T15:00:00.000Z',
    ]);
  });

  it('adds RDATEs once each, and not removed ones', () => {
    const series = weekly({
      rdates: [
        zoned('2026-10-29T09:00'),
        zoned('2026-10-27T09:00'),
        zoned('2026-10-29T09:00'),
        zoned('2026-10-30T09:00'),
        utc('2026-11-05T16:00:00.000Z'),
      ],
      exdates: [zoned('2026-10-30T09:00')],
    });
    expect(keys(expandSeries(series, [], WEEKS))).toEqual([
      '2026-10-27T15:00:00.000Z',
      '2026-10-29T15:00:00.000Z',
      '2026-11-03T16:00:00.000Z',
      '2026-11-05T16:00:00.000Z',
    ]);
    // RDATEs without a rule: the start and each RDATE, all keyed.
    const dates = row(
      event({
        start: day('2026-10-26'),
        end: day('2026-10-27'),
        rdates: [day('2026-10-26'), day('2026-11-04')],
      }),
    );
    expect(keys(expandSeries(dates, [], WEEKS))).toEqual(['2026-10-26', '2026-11-04']);
  });

  it('adds RDATEs just inside the range, from any time zone', () => {
    // From New York, the range runs from 4:00 UTC on October 25 to 5:00 UTC on November 8.
    const series = weekly({
      rdates: [
        zoned('2026-10-24T17:00', 'Pacific/Honolulu'),
        zoned('2026-10-24T20:00', 'Pacific/Honolulu'),
        zoned('2026-11-08T08:00', 'Asia/Tokyo'),
        zoned('2026-11-08T14:00', 'Asia/Tokyo'),
      ],
    });
    expect(keys(expandSeries(series, [], WEEKS))).toEqual([
      '2026-10-25T06:00:00.000Z',
      '2026-10-27T15:00:00.000Z',
      '2026-11-03T16:00:00.000Z',
      '2026-11-07T23:00:00.000Z',
    ]);
  });

  it(`reads at most ${MAX_RDATES} RDATEs`, () => {
    const september = (i: number) =>
      utc(new Date(Date.parse('2026-09-01T15:00:00.000Z') + i * 60_000).toISOString());
    const rdates = Array.from({ length: MAX_RDATES - 1 }, (_, i) => september(i));
    const start = utc('2026-09-01T14:00:00.000Z');
    const inRange = utc('2026-10-27T15:00:00.000Z');
    const read = row(event({ start, rdates: [...rdates, inRange] }));
    expect(expandSeries(read, [], WEEKS)).toMatchObject({ truncated: false });
    expect(starts(expandSeries(read, [], WEEKS))).toEqual(['2026-10-27T15:00:00.000Z']);
    const tooMany = row(event({ start, rdates: [...rdates, september(MAX_RDATES), inRange] }));
    expect(expandSeries(tooMany, [], WEEKS)).toEqual({ occurrences: [], truncated: true });
  });

  it("reads Outlook's BYSETPOS for one weekday", () => {
    const series = row(
      event({
        start: zoned('2026-10-13T09:00'),
        end: zoned('2026-10-13T10:00'),
        rrule: 'FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2',
      }),
    );
    const result = expandSeries(series, [], {
      from: '2026-10-25',
      to: '2026-12-06',
      timeZone: DENVER,
    });
    expect(result).toMatchObject({ truncated: false });
    expect(starts(result)).toEqual(['2026-11-10T16:00:00.000Z']);
  });

  it("shows only the first occurrence of a rule it can't expand, and says there may be more", () => {
    const series = weekly({
      start: zoned('2026-10-27T09:00'),
      end: zoned('2026-10-27T10:00'),
      rrule: 'FREQ=WEEKLY;BYDAY=TU;BYHOUR=9,15',
      rdates: [zoned('2026-11-05T09:00')],
    });
    const moved = row(
      event({ recurrenceId: zoned('2026-11-03T09:00'), start: zoned('2026-11-04T09:00') }),
      series.id,
    );
    const result = expandSeries(series, [moved], WEEKS);
    expect(starts(result)).toEqual([
      '2026-10-27T15:00:00.000Z',
      '2026-11-04T16:00:00.000Z',
      '2026-11-05T16:00:00.000Z',
    ]);
    expect(result.truncated).toBe(true);
  });

  it("reads floating times in the viewer's time zone", () => {
    const series = row(
      event({
        start: floating('2026-10-26T09:00'),
        end: floating('2026-10-26T10:00'),
        rrule: 'FREQ=DAILY;COUNT=2',
        exdates: [floating('2026-10-27T09:00')],
        rdates: [zoned('2026-10-28T11:00', NEW_YORK)],
      }),
    );
    const inNewYork = expandSeries(series, [], WEEKS);
    expect(starts(inNewYork)).toEqual(['2026-10-26T13:00:00.000Z', '2026-10-28T15:00:00.000Z']);
    expect(inNewYork.occurrences[0]?.timeZone).toBe(NEW_YORK);
    const inDenver = expandSeries(series, [], { ...WEEKS, timeZone: DENVER });
    expect(starts(inDenver)).toEqual(['2026-10-26T15:00:00.000Z', '2026-10-28T15:00:00.000Z']);
    expect(inDenver.occurrences[0]?.timeZone).toBe(DENVER);
  });

  it("reads a time zone it doesn't know as the viewer's", () => {
    const mars = (dateTime: string) => zoned(dateTime, 'Mars/Olympus_Mons');
    const series = row(
      event({
        start: mars('2026-10-26T09:00'),
        end: mars('2026-10-26T10:00'),
        rrule: 'FREQ=DAILY;COUNT=3',
        exdates: [mars('2026-10-27T09:00')],
      }),
    );
    const result = expandSeries(series, [], WEEKS);
    expect(starts(result)).toEqual(['2026-10-26T13:00:00.000Z', '2026-10-28T13:00:00.000Z']);
    expect(result.occurrences.map((o) => o.timeZone)).toEqual([NEW_YORK, NEW_YORK]);
    const single = row(event({ start: mars('2026-10-26T09:00') }));
    expect(expandSeries(single, [], WEEKS).occurrences).toMatchObject([
      { start: '2026-10-26T13:00:00.000Z', timeZone: NEW_YORK },
    ]);
  });

  it('repeats UTC times at the same UTC time', () => {
    const series = row(
      event({
        start: utc('2026-10-30T15:30:00.000Z'),
        end: utc('2026-10-30T16:00:00.000Z'),
        rrule: 'FREQ=DAILY;COUNT=5',
        exdates: [day('2026-10-31')],
      }),
    );
    const result = expandSeries(series, [], WEEKS);
    expect(starts(result)).toEqual([
      '2026-10-30T15:30:00.000Z',
      '2026-11-01T15:30:00.000Z',
      '2026-11-02T15:30:00.000Z',
      '2026-11-03T15:30:00.000Z',
    ]);
    expect(result.occurrences.every((o) => o.timeZone === 'UTC')).toBe(true);
  });

  it('keeps the exact length when an occurrence spans a clock change', () => {
    // 23:00 to 3:00 the next morning in New York: five hours on the night the clocks go back.
    const series = row(
      event({
        start: zoned('2026-10-31T23:00', NEW_YORK),
        end: zoned('2026-11-01T03:00', NEW_YORK),
        rrule: 'FREQ=DAILY;COUNT=2',
      }),
    );
    const lengths = expandSeries(series, [], WEEKS).occurrences.map(
      (o) => (Date.parse(o.end) - Date.parse(o.start)) / 3_600_000,
    );
    expect(lengths).toEqual([5, 5]);
  });

  it('moves a time the clocks skip to when they change', () => {
    // 2:30 doesn't happen in New York on March 8, 2026.
    const series = row(
      event({ start: zoned('2026-03-07T02:30', NEW_YORK), rrule: 'FREQ=DAILY;COUNT=3' }),
    );
    const march = { from: '2026-03-07', to: '2026-03-10', timeZone: NEW_YORK };
    expect(starts(expandSeries(series, [], march))).toEqual([
      '2026-03-07T07:30:00.000Z',
      '2026-03-08T07:00:00.000Z',
      '2026-03-09T06:30:00.000Z',
    ]);
  });

  it('shows a single event as it is, with no key', () => {
    const single = row(event({ start: zoned('2026-10-27T09:00'), end: zoned('2026-10-27T10:00') }));
    expect(expandSeries(single, [], WEEKS).occurrences).toEqual([
      {
        row: single,
        series: null,
        key: null,
        allDay: false,
        start: '2026-10-27T15:00:00.000Z',
        end: '2026-10-27T16:00:00.000Z',
        timeZone: DENVER,
      },
    ]);
    const before = { ...WEEKS, from: '2026-10-28' };
    expect(expandSeries(single, [], before).occurrences).toEqual([]);
    // No length: it shows if it starts in the range.
    const atStart = row(event({ start: zoned('2026-10-24T22:00') }));
    expect(expandSeries(atStart, [], WEEKS).occurrences).toHaveLength(1);
    const atEnd = row(event({ start: utc('2026-11-08T05:00:00.000Z') }));
    expect(expandSeries(atEnd, [], WEEKS).occurrences).toEqual([]);
    const justBefore = row(event({ start: zoned('2026-10-24T21:59') }));
    expect(expandSeries(justBefore, [], WEEKS).occurrences).toEqual([]);
    // All-day: dates in the range, whatever the viewer's time zone.
    const lastDay = row(event({ start: day('2026-11-07') }));
    expect(starts(expandSeries(lastDay, [], WEEKS))).toEqual(['2026-11-07']);
    const dayAfter = row(event({ start: day('2026-11-08') }));
    expect(expandSeries(dayAfter, [], WEEKS).occurrences).toEqual([]);
    const dayBefore = row(event({ start: day('2026-10-24') }));
    expect(expandSeries(dayBefore, [], WEEKS).occurrences).toEqual([]);
    // A UTC time shows in UTC.
    const inUtc = row(event({ start: utc('2026-10-27T15:00:00.000Z') }));
    expect(expandSeries(inUtc, [], WEEKS).occurrences.map((o) => o.timeZone)).toEqual(['UTC']);
  });

  it('gives an event without a usable end a day, or no length', () => {
    const times = (start: ExternalTime, end: ExternalTime) =>
      expandSeries(row(event({ start, end })), [], WEEKS).occurrences.map((o) => [o.start, o.end]);
    expect(times(day('2026-10-27'), day('2026-10-27'))).toEqual([['2026-10-27', '2026-10-28']]);
    expect(times(day('2026-10-27'), day('2026-10-26'))).toEqual([['2026-10-27', '2026-10-28']]);
    const nine = ['2026-10-27T15:00:00.000Z', '2026-10-27T15:00:00.000Z'];
    expect(times(zoned('2026-10-27T09:00'), zoned('2026-10-27T08:00'))).toEqual([nine]);
    expect(times(zoned('2026-10-27T09:00'), day('2026-10-28'))).toEqual([nine]);
  });

  it('shows a changed copy of a single event in its place', () => {
    const single = row(event({ start: zoned('2026-10-27T09:00'), end: zoned('2026-10-27T10:00') }));
    const moved = row(
      event({
        recurrenceId: zoned('2026-10-27T09:00'),
        start: zoned('2026-10-27T11:00'),
        end: zoned('2026-10-27T12:00'),
      }),
      single.id,
    );
    expect(expandSeries(single, [moved], WEEKS).occurrences).toEqual([
      {
        row: moved,
        series: single,
        key: '2026-10-27T15:00:00.000Z',
        allDay: false,
        start: '2026-10-27T17:00:00.000Z',
        end: '2026-10-27T18:00:00.000Z',
        timeZone: DENVER,
      },
    ]);
    // A row without a RECURRENCE-ID changes nothing.
    const notAChange = row(event({ start: zoned('2026-10-28T09:00') }), single.id);
    expect(expandSeries(single, [notAChange], WEEKS)).toEqual(expandSeries(single, [], WEEKS));
    expect(keys(expandSeries(weekly(), [notAChange], WEEKS))).toEqual([
      '2026-10-27T15:00:00.000Z',
      '2026-11-03T16:00:00.000Z',
    ]);
  });

  it('shows nothing for a cancelled event', () => {
    expect(expandSeries(weekly({ status: 'cancelled' }), [], WEEKS)).toEqual({
      occurrences: [],
      truncated: false,
    });
  });

  it('stops before expanding a rule once the budget is spent', () => {
    const spent = { now: () => 10, until: 5 };
    expect(expandSeries(weekly(), [], WEEKS, spent)).toEqual({ occurrences: [], truncated: true });
    const single = row(event({ start: zoned('2026-10-27T09:00') }));
    expect(expandSeries(single, [], WEEKS, spent).occurrences).toHaveLength(1);
  });

  it('shows every occurrence to the end of the range, from any time zone', () => {
    const daily = weekly({ rrule: 'FREQ=DAILY' });
    const fromNewYork = starts(expandSeries(daily, [], WEEKS));
    expect([fromNewYork.length, fromNewYork[0], fromNewYork.at(-1)]).toEqual([
      14,
      '2026-10-25T15:00:00.000Z',
      '2026-11-07T16:00:00.000Z',
    ]);
    // From Tokyo, the same dates run from 15:00 UTC on October 24 to 15:00 UTC on November 7.
    const fromTokyo = starts(expandSeries(daily, [], { ...WEEKS, timeZone: 'Asia/Tokyo' }));
    expect([fromTokyo.length, fromTokyo[0], fromTokyo.at(-1)]).toEqual([
      14,
      '2026-10-24T15:00:00.000Z',
      '2026-11-06T16:00:00.000Z',
    ]);
  });

  it(`shows at most ${MAX_OCCURRENCES} occurrences, and says there may be more`, () => {
    const minutes = Array.from({ length: MAX_RDATES }, (_, i) =>
      utc(new Date(Date.parse('2026-10-26T00:00:00.000Z') + i * 60_000).toISOString()),
    );
    const busy = weekly({ rrule: 'FREQ=DAILY', rdates: minutes });
    const result = expandSeries(busy, [], WEEKS);
    expect(result.occurrences).toHaveLength(MAX_OCCURRENCES);
    expect(result.truncated).toBe(true);
  });

  it('says there may be more when a rule takes too long to expand', () => {
    // Counting 40,000 days from 1950 takes more steps than team-repeat allows.
    const long = weekly({ start: zoned('1950-01-02T09:00'), rrule: 'FREQ=DAILY;COUNT=40000' });
    expect(expandSeries(long, [], WEEKS).truncated).toBe(true);
  });

  it('gives keys the API takes', () => {
    const results = [
      expandSeries(weekly(), [], WEEKS),
      expandSeries(row(event({ start: day('2026-10-26'), rrule: 'FREQ=DAILY' })), [], WEEKS),
    ];
    const all = results.flatMap(keys);
    expect(all.length).toBeGreaterThan(10);
    for (const key of all) expect(syncedOccurrenceKeySchema.safeParse(key).success).toBe(true);
  });

  it('refuses a range it should never get', () => {
    const dates = 'The range needs two dates and a time zone.';
    const days = 'The range must cover 1 to 42 days.';
    const bad: [ExpandRange, string][] = [
      [{ from: '2026-10-25', to: '2026-10-25', timeZone: NEW_YORK }, days],
      [{ from: '2026-10-25', to: '2026-12-07', timeZone: NEW_YORK }, days],
      [{ from: '2026-10-25', to: '2026-11-31', timeZone: NEW_YORK }, dates],
      [{ from: '2026-02-30', to: '2026-03-10', timeZone: NEW_YORK }, dates],
      [{ from: '2026-10-25', to: '2026-11-01', timeZone: 'Mars/Olympus_Mons' }, dates],
    ];
    for (const [range, message] of bad) {
      const read = () => expandSeries(weekly(), [], range);
      expect(read).toThrow(RangeError);
      expect(read).toThrow(message);
    }
    const longest = { from: '2026-10-25', to: '2026-12-06', timeZone: NEW_YORK };
    expect(expandSeries(weekly(), [], longest).occurrences).toHaveLength(6);
  });
});

describe('withoutSetPos', () => {
  it('turns one weekday with positions into nth weekdays', () => {
    expect(withoutSetPos('FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2')).toBe('FREQ=MONTHLY;BYDAY=2TU');
    expect(withoutSetPos('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=SU;BYSETPOS=-1')).toBe(
      'FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    );
    expect(withoutSetPos('freq=monthly;bysetpos=+1,3;byday=we;count=5')).toBe(
      'freq=monthly;BYDAY=1WE,3WE;count=5',
    );
  });

  it('leaves every other rule as it is', () => {
    for (const rule of [
      'FREQ=MONTHLY;BYDAY=2TU',
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
      'FREQ=YEARLY;BYMONTH=3,9;BYDAY=SU;BYSETPOS=1',
      'FREQ=YEARLY;BYDAY=SU;BYSETPOS=1',
      'FREQ=WEEKLY;BYDAY=TU;BYSETPOS=1',
      'FREQ=MONTHLY;BYMONTHDAY=1;BYDAY=TU;BYSETPOS=1',
      'FREQ=MONTHLY;BYDAY=TU;BYSETPOS=6',
      'FREQ=MONTHLY;BYDAY=1TU;BYSETPOS=1',
      'FREQ=MONTHLY;BYDAY=TU;BYSETPOS=1;BYSETPOS=2',
      'FREQ=MONTHLY;BYDAY=TU;BYSETPOS',
      'FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2;COUNT',
    ]) {
      expect(withoutSetPos(rule)).toBe(rule);
    }
  });
});

describe('expandSyncedEvents', () => {
  it('shows single events, series and their changes, by start', () => {
    const huddle = row(
      event({ uid: 'huddle@example.com', title: 'Team huddle', start: zoned('2026-10-28T08:00') }),
    );
    const series = weekly();
    const moved = row(
      event({ recurrenceId: zoned('2026-10-27T09:00'), start: zoned('2026-10-27T12:00') }),
      series.id,
    );
    const cancelled = row(
      event({
        recurrenceId: zoned('2026-11-03T09:00'),
        status: 'cancelled',
        start: zoned('2026-11-03T09:00'),
      }),
      series.id,
    );
    // An invitation to one occurrence of a series Care Hub can't see: a single event.
    const invited = row(
      event({
        uid: 'review@example.org',
        recurrenceId: utc('2026-10-29T18:00:00.000Z'),
        start: utc('2026-10-29T18:00:00.000Z'),
      }),
    );
    // A change whose series is outside the range keeps its key.
    const elsewhere = row(
      event({
        uid: 'planning@example.net',
        recurrenceId: zoned('2026-09-01T09:00'),
        start: zoned('2026-10-30T09:00'),
      }),
      'row-not-in-range',
    );
    const cancelledElsewhere = row(
      event({
        uid: 'planning@example.net',
        recurrenceId: zoned('2026-09-08T09:00'),
        status: 'cancelled',
        start: zoned('2026-10-29T09:00'),
      }),
      'row-not-in-range',
    );
    const allDayElsewhere = row(
      event({
        uid: 'offsite@example.net',
        recurrenceId: day('2026-09-01'),
        start: day('2026-10-31'),
        end: day('2026-11-01'),
      }),
      'row-not-in-range',
    );
    // Floating times, its key included, are read in the viewer's time zone.
    const floatingElsewhere = row(
      event({
        uid: 'standup@example.net',
        recurrenceId: floating('2026-09-22T09:00'),
        start: floating('2026-10-28T11:00'),
      }),
      'row-not-in-range',
    );
    const later = row(
      event({
        uid: 'planning@example.net',
        recurrenceId: zoned('2026-09-15T09:00'),
        start: zoned('2026-12-01T09:00'),
      }),
      'row-not-in-range',
    );
    const gone = row(
      event({ uid: 'gone@example.com', status: 'cancelled', start: zoned('2026-10-29T09:00') }),
    );
    const result = expandSyncedEvents(
      [
        allDayElsewhere,
        elsewhere,
        cancelled,
        huddle,
        moved,
        series,
        invited,
        cancelledElsewhere,
        floatingElsewhere,
        later,
        gone,
      ],
      WEEKS,
    );
    expect(result.truncated).toBe(false);
    expect(result.occurrences.map((o) => [o.row.id, o.series?.id ?? null, o.key, o.start])).toEqual(
      [
        [moved.id, series.id, '2026-10-27T15:00:00.000Z', '2026-10-27T18:00:00.000Z'],
        [huddle.id, null, null, '2026-10-28T14:00:00.000Z'],
        [floatingElsewhere.id, null, '2026-09-22T13:00:00.000Z', '2026-10-28T15:00:00.000Z'],
        [invited.id, null, null, '2026-10-29T18:00:00.000Z'],
        [elsewhere.id, null, '2026-09-01T15:00:00.000Z', '2026-10-30T15:00:00.000Z'],
        [allDayElsewhere.id, null, '2026-09-01', '2026-10-31'],
      ],
    );
  });

  it("leaves out an event it can't read, says so, and shows the rest", () => {
    const broken = row(event({ start: zoned('not a time'), rrule: 'FREQ=DAILY' }));
    const brokenChange = row(
      event({ recurrenceId: zoned('2026-10-27'), start: zoned('2026-10-27T09:00') }),
      'row-x',
    );
    const fine = weekly();
    const result = expandSyncedEvents([broken, brokenChange, fine], WEEKS);
    expect(result.truncated).toBe(true);
    expect(result.occurrences.map((o) => o.row)).toEqual([fine, fine]);
  });

  it(`stops after ${MAX_EXPAND_MS} ms and says so`, () => {
    const clock = () => {
      let time = 0;
      return () => (time += 100);
    };
    const series = [weekly(), weekly(), weekly(), weekly()];
    const single = row(event({ start: zoned('2026-10-29T09:00') }));
    // Each look at the clock adds 100 ms, so the 250 ms run out after the first series.
    const result = expandSyncedEvents([...series, single], WEEKS, { now: clock() });
    expect(result.occurrences.map((o) => o.row)).toEqual([series[0], series[0]]);
    expect(result.truncated).toBe(true);
    const roomy = expandSyncedEvents([...series, single], WEEKS, { now: clock(), budgetMs: 1000 });
    expect(roomy).toMatchObject({ truncated: false });
    expect(roomy.occurrences).toHaveLength(9);
  });

  it('checks the range even with no rows', () => {
    expect(() => expandSyncedEvents([], { ...WEEKS, to: '2026-12-31' })).toThrow(RangeError);
    expect(expandSyncedEvents([], WEEKS)).toEqual({ occurrences: [], truncated: false });
  });
});
