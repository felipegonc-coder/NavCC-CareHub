import { describe, expect, it } from 'vitest';
import { changedPreferences, DEFAULT_PREFERENCES, preferencesPatch } from './preferences';

describe('notification preferences', () => {
  it('default to all messages, with message text shown', () => {
    expect(DEFAULT_PREFERENCES).toEqual({ notifyAbout: 'all', showText: true });
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
  });
});
