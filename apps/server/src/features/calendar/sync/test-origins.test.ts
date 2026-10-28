import { describe, expect, it } from 'vitest';
import { isTestOrigin, readTestCalendarOrigins } from './test-origins';

describe('isTestOrigin', () => {
  it('accepts http loopback origins with a port', () => {
    for (const origin of ['http://127.0.0.1:4598', 'http://localhost:4598', 'http://[::1]:4598']) {
      expect(isTestOrigin(origin)).toBe(true);
    }
  });

  it('refuses everything else', () => {
    for (const entry of [
      'https://127.0.0.1:4598',
      'http://127.0.0.1',
      'http://127.0.0.1:80',
      'http://127.0.0.1:4598/',
      'http://127.0.0.1:4598/calendar.ics',
      'http://127.0.0.1:4598?view=week',
      'http://sam@127.0.0.1:4598',
      'http://127.1:4598',
      'http://127.0.0.2:4598',
      'http://LOCALHOST:4598',
      'http://localhost.:4598',
      'http://0.0.0.0:4598',
      'http://[::]:4598',
      'http://[::ffff:127.0.0.1]:4598',
      'http://10.0.0.5:4598',
      'http://calendar.example.com:4598',
      'webcal://127.0.0.1:4598',
      '127.0.0.1:4598',
      '',
    ]) {
      expect(isTestOrigin(entry)).toBe(false);
    }
  });
});

describe('readTestCalendarOrigins', () => {
  function read(env: Record<string, string | undefined>) {
    const warnings: string[] = [];
    const origins = readTestCalendarOrigins({ env, log: { warn: (m) => warnings.push(m) } });
    return { origins, warnings };
  }

  it('reads a comma-separated list when CAREHUB_TEST_HOOKS=1', () => {
    expect(
      read({
        CAREHUB_TEST_HOOKS: '1',
        CAREHUB_TEST_CALENDAR_ORIGINS:
          ' http://127.0.0.1:4598, http://[::1]:4598,,http://127.0.0.1:4598',
      }),
    ).toEqual({ origins: ['http://127.0.0.1:4598', 'http://[::1]:4598'], warnings: [] });
  });

  it('is empty without CAREHUB_TEST_HOOKS=1, and says the list is ignored', () => {
    const origins = 'http://127.0.0.1:4598';
    expect(read({})).toEqual({ origins: [], warnings: [] });
    expect(read({ CAREHUB_TEST_HOOKS: '1' })).toEqual({ origins: [], warnings: [] });
    expect(read({ CAREHUB_TEST_HOOKS: '1', CAREHUB_TEST_CALENDAR_ORIGINS: '' })).toEqual({
      origins: [],
      warnings: [],
    });
    for (const hooks of [undefined, '0', '']) {
      expect(read({ CAREHUB_TEST_HOOKS: hooks, CAREHUB_TEST_CALENDAR_ORIGINS: origins })).toEqual({
        origins: [],
        warnings: ["CAREHUB_TEST_CALENDAR_ORIGINS is ignored, because CAREHUB_TEST_HOOKS isn't 1."],
      });
    }
  });

  it('refuses the whole list if anything in it is not an http loopback origin with a port', () => {
    for (const value of [
      'http://127.0.0.1:4598,https://calendar.example.com',
      'http://10.0.0.5:4598',
      'http://localhost',
      ' , ',
    ]) {
      const { origins, warnings } = read({
        CAREHUB_TEST_HOOKS: '1',
        CAREHUB_TEST_CALENDAR_ORIGINS: value,
      });
      expect(origins).toEqual([]);
      expect(warnings).toEqual([
        "CAREHUB_TEST_CALENDAR_ORIGINS isn't valid, so it counts as unset: give only http loopback origins with a port, like http://127.0.0.1:4598, separated by commas",
      ]);
    }
  });
});
