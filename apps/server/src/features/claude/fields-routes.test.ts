import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, hasDatabase, injectAs, type TestApp } from '../../testing';

// Fictional people and IDs only. Until Databases binds its host, no property is a Claude field.
describe.skipIf(!hasDatabase)('/api/claude/fields', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  const fill = { databaseId: randomUUID(), propertyId: 'property-summary', rowIds: ['all'] };
  const two = [randomUUID(), randomUUID()];

  it('checks what it is sent', async () => {
    const avery = await createUser(t.db, { name: 'Avery Lin' });
    const typed = { ...fill, rowIds: [randomUUID()], text: 'Typed by someone.' };
    for (const payload of [fill, { ...fill, rowIds: two }, typed]) {
      const response = await injectAs(t.app, avery, {
        method: 'POST',
        url: '/api/claude/fields/fill',
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it('refuses a field nobody may fill, with the standard words', async () => {
    const avery = await createUser(t.db, { name: 'Avery Lin' });
    const response = await injectAs(t.app, avery, {
      method: 'POST',
      url: '/api/claude/fields/fill',
      payload: { ...fill, rowIds: [randomUUID()] },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: 'forbidden',
        message: "You don't have access to this.",
        details: { reason: 'no_permission' },
      },
    });
  });
});
