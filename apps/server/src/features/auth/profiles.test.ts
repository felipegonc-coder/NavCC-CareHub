import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, type TestApp } from '../../testing';
import { getProfiles } from './profiles';

/** A database that fails the test if anything asks it a question. */
const unused = new Proxy({} as Db, {
  get() {
    throw new Error('getProfiles should not use the database here.');
  },
});

describe('getProfiles without ids to look up', () => {
  it('answers without the database when no id could be a user', async () => {
    expect(await getProfiles(unused, [])).toEqual(new Map());
    expect(await getProfiles(unused, ['', 'x', 'not-a-user-id'])).toEqual(new Map());
  });
});

describe.skipIf(!hasDatabase)('getProfiles', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test?.close();
  });

  it('gives names and pictures by user id and leaves out ids that are not users', async () => {
    const avery = await createUser(test.db, { name: 'Avery Lin' });
    const jordan = await createUser(test.db, { name: 'Jordan Park' });
    const ids = [avery.id, randomUUID(), avery.id, 'x', jordan.id];
    const profiles = await getProfiles(test.db, ids);
    expect([...profiles.keys()].sort()).toEqual([avery.id, jordan.id].sort());
    expect(profiles.get(avery.id)).toEqual({ id: avery.id, name: 'Avery Lin', avatarUrl: null });
    expect(profiles.get(jordan.id)?.name).toBe('Jordan Park');
  });
});
