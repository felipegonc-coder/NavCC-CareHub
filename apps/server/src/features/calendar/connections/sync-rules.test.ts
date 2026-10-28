import { describe, expect, it } from 'vitest';
import { GoogleCalendarError } from '../sync/google/client';
import { TransportError } from '../sync/google/http';
import type { ExternalEvent } from '../sync/types';
import {
  NOT_SUPPORTED,
  RECONNECT_MESSAGE,
  SyncFailure,
  classify,
  googleTokensSchema,
  linkEventId,
  linkSecretSchema,
  monthsFrom,
  plain,
} from './sync-rules';

const UNKNOWN = 'Something went wrong reading this calendar. Care Hub will try again shortly.';

/** Stands in for the link reader's errors, which the rules know by name. */
const readerError = (name: string, fields: { retryable?: boolean; code?: string }) =>
  Object.assign(new Error("Care Hub couldn't read this calendar link."), { name, ...fields });

const sorted = (error: unknown) => {
  const failure = classify(error);
  return { kind: failure.kind, message: failure.message, retryAfterMs: failure.retryAfterMs };
};

describe('sorting a failed read', () => {
  it('asks for a new sign-in when Google turns the sign-in down', () => {
    for (const kind of ['unauthorized', 'forbidden'] as const) {
      expect(sorted(new GoogleCalendarError(kind))).toEqual({
        kind: 'reconnect',
        message: RECONNECT_MESSAGE,
        retryAfterMs: undefined,
      });
    }
  });

  it('tries Google again later, waiting as long as Google asks', () => {
    expect(sorted(new GoogleCalendarError('rate-limited', { retryAfterMs: 30_000 }))).toEqual({
      kind: 'temporary',
      message: 'Google Calendar asked Care Hub to slow down. Care Hub will try again shortly.',
      retryAfterMs: 30_000,
    });
    expect(sorted(new GoogleCalendarError('unavailable')).kind).toBe('temporary');
  });

  it("stops trying while the Google Calendar API isn't turned on", () => {
    expect(sorted(new GoogleCalendarError('not-configured')).kind).toBe('broken');
  });

  it('tries again after a network failure, unless trying again cannot help', () => {
    const message = "Care Hub couldn't reach Google Calendar.";
    expect(sorted(new TransportError('network', message, true))).toMatchObject({
      kind: 'temporary',
      message,
    });
    expect(sorted(new TransportError('bridge', message, false)).kind).toBe('broken');
  });

  it('follows the link reader: retryable fetches and calendars too complex to read in time', () => {
    expect(sorted(readerError('FetchLinkError', { retryable: true })).kind).toBe('temporary');
    expect(sorted(readerError('FetchLinkError', { retryable: false })).kind).toBe('broken');
    expect(sorted(readerError('IcalParseError', { code: 'too-complex' })).kind).toBe('temporary');
    expect(sorted(readerError('IcalParseError', { code: 'not-calendar' }))).toMatchObject({
      kind: 'broken',
      message: "Care Hub couldn't read this calendar link.",
    });
  });

  it("never passes on an unexpected error's own words", () => {
    expect(sorted(new Error('connect ECONNREFUSED 10.0.0.7:443'))).toEqual({
      kind: 'temporary',
      message: UNKNOWN,
      retryAfterMs: undefined,
    });
    expect(sorted('nothing useful').message).toBe(UNKNOWN);
  });

  it('keeps a failure that was already sorted', () => {
    const failure = new SyncFailure('broken', NOT_SUPPORTED);
    expect(classify(failure)).toBe(failure);
  });
});

describe("a layer's message", () => {
  it('stays a plain sentence', () => {
    const sentence = "The link redirected to an address Care Hub can't use.";
    expect(plain(sentence)).toBe(sentence);
  });

  it('is never a link, which may be private', () => {
    for (const message of [
      "Couldn't read https://calendar.example.org/private-4f9a/basic.ics",
      'webcal:calendar.example.org/private-4f9a',
      'See www.example.org for details',
      'x'.repeat(301),
      '',
    ]) {
      expect(plain(message)).toBe(UNKNOWN);
    }
  });
});

describe('link event ids', () => {
  const lesson: ExternalEvent = {
    uid: 'lesson-1@school.example.org',
    status: 'confirmed',
    title: 'Swimming lesson',
    busy: true,
    start: { kind: 'utc', instant: '2026-11-02T15:00:00Z' },
    rrule: 'FREQ=WEEKLY',
  };

  it('are the uid, and the occurrence a changed occurrence replaces', () => {
    expect(linkEventId(lesson)).toBe('lesson-1@school.example.org');
    const ids = [
      { kind: 'date', date: '2026-11-02' },
      { kind: 'utc', instant: '2026-11-02T15:00:00Z' },
      { kind: 'zoned', dateTime: '2026-11-02T10:00', timeZone: 'America/New_York' },
      { kind: 'floating', dateTime: '2026-11-02T10:00' },
    ] as const;
    expect(ids.map((recurrenceId) => linkEventId({ ...lesson, recurrenceId }))).toEqual([
      'lesson-1@school.example.org#2026-11-02',
      'lesson-1@school.example.org#2026-11-02T15:00:00Z',
      'lesson-1@school.example.org#2026-11-02T10:00 America/New_York',
      'lesson-1@school.example.org#2026-11-02T10:00',
    ]);
  });
});

describe('the sync window', () => {
  it('counts whole months from a date without changing it', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    expect(monthsFrom(now, -6).toISOString()).toBe('2026-05-10T12:00:00.000Z');
    expect(monthsFrom(now, 12).toISOString()).toBe('2027-11-10T12:00:00.000Z');
    expect(now.toISOString()).toBe('2026-11-10T12:00:00.000Z');
  });
});

describe('sealed secrets', () => {
  it('hold a whole Google sign-in', () => {
    const tokens = {
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      expiresAt: '2026-11-10T13:00:00.000Z',
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    };
    expect(googleTokensSchema.parse(tokens)).toEqual(tokens);
    expect(googleTokensSchema.safeParse({ ...tokens, refreshToken: '' }).success).toBe(false);
  });

  it('hold a link', () => {
    expect(linkSecretSchema.safeParse({ url: '' }).success).toBe(false);
    expect(linkSecretSchema.parse({ url: 'https://calendar.example.org/basic.ics' }).url).toBe(
      'https://calendar.example.org/basic.ics',
    );
  });
});
