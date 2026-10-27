import { DEFAULT_SETTINGS, settingsResponseSchema } from '@carehub/team-calendar-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';

describe.skipIf(!hasDatabase)('calendar settings', () => {
  let test: TestApp;
  let ada: TestUser;
  let ben: TestUser;

  beforeAll(async () => {
    test = await createTestApp();
    ada = await createUser(test.db, { name: 'Ada Example' });
    ben = await createUser(test.db, { name: 'Ben Sample', role: 'viewer' });
  });

  afterAll(async () => {
    await test?.close();
  });

  async function settingsOf(user: TestUser) {
    const response = await injectAs(test.app, user, {
      method: 'GET',
      url: '/api/calendar/settings',
    });
    expect(response.statusCode, response.body).toBe(200);
    return settingsResponseSchema.parse(response.json()).settings;
  }

  const change = (user: TestUser, payload: Record<string, unknown>) =>
    injectAs(test.app, user, { method: 'PATCH', url: '/api/calendar/settings', payload });

  async function changed(user: TestUser, payload: Record<string, unknown>) {
    const response = await change(user, payload);
    expect(response.statusCode, response.body).toBe(200);
    return settingsResponseSchema.parse(response.json()).settings;
  }

  it('starts with the defaults', async () => {
    expect(await settingsOf(ada)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps each change on top of the earlier ones, for that person only', async () => {
    const lisbon = { timeZone: 'Europe/Lisbon', label: 'Lisbon' };
    expect(await changed(ada, { hideWeekends: true, secondTimeZone: lisbon })).toEqual({
      ...DEFAULT_SETTINGS,
      hideWeekends: true,
      secondTimeZone: lisbon,
    });
    const after = await changed(ada, { secondTimeZone: null, defaultReminder: 10 });
    expect(after).toEqual({ ...DEFAULT_SETTINGS, hideWeekends: true, defaultReminder: 10 });
    expect(await settingsOf(ada)).toEqual(after);
    expect(await settingsOf(ben)).toEqual(DEFAULT_SETTINGS);
  });

  it('refuses empty, unknown and bad changes', async () => {
    for (const payload of [{}, { weekStart: 1 }, { defaultLength: 45 }, { defaultReminder: -1 }]) {
      expect((await change(ben, payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(await settingsOf(ben)).toEqual(DEFAULT_SETTINGS);
  });
});
