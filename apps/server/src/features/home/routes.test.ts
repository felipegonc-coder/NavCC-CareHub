// The Home settings routes on Postgres: each person's own settings (HR-06).
import { eq, sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { users } from '../auth/schema';
import { publishToUsers } from '../live';
import { homeSettings } from './schema';

// The app's own /api/home, with the live events kept here instead of sent.
vi.mock('../live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../live')>()),
  publishToUsers: vi.fn(),
}));

describe.skipIf(!hasDatabase)('Home settings on Postgres', () => {
  let test: TestApp;
  let avery: TestUser;
  let sam: TestUser;

  beforeAll(async () => {
    test = await createTestApp();
    avery = await createUser(test.db, { name: 'Avery Lin' });
    sam = await createUser(test.db, { name: 'Sam Ortiz' });
  });
  afterAll(async () => {
    await test?.close();
  });

  async function read(user: TestUser) {
    const response = await injectAs(test.app, user, { method: 'GET', url: '/api/home/settings' });
    expect(response.statusCode).toBe(200);
    return response.json().settings;
  }
  const change = (user: TestUser, payload: object) =>
    injectAs(test.app, user, { method: 'PATCH', url: '/api/home/settings', payload });

  it('starts with every section shown and Upcoming open', async () => {
    expect(await read(avery)).toEqual({ hiddenSections: [], upcomingFolded: false });
  });

  it('keeps a hidden section hidden for that person only (HR-06)', async () => {
    const response = await change(avery, { hiddenSections: ['recent', 'upcoming', 'recent'] });
    expect(response.statusCode).toBe(200);
    const settings = { hiddenSections: ['upcoming', 'recent'], upcomingFolded: false };
    expect(response.json()).toEqual({ settings });
    expect(await read(avery)).toEqual(settings);
    expect(await read(sam)).toEqual({ hiddenSections: [], upcomingFolded: false });
    expect(vi.mocked(publishToUsers)).toHaveBeenLastCalledWith([avery.id], {
      type: 'home-settings-changed',
    });
  });

  it('changes only the settings it is sent', async () => {
    expect((await change(sam, { upcomingFolded: true })).statusCode).toBe(200);
    expect((await change(sam, { hiddenSections: ['learning'] })).statusCode).toBe(200);
    expect(await read(sam)).toEqual({ hiddenSections: ['learning'], upcomingFolded: true });
    await change(sam, { hiddenSections: [] });
    expect(await read(sam)).toEqual({ hiddenSections: [], upcomingFolded: true });
  });

  it('says what is wrong with a change, and changes nothing', async () => {
    const before = await read(avery);
    const unknown = await change(avery, { hiddenSections: ['weather'] });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error).toMatchObject({
      code: 'invalid',
      message: "That isn't a section of Home.",
    });
    const empty = await change(avery, {});
    expect(empty.json().error).toMatchObject({ code: 'invalid', message: 'Nothing to change.' });
    expect((await change(avery, { upcomingFolded: 'yes' })).statusCode).toBe(400);
    // There's no way to name another person.
    expect((await change(avery, { userId: sam.id, upcomingFolded: true })).statusCode).toBe(400);
    expect(await read(avery)).toEqual(before);
    expect(await read(sam)).toEqual({ hiddenSections: [], upcomingFolded: true });
  });

  it('goes when the person does', async () => {
    const riley = await createUser(test.db, { name: 'Riley Chen' });
    await change(riley, { upcomingFolded: true });
    await test.db.delete(users).where(eq(users.id, riley.id));
    const { rows } = await test.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM home_settings WHERE user_id = ${riley.id}`,
    );
    expect(rows[0]?.count).toBe(0);
  });

  it('refuses a section the table does not know', async () => {
    await expect(
      test.db.execute(
        sql`INSERT INTO home_settings (user_id, hidden_sections) VALUES (${sam.id}, '{weather}')
            ON CONFLICT (user_id) DO UPDATE SET hidden_sections = EXCLUDED.hidden_sections`,
      ),
    ).rejects.toThrow();
  });

  it('describes the table exactly as the migration made it', async () => {
    const { name, columns } = getTableConfig(homeSettings);
    const { rows } = await test.db.execute<{ name: string; type: string; notNull: boolean }>(sql`
      SELECT attname AS name, format_type(atttypid, atttypmod) AS type, attnotnull AS "notNull"
      FROM pg_attribute
      WHERE attrelid = ${name}::regclass AND attnum > 0 AND NOT attisdropped`);
    const byName = <T extends { name: string }>(list: T[]) =>
      [...list].sort((a, b) => a.name.localeCompare(b.name));
    const expected = columns.map((column) => ({
      name: column.name,
      type: column.getSQLType(),
      notNull: column.notNull,
    }));
    expect(byName(rows)).toEqual(byName(expected));
  });
});
