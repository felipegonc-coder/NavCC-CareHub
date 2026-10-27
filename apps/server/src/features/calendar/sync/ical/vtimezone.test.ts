import { describe, expect, it } from 'vitest';
import { logicalLines, parseContentLine, readComponents } from './text';
import type { Component } from './text';
import { civilToMs } from './values';
import {
  customOffset,
  customWallToUtc,
  matchIanaZone,
  readVTimezone,
  writeVTimezone,
} from './vtimezone';
import { zoneOffset } from './zones';

const SUMMER_2026 = Date.UTC(2026, 5, 1);

function vtimezone(...lines: string[]): Component {
  const text = ['BEGIN:VTIMEZONE', ...lines, 'END:VTIMEZONE'].join('\r\n');
  const parsed = [...logicalLines(text)].map(({ text: raw, line }) => parseContentLine(raw, line)!);
  return readComponents(parsed)[0]!;
}

// How Outlook writes a zone: a display name as TZID, rules starting in 1601.
const OUTLOOK_MOUNTAIN = vtimezone(
  'TZID:(UTC-07:00) Mountain Time (US & Canada)',
  'BEGIN:STANDARD',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:-0600',
  'TZOFFSETTO:-0700',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0600',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3',
  'END:DAYLIGHT',
);

describe('readVTimezone', () => {
  it('expands yearly rules into transitions', () => {
    const zone = readVTimezone(OUTLOOK_MOUNTAIN)!;
    expect(zone.tzid).toBe('(UTC-07:00) Mountain Time (US & Canada)');
    // 2026: DST starts March 8 at 2:00 MST and ends November 1 at 2:00 MDT.
    expect(customOffset(zone, Date.UTC(2026, 2, 8, 8, 59))).toBe(-420);
    expect(customOffset(zone, Date.UTC(2026, 2, 8, 9, 0))).toBe(-360);
    expect(customOffset(zone, Date.UTC(2026, 10, 1, 7, 59))).toBe(-360);
    expect(customOffset(zone, Date.UTC(2026, 10, 1, 8, 0))).toBe(-420);
    const wall = civilToMs({ year: 2026, month: 7, day: 14, hour: 9, minute: 0 });
    expect(new Date(customWallToUtc(zone, wall)).toISOString()).toBe('2026-07-14T15:00:00.000Z');
  });

  it('reads last-weekday, BYSETPOS, BYMONTHDAY, UNTIL and RDATE forms', () => {
    const zone = readVTimezone(
      vtimezone(
        'TZID:Northwind Tiles Office',
        'BEGIN:STANDARD',
        'DTSTART:20201025T030000',
        'TZOFFSETFROM:+0217',
        'TZOFFSETTO:+0117',
        'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=SU;BYSETPOS=-1;UNTIL=20231029T004300Z',
        'RDATE:20241001T000000',
        'END:STANDARD',
        'BEGIN:DAYLIGHT',
        'DTSTART:20210401T000000',
        'TZOFFSETFROM:+0117',
        'TZOFFSETTO:+0217',
        'RRULE:FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=1;COUNT=4',
        'END:DAYLIGHT',
      ),
    )!;
    const changes = zone.transitions.map((t) => [new Date(t.at).toISOString(), t.to]);
    expect(changes).toEqual([
      ['2020-10-25T00:43:00.000Z', 77],
      ['2021-03-31T22:43:00.000Z', 137],
      ['2021-10-31T00:43:00.000Z', 77],
      ['2022-03-31T22:43:00.000Z', 137],
      ['2022-10-30T00:43:00.000Z', 77],
      ['2023-03-31T22:43:00.000Z', 137],
      ['2023-10-29T00:43:00.000Z', 77],
      ['2024-03-31T22:43:00.000Z', 137],
      ['2024-09-30T21:43:00.000Z', 77],
    ]);
    // Before the first transition the zone uses that transition's "from" offset.
    expect(customOffset(zone, Date.UTC(2019, 0, 1))).toBe(137);
  });

  it('ignores zones without a usable part', () => {
    expect(readVTimezone(vtimezone('TZID:Empty'))).toBeUndefined();
    expect(
      readVTimezone(
        vtimezone('BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETTO:+0100', 'END:STANDARD'),
      ),
    ).toBeUndefined();
  });

  it('keeps a runaway rule within its budget', () => {
    const zone = readVTimezone(
      vtimezone(
        'TZID:Runaway',
        'BEGIN:STANDARD',
        'DTSTART:16010101T000000',
        'TZOFFSETFROM:+0000',
        'TZOFFSETTO:+0000',
        `RRULE:FREQ=YEARLY;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12;BYMONTHDAY=${Array.from({ length: 31 }, (_, i) => i + 1).join(',')}`,
        'END:STANDARD',
      ),
    )!;
    expect(zone.transitions.length).toBeLessThanOrEqual(20_000);
  });
});

describe('matchIanaZone', () => {
  it('finds the IANA zone behind an Outlook display name', () => {
    expect(matchIanaZone(readVTimezone(OUTLOOK_MOUNTAIN)!, SUMMER_2026)).toBe('America/Denver');
  });

  it('prefers X-LIC-LOCATION, then a city named in the TZID', () => {
    const european = [
      'BEGIN:STANDARD',
      'DTSTART:19701025T030000',
      'TZOFFSETFROM:+0200',
      'TZOFFSETTO:+0100',
      'TZNAME:CET',
      'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
      'END:STANDARD',
      'BEGIN:DAYLIGHT',
      'DTSTART:19700329T020000',
      'TZOFFSETFROM:+0100',
      'TZOFFSETTO:+0200',
      'TZNAME:CEST',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
      'END:DAYLIGHT',
    ];
    const located = readVTimezone(
      vtimezone('TZID:Bluebird Bakery', 'X-LIC-LOCATION:Europe/Madrid', ...european),
    )!;
    expect(located.location).toBe('Europe/Madrid');
    expect(matchIanaZone(located, SUMMER_2026)).toBe('Europe/Madrid');
    const named = readVTimezone(vtimezone('TZID:Custom Paris Time', ...european))!;
    expect(matchIanaZone(named, SUMMER_2026)).toBe('Europe/Paris');
  });

  it('returns undefined when no zone behaves the same', () => {
    const odd = readVTimezone(
      vtimezone(
        'TZID:Odd',
        'BEGIN:STANDARD',
        'DTSTART:19700101T000000',
        'TZOFFSETFROM:+0517',
        'TZOFFSETTO:+0517',
        'END:STANDARD',
      ),
    )!;
    expect(matchIanaZone(odd, SUMMER_2026)).toBeUndefined();
    const fixed = readVTimezone(
      vtimezone(
        'TZID:Fixed',
        'BEGIN:STANDARD',
        'DTSTART:19700101T000000',
        'TZOFFSETFROM:-0300',
        'TZOFFSETTO:-0300',
        'END:STANDARD',
      ),
    )!;
    expect(matchIanaZone(fixed, SUMMER_2026)).toBeDefined();
  });
});

describe('writeVTimezone', () => {
  it('writes yearly rules, closing the old ones', () => {
    expect(writeVTimezone('America/Denver', 2005, 2028)).toEqual([
      'BEGIN:VTIMEZONE',
      'TZID:America/Denver',
      'BEGIN:DAYLIGHT',
      'TZOFFSETFROM:-0700',
      'TZOFFSETTO:-0600',
      'TZNAME:MDT',
      'DTSTART:20050403T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU;UNTIL=20060402T090000Z',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'TZOFFSETFROM:-0600',
      'TZOFFSETTO:-0700',
      'TZNAME:MST',
      'DTSTART:20051030T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU;UNTIL=20061029T080000Z',
      'END:STANDARD',
      'BEGIN:DAYLIGHT',
      'TZOFFSETFROM:-0700',
      'TZOFFSETTO:-0600',
      'TZNAME:MDT',
      'DTSTART:20070311T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'TZOFFSETFROM:-0600',
      'TZOFFSETTO:-0700',
      'TZNAME:MST',
      'DTSTART:20071104T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
      'END:STANDARD',
      'END:VTIMEZONE',
    ]);
  });

  it('writes a single STANDARD part for a zone without changes', () => {
    expect(writeVTimezone('America/Phoenix', 2025, 2028)).toEqual([
      'BEGIN:VTIMEZONE',
      'TZID:America/Phoenix',
      'BEGIN:STANDARD',
      'DTSTART:20250101T000000',
      'TZOFFSETFROM:-0700',
      'TZOFFSETTO:-0700',
      'TZNAME:MST',
      'END:STANDARD',
      'END:VTIMEZONE',
    ]);
  });

  it('agrees with Intl over the years it covers, and at each change', () => {
    const zones = [
      'America/Denver',
      'Europe/London',
      'Europe/Dublin',
      'Australia/Sydney',
      'America/Sao_Paulo',
      'Africa/Casablanca',
      'Asia/Kolkata',
    ];
    for (const zone of zones) {
      const text = ['BEGIN:VCALENDAR', ...writeVTimezone(zone, 2015, 2030), 'END:VCALENDAR'].join(
        '\r\n',
      );
      const parsed = [...logicalLines(text)].map((l) => parseContentLine(l.text, l.line)!);
      const custom = readVTimezone(readComponents(parsed)[0]!.children[0]!)!;
      const mismatches: string[] = [];
      const check = (ms: number) => {
        if (customOffset(custom, ms) !== zoneOffset(zone, ms)) {
          mismatches.push(`${zone} ${new Date(ms).toISOString()}`);
        }
      };
      for (let t = Date.UTC(2015, 0, 1); t < Date.UTC(2031, 0, 1); t += 13 * 3_600_000) check(t);
      for (const { at } of custom.transitions) {
        if (at >= Date.UTC(2015, 0, 1) && at < Date.UTC(2031, 0, 1))
          [at - 60_000, at].forEach(check);
      }
      expect(mismatches.slice(0, 5)).toEqual([]);
    }
  });
});
