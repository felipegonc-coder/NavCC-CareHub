import { describe, expect, it } from 'vitest';
import {
  VERSION_KINDS,
  VERSION_MAX_STRETCH_MS,
  VERSION_PAUSE_MS,
  VERSION_REASONS,
  isVersionReason,
  kindForReason,
} from './index';

describe('version kinds', () => {
  it('has a "before" kind for every reason', () => {
    for (const reason of VERSION_REASONS) expect(VERSION_KINDS).toContain(kindForReason(reason));
    expect(kindForReason('import')).toBe('before_import');
  });

  it('knows its reasons', () => {
    expect(isVersionReason('template')).toBe(true);
    expect(isVersionReason('automatic')).toBe(false);
    expect(isVersionReason(undefined)).toBe(false);
  });
});

describe('version timing', () => {
  it('waits 2 minutes after the last edit and saves within 10 minutes in long sessions', () => {
    expect(VERSION_PAUSE_MS).toBe(120_000);
    expect(VERSION_MAX_STRETCH_MS).toBeLessThan(10 * 60 * 1000);
    // An hour of typing: the stretch, plus up to 15 s for the check and 10 s for the save.
    expect(Math.floor((60 * 60 * 1000) / (VERSION_MAX_STRETCH_MS + 25_000))).toBeGreaterThanOrEqual(
      6,
    );
  });
});
