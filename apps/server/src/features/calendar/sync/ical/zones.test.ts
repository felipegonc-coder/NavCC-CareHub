import { describe, expect, it } from 'vitest';
import { WINDOWS_ZONES } from './windows-zones';
import { ianaZone, msToZoned, zonedToMs, zoneFromTzid, zoneOffset } from './zones';

const iso = (ms: number | undefined) => (ms === undefined ? undefined : new Date(ms).toISOString());

describe('Windows zone table', () => {
  it('maps every Windows ID once, to a zone Intl knows', () => {
    const ids = WINDOWS_ZONES.map(([id]) => id.toLowerCase());
    expect(new Set(ids).size).toBe(ids.length);
    for (const [id, zone] of WINDOWS_ZONES) {
      expect(ianaZone(zone)).toBe(zone);
      // 'UTC' is an IANA name as well as a Windows ID, and is kept as written.
      expect(zoneFromTzid(id)).toBe(id === 'UTC' ? 'UTC' : zone);
    }
  });
});

describe('zoneFromTzid', () => {
  it('reads IANA names, Windows IDs and path-prefixed names', () => {
    expect(zoneFromTzid('America/New_York')).toBe('America/New_York');
    expect(zoneFromTzid('america/new_york')).toBe('America/New_York');
    expect(zoneFromTzid('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(zoneFromTzid('UTC')).toBe('UTC');
    expect(zoneFromTzid('"Eastern Standard Time"')).toBe('America/New_York');
    expect(zoneFromTzid('W. Europe Standard Time')).toBe('Europe/Berlin');
    expect(zoneFromTzid('/mozilla.org/20050126_1/America/New_York')).toBe('America/New_York');
    expect(zoneFromTzid('/example.org/Olson_20011030_5/Europe/London')).toBe('Europe/London');
  });

  it('returns undefined for names it cannot place', () => {
    expect(zoneFromTzid('Bakery/Nowhere')).toBeUndefined();
    expect(zoneFromTzid('(UTC-07:00) Mountain Time (US & Canada)')).toBeUndefined();
    expect(zoneFromTzid('')).toBeUndefined();
  });
});

describe('zone arithmetic', () => {
  it('finds offsets, including half and quarter hours', () => {
    expect(zoneOffset('America/New_York', Date.UTC(2026, 6, 1))).toBe(-240);
    expect(zoneOffset('America/New_York', Date.UTC(2026, 0, 15))).toBe(-300);
    expect(zoneOffset('Asia/Kolkata', Date.UTC(2026, 0, 15))).toBe(330);
    expect(zoneOffset('Asia/Kathmandu', Date.UTC(2026, 0, 15))).toBe(345);
  });

  it('follows RFC 5545 3.3.5 for skipped and repeated times', () => {
    // 2:30 AM didn't happen: read with the offset before the gap (EST), so 3:30 AM EDT.
    expect(iso(zonedToMs('2007-03-11T02:30', 'America/New_York'))).toBe('2007-03-11T07:30:00.000Z');
    // 1:30 AM happened twice: the first one (EDT).
    expect(iso(zonedToMs('2007-11-04T01:30', 'America/New_York'))).toBe('2007-11-04T05:30:00.000Z');
    expect(iso(zonedToMs('2026-03-29T01:30', 'Europe/London'))).toBe('2026-03-29T01:30:00.000Z');
    expect(iso(zonedToMs('2026-10-25T01:30', 'Europe/London'))).toBe('2026-10-25T00:30:00.000Z');
  });

  it('converts both ways', () => {
    const ms = zonedToMs('2026-10-27T09:15', 'Australia/Sydney')!;
    expect(iso(ms)).toBe('2026-10-26T22:15:00.000Z');
    expect(msToZoned(ms, 'Australia/Sydney')).toEqual({
      year: 2026,
      month: 10,
      day: 27,
      hour: 9,
      minute: 15,
    });
    expect(zonedToMs('2026-13-01T09:00', 'UTC')).toBeUndefined();
  });
});
