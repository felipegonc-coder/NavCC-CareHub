import { describe, expect, it } from 'vitest';
import {
  activePause,
  canPause,
  changedPreferences,
  DEFAULT_PREFERENCES,
  MAX_PAUSE_MS,
  preferencesPatch,
} from './preferences';

const now = new Date('2026-10-27T15:00:00Z');
const later = (ms: number) => new Date(now.getTime() + ms);
const hour = 60 * 60 * 1000;

describe('notification preferences', () => {
  it('default to all messages, with message text shown and no pause', () => {
    expect(DEFAULT_PREFERENCES).toEqual({ notifyAbout: 'all', showText: true, pause: null });
  });

  it('change only the settings that are given', () => {
    expect(changedPreferences(preferencesPatch.parse({ showText: false }))).toEqual({
      showText: false,
    });
    expect(changedPreferences(preferencesPatch.parse({ notifyAbout: 'mentions' }))).toEqual({
      notifyAbout: 'mentions',
    });
    expect(changedPreferences(preferencesPatch.parse({}))).toEqual({});
  });

  it('pause until a time, until turned back on, or not at all', () => {
    const until = '2026-10-28T08:00:00-06:00';
    expect(changedPreferences(preferencesPatch.parse({ pause: { until } }))).toEqual({
      pause: { until: new Date('2026-10-28T14:00:00Z') },
    });
    expect(changedPreferences(preferencesPatch.parse({ pause: { until: null } }))).toEqual({
      pause: { until: null },
    });
    expect(changedPreferences(preferencesPatch.parse({ pause: null }))).toEqual({ pause: null });
  });

  it('refuse unknown settings and values', () => {
    expect(preferencesPatch.safeParse({ notifyAbout: 'everything' }).success).toBe(false);
    expect(preferencesPatch.safeParse({ showText: 'yes' }).success).toBe(false);
    expect(preferencesPatch.safeParse({ muted: true }).success).toBe(false);
    expect(preferencesPatch.safeParse({ pause: { until: 'tomorrow' } }).success).toBe(false);
    expect(preferencesPatch.safeParse({ pause: { for: '1h' } }).success).toBe(false);
    expect(preferencesPatch.safeParse({ pause: true }).success).toBe(false);
  });

  it('pause for up to 7 days, or until turned back on', () => {
    expect(canPause({ until: later(hour) }, now)).toBe(true);
    expect(canPause({ until: later(MAX_PAUSE_MS) }, now)).toBe(true);
    expect(canPause({ until: null }, now)).toBe(true);
    expect(canPause({ until: now }, now)).toBe(false);
    expect(canPause({ until: later(-hour) }, now)).toBe(false);
    expect(canPause({ until: later(MAX_PAUSE_MS + 1) }, now)).toBe(false);
  });

  it('end a pause at its time', () => {
    const pause = { until: later(hour) };
    expect(activePause(pause, now)).toBe(pause);
    expect(activePause(pause, later(hour))).toBeNull();
    expect(activePause({ until: null }, later(1000 * hour))).toEqual({ until: null });
    expect(activePause(null, now)).toBeNull();
  });
});
