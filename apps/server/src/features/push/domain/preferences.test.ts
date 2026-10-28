import { describe, expect, it } from 'vitest';
import {
  activePause,
  changedPreferences,
  DEFAULT_PREFERENCES,
  pauseBody,
  pauseFrom,
  preferencesPatch,
} from './preferences';

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

  it('refuse unknown settings and values', () => {
    expect(preferencesPatch.safeParse({ notifyAbout: 'everything' }).success).toBe(false);
    expect(preferencesPatch.safeParse({ showText: 'yes' }).success).toBe(false);
    expect(preferencesPatch.safeParse({ muted: true }).success).toBe(false);
    expect(preferencesPatch.safeParse({ pause: null }).success).toBe(false);
  });
});

describe('pausing notifications', () => {
  // 9:00 AM on Tuesday, Oct 27, 2026 in Denver (UTC-6 until Nov 1).
  const morning = new Date('2026-10-27T15:00:00Z');

  it('lasts an hour, or until turned back on', () => {
    expect(pauseFrom('in_an_hour', morning, 'America/Denver')).toEqual({
      until: new Date('2026-10-27T16:00:00Z'),
    });
    expect(pauseFrom('when_turned_on', morning, 'America/Denver')).toEqual({ until: null });
  });

  it("ends at 8:00 AM on the next day in the person's time zone", () => {
    const tomorrow = (now: string, timeZone: string) =>
      pauseFrom('tomorrow_8am', new Date(now), timeZone).until?.toISOString();
    expect(tomorrow('2026-10-27T15:00:00Z', 'America/Denver')).toBe('2026-10-28T14:00:00.000Z');
    // 11:30 PM and 12:30 AM in Denver: the next day starts at midnight.
    expect(tomorrow('2026-10-28T05:30:00Z', 'America/Denver')).toBe('2026-10-28T14:00:00.000Z');
    expect(tomorrow('2026-10-28T06:30:00Z', 'America/Denver')).toBe('2026-10-29T14:00:00.000Z');
    // Denver's clocks go back on Sunday, Nov 1: 8:00 AM is then UTC-7.
    expect(tomorrow('2026-10-31T20:00:00Z', 'America/Denver')).toBe('2026-11-01T15:00:00.000Z');
    expect(tomorrow('2026-10-27T23:30:00Z', 'Europe/London')).toBe('2026-10-28T08:00:00.000Z');
    // A zone Intl doesn't know falls back to Denver.
    expect(tomorrow('2026-10-27T15:00:00Z', 'Mars/Olympus_Mons')).toBe('2026-10-28T14:00:00.000Z');
  });

  it('is on until it ends', () => {
    const until = new Date('2026-10-27T16:00:00Z');
    expect(activePause({ until }, morning)).toEqual({ until });
    expect(activePause({ until }, until)).toBeNull();
    expect(activePause({ until: null }, new Date('2027-10-27T15:00:00Z'))).toEqual({ until: null });
    expect(activePause(null, morning)).toBeNull();
  });

  it('is chosen from the three lengths only', () => {
    expect(pauseBody.parse({ ends: 'tomorrow_8am' })).toEqual({ ends: 'tomorrow_8am' });
    for (const body of [{}, { ends: 'forever' }, { ends: 'in_an_hour', until: null }]) {
      expect(pauseBody.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});
