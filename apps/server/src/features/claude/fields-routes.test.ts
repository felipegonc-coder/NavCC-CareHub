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
  const progressUrl = `/api/claude/fields/progress?databaseId=${fill.databaseId}&propertyId=property-summary`;

  it('needs a signed-in person', async () => {
    const response = await t.app.inject({ method: 'GET', url: progressUrl });
    expect(response.statusCode).toBe(401);
  });

  it('checks what it is sent', async () => {
    const avery = await createUser(t.db, { name: 'Avery Lin' });
    const typed = { ...fill, rowIds: 'all', text: 'Typed by someone.' };
    for (const url of ['/api/claude/fields/plan', '/api/claude/fields/fill']) {
      for (const payload of [fill, typed]) {
        const response = await injectAs(t.app, avery, { method: 'POST', url, payload });
        expect(response.statusCode).toBe(400);
      }
    }
  });

  it('refuses a field nobody may fill, with the standard words', async () => {
    const avery = await createUser(t.db, { name: 'Avery Lin' });
    for (const url of ['/api/claude/fields/plan', '/api/claude/fields/fill']) {
      for (const rowIds of [[randomUUID()], [randomUUID(), randomUUID()], 'all']) {
        const payload = { ...fill, rowIds, confirmedRows: 0 };
        const response = await injectAs(t.app, avery, {
          method: 'POST',
          url,
          payload: url.endsWith('/plan') ? { ...fill, rowIds } : payload,
        });
        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({
          error: {
            code: 'forbidden',
            message: "You don't have access to this.",
            details: { reason: 'no_permission' },
          },
        });
      }
    }
    const progress = await injectAs(t.app, avery, { method: 'GET', url: progressUrl });
    expect(progress.json()).toEqual({ waiting: 0 });
  });
});
