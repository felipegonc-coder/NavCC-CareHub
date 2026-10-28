import { describe, expect, it } from 'vitest';
import { epochMinute } from './time';
import { normalizeSpans, uptimeByDay, uptimeOverWindow, uptimePercent } from './uptime';

const minute = (iso: string) => epochMinute(Date.parse(iso));
const DAY = 24 * 60;
const installedAt = new Date('2026-01-01T00:00:00Z');
const now = new Date('2026-10-27T00:00:00Z');
const to = minute('2026-10-27T00:00:00Z');
const from = to - 30 * DAY;

describe('uptimePercent', () => {
  it('has two decimals, rounded half up', () => {
    expect(uptimePercent(1, 3)).toBe(33.33);
    expect(uptimePercent(2, 3)).toBe(66.67);
    expect(uptimePercent(1, 20_000)).toBe(0.01);
    expect(uptimePercent(1, 20_001)).toBe(0);
    expect(uptimePercent(0, 1440)).toBe(0);
  });

  it('is exact for the spec example: 43 missing minutes in 30 days is 99.90%', () => {
    expect(uptimePercent(30 * DAY - 43, 30 * DAY)).toBe(99.9);
  });

  it('only shows 100 when no minute is missing', () => {
    expect(uptimePercent(30 * DAY, 30 * DAY)).toBe(100);
    expect(uptimePercent(30 * DAY - 1, 30 * DAY)).toBe(99.99);
  });

  it('is null when nothing was measured', () => {
    expect(uptimePercent(0, 0)).toBeNull();
  });
});

describe('normalizeSpans', () => {
  it('sorts, merges overlapping and touching runs, and drops empty ones', () => {
    expect(
      normalizeSpans([
        { start: 20, end: 30 },
        { start: 5, end: 5 },
        { start: 0, end: 10 },
        { start: 10, end: 12 },
        { start: 25, end: 40 },
      ]),
    ).toEqual([
      { start: 0, end: 12 },
      { start: 20, end: 40 },
    ]);
  });
});

describe('uptimeOverWindow', () => {
  it('ST-10: heartbeats missing 43 minutes over 30 days give 99.90%', () => {
    const spans = [
      { start: from, end: from + 1000 },
      { start: from + 1043, end: to },
    ];
    expect(uptimeOverWindow(spans, { now, installedAt })).toEqual({
      from: new Date('2026-09-27T00:00:00Z'),
      to: now,
      upMinutes: 30 * DAY - 43,
      totalMinutes: 30 * DAY,
      percent: 99.9,
    });
  });

  it('ST-04: stopping the app for 5 minutes lowers uptime by 5 minutes', () => {
    const spans = [
      { start: from, end: to - 100 },
      { start: to - 95, end: to },
    ];
    const window = uptimeOverWindow(spans, { now, installedAt });
    expect(window.totalMinutes - window.upMinutes).toBe(5);
    expect(window.percent).toBe(99.99);
  });

  it('counts a restart that missed no minute as fully up', () => {
    const spans = [
      { start: from, end: to - 10 },
      { start: to - 10, end: to },
    ];
    expect(uptimeOverWindow(spans, { now, installedAt }).percent).toBe(100);
  });

  it('only looks at the last 30 days', () => {
    const spans = [
      { start: from - 5000, end: from - 4000 },
      { start: from, end: to },
    ];
    const window = uptimeOverWindow(spans, { now, installedAt });
    expect(window.totalMinutes).toBe(30 * DAY);
    expect(window.percent).toBe(100);
  });

  it('starts at installation when that is less than 30 days ago', () => {
    const installed = new Date('2026-10-25T00:00:00Z');
    const spans = [{ start: minute('2026-10-25T00:00:00Z'), end: to - 60 }];
    const window = uptimeOverWindow(spans, { now, installedAt: installed });
    expect(window.from).toEqual(installed);
    expect(window.totalMinutes).toBe(2 * DAY);
    expect(window.upMinutes).toBe(2 * DAY - 60);
    expect(window.percent).toBe(97.92);
  });

  it('leaves out the current minute, whose heartbeat may still be coming', () => {
    const window = uptimeOverWindow([{ start: from, end: to + 1 }], {
      now: new Date('2026-10-27T00:00:45Z'),
      installedAt,
    });
    expect(window.to).toEqual(now);
    expect(window.upMinutes).toBe(30 * DAY);
    expect(window.percent).toBe(100);
  });

  it('has no percentage before the first heartbeat', () => {
    expect(uptimeOverWindow([], { now, installedAt: null })).toMatchObject({
      totalMinutes: 0,
      percent: null,
    });
    expect(uptimeOverWindow([], { now, installedAt: now }).percent).toBeNull();
  });

  it('counts the first minute after installation once its heartbeat is in', () => {
    const soon = new Date('2026-10-27T00:00:20Z');
    expect(uptimeOverWindow([{ start: to, end: to + 1 }], { now: soon, installedAt: now })).toEqual(
      {
        from: now,
        to: new Date('2026-10-27T00:01:00Z'),
        upMinutes: 1,
        totalMinutes: 1,
        percent: 100,
      },
    );
    // A minute later, the current minute is left out again.
    const later = new Date('2026-10-27T00:01:20Z');
    const spans = [{ start: to, end: to + 2 }];
    expect(uptimeOverWindow(spans, { now: later, installedAt: now })).toMatchObject({
      upMinutes: 1,
      totalMinutes: 1,
      percent: 100,
    });
  });
});

describe('uptimeByDay', () => {
  const allUp = [{ start: minute('2026-09-01T00:00:00Z'), end: minute('2026-11-30T00:00:00Z') }];

  it('gives 30 days by default, ending today in the viewer’s time zone', () => {
    const evening = new Date('2026-10-27T00:30:00Z');
    const denver = uptimeByDay(allUp, { now: evening, installedAt, timeZone: 'America/Denver' });
    expect(denver).toHaveLength(30);
    expect(denver[0]?.date).toBe('2026-09-27');
    // 18:30 in Denver: today is measured from midnight up to now.
    expect(denver.at(-1)).toEqual({
      date: '2026-10-26',
      upMinutes: 1110,
      totalMinutes: 1110,
      percent: 100,
    });
    const utc = uptimeByDay(allUp, { now: evening, installedAt, timeZone: 'UTC' });
    expect(utc[0]?.date).toBe('2026-09-28');
    expect(utc.at(-1)).toMatchObject({ date: '2026-10-27', totalMinutes: 30, percent: 100 });
  });

  it('splits an outage across midnight in the viewer’s time zone', () => {
    // 18:00 to 18:30 UTC is 23:45 to 00:15 in Kathmandu.
    const spans = [
      { start: minute('2026-09-01T00:00:00Z'), end: minute('2026-10-20T18:00:00Z') },
      { start: minute('2026-10-20T18:30:00Z'), end: minute('2026-11-30T00:00:00Z') },
    ];
    const options = { now: new Date('2026-10-27T00:30:00Z'), installedAt, days: 10 };
    const kathmandu = uptimeByDay(spans, { ...options, timeZone: 'Asia/Kathmandu' });
    expect(kathmandu.find((day) => day.date === '2026-10-20')).toMatchObject({
      upMinutes: DAY - 15,
      percent: 98.96,
    });
    expect(kathmandu.find((day) => day.date === '2026-10-21')).toMatchObject({
      upMinutes: DAY - 15,
      percent: 98.96,
    });
    const utc = uptimeByDay(spans, { ...options, timeZone: 'UTC' });
    expect(utc.find((day) => day.date === '2026-10-20')?.percent).toBe(97.92);
    expect(utc.find((day) => day.date === '2026-10-21')?.percent).toBe(100);
  });

  it('follows 25- and 23-hour days when the clocks change', () => {
    const fall = uptimeByDay(allUp, {
      now: new Date('2026-11-03T12:00:00Z'),
      installedAt,
      timeZone: 'America/Denver',
      days: 5,
    });
    expect(fall.map((day) => [day.date, day.totalMinutes])).toEqual([
      ['2026-10-30', 1440],
      ['2026-10-31', 1440],
      ['2026-11-01', 1500],
      ['2026-11-02', 1440],
      ['2026-11-03', 300],
    ]);
    const spring = uptimeByDay(
      [{ start: minute('2026-03-01T00:00:00Z'), end: minute('2026-03-11T00:00:00Z') }],
      { now: new Date('2026-03-10T12:00:00Z'), installedAt, timeZone: 'America/Denver', days: 3 },
    );
    expect(spring.map((day) => [day.date, day.totalMinutes])).toEqual([
      ['2026-03-08', 1380],
      ['2026-03-09', 1440],
      ['2026-03-10', 360],
    ]);
  });

  it('measures nothing before installation', () => {
    const installed = new Date('2026-10-25T12:00:00Z');
    const days = uptimeByDay([{ start: minute('2026-10-25T12:00:00Z'), end: to + 30 }], {
      now: new Date('2026-10-27T00:30:00Z'),
      installedAt: installed,
      timeZone: 'UTC',
      days: 4,
    });
    expect(days.map((day) => [day.date, day.totalMinutes, day.percent])).toEqual([
      ['2026-10-24', 0, null],
      ['2026-10-25', 720, 100],
      ['2026-10-26', 1440, 100],
      ['2026-10-27', 30, 100],
    ]);
  });
});
