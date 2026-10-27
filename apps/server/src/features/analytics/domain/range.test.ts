import { combine, toInstant, todayIn } from '@carehub/team-time';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESET_DAYS,
  KEEP_DAYS,
  PRESET_DAYS,
  customRange,
  daySpans,
  deleteBefore,
  firstKeptDay,
  presetRange,
} from './range';

const HOUR_MS = 3_600_000;
const today = '2026-10-27';

describe('ranges', () => {
  it('AN-04: the presets are the last 7, 30 and 90 days, with today', () => {
    expect(PRESET_DAYS).toEqual([7, 30, 90]);
    expect(DEFAULT_PRESET_DAYS).toBe(7);
    expect(presetRange(7, today)).toEqual({ from: '2026-10-21', to: today });
    expect(presetRange(30, today)).toEqual({ from: '2026-09-28', to: today });
    expect(presetRange(90, today)).toEqual({ from: '2026-07-30', to: today });
  });

  it('keeps a year: today and the 364 days before', () => {
    expect(KEEP_DAYS).toBe(365);
    expect(firstKeptDay(today)).toBe('2025-10-28');
    // 365 days, so a year with February 29 starts a day later than the date a year back.
    expect(firstKeptDay('2028-03-01')).toBe('2027-03-03');
  });

  it('cuts a custom range to the kept days', () => {
    expect(customRange('2026-10-01', '2026-10-10', today)).toEqual({
      from: '2026-10-01',
      to: '2026-10-10',
    });
    expect(customRange('2026-10-27', '2026-10-27', today)).toEqual({ from: today, to: today });
    expect(customRange('2024-01-01', '2027-01-01', today)).toEqual({
      from: '2025-10-28',
      to: today,
    });
  });

  it('refuses custom ranges that are backwards, not dates or not kept', () => {
    expect(customRange('2026-10-10', '2026-10-01', today)).toBeNull();
    expect(customRange('2026-10-01', 'tomorrow', today)).toBeNull();
    expect(customRange(undefined, '2026-10-01', today)).toBeNull();
    expect(customRange('2026-02-30', '2026-03-01', today)).toBeNull();
    expect(customRange('2024-01-01', '2025-10-27', today)).toBeNull();
    expect(customRange('2026-10-28', '2026-11-30', today)).toBeNull();
  });
});

describe('daySpans', () => {
  it('gives each day from midnight to midnight in the time zone', () => {
    expect(daySpans({ from: '2026-10-26', to: '2026-10-27' }, 'Asia/Kolkata')).toEqual([
      {
        day: '2026-10-26',
        start: new Date('2026-10-25T18:30:00Z'),
        end: new Date('2026-10-26T18:30:00Z'),
      },
      {
        day: '2026-10-27',
        start: new Date('2026-10-26T18:30:00Z'),
        end: new Date('2026-10-27T18:30:00Z'),
      },
    ]);
  });

  it('has 23- and 25-hour days when the clocks change', () => {
    const hours = (from: string, to: string) =>
      daySpans({ from, to }, 'America/Denver').map(
        ({ start, end }) => (end.getTime() - start.getTime()) / HOUR_MS,
      );
    expect(hours('2026-03-07', '2026-03-09')).toEqual([24, 23, 24]);
    expect(hours('2026-10-31', '2026-11-02')).toEqual([24, 25, 24]);
  });

  it('covers the range without gaps or overlaps', () => {
    const spans = daySpans(presetRange(90, today), 'America/New_York');
    expect(spans).toHaveLength(90);
    expect(spans[0]?.day).toBe('2026-07-30');
    expect(spans.at(-1)?.day).toBe(today);
    for (let i = 1; i < spans.length; i++) expect(spans[i]?.start).toEqual(spans[i - 1]?.end);
  });
});

describe('deleteBefore', () => {
  it('AN-07: deletes activity over a year and a day old', () => {
    const now = new Date('2026-10-27T15:00:00Z');
    expect(deleteBefore(now)).toEqual(new Date('2025-10-26T15:00:00Z'));
  });

  it('keeps the whole first kept day in every time zone, and at most two days more', () => {
    const zones = ['Pacific/Kiritimati', 'Asia/Kolkata', 'UTC', 'America/Denver', 'Etc/GMT+12'];
    for (let hour = 0; hour < 24; hour++) {
      const now = new Date(Date.UTC(2026, 2, 8, hour, 59));
      for (const zone of zones) {
        const first = firstKeptDay(todayIn(zone, now));
        const extra =
          toInstant(combine(first, '00:00'), zone).getTime() - deleteBefore(now).getTime();
        expect(extra).toBeGreaterThanOrEqual(0);
        expect(extra).toBeLessThanOrEqual(49 * HOUR_MS);
      }
    }
  });
});
