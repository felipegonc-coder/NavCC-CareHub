import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME_SETTINGS,
  pendingForHome,
  remindersApi,
  timeSettingsFrom,
  withoutReminder,
  type Reminder,
} from './api';

const PAGE_ID = '01e1bba4-156e-4877-b3f0-127fe2fa5cff';
const EVENT_ID = '3bc493cd-177d-4c5a-8a7a-28f6a3c5d1d3';
const IDS = [
  '48313e66-f940-4a1d-bc39-07c324f36c6e',
  'b2c1acfa-cfe1-4d0b-aa6d-c0052a45e6a1',
  '41c5fc60-fa60-49ce-b141-8354916eece7',
  '9da95f0e-2bfd-4b10-87ea-cec553e57bb9',
  '614c137a-f36b-40e7-b684-cc1457b2aef8',
  'd7cb5f93-bf49-42a0-bee1-0690134bd3b2',
] as const;

const reminder = (id: string, overrides: Partial<Reminder> = {}): Reminder => ({
  id,
  target: { type: 'page', pageId: PAGE_ID },
  title: 'Shift handover',
  href: `/p/${PAGE_ID}`,
  minutesBefore: null,
  dueAt: '2026-10-27T21:30:00.000Z',
  note: '',
  status: 'pending',
  sentAt: null,
  createdAt: '2026-10-26T15:00:00.000Z',
  ...overrides,
});

const event = reminder(IDS[1], {
  target: { type: 'event', eventId: EVENT_ID, occurrenceStart: '2026-10-28T16:00:00.000Z' },
  title: null,
  href: `/calendar?event=${EVENT_ID}&occurrence=2026-10-28T16:00:00.000Z`,
  minutesBefore: 10,
  dueAt: '2026-10-28T15:50:00.000Z',
  note: 'Bring the rota',
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers every request with `body` as JSON; returns the paths asked for. */
function answer(body: unknown): string[] {
  const paths: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    paths.push(String(input));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return paths;
}

describe('remindersApi.list', () => {
  it('reads the list the server sends, with event targets and null titles', async () => {
    const done = reminder(IDS[2], { status: 'done', sentAt: '2026-10-26T21:30:00.000Z' });
    const paths = answer({ pending: [reminder(IDS[0]), event], sent: [done] });
    await expect(remindersApi.list()).resolves.toEqual({
      pending: [reminder(IDS[0]), event],
      sent: [done],
    });
    expect(paths).toEqual(['/api/reminders']);
  });

  it('refuses a reply that is not a reminder list', async () => {
    answer({ pending: [{ id: IDS[0] }], sent: [] });
    await expect(remindersApi.list()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('time settings', () => {
  it('reads the zone and the 24-hour setting from /api/auth/me', async () => {
    const paths = answer({
      user: { name: 'Avery Quinn', timeZone: 'America/New_York', use24h: true },
    });
    await expect(remindersApi.timeSettings()).resolves.toEqual({
      timeZone: 'America/New_York',
      use24h: true,
    });
    expect(paths).toEqual(['/api/auth/me']);
  });

  it('uses America/Denver and 12-hour times without usable settings', () => {
    expect(DEFAULT_TIME_SETTINGS).toEqual({ timeZone: 'America/Denver', use24h: false });
    expect(timeSettingsFrom({ user: { name: 'Avery Quinn' } })).toEqual(DEFAULT_TIME_SETTINGS);
    expect(timeSettingsFrom({ user: { timeZone: 'Nowhere/Atlantis', use24h: true } })).toEqual(
      DEFAULT_TIME_SETTINGS,
    );
    expect(timeSettingsFrom(undefined)).toEqual(DEFAULT_TIME_SETTINGS);
  });
});

describe('pendingForHome', () => {
  it('gives Home the first ones in the server’s order, with what it shows', () => {
    const pending = [reminder(IDS[0]), event, ...IDS.slice(2).map((id) => reminder(id))];
    const home = pendingForHome({ pending, sent: [] }, 5);
    expect(home.map((each) => each.id)).toEqual(IDS.slice(0, 5));
    expect(home[1]).toEqual({
      id: IDS[1],
      type: 'event',
      title: null,
      dueAt: '2026-10-28T15:50:00.000Z',
      note: 'Bring the rota',
      href: `/calendar?event=${EVENT_ID}&occurrence=2026-10-28T16:00:00.000Z`,
    });
    expect(pendingForHome({ pending: [], sent: [] }, 5)).toEqual([]);
  });
});

describe('withoutReminder', () => {
  it('takes the reminder out of whichever section it is in', () => {
    const list = { pending: [reminder(IDS[0]), event], sent: [reminder(IDS[2])] };
    expect(withoutReminder(list, IDS[1])).toEqual({
      pending: [reminder(IDS[0])],
      sent: [reminder(IDS[2])],
    });
    expect(withoutReminder(list, IDS[2]).sent).toEqual([]);
  });
});
