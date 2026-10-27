import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { readSettings } from './settings';

const schema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  REMINDER_LIMIT: z.coerce.number().int().positive().default(20),
  MEETINGS_ENABLED: z.stringbool().optional(),
});

function read(env: Record<string, string | undefined>) {
  const warn = vi.fn();
  return { settings: readSettings(schema, { env, log: { warn } }), warn };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readSettings', () => {
  it('reads and converts the values that are set', () => {
    const { settings, warn } = read({
      GOOGLE_CLIENT_ID: 'client-123',
      REMINDER_LIMIT: '5',
      MEETINGS_ENABLED: 'true',
    });
    expect(settings).toEqual({
      GOOGLE_CLIENT_ID: 'client-123',
      REMINDER_LIMIT: 5,
      MEETINGS_ENABLED: true,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('gives undefined for missing optional settings and defaults for the rest', () => {
    const { settings, warn } = read({});
    expect(settings).toEqual({ REMINDER_LIMIT: 20 });
    expect(settings.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('counts empty values as unset', () => {
    const { settings, warn } = read({
      GOOGLE_CLIENT_ID: '',
      REMINDER_LIMIT: '',
      MEETINGS_ENABLED: '',
    });
    expect(settings).toEqual({ REMINDER_LIMIT: 20 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores invalid values with a warning that never shows them', () => {
    const { settings, warn } = read({
      REMINDER_LIMIT: '-4secret',
      MEETINGS_ENABLED: 'perhaps-secret',
    });
    expect(settings).toEqual({ REMINDER_LIMIT: 20 });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toMatch(/^REMINDER_LIMIT isn't valid, so it counts as unset: /);
    expect(warn.mock.calls[1]?.[0]).toMatch(
      /^MEETINGS_ENABLED isn't valid, so it counts as unset: /,
    );
    expect(warn.mock.calls.flat().join(' ')).not.toContain('secret');
  });

  it('never throws, even for a missing setting without a default', () => {
    const strict = z.object({ CLAUDE_API_URL: z.url() });
    expect(readSettings(strict, { env: {}, log: { warn: vi.fn() } })).toEqual({});
  });

  it('reads process.env by default', () => {
    vi.stubEnv('REMINDER_LIMIT', '7');
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    expect(readSettings(schema)).toMatchObject({ REMINDER_LIMIT: 7 });
    expect(readSettings(schema).GOOGLE_CLIENT_ID).toBeUndefined();
  });
});
